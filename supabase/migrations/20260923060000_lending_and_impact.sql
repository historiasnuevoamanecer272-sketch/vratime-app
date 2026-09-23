begin;

alter type public.listing_type add value if not exists 'lend';

commit;

begin;

alter table public.listings add column if not exists loan_duration_days integer;
alter table public.transactions add column if not exists return_due_at timestamptz;
alter table public.transactions add column if not exists handed_over_at timestamptz;
alter table public.transactions add column if not exists returned_at timestamptz;
alter table public.transactions add column if not exists lender_return_confirmed_at timestamptz;
alter table public.transactions add column if not exists borrower_return_confirmed_at timestamptz;

alter table public.listings drop constraint if exists listings_type_check;
alter table public.listings add constraint listings_type_check check (type in ('give', 'take', 'lend')) not valid;
alter table public.listings validate constraint listings_type_check;
alter table public.listings drop constraint if exists listings_lend_requirements_check;
alter table public.listings add constraint listings_lend_requirements_check check (
  type <> 'lend' or (loan_duration_days between 1 and 365 and image_url is not null)
);

create table if not exists public.reuse_events (
  transaction_id uuid primary key references public.transactions(id) on delete cascade,
  event_kind text not null check (event_kind in ('give_completed', 'loan_returned')),
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  giver_id uuid not null references public.profiles(id) on delete cascade,
  taker_id uuid not null references public.profiles(id) on delete cascade,
  item_count integer not null check (item_count > 0),
  weight_kg numeric(12,3) check (weight_kg is null or weight_kg >= 0),
  category_snapshot text not null,
  created_at timestamptz not null default now()
);

alter table public.reuse_events enable row level security;
revoke insert, update, delete on public.reuse_events from public, anon, authenticated;
revoke select on public.reuse_events from public, anon, authenticated;
grant select on public.reuse_events to authenticated;
create policy reuse_events_participant_read on public.reuse_events
  for select to authenticated using (auth.uid() in (giver_id, taker_id));

create or replace function public.capture_reuse_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare selected_listing public.listings%rowtype;
declare next_kind text;
begin
  select * into selected_listing from public.listings where id = new.listing_id;
  if selected_listing.type = 'lend' and new.returned_at is not null and old.returned_at is null then
    next_kind := 'loan_returned';
  elsif selected_listing.type in ('give', 'take') and new.completed_at is not null and old.completed_at is null then
    next_kind := 'give_completed';
  else
    return new;
  end if;

  insert into public.reuse_events (
    transaction_id, event_kind, actor_user_id, giver_id, taker_id,
    item_count, weight_kg, category_snapshot
  ) values (
    new.id, next_kind, coalesce(auth.uid(), new.giver_id), new.giver_id, new.taker_id,
    greatest(1, coalesce(new.requested_quantity, 1)), selected_listing.weight_kg,
    coalesce(nullif(selected_listing.category_path, ''), selected_listing.category)
  ) on conflict (transaction_id) do nothing;
  return new;
end;
$$;

drop trigger if exists transactions_capture_reuse_event on public.transactions;
create trigger transactions_capture_reuse_event
after update of completed_at, returned_at on public.transactions
for each row execute function public.capture_reuse_event();

insert into public.reuse_events (transaction_id, event_kind, actor_user_id, giver_id, taker_id, item_count, weight_kg, category_snapshot, created_at)
select t.id,
  case when l.type = 'lend' then 'loan_returned' else 'give_completed' end,
  t.giver_id, t.giver_id, t.taker_id,
  greatest(1, coalesce(t.requested_quantity, 1)), l.weight_kg,
  coalesce(nullif(l.category_path, ''), l.category), coalesce(t.returned_at, t.completed_at)
from public.transactions t
join public.listings l on l.id = t.listing_id
where (l.type = 'lend' and t.returned_at is not null)
   or (l.type in ('give', 'take') and t.completed_at is not null)
on conflict (transaction_id) do nothing;

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
  values (selected_listing.id, partner_giver, partner_taker, auth.uid(), flags, now() + interval '48 hours', requested_quantity)
  returning id into new_transaction_id;
  return new_transaction_id;
exception when unique_violation then
  raise exception 'You already requested this listing';
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
      status = case when next_available <= 0 then 'reserved' else 'active' end,
      updated_at = now()
  where id = selected_listing.id;
  return jsonb_build_object('transaction_id', selected_transaction.id, 'available_quantity', next_available);
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
  if auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Only a participant can cancel'; end if;
  if selected_transaction.completed_at is not null or selected_transaction.canceled_at is not null then raise exception 'Transaction is already closed'; end if;
  if selected_transaction.handed_over_at is not null and selected_transaction.returned_at is null then raise exception 'An active loan cannot be canceled'; end if;
  update public.transactions
  set canceled_at = now(), canceled_reason = case when accepted_at is null then 'request_withdrawn' else 'participant_canceled' end
  where id = selected_transaction.id;
  if selected_transaction.accepted_at is not null then
    perform public.restore_or_consume_reservation(selected_transaction.id, 'restore');
  end if;
end;
$$;

create or replace function public.confirm_handover(target_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
declare selected_listing public.listings%rowtype;
declare updated_transaction public.transactions%rowtype;
declare giver_reward integer := 0;
declare taker_reward integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.refresh_expired_deals();
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found or auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Transaction not found'; end if;
  select * into selected_listing from public.listings where id = selected_transaction.listing_id;
  if selected_listing.type = 'lend' then raise exception 'Use the loan handover flow'; end if;
  if selected_transaction.accepted_at is null then raise exception 'The request has not been accepted'; end if;
  if selected_transaction.canceled_at is not null then raise exception 'Transaction is closed'; end if;
  if selected_transaction.completed_at is not null then
    return jsonb_build_object('transaction_id', selected_transaction.id, 'completed', true, 'eco_reward', 0);
  end if;

  update public.transactions
  set giver_confirmed_at = case when auth.uid() = giver_id then coalesce(giver_confirmed_at, now()) else giver_confirmed_at end,
      taker_confirmed_at = case when auth.uid() = taker_id then coalesce(taker_confirmed_at, now()) else taker_confirmed_at end
  where id = selected_transaction.id returning * into updated_transaction;

  if updated_transaction.giver_confirmed_at is not null and updated_transaction.taker_confirmed_at is not null then
    perform public.restore_or_consume_reservation(updated_transaction.id, 'consume');
    update public.transactions set completed_at = now(), eco_reward_awarded = true where id = updated_transaction.id;
    if not updated_transaction.eco_reward_awarded then
      giver_reward := 50; taker_reward := 25;
      update public.profiles set eco_points = coalesce(eco_points, 0) + giver_reward, updated_at = now() where id = updated_transaction.giver_id;
      update public.profiles set eco_points = coalesce(eco_points, 0) + taker_reward, updated_at = now() where id = updated_transaction.taker_id;
    end if;
    return jsonb_build_object('transaction_id', updated_transaction.id, 'completed', true, 'eco_reward', case when auth.uid() = updated_transaction.giver_id then giver_reward else taker_reward end);
  end if;
  return jsonb_build_object('transaction_id', updated_transaction.id, 'completed', false, 'eco_reward', 0);
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
    update public.listings set reserved_quantity = greatest(0, reserved_quantity - updated_transaction.reserved_quantity), status = case when available_quantity > 0 then 'active' else 'reserved' end, updated_at = now() where id = selected_listing.id;
    return jsonb_build_object('transaction_id', updated_transaction.id, 'handed_over', true, 'return_due_at', updated_transaction.return_due_at);
  end if;
  return jsonb_build_object('transaction_id', updated_transaction.id, 'handed_over', false);
end;
$$;

create or replace function public.confirm_loan_return(target_transaction_id uuid)
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
  if selected_transaction.handed_over_at is null then raise exception 'Loan has not been handed over'; end if;
  if selected_transaction.canceled_at is not null then raise exception 'Loan is closed'; end if;
  if selected_transaction.returned_at is not null then return jsonb_build_object('transaction_id', selected_transaction.id, 'returned', true); end if;

  update public.transactions
  set lender_return_confirmed_at = case when auth.uid() = giver_id then coalesce(lender_return_confirmed_at, now()) else lender_return_confirmed_at end,
      borrower_return_confirmed_at = case when auth.uid() = taker_id then coalesce(borrower_return_confirmed_at, now()) else borrower_return_confirmed_at end
  where id = selected_transaction.id returning * into updated_transaction;
  if updated_transaction.lender_return_confirmed_at is not null and updated_transaction.borrower_return_confirmed_at is not null then
    update public.transactions set returned_at = now(), completed_at = now(), eco_reward_awarded = true where id = updated_transaction.id;
    update public.listings set available_quantity = least(quantity, available_quantity + updated_transaction.requested_quantity), status = 'active', updated_at = now() where id = selected_listing.id;
    update public.profiles set eco_points = coalesce(eco_points, 0) + 25, updated_at = now() where id in (updated_transaction.giver_id, updated_transaction.taker_id);
    return jsonb_build_object('transaction_id', updated_transaction.id, 'returned', true);
  end if;
  return jsonb_build_object('transaction_id', updated_transaction.id, 'returned', false);
end;
$$;

create or replace function public.get_impact_totals()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare personal jsonb;
declare community jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select jsonb_build_object(
    'events', count(*), 'items', coalesce(sum(item_count), 0), 'declared_weight_kg', coalesce(sum(weight_kg), 0),
    'categories', coalesce((select jsonb_object_agg(category_snapshot, items) from (select category_snapshot, sum(item_count) items from public.reuse_events where auth.uid() in (giver_id, taker_id) group by category_snapshot) grouped), '{}'::jsonb)
  ) into personal from public.reuse_events where auth.uid() in (giver_id, taker_id);
  select jsonb_build_object(
    'events', count(*), 'items', coalesce(sum(item_count), 0), 'declared_weight_kg', coalesce(sum(weight_kg), 0),
    'categories', coalesce((select jsonb_object_agg(category_snapshot, items) from (select category_snapshot, sum(item_count) items from public.reuse_events group by category_snapshot) grouped), '{}'::jsonb)
  ) into community from public.reuse_events;
  return jsonb_build_object('personal', personal, 'community', community);
end;
$$;

create or replace function public.queue_loan_return_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare inserted_count integer;
begin
  insert into public.user_inbox (user_id, item_type, title, body, payload, idempotency_key)
  select t.giver_id, 'reminder', 'Loan return is approaching', 'The planned return time is approaching.',
    jsonb_build_object('transaction_id', t.id, 'return_due_at', t.return_due_at),
    'loan-return-' || t.id::text || '-' || t.return_due_at::date::text
  from public.transactions t join public.listings l on l.id = t.listing_id
  where l.type = 'lend' and t.handed_over_at is not null and t.returned_at is null and t.canceled_at is null
    and t.return_due_at between now() and now() + interval '24 hours'
  on conflict (user_id, idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
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
    status = case when status = 'canceled' then 'active' else status end, updated_at = now()
  where id = target_listing_id;
end;
$$;

drop function if exists public.get_my_deals();
create function public.get_my_deals()
returns table (
  transaction_id uuid, listing_id uuid, role text, listing_type text, category text, category_path text,
  quantity integer, image_url text, status text, created_at timestamptz, completed_at timestamptz,
  canceled_at timestamptz, partner_id uuid, partner_name text, partner_rating numeric,
  messenger_type text, contact_value text, contact_href text, contacts jsonb, my_review_rating integer,
  accepted_at timestamptz, expires_at timestamptz, giver_confirmed_at timestamptz, taker_confirmed_at timestamptz,
  canceled_reason text, risk_flags text[], is_listing_owner boolean,
  return_due_at timestamptz, handed_over_at timestamptz, returned_at timestamptz,
  lender_return_confirmed_at timestamptz, borrower_return_confirmed_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.refresh_expired_deals();
  return query
  select t.id, l.id, case when t.giver_id = auth.uid() then 'giver' else 'taker' end,
    l.type::text, l.category, l.category_path, t.requested_quantity::integer, l.image_url,
    case
      when t.canceled_at is not null and t.canceled_reason = 'expired' then 'expired'
      when t.canceled_at is not null then 'canceled'
      when l.type = 'lend' and t.returned_at is not null then 'returned'
      when l.type = 'lend' and t.handed_over_at is not null and t.return_due_at <= now() then 'return_due'
      when l.type = 'lend' and t.handed_over_at is not null then 'handed_over'
      when t.completed_at is not null then 'completed'
      when t.accepted_at is null then 'pending'
      when (t.giver_confirmed_at is not null or t.taker_confirmed_at is not null) then 'confirming'
      else 'reserved'
    end,
    t.created_at, t.completed_at, t.canceled_at, partner.id, partner.full_name, partner.rating,
    (contact_bundle.items -> 0) ->> 'messenger_type', (contact_bundle.items -> 0) ->> 'contact_value', (contact_bundle.items -> 0) ->> 'contact_href',
    coalesce(contact_bundle.items, '[]'::jsonb), mine.rating::integer,
    t.accepted_at, t.expires_at, t.giver_confirmed_at, t.taker_confirmed_at, t.canceled_reason, t.risk_flags, l.user_id = auth.uid(),
    t.return_due_at, t.handed_over_at, t.returned_at, t.lender_return_confirmed_at, t.borrower_return_confirmed_at
  from public.transactions t
  join public.listings l on l.id = t.listing_id
  join public.profiles partner on partner.id = case when t.giver_id = auth.uid() then t.taker_id else t.giver_id end
  left join lateral (
    select jsonb_agg(jsonb_build_object('messenger_type', contact.messenger_type, 'contact_value', contact.contact_value,
      'contact_href', case when contact.messenger_type = 'wa' then 'https://wa.me/' || regexp_replace(contact.contact_value, '[^0-9]', '', 'g')
        when contact.messenger_type = 'tg' and btrim(contact.contact_value) ~ '^[+][1-9][0-9]{6,14}$' then 'tg://resolve?phone=' || regexp_replace(contact.contact_value, '[^0-9]', '', 'g')
        when contact.messenger_type = 'tg' then 'https://t.me/' || ltrim(contact.contact_value, '@')
        when contact.messenger_type = 'viber' then 'viber://chat?number=' || regexp_replace(contact.contact_value, '[^+0-9]', '', 'g') else null end
    ) order by case contact.messenger_type when 'tg' then 1 when 'wa' then 2 else 3 end) items
    from public.profile_contacts contact where contact.user_id = partner.id and t.canceled_at is null
  ) contact_bundle on true
  left join public.reviews mine on mine.transaction_id = t.id and mine.from_user_id = auth.uid()
  where auth.uid() in (t.giver_id, t.taker_id) order by t.created_at desc;
end;
$$;

revoke execute on function public.confirm_loan_handover(uuid) from public, anon;
revoke execute on function public.confirm_loan_return(uuid) from public, anon;
revoke execute on function public.get_impact_totals() from public, anon;
revoke execute on function public.queue_loan_return_reminders() from public, anon, authenticated;
revoke execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric, integer) from public, anon;
grant execute on function public.confirm_loan_handover(uuid) to authenticated;
grant execute on function public.confirm_loan_return(uuid) to authenticated;
grant execute on function public.get_impact_totals() to authenticated;
grant execute on function public.queue_loan_return_reminders() to service_role;
grant execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric, integer) to authenticated;

commit;
