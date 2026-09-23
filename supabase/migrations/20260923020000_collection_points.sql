begin;

create table if not exists public.collection_points (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  description text check (description is null or char_length(description) <= 1000),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  location_label text not null check (char_length(btrim(location_label)) between 3 and 240),
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_point_materials (
  point_id uuid not null references public.collection_points(id) on delete cascade,
  material_key text not null check (material_key in ('glass', 'paper', 'textile', 'packaging', 'plastic', 'metal', 'electronics', 'batteries', 'mixed')),
  primary key (point_id, material_key)
);

create table if not exists public.collection_point_votes (
  point_id uuid not null references public.collection_points(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  value text not null check (value in ('exists', 'missing')),
  created_at timestamptz not null default now(),
  primary key (point_id, user_id)
);

create table if not exists public.collection_point_edits (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references public.collection_points(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  suggestion jsonb not null default '{}'::jsonb,
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists collection_points_status_idx on public.collection_points (status, created_at desc);
create index if not exists collection_point_votes_point_idx on public.collection_point_votes (point_id, created_at desc);
create index if not exists collection_point_edits_point_idx on public.collection_point_edits (point_id, created_at desc);

alter table public.collection_points enable row level security;
alter table public.collection_point_materials enable row level security;
alter table public.collection_point_votes enable row level security;
alter table public.collection_point_edits enable row level security;

revoke all on public.collection_points from public, anon, authenticated;
revoke all on public.collection_point_materials from public, anon, authenticated;
revoke all on public.collection_point_votes from public, anon;
revoke all on public.collection_point_edits from public, anon, authenticated;

grant select on public.collection_points, public.collection_point_materials to anon, authenticated;
grant select, insert, update on public.collection_point_votes to authenticated;
grant select on public.collection_point_edits to authenticated;

create policy collection_points_public_read on public.collection_points for select using (true);
create policy collection_point_materials_public_read on public.collection_point_materials for select using (true);
create policy collection_point_votes_owner_read on public.collection_point_votes for select to authenticated using (user_id = auth.uid());
create policy collection_point_votes_owner_write on public.collection_point_votes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy collection_point_edits_owner_or_staff_read on public.collection_point_edits
  for select to authenticated using (user_id = auth.uid() or public.is_staff());

create or replace function public.refresh_collection_point_status(target_point_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare exists_votes integer;
declare missing_votes integer;
declare next_status text;
begin
  select count(*)::integer into exists_votes
  from public.collection_point_votes
  where point_id = target_point_id and value = 'exists' and created_at >= now() - interval '180 days';

  select count(*)::integer into missing_votes
  from public.collection_point_votes
  where point_id = target_point_id and value = 'missing' and created_at >= now() - interval '180 days';

  next_status := case when missing_votes >= 2 then 'unverified' when exists_votes >= 3 then 'verified' else 'unverified' end;
  update public.collection_points set status = next_status, updated_at = now() where id = target_point_id;
  return next_status;
end;
$$;

create or replace function public.refresh_expired_collection_point_votes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare point_record record;
begin
  for point_record in select id from public.collection_points loop
    perform public.refresh_collection_point_status(point_record.id);
  end loop;
end;
$$;

create or replace function public.create_collection_point(
  point_name text,
  point_lat double precision,
  point_lng double precision,
  point_location_label text,
  material_keys text[],
  point_description text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_point_id uuid;
declare material text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(point_name, ''))) < 2 then raise exception 'Point name is required'; end if;
  if point_lat not between -90 and 90 or point_lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
  if char_length(btrim(coalesce(point_location_label, ''))) < 3 then raise exception 'Location label is required'; end if;
  if coalesce(array_length(material_keys, 1), 0) = 0 then raise exception 'At least one material is required'; end if;

  insert into public.collection_points (created_by, name, description, lat, lng, location_label)
  values (auth.uid(), btrim(point_name), nullif(btrim(coalesce(point_description, '')), ''), point_lat, point_lng, btrim(point_location_label))
  returning id into new_point_id;

  foreach material in array material_keys loop
    insert into public.collection_point_materials (point_id, material_key)
    values (new_point_id, material)
    on conflict do nothing;
  end loop;

  if not exists (select 1 from public.collection_point_materials where point_id = new_point_id) then
    raise exception 'At least one supported material is required';
  end if;
  return new_point_id;
end;
$$;

create or replace function public.vote_collection_point(target_point_id uuid, vote_value text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare selected_point public.collection_points%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if vote_value not in ('exists', 'missing') then raise exception 'Invalid vote'; end if;
  select * into selected_point from public.collection_points where id = target_point_id for update;
  if not found then raise exception 'Collection point not found'; end if;
  if selected_point.created_by = auth.uid() then raise exception 'Point owner cannot vote'; end if;

  insert into public.collection_point_votes (point_id, user_id, value)
  values (target_point_id, auth.uid(), vote_value)
  on conflict (point_id, user_id) do update set value = excluded.value, created_at = now();

  return public.refresh_collection_point_status(target_point_id);
end;
$$;

create or replace function public.suggest_collection_point_edit(target_point_id uuid, suggestion jsonb, note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare edit_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.collection_points where id = target_point_id) then raise exception 'Collection point not found'; end if;
  insert into public.collection_point_edits (point_id, user_id, suggestion, note)
  values (target_point_id, auth.uid(), coalesce(suggestion, '{}'::jsonb), nullif(btrim(coalesce(note, '')), ''))
  returning id into edit_id;
  return edit_id;
end;
$$;

create or replace function public.get_collection_points()
returns table (
  id uuid,
  name text,
  description text,
  lat double precision,
  lng double precision,
  location_label text,
  status text,
  materials text[],
  exists_votes integer,
  missing_votes integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.description,
    p.lat,
    p.lng,
    p.location_label,
    p.status,
    coalesce(array_agg(distinct m.material_key) filter (where m.material_key is not null), '{}'::text[]),
    coalesce(count(v.*) filter (where v.value = 'exists' and v.created_at >= now() - interval '180 days'), 0)::integer,
    coalesce(count(v.*) filter (where v.value = 'missing' and v.created_at >= now() - interval '180 days'), 0)::integer,
    p.created_at
  from public.collection_points p
  left join public.collection_point_materials m on m.point_id = p.id
  left join public.collection_point_votes v on v.point_id = p.id
  group by p.id
  order by p.created_at desc;
$$;

revoke execute on function public.refresh_collection_point_status(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_expired_collection_point_votes() from public, anon, authenticated;
revoke execute on function public.create_collection_point(text, double precision, double precision, text, text[], text) from public, anon;
revoke execute on function public.vote_collection_point(uuid, text) from public, anon;
revoke execute on function public.suggest_collection_point_edit(uuid, jsonb, text) from public, anon;
revoke execute on function public.get_collection_points() from public;

grant execute on function public.create_collection_point(text, double precision, double precision, text, text[], text) to authenticated;
grant execute on function public.vote_collection_point(uuid, text) to authenticated;
grant execute on function public.suggest_collection_point_edit(uuid, jsonb, text) to authenticated;
grant execute on function public.get_collection_points() to authenticated;
grant execute on function public.get_collection_points() to anon;
grant execute on function public.refresh_expired_collection_point_votes() to service_role;

commit;
