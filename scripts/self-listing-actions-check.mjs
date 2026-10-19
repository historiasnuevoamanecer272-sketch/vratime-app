import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const pgPath = process.argv.find((arg) => arg.startsWith('--pg-tools='))?.slice('--pg-tools='.length);
if (!pgPath) throw new Error('Pass --pg-tools=/absolute/path/to/@electric-sql/pglite for offline SQL regression checks.');
const { PGlite } = createRequire(import.meta.url)(path.resolve(pgPath));
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const ownListing = '33333333-3333-4333-8333-333333333333', otherListing = '44444444-4444-4444-8444-444444444444';
const legacyReport = '55555555-5555-4555-8555-555555555555';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const migration = readFileSync(new URL('20261019085934_prevent_self_favourites_and_reports.sql', migrations), 'utf8');
const moderation = readFileSync(new URL('20260922000000_roles_moderation_reports_support.sql', migrations), 'utf8');
const actual = (start, end) => {
  const from = moderation.indexOf(start), to = moderation.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Actual original SQL was not found');
  return moderation.slice(from, to);
};
const actor = (role, id, run) => db.transaction(async (tx) => {
  assert.ok(['authenticated', 'anon'].includes(role));
  await tx.exec(`set local role ${role}`);
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id || '']);
  return run(tx);
});
const toggle = (id, listingId) => actor('authenticated', id, async (tx) => (await tx.query('select public.toggle_listing_favourite($1) as result', [listingId])).rows[0].result);
const report = (id, kind, target) => actor('authenticated', id, async (tx) => (await tx.query("select public.create_report($1,$2,'misleading',null) as result", [kind, target])).rows[0].result);
const feed = (id) => actor('authenticated', id, async (tx) => (await tx.query('select public.get_my_discovery_feed() as result')).rows[0].result);
let passed = 0, failed = 0;
const check = async (name, run) => { try { await run(); passed += 1; console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); } };
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create table public.profiles(id uuid primary key);
    create function public.is_staff() returns boolean language sql stable as $$select false$$;
    create table public.listings(id uuid primary key,user_id uuid not null references public.profiles(id),description text);
    alter table public.listings enable row level security;
    grant select on public.listings to authenticated;
    create policy listings_authenticated_read on public.listings for select to authenticated using(user_id=auth.uid() or public.is_staff());
    create table public.transactions(id uuid primary key,giver_id uuid,taker_id uuid);
  `);
  await db.exec(actual('create table if not exists public.reports (', 'create table if not exists public.reputation_penalties ('));
  await db.exec(`alter table public.reports enable row level security;
    create policy reports_owner_or_staff_read on public.reports for select to authenticated using(reporter_id=auth.uid() or public.is_staff());
    revoke all on public.reports from public,anon,authenticated; grant select on public.reports to authenticated;`);
  await db.exec(actual('create or replace function public.create_report(', 'create or replace function public.resolve_report('));
  await db.exec('revoke execute on function public.create_report(text,uuid,text,text) from public,anon; grant execute on function public.create_report(text,uuid,text,text) to authenticated;');
  await db.exec(readFileSync(new URL('20260923010000_discovery_and_digest.sql', migrations), 'utf8'));
  await db.query('insert into public.profiles values($1),($2)', [owner, other]);
  await db.query('insert into public.listings values($1,$2,$5),($3,$4,$6)', [ownListing, owner, otherListing, other, 'Owner ad remains intact', 'Other ad remains intact']);
  await db.query('insert into public.listing_favourites(user_id,listing_id) values($1,$2),($1,$3),($4,$2),($4,$3)', [owner, ownListing, otherListing, other]);
  await db.query("insert into public.reports(id,reporter_id,target_kind,target_id,target_user_id,reason) values($1,$2,'listing',$3,$2,'legacy self report')", [legacyReport, owner, ownListing]);
  await db.query("insert into public.saved_searches(user_id,query) values($1,'glass')", [owner]);
  await db.query("insert into public.user_inbox(user_id,item_type,title) values($1,'system','Existing inbox')", [owner]);
  const listingsBefore = (await db.query('select * from public.listings order by id')).rows;
  await db.exec(migration);

  await check('migration removes only self-favourites and preserves both ads, foreign favourites and existing reports', async () => {
    const favourites = (await db.query('select user_id,listing_id from public.listing_favourites order by user_id,listing_id')).rows;
    assert.deepEqual(favourites, [{ user_id: owner, listing_id: otherListing }, { user_id: other, listing_id: ownListing }]);
    assert.deepEqual((await db.query('select * from public.listings order by id')).rows, listingsBefore);
    assert.equal((await db.query('select id from public.reports')).rows[0].id, legacyReport);
  });
  await check('authoritative favourite RPC rejects the listing owner and still toggles another users listing', async () => {
    await assert.rejects(toggle(owner, ownListing), /own listing|self.favourite/i);
    assert.equal(await toggle(owner, otherListing), false);
    assert.equal(await toggle(owner, otherListing), true);
    await assert.rejects(toggle(null, otherListing), /Authentication required/);
    await assert.rejects(toggle(owner, '99999999-9999-4999-8999-999999999999'), /Listing not found/);
  });
  await check('direct favourite INSERT rejects self and forged owners but permits real foreign favourites despite private listings RLS', async () => {
    await assert.rejects(actor('authenticated', owner, (tx) => tx.query('insert into public.listing_favourites(user_id,listing_id) values($1,$2)', [owner, ownListing])), (error) => error.code === '42501');
    await assert.rejects(actor('authenticated', owner, (tx) => tx.query('insert into public.listing_favourites(user_id,listing_id) values($1,$2)', [other, ownListing])), (error) => error.code === '42501');
    await toggle(owner, otherListing);
    await actor('authenticated', owner, (tx) => tx.query('insert into public.listing_favourites(user_id,listing_id) values($1,$2)', [owner, otherListing]));
    const visibleListings = await actor('authenticated', owner, async (tx) => (await tx.query('select id from public.listings')).rows);
    assert.deepEqual(visibleListings, [{ id: ownListing }]);
  });
  await check('discovery feed keeps its full shape after legacy self-favourite cleanup and exposes only the callers data', async () => {
    const ownFeed = await feed(owner), otherFeed = await feed(other);
    assert.deepEqual(Object.keys(ownFeed).sort(), ['favourites', 'inbox', 'matches', 'saved_searches']);
    assert.deepEqual(ownFeed.favourites.map((row) => row.listing_id), [otherListing]);
    assert.deepEqual(otherFeed.favourites.map((row) => row.listing_id), [ownListing]);
    assert.equal(ownFeed.saved_searches.length, 1); assert.equal(ownFeed.inbox.length, 1);
    assert.equal(otherFeed.saved_searches.length, 0); assert.equal(otherFeed.inbox.length, 0);
  });
  await check('existing report RPC rejects own listing and self-user targets while allowing another users listing', async () => {
    await assert.rejects(report(owner, 'listing', ownListing), /Invalid report target/);
    await assert.rejects(report(owner, 'user', owner), /Invalid report target/);
    const reportId = await report(owner, 'listing', otherListing);
    assert.match(reportId, /^[a-f0-9-]{36}$/);
    const row = (await db.query('select reporter_id,target_id,target_user_id from public.reports where id=$1', [reportId])).rows[0];
    assert.deepEqual(row, { reporter_id: owner, target_id: otherListing, target_user_id: other });
  });
  await check('anonymous RPCs and all direct report INSERTs remain denied', async () => {
    await assert.rejects(actor('anon', null, (tx) => tx.query('select public.toggle_listing_favourite($1)', [otherListing])), (error) => error.code === '42501');
    await assert.rejects(actor('anon', null, (tx) => tx.query("select public.create_report('listing',$1,'misleading',null)", [otherListing])), (error) => error.code === '42501');
    await assert.rejects(actor('authenticated', owner, (tx) => tx.query("insert into public.reports(reporter_id,target_kind,target_id,target_user_id,reason) values($1,'listing',$2,$3,'misleading')", [owner, otherListing, other])), (error) => error.code === '42501');
  });
} finally { await db.close(); }
if (failed) process.exitCode = 1;
else console.log(`Self-listing SQL guards: ${passed} groups passed offline. No migration was applied to a live database.`);
