begin;

-- Remove only the invalid self-favourite relationships. Ads, other users'
-- favourites and existing reports retain their original records.
delete from public.listing_favourites f
using public.listings l
where f.listing_id = l.id and f.user_id = l.user_id;

-- Keep the existing owner policy, and constrain its direct INSERT path.
-- Foreign listing rows are private under their RLS, so check for a visible
-- own listing rather than requiring SELECT access to someone else's listing.
create policy listing_favourites_no_self_insert
on public.listing_favourites as restrictive
for insert to authenticated
with check (
  not exists (
    select 1 from public.listings l
    where l.id = listing_favourites.listing_id and l.user_id = (select auth.uid())
  )
);

create or replace function public.toggle_listing_favourite(target_listing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  listing_owner uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select l.user_id into listing_owner from public.listings l where l.id = target_listing_id;
  if not found then raise exception 'Listing not found'; end if;
  if listing_owner = actor then raise exception 'Cannot favourite your own listing'; end if;

  delete from public.listing_favourites f where f.user_id = actor and f.listing_id = target_listing_id;
  if found then return false; end if;

  insert into public.listing_favourites(user_id, listing_id) values(actor, target_listing_id);
  return true;
end;
$$;

revoke execute on function public.toggle_listing_favourite(uuid) from public, anon;
grant execute on function public.toggle_listing_favourite(uuid) to authenticated;

-- create_report already rejects target_user = auth.uid(); authenticated has
-- SELECT only on reports, so direct INSERT cannot bypass that existing guard.

commit;
