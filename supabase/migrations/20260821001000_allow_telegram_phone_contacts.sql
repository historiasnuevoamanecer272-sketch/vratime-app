-- Telegram may be reached by a public @username or an international phone number.
-- Run after 20260820233000_multi_messenger_contacts.sql.
begin;

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
    select 1 from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text)
    where channel.messenger_type not in ('viber', 'wa', 'tg')
       or char_length(btrim(coalesce(channel.contact_value, ''))) not between 3 and 120
  ) then raise exception 'Invalid contact'; end if;
  if exists (
    select 1 from jsonb_to_recordset(profile_channels) as channel(messenger_type text, contact_value text)
    where channel.messenger_type = 'tg'
      and btrim(channel.contact_value) !~ '^@[A-Za-z0-9_]{5,32}$'
      and btrim(channel.contact_value) !~ '^\+[1-9][0-9]{6,14}$'
  ) then raise exception 'Invalid Telegram contact'; end if;

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

revoke all on function public.upsert_my_profile_v2(text, text, jsonb) from public;
grant execute on function public.upsert_my_profile_v2(text, text, jsonb) to authenticated;

commit;
