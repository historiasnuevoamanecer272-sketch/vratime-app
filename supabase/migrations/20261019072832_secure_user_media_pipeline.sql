-- Prepared locally. Publish together with media-upload and the new client only.
begin;

create schema if not exists media_private;
revoke all on schema media_private from public, anon, authenticated;
grant usage on schema media_private to service_role;
create table media_private.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  kind text not null check (kind in ('avatar','listing','feedback')),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  bucket text not null check (bucket in ('AVATARS','LISTING-PHOTOS','FEEDBACK-ATTACHMENTS')),
  path text not null unique,
  status text not null default 'reserved' check (status in ('reserved','complete','failed','deleting','deleted')),
  reserved_bytes integer not null check (reserved_bytes between 1 and 2097152),
  bytes integer check (bytes between 1 and 2097152),
  output_hash text check (output_hash ~ '^[0-9a-f]{64}$'),
  planned_bytes integer check (planned_bytes between 1 and 2097152),
  url text,
  claim_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes',
  completed_at timestamptz,
  cleanup_token uuid,
  cleanup_expires_at timestamptz,
  unique (user_id, operation_id)
);
alter table media_private.assets enable row level security;
revoke all on media_private.assets from public, anon, authenticated;
grant select, insert, update on media_private.assets to service_role;
create index media_assets_user_recent on media_private.assets(user_id, created_at desc);
create index media_assets_reservations on media_private.assets(user_id, expires_at) where status = 'reserved';
create table media_private.upload_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  asset_id uuid not null references media_private.assets(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
alter table media_private.upload_attempts enable row level security;
revoke all on media_private.upload_attempts from public,anon,authenticated;
grant select,insert on media_private.upload_attempts to service_role;
grant usage,select on sequence media_private.upload_attempts_id_seq to service_role;
create index media_upload_attempts_user_hour on media_private.upload_attempts(user_id,attempted_at desc);

-- Limits affect future writes only. Existing images and URLs are retained.
update storage.buckets set file_size_limit = 524288, allowed_mime_types = array['image/jpeg'] where id = 'AVATARS';
update storage.buckets set file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'] where id = 'LISTING-PHOTOS';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('FEEDBACK-ATTACHMENTS','FEEDBACK-ATTACHMENTS',false,2097152,array['image/jpeg'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Restrictive policies also close unknown old permissive policies. Service-role
-- writes bypass RLS, but user JWTs cannot use Storage upload/upsert/move/delete.
create policy media_server_insert_only on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id not in ('AVATARS','LISTING-PHOTOS','FEEDBACK-ATTACHMENTS'));
create policy media_server_update_only on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id not in ('AVATARS','LISTING-PHOTOS','FEEDBACK-ATTACHMENTS'))
  with check (bucket_id not in ('AVATARS','LISTING-PHOTOS','FEEDBACK-ATTACHMENTS'));
create policy media_server_delete_only on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id not in ('AVATARS','LISTING-PHOTOS','FEEDBACK-ATTACHMENTS'));
create policy media_feedback_private_read on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id <> 'FEEDBACK-ATTACHMENTS');
-- Leave avatars_owner_select from 20261019064710 and all public photo reads intact.
-- Service-created objects do not carry the caller's owner_id. Preserve metadata
-- reads for new owner-scoped avatars as well; direct user writes remain denied.
create policy media_avatar_owner_path_read on storage.objects for select to authenticated
  using (bucket_id = 'AVATARS' and split_part(name,'/',1) = (select auth.uid())::text);

create function public.media_reserve_upload(expected_user_id uuid, upload_operation_id uuid, media_kind text, input_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare asset media_private.assets%rowtype; used_bytes bigint; held_bytes bigint; recent integer; cap integer; asset_id uuid := gen_random_uuid(); selected_bucket text; is_retry boolean := false; stored boolean := false;
begin
  if expected_user_id is null or upload_operation_id is null or media_kind not in ('avatar','listing','feedback') or input_hash is null or input_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid media reservation'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(expected_user_id::text, 71032));
  select * into asset from media_private.assets a where a.user_id = expected_user_id and a.operation_id = upload_operation_id for update;
  if found then
    if asset.input_hash <> media_reserve_upload.input_hash or asset.kind <> media_kind then return jsonb_build_object('error','media_operation_conflict'); end if;
    if asset.status = 'complete' then return jsonb_build_object('status','complete','url',asset.url,'path',asset.path,'assetId',asset.id); end if;
    if asset.status in ('deleting','deleted') then return jsonb_build_object('error','media_asset_removed'); end if;
    if asset.status = 'reserved' and asset.expires_at > now() then return jsonb_build_object('error','media_upload_in_progress'); end if;
    is_retry := true;
    select exists(select 1 from storage.objects o where o.bucket_id=asset.bucket and o.name=asset.path) into stored;
    if stored and (asset.output_hash is null or asset.planned_bytes is null) then return jsonb_build_object('error','media_reconciliation_required'); end if;
  end if;
  select count(*) into recent from media_private.upload_attempts a where a.user_id = expected_user_id and a.attempted_at > now() - interval '1 hour';
  if recent >= 30 then return jsonb_build_object('error','media_rate_limit'); end if;
  if stored then
    update media_private.assets set status='reserved',claim_token=gen_random_uuid(),expires_at=now()+interval '2 minutes' where id=asset.id returning * into asset;
    insert into media_private.upload_attempts(user_id,asset_id) values(expected_user_id,asset.id);
    return jsonb_build_object('status','reconcile','assetId',asset.id,'path',asset.path,'claimToken',asset.claim_token,'outputHash',asset.output_hash,'outputBytes',asset.planned_bytes);
  end if;
  -- Reconcile real Storage metadata every time, including files predating this ledger.
  -- Unknown size fails closed instead of allowing unmetered legacy objects.
  select coalesce(sum(case when (o.metadata->>'size') ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint else 104857600 end),0)
  into used_bytes from storage.objects o where o.bucket_id in ('AVATARS','LISTING-PHOTOS','FEEDBACK-ATTACHMENTS')
    and (o.owner_id = expected_user_id::text or split_part(o.name,'/',1) = expected_user_id::text);
  select coalesce(sum(a.reserved_bytes),0) into held_bytes from media_private.assets a
  where a.user_id = expected_user_id and a.status = 'reserved' and a.expires_at > now()
    and (not is_retry or a.id <> asset.id)
    and not exists(select 1 from storage.objects o where o.bucket_id = a.bucket and o.name = a.path);
  cap := case when media_kind = 'avatar' then 524288 else 2097152 end;
  if used_bytes + held_bytes + cap > 104857600 then return jsonb_build_object('error','media_quota_exceeded'); end if;
  selected_bucket := case media_kind when 'avatar' then 'AVATARS' when 'listing' then 'LISTING-PHOTOS' else 'FEEDBACK-ATTACHMENTS' end;
  if is_retry then
    update media_private.assets set status='reserved',claim_token=gen_random_uuid(),expires_at=now()+interval '2 minutes' where id=asset.id returning * into asset;
  else
    insert into media_private.assets(id,user_id,operation_id,kind,input_hash,bucket,path,reserved_bytes)
    values(asset_id,expected_user_id,upload_operation_id,media_kind,input_hash,selected_bucket,expected_user_id::text || '/' || asset_id::text || '.jpg',cap) returning * into asset;
  end if;
  insert into media_private.upload_attempts(user_id,asset_id) values(expected_user_id,asset.id);
  return jsonb_build_object('status','reserved','assetId',asset.id,'path',asset.path,'claimToken',asset.claim_token);
end;
$$;

-- Persist the immutable encoded identity before any Storage write. Reclaimed
-- workers may upload the same bytes only; upsert=false prevents replacement.
create function public.media_prepare_upload(expected_user_id uuid,target_asset_id uuid,claim_token uuid,output_bytes integer,output_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare asset media_private.assets%rowtype;
begin
  select * into asset from media_private.assets a where a.id=target_asset_id and a.user_id=expected_user_id and a.claim_token=media_prepare_upload.claim_token for update;
  if not found or asset.status <> 'reserved' or asset.expires_at <= now() then return jsonb_build_object('error','media_stale_claim'); end if;
  if output_bytes is null or output_bytes not between 1 and asset.reserved_bytes or output_hash is null or output_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error','media_invalid_output'); end if;
  if asset.output_hash is not null and (asset.output_hash <> media_prepare_upload.output_hash or asset.planned_bytes <> output_bytes) then return jsonb_build_object('error','media_output_conflict'); end if;
  update media_private.assets set planned_bytes=output_bytes,output_hash=media_prepare_upload.output_hash where id=asset.id;
  return jsonb_build_object('status','prepared');
end;
$$;

create function public.media_complete_upload(expected_user_id uuid, target_asset_id uuid, claim_token uuid, output_bytes integer, output_url text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare asset media_private.assets%rowtype; stored_bytes bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(expected_user_id::text, 71032));
  select * into asset from media_private.assets a where a.id = target_asset_id and a.user_id = expected_user_id and a.claim_token = media_complete_upload.claim_token for update;
  if not found then return jsonb_build_object('error','media_not_found'); end if;
  if asset.status = 'complete' then return jsonb_build_object('status','complete','assetId',asset.id,'url',asset.url,'path',asset.path); end if;
  if asset.status <> 'reserved' or asset.expires_at <= now() or output_bytes is null or output_bytes < 1 or output_bytes > asset.reserved_bytes or asset.planned_bytes is distinct from output_bytes or asset.output_hash is null or output_url is null or length(output_url) > 2048 then return jsonb_build_object('error','media_invalid_completion'); end if;
  if asset.kind = 'feedback' and output_url <> 'media:' || asset.id::text then return jsonb_build_object('error','media_invalid_completion'); end if;
  select case when (o.metadata->>'size') ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint else null end into stored_bytes
  from storage.objects o where o.bucket_id = asset.bucket and o.name = asset.path and o.metadata->>'mimetype' = 'image/jpeg';
  if stored_bytes is distinct from output_bytes::bigint then return jsonb_build_object('error','media_storage_unconfirmed'); end if;
  update media_private.assets set status = 'complete', bytes = output_bytes, url = output_url, completed_at = now() where id = asset.id;
  return jsonb_build_object('status','complete','assetId',asset.id,'url',output_url,'path',asset.path);
end;
$$;

create function public.media_fail_upload(expected_user_id uuid, target_asset_id uuid, claim_token uuid)
returns void language sql security invoker set search_path = '' as $$
  update media_private.assets a set status = 'failed' where a.id = target_asset_id and a.user_id = expected_user_id and a.claim_token = media_fail_upload.claim_token and a.status = 'reserved'
    and not exists(select 1 from storage.objects o where o.bucket_id = a.bucket and o.name = a.path);
$$;

create function public.media_private_asset(expected_user_id uuid, target_asset_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('path',a.path,'bucket',a.bucket)
  from media_private.assets a where a.id = target_asset_id and a.kind = 'feedback' and a.status = 'complete'
    and (a.user_id = expected_user_id or exists(select 1 from public.profiles p where p.id = expected_user_id and p.app_role in ('moderator','admin')));
$$;

-- Triggers need private asset lookup when normal authenticated listing RPCs run.
-- They are not exposed APIs; no user can execute these SECURITY DEFINER functions.
create function media_private.validate_listing_media()
returns trigger language plpgsql security definer set search_path = '' as $$
declare photo text; old_photos jsonb := '[]'::jsonb; photos jsonb; n integer;
begin
  if tg_op = 'UPDATE' and new.image_url is not distinct from old.image_url and new.image_urls is not distinct from old.image_urls then return new; end if;
  if jsonb_typeof(new.image_urls) is distinct from 'array' then raise exception 'media_invalid_photos'; end if;
  if jsonb_array_length(new.image_urls) > 5 then raise exception 'media_photo_limit'; end if;
  if exists(select 1 from jsonb_array_elements(new.image_urls) e where jsonb_typeof(e) <> 'string') then raise exception 'media_invalid_photos'; end if;
  photos := new.image_urls;
  if nullif(new.image_url,'') is not null and not photos @> jsonb_build_array(new.image_url) then photos := photos || jsonb_build_array(new.image_url); end if;
  select count(distinct value) into n from jsonb_array_elements_text(photos);
  if n > 5 then raise exception 'media_photo_limit'; end if;
  if tg_op = 'UPDATE' then old_photos := coalesce(old.image_urls,'[]'::jsonb) || case when old.image_url is null then '[]'::jsonb else jsonb_build_array(old.image_url) end; end if;
  for photo in select value from jsonb_array_elements_text(photos) loop
    if old_photos @> jsonb_build_array(photo) then continue; end if;
    perform a.id from media_private.assets a where a.user_id = new.user_id and a.kind = 'listing' and a.status = 'complete' and a.url = photo for share;
    if not found then raise exception 'media_unowned_listing_photo'; end if;
  end loop;
  return new;
end;
$$;
create trigger listings_validate_media before insert or update of image_url,image_urls on public.listings
for each row execute function media_private.validate_listing_media();

create function media_private.validate_avatar_media()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.avatar_url is null or new.avatar_url = '' or (tg_op = 'UPDATE' and new.avatar_url is not distinct from old.avatar_url) then return new; end if;
  perform a.id from media_private.assets a where a.user_id = new.id and a.kind = 'avatar' and a.status = 'complete' and a.url = new.avatar_url for share;
  if not found then raise exception 'media_unowned_avatar'; end if;
  return new;
end;
$$;
create trigger profiles_validate_avatar before insert or update of avatar_url on public.profiles
for each row execute function media_private.validate_avatar_media();

create function media_private.validate_feedback_media()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.screenshot_url is null or new.screenshot_url = '' or (tg_op = 'UPDATE' and new.screenshot_url is not distinct from old.screenshot_url) then return new; end if;
  perform a.id from media_private.assets a where a.user_id = new.user_id and a.kind = 'feedback' and a.status = 'complete' and 'media:' || a.id::text = new.screenshot_url for share;
  if not found then raise exception 'media_unowned_feedback'; end if;
  return new;
end;
$$;
create trigger feedback_validate_media before insert or update of screenshot_url on public.user_feedback
for each row execute function media_private.validate_feedback_media();

-- Strip URL queries/fragments before comparing Storage reference paths. A legacy
-- avatar URL with ?cache=... still protects its object from any cleanup report.
create function media_private.object_is_referenced(target_bucket text,target_path text,target_asset_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.profiles p where right(split_part(split_part(p.avatar_url,'?',1),'#',1),length('/storage/v1/object/public/'||target_bucket||'/'||target_path))='/storage/v1/object/public/'||target_bucket||'/'||target_path)
  or exists(select 1 from public.listings l where right(split_part(split_part(l.image_url,'?',1),'#',1),length('/storage/v1/object/public/'||target_bucket||'/'||target_path))='/storage/v1/object/public/'||target_bucket||'/'||target_path
    or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(l.image_urls)='array' then l.image_urls else '[]'::jsonb end) x where right(split_part(split_part(x,'?',1),'#',1),length('/storage/v1/object/public/'||target_bucket||'/'||target_path))='/storage/v1/object/public/'||target_bucket||'/'||target_path))
  or exists(select 1 from public.user_feedback f where f.screenshot_url='media:'||target_asset_id::text
    or right(split_part(split_part(f.screenshot_url,'?',1),'#',1),length('/storage/v1/object/public/'||target_bucket||'/'||target_path))='/storage/v1/object/public/'||target_bucket||'/'||target_path);
$$;
revoke all on function media_private.object_is_referenced(text,text,uuid) from public,anon,authenticated;
grant execute on function media_private.object_is_referenced(text,text,uuid) to service_role;

-- Dry-run report; execution below requires a separate explicit server-only claim.
create function public.media_cleanup_candidates(minimum_age_days integer default 7)
returns table(bucket text,path text,asset_id uuid,created_at timestamptz,reason text)
language sql stable security invoker set search_path = '' as $$
  select o.bucket_id,o.name,a.id,o.created_at,
    case when a.id is null then 'legacy_unreferenced' else 'unreferenced_asset' end
  from storage.objects o left join media_private.assets a on a.bucket = o.bucket_id and a.path = o.name
  where o.bucket_id in ('AVATARS','LISTING-PHOTOS','FEEDBACK-ATTACHMENTS')
    and o.created_at < now() - make_interval(days => greatest(7,least(coalesce(minimum_age_days,7),365)))
    and not media_private.object_is_referenced(o.bucket_id,o.name,a.id)
    and not coalesce(a.status = 'reserved' and a.expires_at > now(),false)
    and not coalesce(a.status = 'deleting' and a.cleanup_expires_at > now(),false)
  union all
  select a.bucket,a.path,a.id,a.created_at,'cleanup_missing_object' from media_private.assets a
  where a.status='deleting' and a.cleanup_expires_at <= now()
    and not exists(select 1 from storage.objects o where o.bucket_id=a.bucket and o.name=a.path)
    and not media_private.object_is_referenced(a.bucket,a.path,a.id)
  order by 4 limit 500;
$$;

-- Row locking serializes reference attachment with a cleanup claim. Trigger
-- lookups use FOR SHARE; once status=deleting no new reference can attach.
create function public.media_claim_cleanup(target_asset_id uuid,minimum_age_days integer default 7)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare asset media_private.assets%rowtype; object_created timestamptz;
begin
  select * into asset from media_private.assets where id=target_asset_id for update;
  if not found then return jsonb_build_object('error','media_legacy_cleanup_requires_review'); end if;
  if asset.status='deleted' then return jsonb_build_object('status','deleted'); end if;
  if (asset.status='reserved' and asset.expires_at>now()) or (asset.status='deleting' and asset.cleanup_expires_at>now()) then return jsonb_build_object('error','media_cleanup_busy'); end if;
  select o.created_at into object_created from storage.objects o where o.bucket_id=asset.bucket and o.name=asset.path;
  if (object_created is null and asset.status<>'deleting') or coalesce(object_created,asset.created_at)>=now()-make_interval(days=>greatest(7,least(coalesce(minimum_age_days,7),365))) then return jsonb_build_object('error','media_cleanup_too_recent'); end if;
  if media_private.object_is_referenced(asset.bucket,asset.path,asset.id) then return jsonb_build_object('error','media_cleanup_referenced'); end if;
  update media_private.assets set status='deleting',cleanup_token=gen_random_uuid(),cleanup_expires_at=now()+interval '2 minutes' where id=asset.id returning * into asset;
  return jsonb_build_object('status','claimed','assetId',asset.id,'bucket',asset.bucket,'path',asset.path,'claimToken',asset.cleanup_token);
end;
$$;

create function public.media_finish_cleanup(target_asset_id uuid,claim_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare asset media_private.assets%rowtype;
begin
  select * into asset from media_private.assets a where a.id=target_asset_id and a.cleanup_token=media_finish_cleanup.claim_token for update;
  if not found then return jsonb_build_object('error','media_stale_claim'); end if;
  if asset.status='deleted' then return jsonb_build_object('status','deleted'); end if;
  if asset.status<>'deleting' or asset.cleanup_expires_at<=now() then return jsonb_build_object('error','media_stale_claim'); end if;
  if exists(select 1 from storage.objects o where o.bucket_id=asset.bucket and o.name=asset.path) then return jsonb_build_object('error','media_cleanup_storage_unconfirmed'); end if;
  if media_private.object_is_referenced(asset.bucket,asset.path,asset.id) then return jsonb_build_object('error','media_cleanup_referenced'); end if;
  update media_private.assets set status='deleted' where id=asset.id;
  return jsonb_build_object('status','deleted');
end;
$$;

revoke all on function public.media_reserve_upload(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.media_prepare_upload(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.media_complete_upload(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.media_fail_upload(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.media_private_asset(uuid,uuid) from public,anon,authenticated;
revoke all on function public.media_cleanup_candidates(integer) from public,anon,authenticated;
revoke all on function public.media_claim_cleanup(uuid,integer) from public,anon,authenticated;
revoke all on function public.media_finish_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.media_reserve_upload(uuid,uuid,text,text) to service_role;
grant execute on function public.media_prepare_upload(uuid,uuid,uuid,integer,text) to service_role;
grant execute on function public.media_complete_upload(uuid,uuid,uuid,integer,text) to service_role;
grant execute on function public.media_fail_upload(uuid,uuid,uuid) to service_role;
grant execute on function public.media_private_asset(uuid,uuid) to service_role;
grant execute on function public.media_cleanup_candidates(integer) to service_role;
grant execute on function public.media_claim_cleanup(uuid,integer) to service_role;
grant execute on function public.media_finish_cleanup(uuid,uuid) to service_role;
revoke all on function media_private.validate_listing_media() from public,anon,authenticated;
revoke all on function media_private.validate_avatar_media() from public,anon,authenticated;
revoke all on function media_private.validate_feedback_media() from public,anon,authenticated;
grant select on storage.objects,public.profiles,public.listings,public.user_feedback to service_role;

commit;
