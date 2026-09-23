begin;

-- PostgreSQL resolves CASE branches containing only string literals as text,
-- which cannot be assigned to the listing_status enum. Keep the enum explicit
-- in every reservation and handover state transition.
create or replace function public.restore_or_consume_reservation(target_transaction_id uuid, mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
begin
  if mode not in ('restore', 'consume') then raise exception 'Invalid reservation mode'; end if;
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found or selected_transaction.reserved_quantity <= 0 then return; end if;

  perform 1 from public.listings where id = selected_transaction.listing_id for update;
  if mode = 'restore' then
    update public.listings
    set available_quantity = least(quantity, coalesce(available_quantity, 0) + selected_transaction.reserved_quantity),
        reserved_quantity = greatest(0, reserved_quantity - selected_transaction.reserved_quantity),
        status = 'active',
        updated_at = now()
    where id = selected_transaction.listing_id;
  else
    update public.listings
    set reserved_quantity = greatest(0, reserved_quantity - selected_transaction.reserved_quantity),
        status = case when coalesce(available_quantity, 0) <= 0 and greatest(0, reserved_quantity - selected_transaction.reserved_quantity) = 0 then 'completed'::public.listing_status else 'active'::public.listing_status end,
        updated_at = now()
    where id = selected_transaction.listing_id;
  end if;
  update public.transactions set reserved_quantity = 0 where id = selected_transaction.id;
end;
$$;

create or replace function public.accept_deal(target_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
declare selected_listing public.listings%rowtype;
declare next_available integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.refresh_expired_deals();
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found then raise exception 'Request not found'; end if;
  select * into selected_listing from public.listings where id = selected_transaction.listing_id for update;
  if selected_listing.user_id <> auth.uid() then raise exception 'Only the listing owner can accept this request'; end if;
  if selected_transaction.completed_at is not null or selected_transaction.canceled_at is not null then raise exception 'Request is already closed'; end if;
  if selected_transaction.accepted_at is not null then
    return jsonb_build_object('transaction_id', selected_transaction.id, 'available_quantity', selected_listing.available_quantity);
  end if;
  if selected_listing.status <> 'active' then raise exception 'Listing is no longer available'; end if;
  if selected_listing.available_quantity < selected_transaction.requested_quantity then raise exception 'Not enough quantity available'; end if;

  next_available := selected_listing.available_quantity - selected_transaction.requested_quantity;
  update public.transactions
  set accepted_at = now(), expires_at = now() + interval '24 hours',
      return_due_at = case when selected_listing.type = 'lend' then now() + make_interval(days => selected_listing.loan_duration_days) else null end,
      reserved_quantity = selected_transaction.requested_quantity
  where id = selected_transaction.id;
  update public.listings
  set available_quantity = next_available,
      reserved_quantity = reserved_quantity + selected_transaction.requested_quantity,
      status = case when next_available <= 0 then 'reserved'::public.listing_status else 'active'::public.listing_status end,
      updated_at = now()
  where id = selected_listing.id;
  return jsonb_build_object('transaction_id', selected_transaction.id, 'available_quantity', next_available);
end;
$$;

create or replace function public.confirm_loan_handover(target_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
declare selected_listing public.listings%rowtype;
declare updated_transaction public.transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found or auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Transaction not found'; end if;
  select * into selected_listing from public.listings where id = selected_transaction.listing_id for update;
  if selected_listing.type <> 'lend' then raise exception 'Transaction is not a loan'; end if;
  if selected_transaction.accepted_at is null then raise exception 'The request has not been accepted'; end if;
  if selected_transaction.canceled_at is not null or selected_transaction.returned_at is not null then raise exception 'Loan is closed'; end if;
  if selected_transaction.handed_over_at is not null then return jsonb_build_object('transaction_id', selected_transaction.id, 'handed_over', true); end if;

  update public.transactions
  set giver_confirmed_at = case when auth.uid() = giver_id then coalesce(giver_confirmed_at, now()) else giver_confirmed_at end,
      taker_confirmed_at = case when auth.uid() = taker_id then coalesce(taker_confirmed_at, now()) else taker_confirmed_at end
  where id = selected_transaction.id returning * into updated_transaction;
  if updated_transaction.giver_confirmed_at is not null and updated_transaction.taker_confirmed_at is not null then
    update public.transactions set handed_over_at = now(), reserved_quantity = 0 where id = updated_transaction.id;
    update public.listings set reserved_quantity = greatest(0, reserved_quantity - updated_transaction.reserved_quantity), status = case when available_quantity > 0 then 'active'::public.listing_status else 'reserved'::public.listing_status end, updated_at = now() where id = selected_listing.id;
    return jsonb_build_object('transaction_id', updated_transaction.id, 'handed_over', true, 'return_due_at', updated_transaction.return_due_at);
  end if;
  return jsonb_build_object('transaction_id', updated_transaction.id, 'handed_over', false);
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
    moderation_status = 'pending', moderation_reason = null, moderated_by = null, moderated_at = null,
    status = case when status = 'canceled' then 'active'::public.listing_status else status end, updated_at = now()
  where id = target_listing_id;
end;
$$;

revoke execute on function public.accept_deal(uuid) from public, anon;
revoke execute on function public.confirm_loan_handover(uuid) from public, anon;
revoke execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric, integer) from public, anon;
grant execute on function public.accept_deal(uuid) to authenticated;
grant execute on function public.confirm_loan_handover(uuid) to authenticated;
grant execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric, integer) to authenticated;

commit;
