begin;

-- Preserve every existing contact, then permit one row for each channel.
alter table public.profile_contacts drop constraint if exists profile_contacts_pkey;
alter table public.profile_contacts add constraint profile_contacts_pkey primary key (user_id, messenger_type);

create or replace function public.upsert_my_profile_v2(
  profile_name text,
  profile_language text,
  profile_channels jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare channel_count integer;
declare unique_channel_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(profile_name)) < 2 then raise exception 'Name is too short'; end if;
  if profile_language not in ('ru', 'me', 'en') then raise exception 'Unsupported language'; end if;
  if jsonb_typeof(profile_channels) <> 'array' then raise exception 'Contacts must be an array'; end if;

  select count(*), count(distinct channel.messenger_type)
  into channel_count, unique_channel_count
  from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text);

  if channel_count < 1 then raise exception 'At least one contact is required'; end if;
  if channel_count <> unique_channel_count then raise exception 'Each messenger can only be selected once'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text)
    where channel.messenger_type not in ('viber', 'wa', 'tg')
       or char_length(btrim(coalesce(channel.contact_value, ''))) not between 3 and 120
  ) then raise exception 'Invalid contact'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text)
    where channel.messenger_type = 'tg'
      and btrim(channel.contact_value) !~ '^@[A-Za-z0-9_]{5,32}$'
  ) then raise exception 'Invalid Telegram username'; end if;

  insert into public.profiles (id, full_name, language, preferred_language, updated_at)
  values (auth.uid(), btrim(profile_name), profile_language, profile_language, now())
  on conflict (id) do update set
    full_name = excluded.full_name,
    language = excluded.language,
    preferred_language = excluded.preferred_language,
    updated_at = now();

  delete from public.profile_contacts where user_id = auth.uid();
  insert into public.profile_contacts (user_id, messenger_type, contact_value, updated_at)
  select auth.uid(), channel.messenger_type, btrim(channel.contact_value), now()
  from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text);
end;
$$;

drop function if exists public.get_my_deals();
create function public.get_my_deals()
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
        'contact_href', case contact.messenger_type
          when 'wa' then 'https://wa.me/' || regexp_replace(contact.contact_value, '[^0-9]', '', 'g')
          when 'tg' then 'https://t.me/' || ltrim(contact.contact_value, '@')
          when 'viber' then 'viber://chat?number=' || regexp_replace(contact.contact_value, '[^+0-9]', '', 'g')
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

revoke all on function public.upsert_my_profile_v2(text, text, jsonb) from public;
revoke all on function public.get_my_deals() from public;
grant execute on function public.upsert_my_profile_v2(text, text, jsonb) to authenticated;
grant execute on function public.get_my_deals() to authenticated;

commit;
