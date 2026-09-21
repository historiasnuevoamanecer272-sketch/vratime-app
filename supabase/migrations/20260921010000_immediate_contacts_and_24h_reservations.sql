begin;

-- Keep requests visible on the map until the listing owner chooses one, then
-- reserve the listing for one day before automatically returning it to the map.
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
  set accepted_at = now(), expires_at = now() + interval '24 hours'
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

-- A request itself creates a private participant relationship, so each side
-- can coordinate immediately. Contacts remain hidden from every outsider.
create or replace function public.get_my_deals()
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
    l.type::text,
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
          when contact.messenger_type = 'tg' and btrim(contact.contact_value) ~ '^[+][1-9][0-9]{6,14}$'
            then 'tg://resolve?phone=' || regexp_replace(contact.contact_value, '[^0-9]', '', 'g')
          when contact.messenger_type = 'tg' then 'https://t.me/' || ltrim(contact.contact_value, '@')
          when contact.messenger_type = 'viber' then 'viber://chat?number=' || regexp_replace(contact.contact_value, '[^+0-9]', '', 'g')
          else null
        end
      ) order by case contact.messenger_type when 'tg' then 1 when 'wa' then 2 else 3 end
    ) as items
    from public.profile_contacts contact
    where contact.user_id = partner.id
      and t.canceled_at is null
  ) contact_bundle on true
  left join public.reviews mine on mine.transaction_id = t.id and mine.from_user_id = auth.uid()
  where auth.uid() in (t.giver_id, t.taker_id)
  order by t.created_at desc;
end;
$$;

revoke execute on function public.accept_deal(uuid) from public, anon;
revoke execute on function public.get_my_deals() from public, anon;
grant execute on function public.accept_deal(uuid) to authenticated;
grant execute on function public.get_my_deals() to authenticated;

commit;
