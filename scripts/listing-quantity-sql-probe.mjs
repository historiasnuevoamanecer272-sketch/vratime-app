// Emit a rollback-only PostgreSQL regression fixture. It runs the actual latest
// update_my_listing body against isolated temporary tables, never public rows.
import { readdirSync, readFileSync } from 'node:fs';
const directory = new URL('../supabase/migrations/', import.meta.url);
let definition;
for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
  const source = readFileSync(new URL(name, directory), 'utf8');
  const match = source.match(/create or replace function public\.update_my_listing\([\s\S]*?\$\$;/i);
  if (match) definition = match[0];
}
if (!definition) throw Error('update_my_listing definition missing');
const isolated = definition.replaceAll('public.', 'pg_temp.').replace('set search_path = public', 'set search_path = pg_temp').replaceAll('auth.uid()', 'pg_temp.fixture_uid()');
process.stdout.write(`begin;
set local statement_timeout = '30s';
create temp table fixture_bootstrap (id int);
create type pg_temp.listing_status as enum ('active','reserved','completed','canceled');
create temp table listings (
 id uuid primary key, user_id uuid, type text default 'give', quantity integer,
 available_quantity integer, reserved_quantity integer default 0, category_id bigint,
 category text, category_path text, description text, lat double precision, lng double precision,
 location_label text, location_verified_at timestamptz, image_url text, image_urls jsonb,
 condition text, pickup_mode text, pickup_windows jsonb, weight_kg numeric,
 loan_duration_days integer, moderation_status text default 'approved', moderation_reason text,
 moderated_by uuid, moderated_at timestamptz, status pg_temp.listing_status default 'active', updated_at timestamptz
);
create temp table transactions (listing_id uuid, accepted_at timestamptz, completed_at timestamptz, canceled_at timestamptz);
create function pg_temp.fixture_uid() returns uuid language sql as $$ select nullif(current_setting('vratime_probe.uid',true),'')::uuid $$;
select set_config('vratime_probe.uid','00000000-0000-0000-0000-000000000001',true);
${isolated}
create function pg_temp.edit_quantity(next_quantity integer) returns void language plpgsql as $$
begin
 perform pg_temp.update_my_listing('00000000-0000-0000-0000-000000000002',1,'Egg cartons','pallet/egg-crates',null,next_quantity,42.46,18.51,'Igalo, Herceg Novi',null,'[]'::jsonb,'usable','public_place','[]'::jsonb,null,null);
end;
$$;
do $$
declare c record; observed integer; rejected boolean; checked integer := 0;
begin
 for c in select * from (values (4,4,7,7),(10,8,15,13),(10,8,5,3),(10,8,2,0),(10,0,13,3),(4,4,2,2),(4,4,4,4),(4,null::integer,7,7)) as cases(old_total,old_available,new_total,expected) loop
  truncate pg_temp.listings;
  insert into pg_temp.listings(id,user_id,quantity,available_quantity) values ('00000000-0000-0000-0000-000000000002',pg_temp.fixture_uid(),c.old_total,c.old_available);
  perform pg_temp.edit_quantity(c.new_total);
  select available_quantity into observed from pg_temp.listings;
  if observed is distinct from c.expected then raise exception 'quantity edit %/% -> %: expected %, actual %',c.old_available,c.old_total,c.new_total,c.expected,observed; end if;
  checked := checked + 1;
 end loop;
 -- Do not lose already consumed quantity when reducing the declared total.
 update pg_temp.listings set quantity=10,available_quantity=8;
 rejected := false;
 begin perform pg_temp.edit_quantity(1); exception when raise_exception then if sqlerrm <> 'Invalid quantity' then raise; end if; rejected := true; end;
 if not rejected then raise exception 'quantity below consumed stock was accepted'; end if;
 -- Preserve the existing accepted-reservation edit lock and ownership checks.
 insert into pg_temp.transactions(listing_id,accepted_at) values ('00000000-0000-0000-0000-000000000002',now());
 rejected := false;
 begin perform pg_temp.edit_quantity(12); exception when raise_exception then if sqlerrm <> 'An accepted booking cannot be edited' then raise; end if; rejected := true; end;
 if not rejected then raise exception 'accepted reservation edit was accepted'; end if;
 truncate pg_temp.transactions;
 perform set_config('vratime_probe.uid','00000000-0000-0000-0000-000000000003',true);
 rejected := false;
 begin perform pg_temp.edit_quantity(12); exception when raise_exception then if sqlerrm <> 'Listing not found' then raise; end if; rejected := true; end;
 if not rejected then raise exception 'non-owner edit was accepted'; end if;
 raise notice 'PASS quantity SQL: % stock cases + consumed minimum + reservation lock + ownership; public writes=0',checked;
end;
$$;
rollback;
`);
