/* VratiMe logical safety snapshot + ordered migrations.
   Run this file once in Supabase SQL Editor. It creates vratime_backup first. */
begin;
create schema if not exists vratime_backup;
create table if not exists vratime_backup.categories_before_revival as table public.categories;
create table if not exists vratime_backup.listings_before_revival as table public.listings;
create table if not exists vratime_backup.profiles_before_revival as table public.profiles;
create table if not exists vratime_backup.transactions_before_revival as table public.transactions;
create table if not exists vratime_backup.reviews_before_revival as table public.reviews;
do $$ begin
  if to_regclass('public.profile_contacts') is not null then
    execute 'create table if not exists vratime_backup.profile_contacts_before_revival as table public.profile_contacts';
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'create table if not exists vratime_backup.storage_objects_before_revival as select id, bucket_id, name, owner_id, created_at, updated_at, metadata from storage.objects where bucket_id = ''LISTING-PHOTOS''';
  end if;
end $$;
commit;

-- ===== 20260820210000_vratime_revival.sql =====
begin;

create extension if not exists pgcrypto;

alter table public.categories add column if not exists translations jsonb not null default '{}'::jsonb;

update public.categories
set translations = case category_path
  when 'glass' then '{"ru":"Стекло","me":"Staklo","en":"Glass"}'::jsonb
  when 'cloth' then '{"ru":"Текстиль","me":"Tekstil","en":"Textiles"}'::jsonb
  when 'box' then '{"ru":"Бумага","me":"Papir","en":"Paper"}'::jsonb
  when 'pallet' then '{"ru":"Упаковка","me":"Ambalaža","en":"Packaging"}'::jsonb
  when 'glass/bottles' then '{"ru":"Бутылки","me":"Boce","en":"Bottles"}'::jsonb
  when 'glass/jars' then '{"ru":"Банки","me":"Tegle","en":"Jars"}'::jsonb
  when 'cloth/clothing' then '{"ru":"Одежда","me":"Odjeća","en":"Clothing"}'::jsonb
  when 'cloth/rags' then '{"ru":"Ветошь","me":"Krpe","en":"Rags"}'::jsonb
  when 'box/cardboard' then '{"ru":"Картон","me":"Karton","en":"Cardboard"}'::jsonb
  when 'box/office-paper' then '{"ru":"Офисная бумага","me":"Kancelarijski papir","en":"Office paper"}'::jsonb
  when 'pallet/egg-crates' then '{"ru":"Яичные ячейки","me":"Kartoni za jaja","en":"Egg cartons"}'::jsonb
  when 'pallet/pallets' then '{"ru":"Поддоны","me":"Palete","en":"Pallets"}'::jsonb
  when 'glass/bottles/clear-bottle' then '{"ru":"Прозрачные бутылки","me":"Prozirne boce","en":"Clear bottles"}'::jsonb
  when 'glass/bottles/green-bottle' then '{"ru":"Зелёные бутылки","me":"Zelene boce","en":"Green bottles"}'::jsonb
  when 'glass/bottles/brown-bottle' then '{"ru":"Коричневые бутылки","me":"Braon boce","en":"Brown bottles"}'::jsonb
  when 'glass/jars/clear-jar' then '{"ru":"Прозрачные банки","me":"Prozirne tegle","en":"Clear jars"}'::jsonb
  when 'glass/jars/colored-jar' then '{"ru":"Цветные банки","me":"Obojene tegle","en":"Colored jars"}'::jsonb
  when 'cloth/clothing/men-cloth' then '{"ru":"Мужская одежда","me":"Muška odjeća","en":"Men''s clothing"}'::jsonb
  when 'cloth/clothing/women-cloth' then '{"ru":"Женская одежда","me":"Ženska odjeća","en":"Women''s clothing"}'::jsonb
  when 'cloth/clothing/kids-cloth' then '{"ru":"Детская одежда","me":"Dječja odjeća","en":"Children''s clothing"}'::jsonb
  else jsonb_build_object('ru', name, 'me', name, 'en', name)
end;

create table if not exists public.profile_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  messenger_type text not null,
  contact_value text not null,
  updated_at timestamptz not null default now(),
  constraint profile_contacts_messenger_check check (messenger_type in ('viber', 'wa', 'tg')),
  constraint profile_contacts_value_check check (char_length(btrim(contact_value)) between 3 and 120)
);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone') then
    execute $sql$
      insert into public.profile_contacts (user_id, messenger_type, contact_value)
      select id,
             case when messenger_type in ('viber', 'wa', 'tg') then messenger_type else 'viber' end,
             btrim(phone)
      from public.profiles
      where phone is not null and char_length(btrim(phone)) >= 3
      on conflict (user_id) do update
      set messenger_type = excluded.messenger_type,
          contact_value = excluded.contact_value,
          updated_at = now()
    $sql$;
  end if;
end $$;

alter table public.transactions add column if not exists canceled_at timestamptz;
alter table public.transactions add column if not exists booked_by uuid references auth.users(id);
alter table public.transactions add column if not exists eco_reward_awarded boolean not null default false;

update public.transactions set booked_by = taker_id where booked_by is null;

update public.transactions t
set completed_at = coalesce(t.completed_at, t.created_at), eco_reward_awarded = true
from public.listings l
where l.id = t.listing_id and l.status = 'completed' and t.canceled_at is null;

update public.transactions t
set canceled_at = coalesce(t.canceled_at, now())
from public.listings l
where l.id = t.listing_id
  and l.status <> 'reserved'
  and t.completed_at is null
  and t.canceled_at is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_type_check') then
    alter table public.listings add constraint listings_type_check check (type in ('give', 'take')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_status_check') then
    alter table public.listings add constraint listings_status_check check (status in ('active', 'reserved', 'completed', 'canceled')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_quantity_check') then
    alter table public.listings add constraint listings_quantity_check check (quantity between 1 and 10000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_lat_check') then
    alter table public.listings add constraint listings_lat_check check (lat between -90 and 90) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_lng_check') then
    alter table public.listings add constraint listings_lng_check check (lng between -180 and 180) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reviews_rating_check') then
    alter table public.reviews add constraint reviews_rating_check check (rating between 1 and 5) not valid;
  end if;
end $$;

alter table public.listings validate constraint listings_type_check;
alter table public.listings validate constraint listings_status_check;
alter table public.listings validate constraint listings_quantity_check;
alter table public.listings validate constraint listings_lat_check;
alter table public.listings validate constraint listings_lng_check;
alter table public.reviews validate constraint reviews_rating_check;

create unique index if not exists transactions_one_open_per_listing
  on public.transactions (listing_id)
  where completed_at is null and canceled_at is null;

create unique index if not exists reviews_one_per_participant
  on public.reviews (transaction_id, from_user_id);

create index if not exists transactions_giver_idx on public.transactions (giver_id, created_at desc);
create index if not exists transactions_taker_idx on public.transactions (taker_id, created_at desc);
create index if not exists listings_status_created_idx on public.listings (status, created_at desc);

do $$
declare policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename in ('categories', 'listings', 'profiles', 'profile_contacts', 'transactions', 'reviews')
  loop
    execute format('drop policy if exists %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end $$;

alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_contacts enable row level security;
alter table public.transactions enable row level security;
alter table public.reviews enable row level security;

revoke all on public.profiles from anon;
revoke all on public.profile_contacts from anon;
revoke all on public.transactions from anon;
revoke all on public.reviews from anon;
grant select on public.categories to anon, authenticated;
grant select on public.listings to anon, authenticated;
revoke update on public.listings from anon, authenticated;
grant insert on public.listings to authenticated;
grant select on public.profiles to authenticated;
grant select on public.profile_contacts to authenticated;
grant select on public.transactions to authenticated;
revoke insert on public.reviews from anon, authenticated;
grant select on public.reviews to authenticated;

create policy categories_public_read on public.categories for select using (true);
create policy listings_public_active_read on public.listings for select to anon using (status = 'active');
create policy listings_authenticated_read on public.listings for select to authenticated using (true);
create policy listings_owner_insert on public.listings for insert to authenticated with check (user_id = auth.uid() and status = 'active');
create policy profiles_authenticated_read on public.profiles for select to authenticated using (true);
create policy profile_contacts_owner_read on public.profile_contacts for select to authenticated using (user_id = auth.uid());
create policy transactions_participant_read on public.transactions for select to authenticated using (auth.uid() in (giver_id, taker_id));
create policy reviews_participant_read on public.reviews for select to authenticated using (auth.uid() in (from_user_id, to_user_id));

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'contacts') then
    alter table public.profiles drop column contacts;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone') then
    alter table public.profiles drop column phone;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'messenger_type') then
    alter table public.profiles drop column messenger_type;
  end if;
end $$;

create or replace function public.upsert_my_profile(
  profile_name text,
  profile_language text,
  profile_messenger text,
  profile_contact text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(profile_name)) < 2 then raise exception 'Name is too short'; end if;
  if profile_language not in ('ru', 'me', 'en') then raise exception 'Unsupported language'; end if;
  if profile_messenger not in ('viber', 'wa', 'tg') then raise exception 'Unsupported messenger'; end if;
  if char_length(btrim(profile_contact)) not between 3 and 120 then raise exception 'Invalid contact'; end if;

  insert into public.profiles (id, full_name, language, preferred_language, updated_at)
  values (auth.uid(), btrim(profile_name), profile_language, profile_language, now())
  on conflict (id) do update set
    full_name = excluded.full_name,
    language = excluded.language,
    preferred_language = excluded.preferred_language,
    updated_at = now();

  insert into public.profile_contacts (user_id, messenger_type, contact_value, updated_at)
  values (auth.uid(), profile_messenger, btrim(profile_contact), now())
  on conflict (user_id) do update set
    messenger_type = excluded.messenger_type,
    contact_value = excluded.contact_value,
    updated_at = now();
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into selected_listing from public.listings where id = target_listing_id for update;
  if not found then raise exception 'Listing not found'; end if;
  if selected_listing.status <> 'active' then raise exception 'Listing is no longer available'; end if;
  if selected_listing.user_id = auth.uid() then raise exception 'You cannot book your own listing'; end if;

  insert into public.transactions (listing_id, giver_id, taker_id, booked_by)
  values (
    selected_listing.id,
    case when selected_listing.type = 'give' then selected_listing.user_id else auth.uid() end,
    case when selected_listing.type = 'give' then auth.uid() else selected_listing.user_id end,
    auth.uid()
  ) returning id into new_transaction_id;

  update public.listings set status = 'reserved' where id = selected_listing.id;
  return new_transaction_id;
end;
$$;

create or replace function public.cancel_booking(target_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  if selected_transaction.booked_by <> auth.uid() then raise exception 'Only the booking author can cancel'; end if;
  if selected_transaction.completed_at is not null or selected_transaction.canceled_at is not null then raise exception 'Transaction is already closed'; end if;
  update public.transactions set canceled_at = now() where id = selected_transaction.id;
  update public.listings set status = 'active' where id = selected_transaction.listing_id and status = 'reserved';
end;
$$;

create or replace function public.deactivate_listing(target_listing_id uuid)
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
  if selected_listing.status <> 'active' then raise exception 'Only an active listing can be deactivated'; end if;
  update public.listings set status = 'canceled' where id = selected_listing.id;
end;
$$;

create or replace function public.complete_deal(target_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  if selected_transaction.giver_id <> auth.uid() then raise exception 'Only the giver can complete this deal'; end if;
  if selected_transaction.canceled_at is not null then raise exception 'Transaction is canceled'; end if;
  if selected_transaction.completed_at is not null then
    return jsonb_build_object('transaction_id', selected_transaction.id, 'eco_reward', 0);
  end if;

  update public.transactions set completed_at = now(), eco_reward_awarded = true where id = selected_transaction.id;
  update public.listings set status = 'completed' where id = selected_transaction.listing_id;
  if not selected_transaction.eco_reward_awarded then
    update public.profiles set eco_points = coalesce(eco_points, 0) + 50, updated_at = now() where id = selected_transaction.giver_id;
  end if;
  return jsonb_build_object('transaction_id', selected_transaction.id, 'eco_reward', case when selected_transaction.eco_reward_awarded then 0 else 50 end);
end;
$$;

create or replace function public.submit_review(target_transaction_id uuid, target_rating integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
declare review_id uuid;
declare partner_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_rating not between 1 and 5 then raise exception 'Rating must be between 1 and 5'; end if;
  select * into selected_transaction from public.transactions where id = target_transaction_id;
  if not found or auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Transaction not found'; end if;
  if selected_transaction.completed_at is null or selected_transaction.canceled_at is not null then raise exception 'Only completed transactions can be reviewed'; end if;
  partner_id := case when auth.uid() = selected_transaction.giver_id then selected_transaction.taker_id else selected_transaction.giver_id end;
  perform 1 from public.profiles where id = partner_id for update;
  insert into public.reviews (transaction_id, from_user_id, to_user_id, rating)
  values (selected_transaction.id, auth.uid(), partner_id, target_rating)
  returning id into review_id;
  update public.profiles p set rating = (select round(avg(r.rating)::numeric, 2) from public.reviews r where r.to_user_id = partner_id), updated_at = now() where p.id = partner_id;
  return review_id;
exception when unique_violation then
  raise exception 'You already reviewed this transaction';
end;
$$;

create or replace function public.get_my_deals()
returns table (
  transaction_id uuid, listing_id uuid, role text, listing_type text, category text, category_path text,
  quantity integer, image_url text, status text, created_at timestamptz, completed_at timestamptz,
  canceled_at timestamptz, partner_id uuid, partner_name text, partner_rating numeric,
  messenger_type text, contact_value text, contact_href text, my_review_rating integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    l.id,
    case when t.giver_id = auth.uid() then 'giver' else 'taker' end,
    l.type,
    l.category,
    l.category_path,
    l.quantity::integer,
    l.image_url,
    case when t.canceled_at is not null then 'canceled' when t.completed_at is not null then 'completed' else l.status end,
    t.created_at,
    t.completed_at,
    t.canceled_at,
    partner.id,
    partner.full_name,
    partner.rating,
    contact.messenger_type,
    contact.contact_value,
    case contact.messenger_type
      when 'wa' then 'https://wa.me/' || regexp_replace(contact.contact_value, '[^0-9]', '', 'g')
      when 'tg' then 'https://t.me/' || ltrim(contact.contact_value, '@')
      when 'viber' then 'viber://chat?number=' || regexp_replace(contact.contact_value, '[^+0-9]', '', 'g')
      else null
    end,
    mine.rating::integer
  from public.transactions t
  join public.listings l on l.id = t.listing_id
  join public.profiles partner on partner.id = case when t.giver_id = auth.uid() then t.taker_id else t.giver_id end
  left join public.profile_contacts contact on contact.user_id = partner.id
  left join public.reviews mine on mine.transaction_id = t.id and mine.from_user_id = auth.uid()
  where auth.uid() in (t.giver_id, t.taker_id)
  order by t.created_at desc;
$$;

revoke all on function public.upsert_my_profile(text, text, text, text) from public;
revoke all on function public.book_listing(uuid) from public;
revoke all on function public.cancel_booking(uuid) from public;
revoke all on function public.deactivate_listing(uuid) from public;
revoke all on function public.complete_deal(uuid) from public;
revoke all on function public.submit_review(uuid, integer) from public;
revoke all on function public.get_my_deals() from public;
grant execute on function public.upsert_my_profile(text, text, text, text) to authenticated;
grant execute on function public.book_listing(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.deactivate_listing(uuid) to authenticated;
grant execute on function public.complete_deal(uuid) to authenticated;
grant execute on function public.submit_review(uuid, integer) to authenticated;
grant execute on function public.get_my_deals() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('LISTING-PHOTOS', 'LISTING-PHOTOS', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $$
declare policy_record record;
begin
  for policy_record in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like 'vratime_%' or policyname in ('Authenticated Upload', 'Owner Delete', 'Public Read'))
  loop execute format('drop policy if exists %I on storage.objects', policy_record.policyname); end loop;
end $$;

create policy vratime_public_photo_read on storage.objects for select using (bucket_id = 'LISTING-PHOTOS');
create policy vratime_owner_photo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'LISTING-PHOTOS' and (storage.foldername(name))[1] = auth.uid()::text);
create policy vratime_owner_photo_update on storage.objects for update to authenticated
  using (bucket_id = 'LISTING-PHOTOS' and owner_id = auth.uid()::text)
  with check (bucket_id = 'LISTING-PHOTOS' and owner_id = auth.uid()::text);
create policy vratime_owner_photo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'LISTING-PHOTOS' and owner_id = auth.uid()::text);

commit;

-- ===== 20260820211500_storage_policy_cleanup.sql =====
begin;

drop policy if exists "Authenticated Upload" on storage.objects;
drop policy if exists "Owner Delete" on storage.objects;
drop policy if exists "Public Read" on storage.objects;

commit;

-- ===== 20260820213000_server_only_mutations.sql =====
begin;

revoke update on public.listings from anon, authenticated;
revoke insert on public.reviews from anon, authenticated;
drop policy if exists listings_owner_update on public.listings;

create or replace function public.deactivate_listing(target_listing_id uuid)
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
  if selected_listing.status <> 'active' then raise exception 'Only an active listing can be deactivated'; end if;
  update public.listings set status = 'canceled' where id = selected_listing.id;
end;
$$;

create or replace function public.submit_review(target_transaction_id uuid, target_rating integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
declare review_id uuid;
declare partner_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_rating not between 1 and 5 then raise exception 'Rating must be between 1 and 5'; end if;
  select * into selected_transaction from public.transactions where id = target_transaction_id;
  if not found or auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Transaction not found'; end if;
  if selected_transaction.completed_at is null or selected_transaction.canceled_at is not null then raise exception 'Only completed transactions can be reviewed'; end if;
  partner_id := case when auth.uid() = selected_transaction.giver_id then selected_transaction.taker_id else selected_transaction.giver_id end;
  perform 1 from public.profiles where id = partner_id for update;
  insert into public.reviews (transaction_id, from_user_id, to_user_id, rating)
  values (selected_transaction.id, auth.uid(), partner_id, target_rating)
  returning id into review_id;
  update public.profiles p set rating = (select round(avg(r.rating)::numeric, 2) from public.reviews r where r.to_user_id = partner_id), updated_at = now() where p.id = partner_id;
  return review_id;
exception when unique_violation then
  raise exception 'You already reviewed this transaction';
end;
$$;

revoke all on function public.deactivate_listing(uuid) from public;
grant execute on function public.deactivate_listing(uuid) to authenticated;

commit;

-- ===== 20260820233000_multi_messenger_contacts.sql =====
begin;

-- Preserve every existing contact, then permit one row for each channel.
alter table public.profile_contacts drop constraint if exists profile_contacts_pkey;
alter table public.profile_contacts add constraint profile_contacts_pkey primary key (user_id, messenger_type);

create or replace function public.upsert_my_profile_v2(
  profile_name text,
  profile_language text,
  profile_channels jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare channel_count integer;
declare unique_channel_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(profile_name)) < 2 then raise exception 'Name is too short'; end if;
  if profile_language not in ('ru', 'me', 'en') then raise exception 'Unsupported language'; end if;
  if jsonb_typeof(profile_channels) <> 'array' then raise exception 'Contacts must be an array'; end if;

  select count(*), count(distinct channel.messenger_type)
  into channel_count, unique_channel_count
  from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text);

  if channel_count < 1 then raise exception 'At least one contact is required'; end if;
  if channel_count <> unique_channel_count then raise exception 'Each messenger can only be selected once'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text)
    where channel.messenger_type not in ('viber', 'wa', 'tg')
       or char_length(btrim(coalesce(channel.contact_value, ''))) not between 3 and 120
  ) then raise exception 'Invalid contact'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text)
    where channel.messenger_type = 'tg'
      and btrim(channel.contact_value) !~ '^@[A-Za-z0-9_]{5,32}$'
      and btrim(channel.contact_value) !~ '^\+[1-9][0-9]{6,14}$'
  ) then raise exception 'Invalid Telegram contact'; end if;

  insert into public.profiles (id, full_name, language, preferred_language, updated_at)
  values (auth.uid(), btrim(profile_name), profile_language, profile_language, now())
  on conflict (id) do update set
    full_name = excluded.full_name,
    language = excluded.language,
    preferred_language = excluded.preferred_language,
    updated_at = now();

  delete from public.profile_contacts where user_id = auth.uid();
  insert into public.profile_contacts (user_id, messenger_type, contact_value, updated_at)
  select auth.uid(), channel.messenger_type, btrim(channel.contact_value), now()
  from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text);
end;
$$;

drop function if exists public.get_my_deals();
create function public.get_my_deals()
returns table (
  transaction_id uuid, listing_id uuid, role text, listing_type text, category text, category_path text,
  quantity integer, image_url text, status text, created_at timestamptz, completed_at timestamptz,
  canceled_at timestamptz, partner_id uuid, partner_name text, partner_rating numeric,
  messenger_type text, contact_value text, contact_href text, contacts jsonb, my_review_rating integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    l.id,
    case when t.giver_id = auth.uid() then 'giver' else 'taker' end,
    l.type,
    l.category,
    l.category_path,
    l.quantity::integer,
    l.image_url,
    case when t.canceled_at is not null then 'canceled' when t.completed_at is not null then 'completed' else l.status end,
    t.created_at,
    t.completed_at,
    t.canceled_at,
    partner.id,
    partner.full_name,
    partner.rating,
    (contact_bundle.items -> 0) ->> 'messenger_type',
    (contact_bundle.items -> 0) ->> 'contact_value',
    (contact_bundle.items -> 0) ->> 'contact_href',
    coalesce(contact_bundle.items, '[]'::jsonb),
    mine.rating::integer
  from public.transactions t
  join public.listings l on l.id = t.listing_id
  join public.profiles partner on partner.id = case when t.giver_id = auth.uid() then t.taker_id else t.giver_id end
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'messenger_type', contact.messenger_type,
        'contact_value', contact.contact_value,
        'contact_href', case contact.messenger_type
          when 'wa' then 'https://wa.me/' || regexp_replace(contact.contact_value, '[^0-9]', '', 'g')
          when 'tg' then 'https://t.me/' || ltrim(contact.contact_value, '@')
          when 'viber' then 'viber://chat?number=' || regexp_replace(contact.contact_value, '[^+0-9]', '', 'g')
          else null
        end
      ) order by case contact.messenger_type when 'tg' then 1 when 'wa' then 2 else 3 end
    ) as items
    from public.profile_contacts contact
    where contact.user_id = partner.id
  ) contact_bundle on true
  left join public.reviews mine on mine.transaction_id = t.id and mine.from_user_id = auth.uid()
  where auth.uid() in (t.giver_id, t.taker_id)
  order by t.created_at desc;
$$;

revoke all on function public.upsert_my_profile_v2(text, text, jsonb) from public;
revoke all on function public.get_my_deals() from public;
grant execute on function public.upsert_my_profile_v2(text, text, jsonb) to authenticated;
grant execute on function public.get_my_deals() to authenticated;

commit;

-- ===== 20260821000000_allow_both_participants_to_cancel.sql =====
-- Either participant may cancel an uncompleted arrangement.
-- The canceled transaction remains in history; the listing becomes active again.
begin;

create or replace function public.cancel_booking(target_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into selected_transaction
  from public.transactions
  where id = target_transaction_id
  for update;

  if not found then raise exception 'Transaction not found'; end if;
  if auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then
    raise exception 'Only a deal participant can cancel';
  end if;
  if selected_transaction.completed_at is not null or selected_transaction.canceled_at is not null then
    raise exception 'Transaction is already closed';
  end if;

  update public.transactions set canceled_at = now() where id = selected_transaction.id;
  update public.listings set status = 'active' where id = selected_transaction.listing_id and status = 'reserved';
end;
$$;

revoke all on function public.cancel_booking(uuid) from public;
grant execute on function public.cancel_booking(uuid) to authenticated;

commit;

-- ===== 20260821001000_allow_telegram_phone_contacts.sql =====
-- Telegram may be reached by a public @username or an international phone number.
-- Run after 20260820233000_multi_messenger_contacts.sql.
begin;

create or replace function public.upsert_my_profile_v2(
  profile_name text,
  profile_language text,
  profile_channels jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare channel_count integer;
declare unique_channel_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(profile_name)) < 2 then raise exception 'Name is too short'; end if;
  if profile_language not in ('ru', 'me', 'en') then raise exception 'Unsupported language'; end if;
  if jsonb_typeof(profile_channels) <> 'array' then raise exception 'Contacts must be an array'; end if;

  select count(*), count(distinct channel.messenger_type)
  into channel_count, unique_channel_count
  from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text);

  if channel_count < 1 then raise exception 'At least one contact is required'; end if;
  if channel_count <> unique_channel_count then raise exception 'Each messenger can only be selected once'; end if;
  if exists (
    select 1 from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text)
    where channel.messenger_type not in ('viber', 'wa', 'tg')
       or char_length(btrim(coalesce(channel.contact_value, ''))) not between 3 and 120
  ) then raise exception 'Invalid contact'; end if;
  if exists (
    select 1 from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text)
    where channel.messenger_type = 'tg'
      and btrim(channel.contact_value) !~ '^@[A-Za-z0-9_]{5,32}$'
      and btrim(channel.contact_value) !~ '^\+[1-9][0-9]{6,14}$'
  ) then raise exception 'Invalid Telegram contact'; end if;

  insert into public.profiles (id, full_name, language, preferred_language, updated_at)
  values (auth.uid(), btrim(profile_name), profile_language, profile_language, now())
  on conflict (id) do update set
    full_name = excluded.full_name,
    language = excluded.language,
    preferred_language = excluded.preferred_language,
    updated_at = now();

  delete from public.profile_contacts where user_id = auth.uid();
  insert into public.profile_contacts (user_id, messenger_type, contact_value, updated_at)
  select auth.uid(), channel.messenger_type, btrim(channel.contact_value), now()
  from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text);
end;
$$;

revoke all on function public.upsert_my_profile_v2(text, text, jsonb) from public;
grant execute on function public.upsert_my_profile_v2(text, text, jsonb) to authenticated;

commit;

-- ===== 20260821002000_restrict_rpc_execution.sql =====
-- Supabase/PostgREST should expose private workflow functions only to signed-in users.
-- Explicit anon revokes also harden projects where older functions retained direct grants.
begin;

revoke execute on function public.upsert_my_profile(text, text, text, text) from public, anon;
revoke execute on function public.upsert_my_profile_v2(text, text, jsonb) from public, anon;
revoke execute on function public.book_listing(uuid) from public, anon;
revoke execute on function public.cancel_booking(uuid) from public, anon;
revoke execute on function public.deactivate_listing(uuid) from public, anon;
revoke execute on function public.complete_deal(uuid) from public, anon;
revoke execute on function public.submit_review(uuid, integer) from public, anon;
revoke execute on function public.get_my_deals() from public, anon;

grant execute on function public.upsert_my_profile(text, text, text, text) to authenticated;
grant execute on function public.upsert_my_profile_v2(text, text, jsonb) to authenticated;
grant execute on function public.book_listing(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.deactivate_listing(uuid) to authenticated;
grant execute on function public.complete_deal(uuid) to authenticated;
grant execute on function public.submit_review(uuid, integer) to authenticated;
grant execute on function public.get_my_deals() to authenticated;

commit;


