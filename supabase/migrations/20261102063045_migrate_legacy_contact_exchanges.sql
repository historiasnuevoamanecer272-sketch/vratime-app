-- Retire unfulfilled reservations into the contact flow, preserving the original
-- transaction and its dates. Closed history and physically issued loans stay put.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.listings, public.transactions in share row exclusive mode;
alter table public.transactions add column contact_exchange_id uuid
  references public.listing_contact_exchanges(id) on delete set null;

do $$
declare legacy record;
declare exchange uuid;
begin
  for legacy in
    select t.*, l.user_id as owner_id,
      case when l.user_id=t.giver_id then t.taker_id else t.giver_id end as requester_id
    from public.transactions t join public.listings l on l.id=t.listing_id
    where t.canceled_at is null and t.completed_at is null
      and t.handed_over_at is null and t.returned_at is null
      and t.contact_exchange_id is null
    order by t.created_at,t.id
  loop
    if legacy.owner_id not in (legacy.giver_id,legacy.taker_id)
      or legacy.requester_id is null or legacy.requester_id=legacy.owner_id then
      raise exception 'Legacy transaction has invalid participants: %',legacy.id;
    end if;
    insert into public.listing_contact_exchanges(listing_id,owner_id,requester_id,created_at)
      values(legacy.listing_id,legacy.owner_id,legacy.requester_id,legacy.created_at)
      on conflict(listing_id,requester_id) do nothing;
    select id into strict exchange from public.listing_contact_exchanges
      where listing_id=legacy.listing_id and requester_id=legacy.requester_id;

    -- Restore stock without reopening an independently closed/removed listing.
    update public.listings set
      available_quantity=least(quantity,coalesce(available_quantity,0)+coalesce(legacy.reserved_quantity,0)),
      reserved_quantity=greatest(0,coalesce(reserved_quantity,0)-coalesce(legacy.reserved_quantity,0)),
      status=case when status='reserved' then 'active'::public.listing_status else status end,
      updated_at=now()
      where id=legacy.listing_id and coalesce(legacy.reserved_quantity,0)>0;

    -- This is migration, not a failed deal: no outcome, reward, penalty or email.
    -- Keeping the old dates and participants preserves the reservation history.
    update public.transactions set reserved_quantity=0,contact_exchange_id=exchange,
      canceled_at=now(),canceled_reason='contact_exchange_migrated'
      where id=legacy.id;
    update public.user_inbox set read_at=coalesce(read_at,now())
      where user_id in(legacy.giver_id,legacy.taker_id)
        and payload->>'transaction_id'=legacy.id::text;
  end loop;
end;
$$;
create or replace function public.get_my_deals()
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
  where auth.uid() in (t.giver_id, t.taker_id) and t.contact_exchange_id is null order by t.created_at desc;
end;
$$;


revoke execute on function public.get_my_deals() from public, anon;
grant execute on function public.get_my_deals() to authenticated;

commit;

