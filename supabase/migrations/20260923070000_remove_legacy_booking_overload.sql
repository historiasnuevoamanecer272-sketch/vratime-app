begin;

-- PostgREST cannot disambiguate a one-argument wrapper from the quantity-aware
-- function when its second argument has a default. Keep only the latter; it
-- still accepts a one-argument SQL call and preserves quantity support.
drop function if exists public.book_listing(uuid);

revoke execute on function public.book_listing(uuid, integer) from public, anon;
grant execute on function public.book_listing(uuid, integer) to authenticated;

commit;
