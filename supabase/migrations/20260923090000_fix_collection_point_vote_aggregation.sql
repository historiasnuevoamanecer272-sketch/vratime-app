begin;

-- Materials and votes are separate one-to-many joins. Count distinct voters
-- so a point that accepts several materials does not multiply confirmations.
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
    coalesce(count(distinct v.user_id) filter (where v.value = 'exists' and v.created_at >= now() - interval '180 days'), 0)::integer,
    coalesce(count(distinct v.user_id) filter (where v.value = 'missing' and v.created_at >= now() - interval '180 days'), 0)::integer,
    p.created_at
  from public.collection_points p
  left join public.collection_point_materials m on m.point_id = p.id
  left join public.collection_point_votes v on v.point_id = p.id
  group by p.id
  order by p.created_at desc;
$$;

revoke execute on function public.get_collection_points() from public;
grant execute on function public.get_collection_points() to anon, authenticated;

commit;
