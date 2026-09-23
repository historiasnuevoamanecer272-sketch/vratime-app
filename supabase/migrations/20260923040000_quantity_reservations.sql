begin;

alter table public.transactions add column if not exists requested_quantity integer not null default 1;
alter table public.transactions add column if not exists reserved_quantity integer not null default 0;

update public.listings
set available_quantity = coalesce(available_quantity, greatest(0, quantity - reserved_quantity)),
    reserved_quantity = coalesce(reserved_quantity, 0);
update public.transactions
set requested_quantity = coalesce(requested_quantity, 1),
    reserved_quantity = case when accepted_at is not null and completed_at is null and canceled_at is null then coalesce(reserved_quantity, requested_quantity, 1) else 0 end;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_requested_quantity_check') then
    alter table public.transactions add constraint transactions_requested_quantity_check check (requested_quantity between 1 and 10000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_reserved_quantity_check') then
    alter table public.transactions add constraint transactions_reserved_quantity_check check (reserved_quantity >= 0);
  end if;
end $$;

drop index if exists public.transactions_one_accepted_per_listing;
drop index if exists public.transactions_one_open_per_listing;

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

create or replace function public.refresh_expired_deals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare expired_record record;
declare expired_count integer := 0;
begin
  for expired_record in
    update public.transactions
    set canceled_at = now(), canceled_reason = 'expired'
    where accepted_at is not null
      and expires_at <= now()
      and completed_at is null
      and canceled_at is null
    returning id
  loop
    perform public.restore_or_consume_reservation(expired_record.id, 'restore');
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

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

  partner_giver := case when selected_listing.type = 'give' then selected_listing.user_id else auth.uid() end;
  partner_taker := case when selected_listing.type = 'give' then auth.uid() else selected_listing.user_id end;
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

create or replace function public.book_listing(target_listing_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$ select public.book_listing(target_listing_id, 1); $$;

drop function if exists public.accept_deal(uuid);
create function public.accept_deal(target_transaction_id uuid)
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
  set accepted_at = now(), expires_at = now() + interval '24 hours', reserved_quantity = selected_transaction.requested_quantity
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
declare updated_transaction public.transactions%rowtype;
declare giver_reward integer := 0;
declare taker_reward integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.refresh_expired_deals();
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found or auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Transaction not found'; end if;
  if selected_transaction.accepted_at is null then raise exception 'The request has not been accepted'; end if;
  if selected_transaction.canceled_at is not null then raise exception 'Transaction is closed'; end if;
  if selected_transaction.completed_at is not null then
    return jsonb_build_object('transaction_id', selected_transaction.id, 'completed', true, 'eco_reward', 0);
  end if;

  update public.transactions
  set giver_confirmed_at = case when auth.uid() = giver_id then coalesce(giver_confirmed_at, now()) else giver_confirmed_at end,
      taker_confirmed_at = case when auth.uid() = taker_id then coalesce(taker_confirmed_at, now()) else taker_confirmed_at end
  where id = selected_transaction.id
  returning * into updated_transaction;

  if updated_transaction.giver_confirmed_at is not null and updated_transaction.taker_confirmed_at is not null then
    perform public.restore_or_consume_reservation(updated_transaction.id, 'consume');
    update public.transactions set completed_at = now(), eco_reward_awarded = true where id = updated_transaction.id;
    if not updated_transaction.eco_reward_awarded then
      giver_reward := 50;
      taker_reward := 25;
      update public.profiles set eco_points = coalesce(eco_points, 0) + giver_reward, updated_at = now() where id = updated_transaction.giver_id;
      update public.profiles set eco_points = coalesce(eco_points, 0) + taker_reward, updated_at = now() where id = updated_transaction.taker_id;
    end if;
    return jsonb_build_object('transaction_id', updated_transaction.id, 'completed', true, 'eco_reward', case when auth.uid() = updated_transaction.giver_id then giver_reward else taker_reward end);
  end if;
  return jsonb_build_object('transaction_id', updated_transaction.id, 'completed', false, 'eco_reward', 0);
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
  canceled_reason text, risk_flags text[], is_listing_owner boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.refresh_expired_deals();
  return query
  select
    t.id, l.id,
    case when t.giver_id = auth.uid() then 'giver' else 'taker' end,
    l.type::text, l.category, l.category_path,
    t.requested_quantity::integer,
    l.image_url,
    case
      when t.canceled_at is not null and t.canceled_reason = 'expired' then 'expired'
      when t.canceled_at is not null then 'canceled'
      when t.completed_at is not null then 'completed'
      when t.accepted_at is null then 'pending'
      when (t.giver_confirmed_at is not null or t.taker_confirmed_at is not null) then 'confirming'
      else 'reserved'
    end,
    t.created_at, t.completed_at, t.canceled_at,
    partner.id, partner.full_name, partner.rating,
    (contact_bundle.items -> 0) ->> 'messenger_type',
    (contact_bundle.items -> 0) ->> 'contact_value',
    (contact_bundle.items -> 0) ->> 'contact_href',
    coalesce(contact_bundle.items, '[]'::jsonb),
    mine.rating::integer,
    t.accepted_at, t.expires_at, t.giver_confirmed_at, t.taker_confirmed_at,
    t.canceled_reason, t.risk_flags, l.user_id = auth.uid()
  from public.transactions t
  join public.listings l on l.id = t.listing_id
  join public.profiles partner on partner.id = case when t.giver_id = auth.uid() then t.taker_id else t.giver_id end
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'messenger_type', contact.messenger_type,
      'contact_value', contact.contact_value,
      'contact_href', case
        when contact.messenger_type = 'wa' then 'https://wa.me/' || regexp_replace(contact.contact_value, '[^0-9]', '', 'g')
        when contact.messenger_type = 'tg' and btrim(contact.contact_value) ~ '^[+][1-9][0-9]{6,14}$' then 'tg://resolve?phone=' || regexp_replace(contact.contact_value, '[^0-9]', '', 'g')
        when contact.messenger_type = 'tg' then 'https://t.me/' || ltrim(contact.contact_value, '@')
        when contact.messenger_type = 'viber' then 'viber://chat?number=' || regexp_replace(contact.contact_value, '[^+0-9]', '', 'g')
        else null
      end
    ) order by case contact.messenger_type when 'tg' then 1 when 'wa' then 2 else 3 end) as items
    from public.profile_contacts contact
    where contact.user_id = partner.id and t.canceled_at is null
  ) contact_bundle on true
  left join public.reviews mine on mine.transaction_id = t.id and mine.from_user_id = auth.uid()
  where auth.uid() in (t.giver_id, t.taker_id)
  order by t.created_at desc;
end;
$$;

revoke execute on function public.book_listing(uuid, integer) from public, anon;
revoke execute on function public.book_listing(uuid) from public, anon;
revoke execute on function public.accept_deal(uuid) from public, anon;
revoke execute on function public.cancel_booking(uuid) from public, anon;
revoke execute on function public.confirm_handover(uuid) from public, anon;
revoke execute on function public.restore_or_consume_reservation(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_my_deals() from public, anon;
grant execute on function public.book_listing(uuid, integer) to authenticated;
grant execute on function public.book_listing(uuid) to authenticated;
grant execute on function public.accept_deal(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.confirm_handover(uuid) to authenticated;
grant execute on function public.get_my_deals() to authenticated;

commit;
