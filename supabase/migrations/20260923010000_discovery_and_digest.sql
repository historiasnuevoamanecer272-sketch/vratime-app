begin;

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  query text not null check (char_length(btrim(query)) between 1 and 120),
  filters jsonb not null default '{}'::jsonb,
  notify_daily boolean not null default true,
  last_digest_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  query text not null check (char_length(btrim(query)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.listing_favourites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create table if not exists public.listing_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  saved_search_id uuid references public.saved_searches(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  score numeric(5,2) not null default 1,
  reason text,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, saved_search_id, listing_id)
);

create table if not exists public.user_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_type text not null check (item_type in ('digest', 'match', 'reminder', 'system')),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  body text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table if not exists public.digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  digest_date date not null,
  inbox_id uuid references public.user_inbox(id) on delete set null,
  search_count integer not null default 0 check (search_count >= 0),
  push_attempted boolean not null default false,
  delivered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null check (char_length(btrim(p256dh)) >= 20),
  auth text not null check (char_length(btrim(auth)) >= 10),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create unique index if not exists digest_deliveries_one_per_day
  on public.digest_deliveries (user_id, digest_date);

create index if not exists saved_searches_user_idx on public.saved_searches (user_id, updated_at desc);
create index if not exists search_history_user_idx on public.search_history (user_id, created_at desc);
create index if not exists listing_favourites_listing_idx on public.listing_favourites (listing_id, created_at desc);
create index if not exists listing_matches_user_idx on public.listing_matches (user_id, created_at desc);
create index if not exists user_inbox_user_idx on public.user_inbox (user_id, created_at desc);
create index if not exists push_subscriptions_user_idx on public.web_push_subscriptions (user_id, enabled);

alter table public.saved_searches enable row level security;
alter table public.search_history enable row level security;
alter table public.listing_favourites enable row level security;
alter table public.listing_matches enable row level security;
alter table public.user_inbox enable row level security;
alter table public.digest_deliveries enable row level security;
alter table public.web_push_subscriptions enable row level security;

revoke all on public.saved_searches from public, anon;
revoke all on public.search_history from public, anon;
revoke all on public.listing_favourites from public, anon;
revoke all on public.listing_matches from public, anon;
revoke all on public.user_inbox from public, anon;
revoke all on public.digest_deliveries from public, anon;
revoke all on public.web_push_subscriptions from public, anon;

grant select, insert, update, delete on public.saved_searches to authenticated;
grant select, insert, delete on public.search_history to authenticated;
grant select, insert, delete on public.listing_favourites to authenticated;
grant select, update on public.listing_matches to authenticated;
grant select, update on public.user_inbox to authenticated;
grant select on public.digest_deliveries to authenticated;
grant select, insert, update, delete on public.web_push_subscriptions to authenticated;

create policy saved_searches_owner on public.saved_searches
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy search_history_owner on public.search_history
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy listing_favourites_owner on public.listing_favourites
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy listing_matches_owner on public.listing_matches
  for select to authenticated using (user_id = auth.uid());
create policy listing_matches_owner_seen on public.listing_matches
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_inbox_owner_read on public.user_inbox
  for select to authenticated using (user_id = auth.uid());
create policy user_inbox_owner_update on public.user_inbox
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy digest_deliveries_owner_read on public.digest_deliveries
  for select to authenticated using (user_id = auth.uid());
create policy web_push_subscriptions_owner on public.web_push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.save_search(
  search_query text,
  search_filters jsonb default '{}'::jsonb,
  wants_daily_digest boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare search_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(search_query, ''))) < 1 then raise exception 'Search query is required'; end if;

  insert into public.saved_searches (user_id, query, filters, notify_daily)
  values (auth.uid(), btrim(search_query), coalesce(search_filters, '{}'::jsonb), coalesce(wants_daily_digest, true))
  returning id into search_id;
  return search_id;
end;
$$;

create or replace function public.toggle_listing_favourite(target_listing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.listings where id = target_listing_id) then raise exception 'Listing not found'; end if;

  delete from public.listing_favourites
  where user_id = auth.uid() and listing_id = target_listing_id;
  if found then
    return false;
  end if;

  insert into public.listing_favourites (user_id, listing_id)
  values (auth.uid(), target_listing_id);
  return true;
end;
$$;

create or replace function public.record_search_history(search_query text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare history_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(search_query, ''))) < 1 then raise exception 'Search query is required'; end if;

  insert into public.search_history (user_id, query)
  values (auth.uid(), btrim(search_query))
  returning id into history_id;
  return history_id;
end;
$$;

create or replace function public.get_my_discovery_feed()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'saved_searches', coalesce((select jsonb_agg(to_jsonb(s) order by s.updated_at desc) from public.saved_searches s where s.user_id = auth.uid()), '[]'::jsonb),
    'favourites', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from public.listing_favourites f where f.user_id = auth.uid()), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from public.listing_matches m where m.user_id = auth.uid()), '[]'::jsonb),
    'inbox', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.user_inbox i where i.user_id = auth.uid() limit 50), '[]'::jsonb)
  );
$$;

create or replace function public.mark_inbox_item_read(target_inbox_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.user_inbox
  set read_at = coalesce(read_at, now())
  where id = target_inbox_id and user_id = auth.uid();
  if not found then raise exception 'Inbox item not found'; end if;
end;
$$;

revoke execute on function public.save_search(text, jsonb, boolean) from public, anon;
revoke execute on function public.toggle_listing_favourite(uuid) from public, anon;
revoke execute on function public.record_search_history(text) from public, anon;
revoke execute on function public.get_my_discovery_feed() from public, anon;
revoke execute on function public.mark_inbox_item_read(uuid) from public, anon;

grant execute on function public.save_search(text, jsonb, boolean) to authenticated;
grant execute on function public.toggle_listing_favourite(uuid) to authenticated;
grant execute on function public.record_search_history(text) to authenticated;
grant execute on function public.get_my_discovery_feed() to authenticated;
grant execute on function public.mark_inbox_item_read(uuid) to authenticated;

commit;
