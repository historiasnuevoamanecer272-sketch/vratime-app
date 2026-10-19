-- Prepared locally at the user's request; do not apply before the publication command.
-- No user/account cleanup belongs in this reusable schema migration.
-- Existing transaction deadlines are preserved. New requests get12h; accepted
-- reservations already use24h in the latest accept_deal implementation.
begin;

alter table public.listings alter column moderation_status set default 'approved';
-- An already-open PWA can still submit the former explicit 'pending' value.
-- Normalize only a new active listing owned by this caller; RLS still validates
-- ownership and the verified pickup point, including for cached older clients.
create function public.approve_new_listing_without_premoderation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.user_id = (select auth.uid()) and new.status = 'active' and new.moderation_status = 'pending' then
    new.moderation_status := 'approved';
  end if;
  return new;
end;
$$;
revoke all on function public.approve_new_listing_without_premoderation() from public, anon, authenticated;
create trigger listings_publish_immediately before insert on public.listings
for each row execute function public.approve_new_listing_without_premoderation();

drop policy if exists listings_owner_insert on public.listings;
create policy listings_owner_insert on public.listings for insert to authenticated
  with check (
    user_id = (select auth.uid()) and status = 'active' and moderation_status = 'approved'
    and location_verified_at is not null and location_label is not null
    and char_length(btrim(location_label)) >= 3
    and lat between -90 and 90 and lng between -180 and 180
  );

create or replace function public.book_listing(target_listing_id uuid, requested_quantity integer default 1)
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
  if requested_quantity not between 1 and 10000 then raise exception 'Invalid requested quantity'; end if;
  perform public.refresh_expired_deals();
  select * into selected_listing from public.listings where id = target_listing_id for update;
  if not found then raise exception 'Listing not found'; end if;
  if selected_listing.status <> 'active' then raise exception 'Listing is no longer available'; end if;
  if selected_listing.moderation_status <> 'approved' then raise exception 'Listing is awaiting moderation'; end if;
  if selected_listing.user_id = auth.uid() then raise exception 'You cannot request your own listing'; end if;
  if coalesce(selected_listing.available_quantity, selected_listing.quantity) < requested_quantity then raise exception 'Not enough quantity available'; end if;
  if selected_listing.type = 'lend' and (selected_listing.loan_duration_days is null or selected_listing.image_url is null) then raise exception 'Loan terms are incomplete'; end if;

  partner_giver := case when selected_listing.type in ('give', 'lend') then selected_listing.user_id else auth.uid() end;
  partner_taker := case when selected_listing.type in ('give', 'lend') then auth.uid() else selected_listing.user_id end;
  if (select count(*) from public.transactions where booked_by = auth.uid() and created_at > now() - interval '24 hours') >= 5 then
    flags := array_append(flags, 'high_request_velocity');
  end if;
  insert into public.transactions (listing_id, giver_id, taker_id, booked_by, risk_flags, expires_at, requested_quantity)
  values (selected_listing.id, partner_giver, partner_taker, auth.uid(), flags, now() + interval '12 hours', requested_quantity)
  returning id into new_transaction_id;
  return new_transaction_id;
exception when unique_violation then
  raise exception 'You already requested this listing';
end;
$$;

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
  if target_lat not between -90 and 90 or target_lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
  if char_length(btrim(coalesce(target_location_label, ''))) < 3 then raise exception 'A verified address is required'; end if;
  if target_condition not in ('new', 'usable', 'worn', 'repair') then raise exception 'Invalid condition'; end if;
  if target_pickup_mode not in ('public_place', 'entrance', 'doorstep', 'courier') then raise exception 'Invalid pickup mode'; end if;
  if jsonb_typeof(coalesce(target_pickup_windows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(target_pickup_windows, '[]'::jsonb)) > 3 then raise exception 'Too many pickup windows'; end if;
  if selected_listing.type = 'lend' and (target_loan_duration_days not between 1 and 365 or nullif(target_image_url, '') is null) then raise exception 'Loan terms are incomplete'; end if;
  update public.listings set
    category_id = target_category_id, category = btrim(target_category), category_path = btrim(target_category_path),
    description = nullif(btrim(coalesce(target_description, '')), ''), quantity = target_quantity,
    available_quantity = least(coalesce(available_quantity, target_quantity), target_quantity),
    lat = target_lat, lng = target_lng, location_label = btrim(target_location_label), location_verified_at = now(),
    image_url = nullif(target_image_url, ''), image_urls = coalesce(target_image_urls, '[]'::jsonb),
    condition = target_condition, pickup_mode = target_pickup_mode, pickup_windows = coalesce(target_pickup_windows, '[]'::jsonb),
    weight_kg = target_weight_kg, loan_duration_days = case when type = 'lend' then target_loan_duration_days else null end,
    moderation_status = 'approved', moderation_reason = null, moderated_by = null, moderated_at = null,
    status = case when status = 'canceled' then 'active'::public.listing_status else status end, updated_at = now()
  where id = target_listing_id;
end;
$$;

-- Release pending, valid active listings without reviving removed/canceled ones.
update public.listings set moderation_status = 'approved', moderated_at = now(), updated_at = now()
where moderation_status = 'pending' and status = 'active'
  and location_verified_at is not null and char_length(btrim(coalesce(location_label, ''))) >= 3
  and lat between -90 and 90 and lng between -180 and 180;

revoke execute on function public.book_listing(uuid, integer) from public, anon;
grant execute on function public.book_listing(uuid, integer) to authenticated;
revoke execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric, integer) from public, anon;
grant execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric, integer) to authenticated;

commit;
