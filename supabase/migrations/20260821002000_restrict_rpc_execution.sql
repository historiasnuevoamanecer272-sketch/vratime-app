-- Supabase/PostgREST should expose private workflow functions only to signed-in users.
-- Explicit anon revokes also harden projects where older functions retained direct grants.
begin;

revoke execute on function public.upsert_my_profile(text, text, text, text) from public, anon;
revoke execute on function public.upsert_my_profile_v2(text, text, jsonb) from public, anon;
revoke execute on function public.book_listing(uuid) from public, anon;
revoke execute on function public.cancel_booking(uuid) from public, anon;
revoke execute on function public.deactivate_listing(uuid) from public, anon;
revoke execute on function public.complete_deal(uuid) from public, anon;
revoke execute on function public.submit_review(uuid, integer) from public, anon;
revoke execute on function public.get_my_deals() from public, anon;

grant execute on function public.upsert_my_profile(text, text, text, text) to authenticated;
grant execute on function public.upsert_my_profile_v2(text, text, jsonb) to authenticated;
grant execute on function public.book_listing(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.deactivate_listing(uuid) to authenticated;
grant execute on function public.complete_deal(uuid) to authenticated;
grant execute on function public.submit_review(uuid, integer) to authenticated;
grant execute on function public.get_my_deals() to authenticated;

commit;
