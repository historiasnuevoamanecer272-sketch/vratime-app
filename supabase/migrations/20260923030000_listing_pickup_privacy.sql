begin;

alter table public.listings add column if not exists condition text not null default 'usable';
alter table public.listings add column if not exists pickup_mode text not null default 'public_place';
alter table public.listings add column if not exists pickup_windows jsonb not null default '[]'::jsonb;
alter table public.listings add column if not exists public_lat double precision;
alter table public.listings add column if not exists public_lng double precision;
alter table public.listings add column if not exists public_meeting_label text;
alter table public.listings add column if not exists available_quantity integer;
alter table public.listings add column if not exists reserved_quantity integer not null default 0;
alter table public.listings add column if not exists weight_kg numeric(8,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_condition_check') then
    alter table public.listings add constraint listings_condition_check check (condition in ('new', 'usable', 'worn', 'repair'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_pickup_mode_check') then
    alter table public.listings add constraint listings_pickup_mode_check check (pickup_mode in ('public_place', 'entrance', 'doorstep', 'courier'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_pickup_windows_check') then
    alter table public.listings add constraint listings_pickup_windows_check check (jsonb_typeof(pickup_windows) = 'array' and jsonb_array_length(pickup_windows) <= 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_available_quantity_check') then
    alter table public.listings add constraint listings_available_quantity_check check (available_quantity is null or available_quantity >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_reserved_quantity_check') then
    alter table public.listings add constraint listings_reserved_quantity_check check (reserved_quantity >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_weight_kg_check') then
    alter table public.listings add constraint listings_weight_kg_check check (weight_kg is null or weight_kg > 0);
  end if;
end $$;

create or replace function public.set_listing_public_coordinates()
returns trigger
language plpgsql
set search_path = public
as $$
declare latitude_step double precision := 300.0 / 111320.0;
declare coarse_lat double precision;
declare longitude_step double precision;
begin
  if new.available_quantity is null then
    new.available_quantity := greatest(0, coalesce(new.quantity, 0) - coalesce(new.reserved_quantity, 0));
  end if;
  if new.lat is not null and new.lng is not null then
    coarse_lat := floor(new.lat / latitude_step) * latitude_step;
    longitude_step := 300.0 / (111320.0 * greatest(cos(radians(coarse_lat)), 0.01));
    new.public_lat := round(coarse_lat::numeric, 6)::double precision;
    new.public_lng := round((floor(new.lng / longitude_step) * longitude_step)::numeric, 6)::double precision;
  end if;
  new.public_meeting_label := coalesce(nullif(btrim(new.public_meeting_label), ''), split_part(coalesce(new.location_label, ''), ',', 1));
  return new;
end;
$$;

drop trigger if exists listings_public_coordinates on public.listings;
create trigger listings_public_coordinates
before insert or update on public.listings
for each row execute function public.set_listing_public_coordinates();

update public.listings
set available_quantity = coalesce(available_quantity, greatest(0, quantity - reserved_quantity)),
    public_meeting_label = coalesce(public_meeting_label, split_part(coalesce(location_label, ''), ',', 1));

drop policy if exists listings_public_active_read on public.listings;
drop policy if exists listings_authenticated_read on public.listings;
create policy listings_public_active_read on public.listings for select to anon using (false);
create policy listings_authenticated_read on public.listings for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

create or replace function public.get_public_map_listings()
returns table (
  id uuid,
  user_id uuid,
  type text,
  status text,
  category_id bigint,
  category text,
  category_path text,
  description text,
  image_url text,
  image_urls jsonb,
  quantity integer,
  available_quantity integer,
  condition text,
  pickup_mode text,
  public_meeting_label text,
  lat double precision,
  lng double precision,
  public_lat double precision,
  public_lng double precision,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.user_id,
    l.type::text,
    l.status::text,
    l.category_id,
    l.category,
    l.category_path,
    l.description,
    l.image_url,
    l.image_urls,
    l.quantity::integer,
    coalesce(l.available_quantity, l.quantity)::integer,
    l.condition,
    l.pickup_mode,
    l.public_meeting_label,
    l.public_lat,
    l.public_lng,
    l.public_lat,
    l.public_lng,
    l.created_at
  from public.listings l
  where l.status = 'active'
    and l.moderation_status = 'approved'
    and l.location_verified_at is not null
    and l.public_lat is not null
    and l.public_lng is not null
  order by l.created_at desc;
$$;

create or replace function public.get_transaction_pickup_details(target_transaction_id uuid)
returns table (
  transaction_id uuid,
  listing_id uuid,
  lat double precision,
  lng double precision,
  location_label text,
  pickup_mode text,
  pickup_windows jsonb,
  public_meeting_label text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    l.id,
    l.lat,
    l.lng,
    l.location_label,
    l.pickup_mode,
    l.pickup_windows,
    l.public_meeting_label
  from public.transactions t
  join public.listings l on l.id = t.listing_id
  where t.id = target_transaction_id
    and auth.uid() in (t.giver_id, t.taker_id)
    and t.accepted_at is not null
    and t.canceled_at is null;
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
  target_image_urls jsonb,
  target_condition text,
  target_pickup_mode text,
  target_pickup_windows jsonb,
  target_weight_kg numeric default null
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
  if target_condition not in ('new', 'usable', 'worn', 'repair') then raise exception 'Invalid condition'; end if;
  if target_pickup_mode not in ('public_place', 'entrance', 'doorstep', 'courier') then raise exception 'Invalid pickup mode'; end if;
  if jsonb_typeof(coalesce(target_pickup_windows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(target_pickup_windows, '[]'::jsonb)) > 3 then raise exception 'Too many pickup windows'; end if;
  update public.listings set
    category_id = target_category_id,
    category = btrim(target_category),
    category_path = btrim(target_category_path),
    description = nullif(btrim(coalesce(target_description, '')), ''),
    quantity = target_quantity,
    available_quantity = least(coalesce(available_quantity, target_quantity), target_quantity),
    lat = target_lat,
    lng = target_lng,
    location_label = btrim(target_location_label),
    location_verified_at = now(),
    image_url = nullif(target_image_url, ''),
    image_urls = coalesce(target_image_urls, '[]'::jsonb),
    condition = target_condition,
    pickup_mode = target_pickup_mode,
    pickup_windows = coalesce(target_pickup_windows, '[]'::jsonb),
    weight_kg = target_weight_kg,
    moderation_status = 'pending', moderation_reason = null, moderated_by = null, moderated_at = null,
    status = case when status = 'canceled' then 'active' else status end,
    updated_at = now()
  where id = target_listing_id;
end;
$$;

revoke execute on function public.get_public_map_listings() from public;
revoke execute on function public.get_transaction_pickup_details(uuid) from public, anon;
revoke execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric) from public, anon;
grant execute on function public.get_public_map_listings() to anon, authenticated;
grant execute on function public.get_transaction_pickup_details(uuid) to authenticated;
grant execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric) to authenticated;

commit;
