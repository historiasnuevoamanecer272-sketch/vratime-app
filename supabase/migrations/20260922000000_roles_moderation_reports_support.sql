begin;

alter table public.profiles add column if not exists app_role text not null default 'user';
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists rating_penalty numeric(3,1) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_app_role_check') then
    alter table public.profiles add constraint profiles_app_role_check check (app_role in ('user', 'moderator', 'admin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_rating_penalty_check') then
    alter table public.profiles add constraint profiles_rating_penalty_check check (rating_penalty between 0 and 2);
  end if;
end $$;

alter table public.listings add column if not exists moderation_status text not null default 'approved';
alter table public.listings add column if not exists moderation_reason text;
alter table public.listings add column if not exists moderated_by uuid references public.profiles(id);
alter table public.listings add column if not exists moderated_at timestamptz;
alter table public.listings add column if not exists location_verified_at timestamptz;
alter table public.listings add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_moderation_status_check') then
    alter table public.listings add constraint listings_moderation_status_check
      check (moderation_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

update public.listings
set moderation_status = case
      when location_label is not null and char_length(btrim(location_label)) >= 3 and lat is not null and lng is not null then 'approved'
      else 'pending'
    end,
    location_verified_at = case
      when location_label is not null and char_length(btrim(location_label)) >= 3 and lat is not null and lng is not null
        then coalesce(location_verified_at, created_at, now())
      else null
    end;

alter table public.listings alter column moderation_status set default 'pending';

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  moderator_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('approved', 'rejected')),
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('listing', 'deal', 'user')),
  target_id uuid not null,
  target_user_id uuid not null references public.profiles(id),
  reason text not null check (char_length(btrim(reason)) between 3 and 120),
  details text check (details is null or char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'upheld', 'dismissed')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.reputation_penalties (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.reports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(2,1) not null check (amount in (0.5, 1.0)),
  applied_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('feature', 'category', 'problem', 'support')),
  message text not null check (char_length(btrim(message)) between 5 and 3000),
  screenshot_url text,
  status text not null default 'received' check (status in ('received', 'reviewing', 'planned', 'resolved', 'closed')),
  handled_by uuid references public.profiles(id),
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listings_moderation_idx on public.listings (moderation_status, created_at desc);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists feedback_status_idx on public.user_feedback (status, created_at desc);

alter table public.moderation_actions enable row level security;
alter table public.reports enable row level security;
alter table public.reputation_penalties enable row level security;
alter table public.user_feedback enable row level security;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select app_role from public.profiles where id = auth.uid()), 'user'); $$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.current_app_role() in ('moderator', 'admin'); $$;

drop policy if exists listings_public_active_read on public.listings;
drop policy if exists listings_authenticated_read on public.listings;
drop policy if exists listings_owner_insert on public.listings;
create policy listings_public_active_read on public.listings for select to anon
  using (status = 'active' and moderation_status = 'approved' and location_verified_at is not null);
create policy listings_authenticated_read on public.listings for select to authenticated
  using (user_id = auth.uid() or public.is_staff() or (moderation_status = 'approved' and location_verified_at is not null));
create policy listings_owner_insert on public.listings for insert to authenticated
  with check (
    user_id = auth.uid() and status = 'active' and moderation_status = 'pending'
    and location_verified_at is not null and location_label is not null and char_length(btrim(location_label)) >= 3
  );

create policy moderation_actions_staff_read on public.moderation_actions for select to authenticated using (public.is_staff());
create policy reports_owner_or_staff_read on public.reports for select to authenticated using (reporter_id = auth.uid() or public.is_staff());
create policy penalties_owner_or_staff_read on public.reputation_penalties for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy feedback_owner_or_staff_read on public.user_feedback for select to authenticated using (user_id = auth.uid() or public.is_staff());

revoke all on public.moderation_actions from public, anon, authenticated;
revoke all on public.reports from public, anon, authenticated;
revoke all on public.reputation_penalties from public, anon, authenticated;
revoke all on public.user_feedback from public, anon, authenticated;
grant select on public.moderation_actions, public.reports, public.reputation_penalties, public.user_feedback to authenticated;

create or replace function public.set_user_role(target_user_id uuid, target_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() <> 'admin' then raise exception 'Only an administrator can change roles'; end if;
  if target_role not in ('user', 'moderator', 'admin') then raise exception 'Invalid role'; end if;
  update public.profiles set app_role = target_role, updated_at = now() where id = target_user_id;
  if not found then raise exception 'Profile not found'; end if;
end;
$$;

create or replace function public.moderate_listing(target_listing_id uuid, decision text, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare selected_listing public.listings%rowtype;
begin
  if not public.is_staff() then raise exception 'Moderator role required'; end if;
  if decision not in ('approved', 'rejected') then raise exception 'Invalid moderation decision'; end if;
  select * into selected_listing from public.listings where id = target_listing_id for update;
  if not found then raise exception 'Listing not found'; end if;
  if decision = 'approved' and (
    selected_listing.location_verified_at is null or selected_listing.location_label is null
    or char_length(btrim(selected_listing.location_label)) < 3
  ) then raise exception 'A verified address is required'; end if;
  if decision = 'rejected' and char_length(btrim(coalesce(reason, ''))) < 3 then raise exception 'A rejection reason is required'; end if;
  update public.listings set
    moderation_status = decision,
    moderation_reason = case when decision = 'rejected' then btrim(reason) else null end,
    moderated_by = auth.uid(), moderated_at = now(), updated_at = now()
  where id = target_listing_id;
  insert into public.moderation_actions (listing_id, moderator_id, decision, reason)
  values (target_listing_id, auth.uid(), decision, nullif(btrim(coalesce(reason, '')), ''));
end;
$$;

create or replace function public.update_my_listing(
  target_listing_id uuid,
  target_category_id bigint,
  target_category text,
  target_category_path text,
  target_description text,
  target_quantity integer,
  target_lat double precision,
  target_lng double precision,
  target_location_label text,
  target_image_url text,
  target_image_urls text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare selected_listing public.listings%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into selected_listing from public.listings where id = target_listing_id for update;
  if not found or selected_listing.user_id <> auth.uid() then raise exception 'Listing not found'; end if;
  if exists (
    select 1 from public.transactions where listing_id = target_listing_id
      and accepted_at is not null and completed_at is null and canceled_at is null
  ) then raise exception 'An accepted booking cannot be edited'; end if;
  if target_quantity not between 1 and 10000 then raise exception 'Invalid quantity'; end if;
  if target_lat not between -90 and 90 or target_lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
  if char_length(btrim(coalesce(target_location_label, ''))) < 3 then raise exception 'A verified address is required'; end if;
  update public.listings set
    category_id = target_category_id,
    category = btrim(target_category),
    category_path = btrim(target_category_path),
    description = nullif(btrim(coalesce(target_description, '')), ''),
    quantity = target_quantity,
    lat = target_lat,
    lng = target_lng,
    location_label = btrim(target_location_label),
    location_verified_at = now(),
    image_url = nullif(target_image_url, ''),
    image_urls = coalesce(target_image_urls, '{}'::text[]),
    moderation_status = 'pending', moderation_reason = null, moderated_by = null, moderated_at = null,
    status = case when status = 'canceled' then 'active' else status end,
    updated_at = now()
  where id = target_listing_id;
end;
$$;

create or replace function public.set_my_avatar(next_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.profiles set avatar_url = nullif(btrim(coalesce(next_avatar_url, '')), ''), updated_at = now() where id = auth.uid();
end;
$$;

create or replace function public.create_report(target_kind text, target_id uuid, reason text, details text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare target_user uuid;
declare report_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_kind = 'listing' then
    select user_id into target_user from public.listings where id = target_id;
  elsif target_kind = 'deal' then
    select case when giver_id = auth.uid() then taker_id else giver_id end into target_user
    from public.transactions where id = target_id and auth.uid() in (giver_id, taker_id);
  elsif target_kind = 'user' then
    target_user := target_id;
  else
    raise exception 'Invalid report target';
  end if;
  if target_user is null or target_user = auth.uid() then raise exception 'Invalid report target'; end if;
  if char_length(btrim(coalesce(reason, ''))) < 3 then raise exception 'A reason is required'; end if;
  insert into public.reports (reporter_id, target_kind, target_id, target_user_id, reason, details)
  values (auth.uid(), target_kind, target_id, target_user, btrim(reason), nullif(btrim(coalesce(details, '')), ''))
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.resolve_report(target_report_id uuid, decision text, penalty numeric default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare selected_report public.reports%rowtype;
begin
  if not public.is_staff() then raise exception 'Moderator role required'; end if;
  if decision not in ('upheld', 'dismissed') then raise exception 'Invalid report decision'; end if;
  if penalty not in (0, 0.5, 1.0) then raise exception 'Invalid penalty'; end if;
  if decision = 'dismissed' and penalty <> 0 then raise exception 'Dismissed reports cannot add a penalty'; end if;
  select * into selected_report from public.reports where id = target_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  update public.reports set status = decision, resolved_by = auth.uid(), resolved_at = now() where id = target_report_id;
  if decision = 'upheld' and penalty > 0 then
    insert into public.reputation_penalties (report_id, user_id, amount, applied_by)
    values (target_report_id, selected_report.target_user_id, penalty, auth.uid())
    on conflict (report_id) do update set amount = excluded.amount, applied_by = excluded.applied_by;
  else
    delete from public.reputation_penalties where report_id = target_report_id;
  end if;
  update public.profiles p set rating_penalty = least(2, coalesce((
    select sum(rp.amount) from public.reputation_penalties rp where rp.user_id = p.id
  ), 0)), updated_at = now() where p.id = selected_report.target_user_id;
end;
$$;

create or replace function public.create_feedback(feedback_type text, message text, screenshot_url text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare feedback_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if feedback_type not in ('feature', 'category', 'problem', 'support') then raise exception 'Invalid feedback type'; end if;
  if char_length(btrim(coalesce(message, ''))) < 5 then raise exception 'Message is too short'; end if;
  insert into public.user_feedback (user_id, feedback_type, message, screenshot_url)
  values (auth.uid(), feedback_type, btrim(message), nullif(btrim(coalesce(screenshot_url, '')), ''))
  returning id into feedback_id;
  return feedback_id;
end;
$$;

create or replace function public.set_feedback_status(target_feedback_id uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Moderator role required'; end if;
  if next_status not in ('received', 'reviewing', 'planned', 'resolved', 'closed') then raise exception 'Invalid feedback status'; end if;
  update public.user_feedback set status = next_status, handled_by = auth.uid(), handled_at = now(), updated_at = now()
  where id = target_feedback_id;
  if not found then raise exception 'Feedback not found'; end if;
end;
$$;

create or replace function public.book_listing(target_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare selected_listing public.listings%rowtype;
declare new_transaction_id uuid;
declare flags text[] := '{}'::text[];
declare partner_giver uuid;
declare partner_taker uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.refresh_expired_deals();
  select * into selected_listing from public.listings where id = target_listing_id for update;
  if not found then raise exception 'Listing not found'; end if;
  if selected_listing.status <> 'active' then raise exception 'Listing is no longer available'; end if;
  if selected_listing.moderation_status <> 'approved' then raise exception 'Listing is awaiting moderation'; end if;
  if selected_listing.location_verified_at is null or selected_listing.location_label is null
     or char_length(btrim(selected_listing.location_label)) < 3 then raise exception 'A verified address is required'; end if;
  if selected_listing.user_id = auth.uid() then raise exception 'You cannot request your own listing'; end if;
  partner_giver := case when selected_listing.type = 'give' then selected_listing.user_id else auth.uid() end;
  partner_taker := case when selected_listing.type = 'give' then auth.uid() else selected_listing.user_id end;
  if (select count(*) from public.transactions where booked_by = auth.uid() and created_at > now() - interval '24 hours') >= 5 then
    flags := array_append(flags, 'high_request_velocity');
  end if;
  insert into public.transactions (listing_id, giver_id, taker_id, booked_by, risk_flags, expires_at)
  values (selected_listing.id, partner_giver, partner_taker, auth.uid(), flags, now() + interval '48 hours')
  returning id into new_transaction_id;
  return new_transaction_id;
exception when unique_violation then
  raise exception 'You already requested this listing';
end;
$$;

create or replace function public.accept_deal(target_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
declare selected_listing public.listings%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.refresh_expired_deals();
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found then raise exception 'Request not found'; end if;
  select * into selected_listing from public.listings where id = selected_transaction.listing_id for update;
  if selected_listing.user_id <> auth.uid() then raise exception 'Only the listing owner can accept this request'; end if;
  if selected_transaction.completed_at is not null or selected_transaction.canceled_at is not null then raise exception 'Request is already closed'; end if;
  if selected_transaction.accepted_at is not null then return selected_transaction.id; end if;
  if selected_listing.status <> 'active' or selected_listing.moderation_status <> 'approved' then raise exception 'Listing is no longer available'; end if;
  if selected_listing.location_verified_at is null then raise exception 'A verified address is required'; end if;
  update public.transactions set accepted_at = now(), expires_at = now() + interval '24 hours' where id = selected_transaction.id;
  update public.transactions set canceled_at = now(), canceled_reason = 'another_request_accepted'
  where listing_id = selected_listing.id and id <> selected_transaction.id and completed_at is null and canceled_at is null;
  update public.listings set status = 'reserved', updated_at = now() where id = selected_listing.id;
  return selected_transaction.id;
end;
$$;

create or replace function public.get_effective_rating(target_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when coalesce(rating, 0) <= 0 then 0 else greatest(1, rating - coalesce(rating_penalty, 0)) end
  from public.profiles where id = target_user_id;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('AVATARS', 'AVATARS', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_owner_insert on storage.objects;
drop policy if exists avatars_owner_update on storage.objects;
drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'AVATARS' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'AVATARS' and owner_id = auth.uid()::text)
  with check (bucket_id = 'AVATARS' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'AVATARS' and owner_id = auth.uid()::text);

revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.set_user_role(uuid, text) from public, anon;
revoke execute on function public.moderate_listing(uuid, text, text) from public, anon;
revoke execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, text[]) from public, anon;
revoke execute on function public.set_my_avatar(text) from public, anon;
revoke execute on function public.create_report(text, uuid, text, text) from public, anon;
revoke execute on function public.resolve_report(uuid, text, numeric) from public, anon;
revoke execute on function public.create_feedback(text, text, text) from public, anon;
revoke execute on function public.set_feedback_status(uuid, text) from public, anon;
revoke execute on function public.book_listing(uuid) from public, anon;
revoke execute on function public.accept_deal(uuid) from public, anon;
revoke execute on function public.get_effective_rating(uuid) from public, anon;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.set_user_role(uuid, text) to authenticated;
grant execute on function public.moderate_listing(uuid, text, text) to authenticated;
grant execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, text[]) to authenticated;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.create_report(text, uuid, text, text) to authenticated;
grant execute on function public.resolve_report(uuid, text, numeric) to authenticated;
grant execute on function public.create_feedback(text, text, text) to authenticated;
grant execute on function public.set_feedback_status(uuid, text) to authenticated;
grant execute on function public.book_listing(uuid) to authenticated;
grant execute on function public.accept_deal(uuid) to authenticated;
grant execute on function public.get_effective_rating(uuid) to authenticated;

commit;
