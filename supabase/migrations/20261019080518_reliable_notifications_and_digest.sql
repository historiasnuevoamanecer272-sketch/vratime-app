begin;

create schema if not exists notifications_private;
revoke all on schema notifications_private from public,anon,authenticated;
grant usage on schema notifications_private to service_role;

create function notifications_private.valid_subscription(endpoint text,p256dh text,auth text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  if endpoint is null or pg_catalog.length(endpoint)>2048 or endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)(:443)?/[^#[:space:]]+$'
    or p256dh is null or p256dh !~ '^[A-Za-z0-9_-]{87}$' or auth is null or auth !~ '^[A-Za-z0-9_-]{22}$' then return false; end if;
  return pg_catalog.octet_length(pg_catalog.decode(pg_catalog.translate(p256dh,'-_','+/')||'=','base64'))=65
    and pg_catalog.get_byte(pg_catalog.decode(pg_catalog.translate(p256dh,'-_','+/')||'=','base64'),0)=4
    and pg_catalog.octet_length(pg_catalog.decode(pg_catalog.translate(auth,'-_','+/')||'==','base64'))=16;
exception when others then return false;
end; $$;

update public.web_push_subscriptions set enabled=false where enabled and not notifications_private.valid_subscription(endpoint,p256dh,auth);
alter table public.web_push_subscriptions add constraint web_push_trusted_service check(not enabled or notifications_private.valid_subscription(endpoint,p256dh,auth));
revoke insert,update,delete on public.web_push_subscriptions from authenticated;

create function public.register_push_subscription(push_endpoint text,push_p256dh text,push_auth text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not notifications_private.valid_subscription(push_endpoint,push_p256dh,push_auth) then raise exception 'push_invalid_subscription'; end if;
  insert into public.web_push_subscriptions(user_id,endpoint,p256dh,auth,enabled)
  values(actor,push_endpoint,push_p256dh,push_auth,true)
  on conflict(user_id,endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,enabled=true,updated_at=now()
  returning id into result;
  return result;
end; $$;

create function public.disable_push_subscription(push_endpoint text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.web_push_subscriptions set enabled=false,updated_at=now() where user_id=auth.uid() and endpoint=push_endpoint;
  return found;
end; $$;

create table notifications_private.deliveries(
  id uuid primary key default gen_random_uuid(),
  inbox_id uuid not null references public.user_inbox(id) on delete cascade,
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check(status in('pending','leased','sent','dead','failed')),
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default now(),lease_token uuid,leased_until timestamptz,
  accepted_at timestamptz,last_status integer,created_at timestamptz not null default now(),
  unique(inbox_id,subscription_id)
);
alter table notifications_private.deliveries enable row level security;
create index notification_deliveries_due on notifications_private.deliveries(next_attempt_at) where status in('pending','leased');
revoke all on notifications_private.deliveries from public,anon,authenticated;
grant select,insert,update,delete on notifications_private.deliveries to service_role;

create function public.get_my_push_status(push_endpoint text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select pg_catalog.jsonb_build_object('enabled',s.enabled,'last_accepted_at',(select max(d.accepted_at) from notifications_private.deliveries d where d.subscription_id=s.id),
    'failed_count',(select count(*) from notifications_private.deliveries d where d.subscription_id=s.id and d.status='failed')) into result
  from public.web_push_subscriptions s where s.user_id=auth.uid() and s.endpoint=push_endpoint;
  return coalesce(result,'{"enabled":false}'::jsonb);
end; $$;

create function notifications_private.user_language(target_user uuid)
returns text language sql stable security invoker set search_path='' as $$
  select case when coalesce(nullif(p.preferred_language,''),p.language) in('ru','me','en','fr','de') then coalesce(nullif(p.preferred_language,''),p.language) else 'en' end from public.profiles p where p.id=target_user;
$$;

create function notifications_private.notification_copy(event text,lang text)
returns jsonb language sql immutable security invoker set search_path='' as $$
select pg_catalog.jsonb_build_object('title',case lang
when 'ru' then case event when 'requested' then 'Новый запрос' when 'accepted' then 'Запрос принят' when 'handover' then 'Передача обновлена' when 'digest' then 'Новые совпадения поиска' when 'reminder' then 'Напоминание' else 'Новое событие' end
when 'me' then case event when 'requested' then 'Novi zahtjev' when 'accepted' then 'Zahtjev je prihvaćen' when 'handover' then 'Primopredaja je ažurirana' when 'digest' then 'Nova podudaranja pretrage' when 'reminder' then 'Podsjetnik' else 'Nova aktivnost' end
when 'fr' then case event when 'requested' then 'Nouvelle demande' when 'accepted' then 'Demande acceptée' when 'handover' then 'Remise mise à jour' when 'digest' then 'Nouveaux résultats de recherche' when 'reminder' then 'Rappel' else 'Nouvelle activité' end
when 'de' then case event when 'requested' then 'Neue Anfrage' when 'accepted' then 'Anfrage angenommen' when 'handover' then 'Übergabe aktualisiert' when 'digest' then 'Neue Suchtreffer' when 'reminder' then 'Erinnerung' else 'Neue Aktivität' end
else case event when 'requested' then 'New request' when 'accepted' then 'Request accepted' when 'handover' then 'Handover updated' when 'digest' then 'New search matches' when 'reminder' then 'Reminder' else 'New activity' end end,
'body',case lang when 'ru' then 'Откройте VratiMe, чтобы посмотреть подробности.' when 'me' then 'Otvorite VratiMe za detalje.' when 'fr' then 'Ouvrez VratiMe pour voir les détails.' when 'de' then 'Öffnen Sie VratiMe für weitere Informationen.' else 'Open VratiMe for details.' end);
$$;

create function notifications_private.localize_inbox()
returns trigger language plpgsql security definer set search_path='' as $$
declare event text:=coalesce(new.payload->>'notification_event',case when new.item_type in('digest','reminder') then new.item_type else 'activity' end); lang text; copy jsonb;
begin
  lang:=coalesce(notifications_private.user_language(new.user_id),'en');
  if new.payload ? 'notification_event' or new.item_type in('digest','reminder') then
    copy:=notifications_private.notification_copy(event,lang); new.title:=copy->>'title'; new.body:=copy->>'body';
  end if;
  new.payload:=coalesce(new.payload,'{}'::jsonb)||pg_catalog.jsonb_build_object('notification_event',event);
  return new;
end; $$;
create trigger inbox_notification_language before insert on public.user_inbox for each row execute function notifications_private.localize_inbox();

create function notifications_private.queue_inbox_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into notifications_private.deliveries(inbox_id,subscription_id)
  select new.id,s.id from public.web_push_subscriptions s where s.user_id=new.user_id and s.enabled
  on conflict(inbox_id,subscription_id) do nothing;
  return new;
end; $$;
create trigger inbox_queue_web_push after insert on public.user_inbox for each row execute function notifications_private.queue_inbox_push();

create function notifications_private.transaction_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid; recipient uuid; stage text; recipients uuid[];
begin
  if tg_op='INSERT' then
    select l.user_id into owner_id from public.listings l where l.id=new.listing_id;
    if owner_id is not null and owner_id is distinct from new.booked_by then
      insert into public.user_inbox(user_id,item_type,title,payload,idempotency_key)
      values(owner_id,'system','VratiMe',pg_catalog.jsonb_build_object('notification_event','requested','transaction_id',new.id),'txn:requested:'||new.id::text) on conflict(user_id,idempotency_key) do nothing;
    end if;
    return new;
  end if;
  if old.accepted_at is null and new.accepted_at is not null and new.booked_by is not null then
    insert into public.user_inbox(user_id,item_type,title,payload,idempotency_key)
    values(new.booked_by,'system','VratiMe',pg_catalog.jsonb_build_object('notification_event','accepted','transaction_id',new.id),'txn:accepted:'||new.id::text) on conflict(user_id,idempotency_key) do nothing;
  end if;
  if old.completed_at is null and new.completed_at is not null then stage:='completed'; recipients:=array[new.giver_id,new.taker_id];
  elsif old.returned_at is null and new.returned_at is not null then stage:='returned'; recipients:=array[new.giver_id,new.taker_id];
  elsif old.handed_over_at is null and new.handed_over_at is not null then stage:='loan-handover'; recipients:=array[new.giver_id,new.taker_id];
  elsif old.giver_confirmed_at is null and new.giver_confirmed_at is not null then stage:='giver-confirmed'; recipients:=array[new.taker_id];
  elsif old.taker_confirmed_at is null and new.taker_confirmed_at is not null then stage:='taker-confirmed'; recipients:=array[new.giver_id]; end if;
  if stage is not null then foreach recipient in array recipients loop
    if recipient is not null then
      insert into public.user_inbox(user_id,item_type,title,payload,idempotency_key)
      values(recipient,'system','VratiMe',pg_catalog.jsonb_build_object('notification_event','handover','transaction_id',new.id),'txn:'||stage||':'||new.id::text) on conflict(user_id,idempotency_key) do nothing;
    end if;
  end loop; end if;
  return new;
end; $$;
create trigger transactions_notify_participants after insert or update on public.transactions for each row execute function notifications_private.transaction_notifications();

grant select on public.profiles,public.listings,public.categories,public.saved_searches,public.web_push_subscriptions,public.user_inbox,public.digest_deliveries,public.listing_matches to service_role;
grant insert,update on public.user_inbox,public.listing_matches,public.digest_deliveries to service_role;
grant update on public.saved_searches,public.web_push_subscriptions to service_role;
alter table public.digest_deliveries alter column delivered_at drop not null;
alter table public.digest_deliveries alter column delivered_at drop default;

create function public.claim_notification_deliveries(batch_limit integer default 10)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  update notifications_private.deliveries set status='failed',lease_token=null,leased_until=null where status='leased' and leased_until<=now() and attempts>=8;
  with candidates as(select d.id from notifications_private.deliveries d join public.web_push_subscriptions s on s.id=d.subscription_id
    where s.enabled and d.attempts<8 and d.next_attempt_at<=now() and (d.status='pending' or (d.status='leased' and d.leased_until<=now()))
    order by d.next_attempt_at,d.id for update of d skip locked limit greatest(1,least(coalesce(batch_limit,10),25))),
  claimed as(update notifications_private.deliveries d set status='leased',attempts=d.attempts+1,lease_token=gen_random_uuid(),leased_until=now()+interval '3 minutes'
    from candidates c where d.id=c.id returning d.*)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',d.id,'lease_token',d.lease_token,'attempts',d.attempts,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth,
    'language',coalesce(notifications_private.user_language(i.user_id),'en'),'event_type',i.payload->>'notification_event')),'[]'::jsonb) into result
  from claimed d join public.web_push_subscriptions s on s.id=d.subscription_id join public.user_inbox i on i.id=d.inbox_id and i.user_id=s.user_id;
  return result;
end; $$;

create function public.finish_notification_delivery(delivery_id uuid,claim_token uuid,status_code integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare job notifications_private.deliveries%rowtype; final_status text;
begin
  if status_code is null or status_code<0 or status_code>599 then raise exception 'notification_invalid_status'; end if;
  select d.* into job from notifications_private.deliveries d where d.id=delivery_id and d.status='leased' and d.lease_token=claim_token and d.leased_until>now() for update;
  if not found then return false; end if;
  final_status:=case when status_code between 200 and 299 then 'sent' when status_code in(404,410) then 'dead' when job.attempts>=8 then 'failed' else 'pending' end;
  update notifications_private.deliveries set status=final_status,last_status=status_code,lease_token=null,leased_until=null,
    accepted_at=case when final_status='sent' then now() else null end,next_attempt_at=now()+least(3600,30*power(2,least(job.attempts-1,7))) * interval '1 second' where id=job.id;
  if status_code in(404,410) then update public.web_push_subscriptions set enabled=false,updated_at=now() where id=job.subscription_id; end if;
  update public.digest_deliveries set push_attempted=true,delivered_at=case when final_status='sent' then coalesce(delivered_at,now()) else delivered_at end where inbox_id=job.inbox_id;
  return true;
end; $$;

create table notifications_private.digest_jobs(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,digest_date date not null,
  status text not null default 'pending' check(status in('pending','leased','done','failed')),attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),lease_token uuid,leased_until timestamptz,snapshot_at timestamptz,searches jsonb not null default '[]'::jsonb,
  unique(user_id,digest_date)
);
alter table notifications_private.digest_jobs enable row level security;
revoke all on notifications_private.digest_jobs from public,anon,authenticated;
grant select,insert,update,delete on notifications_private.digest_jobs to service_role;
create index digest_jobs_due on notifications_private.digest_jobs(next_attempt_at) where status in('pending','leased');

create function notifications_private.category_text(target_category bigint)
returns text language sql stable security invoker set search_path='' as $$
  with recursive parents as(
    select c.id,c.parent_id,pg_catalog.concat_ws(' ',c.name,c.translations->>'ru',c.translations->>'me',c.translations->>'en',c.translations->>'fr',c.translations->>'de',c.category_path) as words,array[c.id] as visited from public.categories c where c.id=target_category
    union all select c.id,c.parent_id,pg_catalog.concat_ws(' ',c.name,c.translations->>'ru',c.translations->>'me',c.translations->>'en',c.translations->>'fr',c.translations->>'de',c.category_path),p.visited||c.id
    from public.categories c join parents p on c.id=p.parent_id where not c.id=any(p.visited)
  ) select coalesce(pg_catalog.string_agg(words,' '),'') from parents;
$$;

create function notifications_private.distance_matches(filters jsonb,latitude double precision,longitude double precision)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare origin_lat double precision; origin_lng double precision; origin_lat_text text; origin_lng_text text; maximum double precision; a double precision;
begin
  if filters->>'distance' is null or filters->>'distance'='all' then return true; end if;
  if filters->>'distance' !~ '^[0-9]+(\.[0-9]+)?$' then return false; end if;
  if pg_catalog.jsonb_typeof(filters->'origin')='array' then
    if pg_catalog.jsonb_array_length(filters->'origin')<>2 then return false; end if;
    origin_lat_text:=filters->'origin'->>0; origin_lng_text:=filters->'origin'->>1;
  elsif pg_catalog.jsonb_typeof(filters->'origin')='object' then
    origin_lat_text:=filters->'origin'->>'lat'; origin_lng_text:=filters->'origin'->>'lng';
  else return false; end if;
  if not coalesce(origin_lat_text ~ '^-?[0-9]+(\.[0-9]+)?$',false) or not coalesce(origin_lng_text ~ '^-?[0-9]+(\.[0-9]+)?$',false) then return false; end if;
  origin_lat:=origin_lat_text::double precision; origin_lng:=origin_lng_text::double precision; maximum:=(filters->>'distance')::double precision;
  if latitude is null or longitude is null or abs(origin_lat)>90 or abs(origin_lng)>180 or abs(latitude)>90 or abs(longitude)>180 or maximum<=0 or maximum>500 then return false; end if;
  a:=power(sin(radians(latitude-origin_lat)/2),2)+cos(radians(origin_lat))*cos(radians(latitude))*power(sin(radians(longitude-origin_lng)/2),2);
  a:=least(1,greatest(0,a));
  return 6371*2*atan2(sqrt(a),sqrt(1-a))<=maximum;
exception when others then return false;
end; $$;

create function notifications_private.digest_candidates(target_user uuid,snapshot_searches jsonb,until_at timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',l.id,'saved_search_id',s.id,'type',l.type,'category',l.category,'category_path',l.category_path,'description',l.description,'category_text',notifications_private.category_text(l.category_id)) order by s.id,l.created_at,l.id),'[]'::jsonb)
from pg_catalog.jsonb_to_recordset(snapshot_searches) as s(id uuid,filters jsonb,created_at timestamptz,last_digest_at timestamptz)
join public.listings l on l.user_id<>target_user and l.status='active' and l.moderation_status='approved' and coalesce(l.available_quantity,l.quantity,0)>0
  and l.created_at<=until_at and l.created_at>coalesce(s.last_digest_at,'-infinity'::timestamptz)
  and (coalesce(nullif(s.filters->>'type',''),'give')='all' or l.type::text=coalesce(nullif(s.filters->>'type',''),'give'))
  and (coalesce(s.filters->>'category','all')='all' or split_part(l.category_path,'/',1)=s.filters->>'category')
  and notifications_private.distance_matches(s.filters,l.lat,l.lng);
$$;

create function public.claim_daily_digest_jobs(batch_limit integer default 10)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare today date:=(now() at time zone 'UTC')::date; job notifications_private.digest_jobs%rowtype; snapshot jsonb; result jsonb:='[]'::jsonb;
begin
  insert into notifications_private.digest_jobs(user_id,digest_date)
  select distinct s.user_id,today from public.saved_searches s where s.notify_daily and (s.last_digest_at is null or (s.last_digest_at at time zone 'UTC')::date<today)
  on conflict(user_id,digest_date) do nothing;
  update notifications_private.digest_jobs set status='failed',lease_token=null,leased_until=null where status='leased' and leased_until<=now() and attempts>=6;
  for job in select d.* from notifications_private.digest_jobs d where d.digest_date<=today and d.attempts<6 and d.next_attempt_at<=now()
    and (d.status='pending' or (d.status='leased' and d.leased_until<=now())) order by d.digest_date,d.id for update skip locked limit greatest(1,least(coalesce(batch_limit,10),20)) loop
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',s.id,'query',s.query,'filters',s.filters,'created_at',s.created_at,'last_digest_at',s.last_digest_at)),'[]'::jsonb) into snapshot
    from public.saved_searches s where s.user_id=job.user_id and s.notify_daily and (s.last_digest_at is null or (s.last_digest_at at time zone 'UTC')::date<job.digest_date);
    update notifications_private.digest_jobs set status='leased',attempts=attempts+1,lease_token=gen_random_uuid(),leased_until=now()+interval '3 minutes',snapshot_at=now(),searches=snapshot where id=job.id returning * into job;
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',job.id,'lease_token',job.lease_token,'language',coalesce(notifications_private.user_language(job.user_id),'en'),'searches',snapshot,'candidates',notifications_private.digest_candidates(job.user_id,snapshot,job.snapshot_at)));
  end loop;
  return result;
end; $$;

create function public.finish_daily_digest_job(job_id uuid,claim_token uuid,matches jsonb default null,error_code text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare job notifications_private.digest_jobs%rowtype; candidates jsonb; inserted integer; inbox_uuid uuid;
begin
  select d.* into job from notifications_private.digest_jobs d where d.id=job_id and d.status='leased' and d.lease_token=claim_token and d.leased_until>now() for update;
  if not found then return false; end if;
  if error_code is not null then
    update notifications_private.digest_jobs set status=case when attempts>=6 then 'failed' else 'pending' end,lease_token=null,leased_until=null,next_attempt_at=now()+least(3600,30*power(2,least(attempts-1,7)))*interval '1 second' where id=job.id;
    return true;
  end if;
  if pg_catalog.jsonb_typeof(matches) is distinct from 'array' then raise exception 'notification_invalid_matches'; end if;
  candidates:=notifications_private.digest_candidates(job.user_id,job.searches,job.snapshot_at);
  if exists(select 1 from pg_catalog.jsonb_array_elements(matches) m where pg_catalog.jsonb_typeof(m->'search_id') is distinct from 'string' or pg_catalog.jsonb_typeof(m->'listing_id') is distinct from 'string'
    or not exists(select 1 from pg_catalog.jsonb_array_elements(candidates) c where c->>'saved_search_id'=m->>'search_id' and c->>'id'=m->>'listing_id')) then raise exception 'notification_invalid_matches'; end if;
  insert into public.listing_matches(user_id,saved_search_id,listing_id,reason)
  select distinct job.user_id,(m->>'search_id')::uuid,(m->>'listing_id')::uuid,'saved_search'
  from pg_catalog.jsonb_array_elements(matches) m join public.saved_searches s on s.id=(m->>'search_id')::uuid and s.user_id=job.user_id and s.notify_daily
  on conflict(user_id,saved_search_id,listing_id) do nothing;
  get diagnostics inserted=row_count;
  if inserted>0 then
    insert into public.user_inbox(user_id,item_type,title,payload,idempotency_key)
    values(job.user_id,'digest','VratiMe',pg_catalog.jsonb_build_object('notification_event','digest','digest_date',job.digest_date,'match_count',inserted),'digest:'||job.user_id::text||':'||job.digest_date::text)
    on conflict(user_id,idempotency_key) do nothing returning id into inbox_uuid;
    if inbox_uuid is null then select i.id into inbox_uuid from public.user_inbox i where i.user_id=job.user_id and i.idempotency_key='digest:'||job.user_id::text||':'||job.digest_date::text; end if;
    insert into notifications_private.deliveries(inbox_id,subscription_id) select inbox_uuid,s.id from public.web_push_subscriptions s where s.user_id=job.user_id and s.enabled on conflict(inbox_id,subscription_id) do nothing;
    insert into public.digest_deliveries(user_id,digest_date,inbox_id,search_count,delivered_at)
    values(job.user_id,job.digest_date,inbox_uuid,pg_catalog.jsonb_array_length(job.searches),null)
    on conflict(user_id,digest_date) do update set inbox_id=excluded.inbox_id,search_count=excluded.search_count,delivered_at=null;
  end if;
  update public.saved_searches s set last_digest_at=job.snapshot_at where s.user_id=job.user_id and s.notify_daily and s.updated_at<=job.snapshot_at and exists(select 1 from pg_catalog.jsonb_array_elements(job.searches) j where j->>'id'=s.id::text);
  update notifications_private.digest_jobs set status='done',lease_token=null,leased_until=null where id=job.id;
  return true;
end; $$;

revoke all on all functions in schema notifications_private from public,anon,authenticated;
grant execute on all functions in schema notifications_private to service_role;
revoke execute on function public.register_push_subscription(text,text,text),public.disable_push_subscription(text),public.get_my_push_status(text) from public,anon,service_role;
grant execute on function public.register_push_subscription(text,text,text),public.disable_push_subscription(text),public.get_my_push_status(text) to authenticated;
revoke execute on function public.claim_notification_deliveries(integer),public.finish_notification_delivery(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_notification_deliveries(integer),public.finish_notification_delivery(uuid,uuid,integer) to service_role;
revoke execute on function public.claim_daily_digest_jobs(integer),public.finish_daily_digest_job(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_daily_digest_jobs(integer),public.finish_daily_digest_job(uuid,uuid,jsonb,text) to service_role;

commit;
