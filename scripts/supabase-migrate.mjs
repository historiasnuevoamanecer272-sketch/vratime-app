import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const required = ['SUPABASE_DB_HOST', 'SUPABASE_DB_USER', 'SUPABASE_DB_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

const root = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 12000,
});

const orderedMigrationFiles = async () => (await fs.readdir(migrationsDir))
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort();

const createLedger = () => client.query(`
  create table if not exists public.vratime_schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  )
`);

const assertSafeMigrationBaseline = async (appliedNames) => {
  if (appliedNames.size) return;
  const result = await client.query(`
    select (
      to_regclass('public.listings') is not null
      or to_regclass('public.profiles') is not null
      or to_regclass('public.categories') is not null
    ) as has_vratime_tables
  `);
  if (result.rows[0]?.has_vratime_tables) {
    throw new Error('Migration ledger is empty on a database that already contains VratiMe tables. Seed the ledger explicitly after verifying the existing schema; refusing to replay historical migrations.');
  }
};

const check = async () => {
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
      to_regprocedure('public.complete_deal(uuid)') is not null as completion_rpc,
      to_regprocedure('public.deactivate_listing(uuid)') is not null as deactivate_rpc,
      has_table_privilege('authenticated', 'public.listings', 'update') as direct_listing_update,
      has_table_privilege('authenticated', 'public.reviews', 'insert') as direct_review_insert
  `);
  process.stdout.write(`${JSON.stringify(result.rows[0])}\n`);
};

const applyAll = async () => {
  await createLedger();
  const files = await orderedMigrationFiles();
  const applied = await client.query('select filename from public.vratime_schema_migrations');
  const appliedNames = new Set(applied.rows.map((row) => row.filename));
  await assertSafeMigrationBaseline(appliedNames);
  const pending = files.filter((file) => !appliedNames.has(file));
  if (!pending.length) {
    process.stdout.write(`No pending migrations. Ledger contains ${appliedNames.size} files.\n`);
    return;
  }
  process.stdout.write(`Applying ${pending.length} ordered migration(s): ${pending.join(', ')}\n`);
  for (const filename of pending) {
    const source = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    await client.query(source);
    await client.query('insert into public.vratime_schema_migrations (filename) values ($1)', [filename]);
    process.stdout.write(`Applied ${filename}\n`);
  }
};

await client.connect();
try {
  if (process.argv.includes('--check')) await check();
  else await applyAll();
} finally {
  await client.end();
}
