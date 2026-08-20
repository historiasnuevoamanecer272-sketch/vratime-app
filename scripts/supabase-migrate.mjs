import fs from 'node:fs/promises';
import process from 'node:process';
import pg from 'pg';

const required = ['SUPABASE_DB_HOST', 'SUPABASE_DB_USER', 'SUPABASE_DB_PASSWORD'];
for (const name of required) {
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
  if (process.argv.includes('--check')) {
    const result = await client.query(`
      select
        (select count(*) from public.categories)::int as categories,
        (select count(*) from public.listings)::int as listings,
        (select count(*) from public.profiles)::int as profiles,
        (select count(*) from public.transactions)::int as transactions,
        (select count(*) from auth.users)::int as auth_users,
        to_regclass('public.profile_contacts') is not null as migrated,
        case when to_regclass('public.profile_contacts') is null then 0 else (select count(*) from public.profile_contacts)::int end as protected_contacts,
        (select count(*) from public.transactions where completed_at is null and canceled_at is null)::int as open_transactions,
        (select count(*) from storage.objects where bucket_id = 'LISTING-PHOTOS')::int as storage_objects,
        (select count(*) from storage.buckets)::int as storage_buckets,
        (select coalesce(jsonb_agg(jsonb_build_object('name', policyname, 'cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check) order by policyname), '[]'::jsonb) from pg_policies where schemaname = 'storage' and tablename = 'objects') as storage_policies,
        not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('phone', 'contacts', 'messenger_type')) as legacy_contacts_removed,
        to_regprocedure('public.book_listing(uuid)') is not null as booking_rpc,
        to_regprocedure('public.complete_deal(uuid)') is not null as completion_rpc
    `);
    process.stdout.write(`${JSON.stringify(result.rows[0])}\n`);
  } else {
    const requestedPath = process.argv.find((argument) => argument.endsWith('.sql'));
    const migrationPath = requestedPath || new URL('../supabase/migrations/20260820210000_vratime_revival.sql', import.meta.url);
    const migration = await fs.readFile(migrationPath, 'utf8');
    await client.query(migration);
    process.stdout.write('Migration applied successfully.\n');
  }
} finally {
  await client.end();
}
