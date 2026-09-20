begin;

alter table public.transactions add column if not exists accepted_at timestamptz;
alter table public.transactions add column if not exists expires_at timestamptz;
alter table public.transactions add column if not exists giver_confirmed_at timestamptz;
alter table public.transactions add column if not exists taker_confirmed_at timestamptz;
alter table public.transactions add column if not exists canceled_reason text;
alter table public.transactions add column if not exists risk_flags text[] not null default '{}'::text[];
alter table public.profiles add column if not exists ranking_opt_in boolean not null default true;
alter table public.listings add column if not exists location_label text;

-- Reservations made before this workflow was introduced remain valid and get
-- a fresh 48-hour window, so the migration never unexpectedly loses a deal.
update public.transactions t
set accepted_at = coalesce(t.accepted_at, t.created_at),
    expires_at = coalesce(t.expires_at, greatest(t.created_at + interval '48 hours', now() + interval '48 hours'))
from public.listings l
where l.id = t.listing_id
  and l.status = 'reserved'
  and t.completed_at is null
  and t.canceled_at is null;

drop index if exists public.transactions_one_open_per_listing;
create unique index if not exists transactions_one_open_request_per_user
  on public.transactions (listing_id, booked_by)
  where completed_at is null and canceled_at is null;
create unique index if not exists transactions_one_accepted_per_listing
  on public.transactions (listing_id)
  where accepted_at is not null and completed_at is null and canceled_at is null;
create index if not exists transactions_expiry_idx
  on public.transactions (expires_at)
  where completed_at is null and canceled_at is null;

create or replace function public.refresh_expired_deals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare expired_count integer;
begin
  with expired as (
    update public.transactions
    set canceled_at = now(), canceled_reason = 'expired'
    where accepted_at is not null
      and expires_at <= now()
      and completed_at is null
      and canceled_at is null
    returning listing_id
  ), restored as (
    update public.listings l
    set status = 'active'
    where l.status = 'reserved'
      and exists (select 1 from expired e where e.listing_id = l.id)
    returning l.id
  )
  select count(*)::integer into expired_count from restored;
  return expired_count;
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
  if selected_listing.user_id = auth.uid() then raise exception 'You cannot request your own listing'; end if;

  partner_giver := case when selected_listing.type = 'give' then selected_listing.user_id else auth.uid() end;
  partner_taker := case when selected_listing.type = 'give' then auth.uid() else selected_listing.user_id end;

  if (select count(*) from public.transactions
      where booked_by = auth.uid() and created_at > now() - interval '24 hours') >= 5 then
    flags := array_append(flags, 'high_request_velocity');
  end if;
  if (select count(*) from public.transactions
      where auth.uid() in (giver_id, taker_id)
        and canceled_at > now() - interval '30 days') >= 3 then
    flags := array_append(flags, 'repeated_cancellations');
  end if;
  if (select count(*) from public.transactions
      where giver_id = partner_giver and taker_id = partner_taker
        and completed_at > now() - interval '30 days') >= 3 then
    flags := array_append(flags, 'repeated_pair');
  end if;

  insert into public.transactions (listing_id, giver_id, taker_id, booked_by, risk_flags)
  values (selected_listing.id, partner_giver, partner_taker, auth.uid(), flags)
  returning id into new_transaction_id;

  -- A request does not hide the listing. It becomes reserved only after the
  -- listing owner accepts one of the requests.
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
  if selected_listing.status <> 'active' then raise exception 'Listing is no longer available'; end if;

  update public.transactions
  set accepted_at = now(), expires_at = now() + interval '48 hours'
  where id = selected_transaction.id;
  update public.transactions
  set canceled_at = now(), canceled_reason = 'another_request_accepted'
  where listing_id = selected_listing.id
    and id <> selected_transaction.id
    and completed_at is null
    and canceled_at is null;
  update public.listings set status = 'reserved' where id = selected_listing.id;
  return selected_transaction.id;
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
    update public.listings set status = 'active' where id = selected_transaction.listing_id and status = 'reserved';
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
    update public.transactions set completed_at = now(), eco_reward_awarded = true where id = updated_transaction.id;
    update public.listings set status = 'completed' where id = updated_transaction.listing_id;
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

-- Keep the old RPC name safe for previously cached clients. It now records
-- one participant's confirmation instead of completing a deal unilaterally.
create or replace function public.complete_deal(target_transaction_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$ select public.confirm_handover(target_transaction_id); $$;

create or replace function public.set_ranking_participation(enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.profiles set ranking_opt_in = enabled, updated_at = now() where id = auth.uid();
end;
$$;

create or replace function public.get_eco_leaderboard(limit_count integer default 20)
returns table (rank bigint, user_id uuid, full_name text, eco_points integer, rating numeric)
language sql
stable
security definer
set search_path = public
as $$
  select row_number() over (order by coalesce(p.eco_points, 0) desc, coalesce(p.rating, 0) desc, p.updated_at asc),
         p.id, p.full_name, coalesce(p.eco_points, 0)::integer, p.rating
  from public.profiles p
  where p.ranking_opt_in = true
  order by coalesce(p.eco_points, 0) desc, coalesce(p.rating, 0) desc, p.updated_at asc
  limit least(greatest(limit_count, 1), 100);
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
    t.id,
    l.id,
    case when t.giver_id = auth.uid() then 'giver' else 'taker' end,
    l.type,
    l.category,
    l.category_path,
    l.quantity::integer,
    l.image_url,
    case
      when t.canceled_at is not null and t.canceled_reason = 'expired' then 'expired'
      when t.canceled_at is not null then 'canceled'
      when t.completed_at is not null then 'completed'
      when t.accepted_at is null then 'pending'
      when (t.giver_confirmed_at is not null or t.taker_confirmed_at is not null) then 'confirming'
      else 'reserved'
    end,
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
    mine.rating::integer,
    t.accepted_at,
    t.expires_at,
    t.giver_confirmed_at,
    t.taker_confirmed_at,
    t.canceled_reason,
    t.risk_flags,
    l.user_id = auth.uid()
  from public.transactions t
  join public.listings l on l.id = t.listing_id
  join public.profiles partner on partner.id = case when t.giver_id = auth.uid() then t.taker_id else t.giver_id end
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'messenger_type', contact.messenger_type,
        'contact_value', contact.contact_value,
        'contact_href', case
          when contact.messenger_type = 'wa' then 'https://wa.me/' || regexp_replace(contact.contact_value, '[^0-9]', '', 'g')
          when contact.messenger_type = 'tg' and btrim(contact.contact_value) ~ '^\+[1-9][0-9]{6,14}$'
            then 'tg://resolve?phone=' || regexp_replace(contact.contact_value, '[^0-9]', '', 'g')
          when contact.messenger_type = 'tg' then 'https://t.me/' || ltrim(contact.contact_value, '@')
          when contact.messenger_type = 'viber' then 'viber://chat?number=' || regexp_replace(contact.contact_value, '[^+0-9]', '', 'g')
          else null
        end
      ) order by case contact.messenger_type when 'tg' then 1 when 'wa' then 2 else 3 end
    ) as items
    from public.profile_contacts contact
    where contact.user_id = partner.id
      and t.accepted_at is not null
      and t.canceled_at is null
  ) contact_bundle on true
  left join public.reviews mine on mine.transaction_id = t.id and mine.from_user_id = auth.uid()
  where auth.uid() in (t.giver_id, t.taker_id)
  order by t.created_at desc;
end;
$$;

revoke execute on function public.refresh_expired_deals() from public, anon;
revoke execute on function public.book_listing(uuid) from public, anon;
revoke execute on function public.accept_deal(uuid) from public, anon;
revoke execute on function public.cancel_booking(uuid) from public, anon;
revoke execute on function public.confirm_handover(uuid) from public, anon;
revoke execute on function public.complete_deal(uuid) from public, anon;
revoke execute on function public.set_ranking_participation(boolean) from public, anon;
revoke execute on function public.get_eco_leaderboard(integer) from public, anon;
revoke execute on function public.get_my_deals() from public, anon;
grant execute on function public.refresh_expired_deals() to authenticated;
grant execute on function public.book_listing(uuid) to authenticated;
grant execute on function public.accept_deal(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.confirm_handover(uuid) to authenticated;
grant execute on function public.complete_deal(uuid) to authenticated;
grant execute on function public.set_ranking_participation(boolean) to authenticated;
grant execute on function public.get_eco_leaderboard(integer) to authenticated;
grant execute on function public.get_my_deals() to authenticated;

commit;
