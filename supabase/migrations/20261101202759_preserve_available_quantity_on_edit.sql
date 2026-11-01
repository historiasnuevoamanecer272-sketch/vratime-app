-- Preserve already used stock while adding/removing units from an owned listing.
-- No historical rows are backfilled; the existing signature, locks and grants remain.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.update_my_listing(
  target_listing_id uuid, target_category_id bigint, target_category text, target_category_path text,
  target_description text, target_quantity integer, target_lat double precision, target_lng double precision,
  target_location_label text, target_image_url text, target_image_urls jsonb, target_condition text,
  target_pickup_mode text, target_pickup_windows jsonb, target_weight_kg numeric default null,
  target_loan_duration_days integer default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare selected_listing public.listings%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into selected_listing from public.listings where id = target_listing_id for update;
  if not found or selected_listing.user_id <> auth.uid() then raise exception 'Listing not found'; end if;
  if selected_listing.moderation_status = 'rejected' then raise exception 'A removed listing cannot be republished'; end if;
  if exists (select 1 from public.transactions where listing_id = target_listing_id and accepted_at is not null and completed_at is null and canceled_at is null) then raise exception 'An accepted booking cannot be edited'; end if;
  if target_quantity not between 1 and 10000 then raise exception 'Invalid quantity'; end if;
  -- Keep consumed/unavailable units accounted for when the owner edits the total.
  if target_quantity < greatest(0, selected_listing.quantity - coalesce(selected_listing.available_quantity, selected_listing.quantity)) then raise exception 'Invalid quantity'; end if;
  if target_lat not between -90 and 90 or target_lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
  if char_length(btrim(coalesce(target_location_label, ''))) < 3 then raise exception 'A verified address is required'; end if;
  if target_condition not in ('new', 'usable', 'worn', 'repair') then raise exception 'Invalid condition'; end if;
  if target_pickup_mode not in ('public_place', 'entrance', 'doorstep', 'courier') then raise exception 'Invalid pickup mode'; end if;
  if jsonb_typeof(coalesce(target_pickup_windows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(target_pickup_windows, '[]'::jsonb)) > 3 then raise exception 'Too many pickup windows'; end if;
  if selected_listing.type = 'lend' and (target_loan_duration_days not between 1 and 365 or nullif(target_image_url, '') is null) then raise exception 'Loan terms are incomplete'; end if;
  update public.listings set
    category_id = target_category_id, category = btrim(target_category), category_path = btrim(target_category_path),
    description = nullif(btrim(coalesce(target_description, '')), ''), quantity = target_quantity,
    available_quantity = target_quantity - greatest(0, quantity - coalesce(available_quantity, quantity)),
    lat = target_lat, lng = target_lng, location_label = btrim(target_location_label), location_verified_at = now(),
    image_url = nullif(target_image_url, ''), image_urls = coalesce(target_image_urls, '[]'::jsonb),
    condition = target_condition, pickup_mode = target_pickup_mode, pickup_windows = coalesce(target_pickup_windows, '[]'::jsonb),
    weight_kg = target_weight_kg, loan_duration_days = case when type = 'lend' then target_loan_duration_days else null end,
    moderation_status = 'approved', moderation_reason = null, moderated_by = null, moderated_at = null,
    status = case when status = 'canceled' then 'active'::public.listing_status else status end, updated_at = now()
  where id = target_listing_id;
end;
$$;

commit;
