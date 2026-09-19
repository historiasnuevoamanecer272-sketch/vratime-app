-- A Telegram username has a web URL; a phone contact needs the Telegram app deep link.
begin;

create or replace function public.get_my_deals()
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
  ) contact_bundle on true
  left join public.reviews mine on mine.transaction_id = t.id and mine.from_user_id = auth.uid()
  where auth.uid() in (t.giver_id, t.taker_id)
  order by t.created_at desc;
$$;

revoke all on function public.get_my_deals() from public, anon;
grant execute on function public.get_my_deals() to authenticated;

commit;
