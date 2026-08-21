import process from 'node:process';
import pg from 'pg';

for (const name of ['SUPABASE_DB_HOST', 'SUPABASE_DB_USER', 'SUPABASE_DB_PASSWORD']) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 12000,
});

await client.connect();
try {
  await client.query('begin');
  await client.query(`
    do $$
    declare
      user_a uuid;
      user_b uuid;
      category_record public.categories%rowtype;
      listing_one uuid := gen_random_uuid();
      listing_two uuid := gen_random_uuid();
      transaction_one uuid;
      transaction_two uuid;
      points_before integer;
      points_after integer;
      repeat_result jsonb;
      duplicate_blocked boolean := false;
      duplicate_review_blocked boolean := false;
      contact_seen text;
    begin
      select user_id into user_a from public.profile_contacts order by user_id limit 1;
      select user_id into user_b from public.profile_contacts where user_id <> user_a order by user_id limit 1;
      select * into category_record from public.categories order by id limit 1;
      if user_a is null or user_b is null then raise exception 'Two contact-enabled test profiles are required'; end if;

      insert into public.listings (id, user_id, type, status, category_id, category, category_path, quantity, lat, lng)
      values (listing_one, user_a, 'give', 'active', category_record.id, category_record.name, category_record.category_path, 2, 42.441, 19.263);

      perform set_config('request.jwt.claim.sub', user_b::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated')::text, true);
      transaction_one := public.book_listing(listing_one);
      begin
        perform public.book_listing(listing_one);
      exception when others then
        duplicate_blocked := true;
      end;
      if not duplicate_blocked then raise exception 'Duplicate booking was not blocked'; end if;
      perform set_config('request.jwt.claim.sub', user_a::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated')::text, true);
      perform public.cancel_booking(transaction_one);
      if not exists (select 1 from public.transactions where id = transaction_one and canceled_at is not null) then raise exception 'Cancellation history missing'; end if;
      if not exists (select 1 from public.listings where id = listing_one and status = 'active') then raise exception 'Listing was not restored'; end if;

      perform set_config('request.jwt.claim.sub', user_b::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated')::text, true);
      insert into public.listings (id, user_id, type, status, category_id, category, category_path, quantity, lat, lng)
      values (listing_two, user_a, 'give', 'active', category_record.id, category_record.name, category_record.category_path, 3, 42.442, 19.264);
      transaction_two := public.book_listing(listing_two);

      select coalesce(eco_points, 0) into points_before from public.profiles where id = user_a;
      perform set_config('request.jwt.claim.sub', user_a::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated')::text, true);
      perform public.complete_deal(transaction_two);
      select coalesce(eco_points, 0) into points_after from public.profiles where id = user_a;
      if points_after <> points_before + 50 then raise exception 'Eco reward is not exactly 50'; end if;
      repeat_result := public.complete_deal(transaction_two);
      if (repeat_result ->> 'eco_reward')::integer <> 0 then raise exception 'Eco reward was awarded twice'; end if;

      perform public.submit_review(transaction_two, 4);
      begin
        perform public.submit_review(transaction_two, 5);
      exception when others then
        duplicate_review_blocked := true;
      end;
      if not duplicate_review_blocked then raise exception 'Duplicate review was not blocked'; end if;

      perform set_config('request.jwt.claim.sub', user_b::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated')::text, true);
      perform public.submit_review(transaction_two, 5);
      select contact_value into contact_seen from public.get_my_deals() where transaction_id = transaction_two;
      if contact_seen is null then raise exception 'Partner contact was not returned to participant'; end if;
    end $$;
  `);
  await client.query('rollback');
  process.stdout.write('Transactional two-user integration check passed; all test writes rolled back.\n');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}
