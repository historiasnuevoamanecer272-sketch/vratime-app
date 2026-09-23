begin;

-- The pre-loan editing RPC has the same named arguments as the newer version.
-- PostgREST cannot pick a defaulted overload, so retain only the version that
-- supports lending metadata and JSON photo arrays.
drop function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric);

revoke execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric, integer) from public, anon;
grant execute on function public.update_my_listing(uuid, bigint, text, text, text, integer, double precision, double precision, text, text, jsonb, text, text, jsonb, numeric, integer) to authenticated;

commit;
