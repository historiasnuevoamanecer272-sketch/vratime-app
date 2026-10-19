// AFTER PUBLICATION ONLY. No mutation or environment read without --execute.
// Credentials, tokens, exact fixture IDs and resumable checkpoints stay private.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { PROJECT_REF, PROJECT_URL, LANGUAGES, UUID, parseReleaseArguments, assertTargetProject, verifyPublicRelease, assertFixtureLedger, buildExactCleanupPlan, executeExactCleanup, ensure, safeCode } from './release-ten-users-support.mjs';
import { simulateRecordedFixtureExpiry } from './release-expiry-simulation.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PRIVATE_ROOT = path.resolve(ROOT, '../vratime-staged-20261019/.private-backups');
const HELP = `Prepared only; no live verification has been performed.
Create/run AFTER publication:
  node scripts/release-ten-users-check.mjs --execute --expected-release-hash=<SHA256_OF_PUBLIC_INDEX_JS> --keep-fixtures
Resume the exact run:
  node scripts/release-ten-users-check.mjs --execute --expected-release-hash=<SAME_HASH> --resume-ledger=<PRIVATE_LEDGER> --keep-fixtures
After browser review, remove only the exact recorded run:
  node scripts/release-ten-users-check.mjs --execute --expected-release-hash=<SAME_HASH> --cleanup-ledger=<PRIVATE_LEDGER>
Omit --keep-fixtures to clean after the suite. Failed cases remain failures even if cleanup succeeds.
Only https://kuoflaaankpjksyssfka.supabase.co and https://vratime.vzdigital.online are accepted.
Hash means SHA256 of the deployed main /assets/index-*.js bytes, not RELEASE.txt or the ZIP.
Keys: SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY (environment or local .env).
Passwords/tokens are never printed; the 0600 private ledger supports browser sessions.
No feedback-telegram, push worker, digest worker or external messenger is invoked.
See scripts/release-ten-users-check.README.md for scope and remaining manual checks.`;

const unwrap = (result, label) => { if (result?.error) throw Object.assign(new Error(label), { code: safeCode(result.error) }); return result?.data; };
const denied = (result, label, allowed = [400, 401, 403, 404, 409, 413, 415, 422]) => { ensure(Boolean(result?.error), label); const status = Number(result.error.status || result.error.statusCode || result.error.context?.status || result.status); ensure(allowed.includes(status), `${label}_unexpected_failure`); };
const hours = (end, start) => (new Date(end) - new Date(start)) / 3600000;
const approx = (value, expected, label) => ensure(Math.abs(value - expected) < 0.03, label);
const recordKeys = { feedback_telegram_deliveries: ['feedback_id'], profile_contacts: ['user_id', 'messenger_type'], listing_favourites: ['user_id', 'listing_id'], collection_point_votes: ['point_id', 'user_id'], collection_point_materials: ['point_id', 'material_key'], reuse_events: ['transaction_id'] };

async function loadEnvironment() {
  const local = {};
  try { for (const line of (await fs.readFile(path.join(ROOT, '.env'), 'utf8')).split(/\r?\n/)) { const match = line.match(/^([A-Z0-9_]+)=(.*)$/); if (match) local[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, ''); } } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const env = { ...local, ...process.env };
  assertTargetProject(env.SUPABASE_URL || env.VITE_SUPABASE_URL);
  ensure(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY, 'missing_anon_key');
  ensure(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, 'missing_server_key');
  return { anon: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY, secret: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY };
}

function testPng(color = 50) {
  const crc = (bytes) => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const type = Buffer.from(name), output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); type.copy(output, 4); data.copy(output, 8); output.writeUInt32BE(crc(Buffer.concat([type, data])), data.length + 8); return output; };
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, color, 119, 69, color, 119, 69, 0, color, 119, 69, color, 119, 69]))), chunk('IEND', Buffer.alloc(0))]);
}

async function ledgerPath(requested, runId) {
  await fs.mkdir(PRIVATE_ROOT, { recursive: true, mode: 0o700 });
  const result = requested ? path.resolve(requested) : path.join(PRIVATE_ROOT, `release-ten-users-${runId}.json`);
  ensure(path.dirname(result) === PRIVATE_ROOT && /^release-ten-users-[0-9a-f-]{36}\.json$/i.test(path.basename(result)), 'ledger_path_outside_private_root');
  ensure(await fs.realpath(path.dirname(result)) === await fs.realpath(PRIVATE_ROOT), 'ledger_symlink_directory');
  if (requested) { const stat = await fs.lstat(result); ensure(stat.isFile() && !stat.isSymbolicLink(), 'ledger_not_regular_file'); }
  return result;
}

export async function runReleaseTenUsers(options) {
  ensure(options.execute === true, 'execute_required');
  // This gate always precedes client construction and every authenticated write.
  // Cleanup names an already recorded release/run; it must remain possible after
  // a later deployment or rollback. Creation/resume require the live hash gate.
  const release = options.cleanupLedger ? null : await verifyPublicRelease({ expectedHash: options.expectedReleaseHash });
  const keys = await loadEnvironment();
  const { createClient } = await import('@supabase/supabase-js');
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), redirect: 'error' }) } };
  const admin = createClient(PROJECT_URL, keys.secret, clientOptions), anon = createClient(PROJECT_URL, keys.anon, clientOptions);
  const requested = options.cleanupLedger || options.resumeLedger;
  let ledger = requested ? JSON.parse(await fs.readFile(await ledgerPath(requested), 'utf8')) : {
    version: 1, projectRef: PROJECT_REF, runId: randomUUID(), expectedReleaseHash: options.expectedReleaseHash, release,
    createdAt: new Date().toISOString(), users: [], media: [], records: {}, checkpoints: {}, cases: [], cleanup: [],
  };
  assertFixtureLedger(ledger);
  ensure(ledger.expectedReleaseHash === options.expectedReleaseHash, 'ledger_release_hash_mismatch');
  const privatePath = await ledgerPath(requested, ledger.runId);
  ensure(path.basename(privatePath) === `release-ten-users-${ledger.runId}.json`, 'ledger_run_filename_mismatch');
  let writing = Promise.resolve();
  const save = () => { const content = JSON.stringify(ledger, null, 2); writing = writing.then(async () => { await fs.writeFile(`${privatePath}.tmp`, content, { mode: 0o600 }); await fs.chmod(`${privatePath}.tmp`, 0o600); await fs.rename(`${privatePath}.tmp`, privatePath); await fs.chmod(privatePath, 0o600); }); return writing; };
  const addRecord = async (table, row) => { const columns = recordKeys[table] || ['id']; const filtered = Object.fromEntries(columns.map((key) => [key, row[key]])); ensure(columns.every((key) => filtered[key]), 'record_identity_missing'); ledger.records[table] ||= []; if (!ledger.records[table].some((existing) => JSON.stringify(existing) === JSON.stringify(filtered))) ledger.records[table].push(filtered); await save(); return row; };
  const step = async (key, action) => { if (Object.hasOwn(ledger.checkpoints, key)) return ledger.checkpoints[key]; const result = await action(); ledger.checkpoints[key] = result ?? true; await save(); return result; };
  const stableId = async (key) => step(`id:${key}`, async () => randomUUID());
  const rpc = async (client, name, params = {}) => unwrap(await client.rpc(name, params), name);
  const readRows = async (table, column, values, select = '*') => { if (!values.length) return []; const rows = unwrap(await admin.from(table).select(select).in(column, values).range(0, 999), `read_${table}`); ensure(rows.length < 1000, 'fixture_inventory_limit'); return rows; };
  const remoteIdentity = async (user, allowMissing = false) => {
    const result = await admin.auth.admin.getUserById(user.id);
    if (result.error && allowMissing && result.error.status === 404) return null;
    const actual = unwrap(result, 'verify_fixture_user')?.user;
    ensure(actual?.id === user.id && actual.email === user.email && actual.app_metadata?.vratime_release_test === ledger.runId, 'remote_fixture_marker_mismatch'); return actual;
  };
  const clients = [];
  const signIn = async (user) => { const client = createClient(PROJECT_URL, keys.anon, clientOptions); const auth = unwrap(await client.auth.signInWithPassword({ email: user.email, password: user.password }), 'sign_in_fixture'); ensure(auth.user.id === user.id, 'fixture_session_owner'); user.session = auth.session; await save(); return client; };
  const runCase = async (name, action) => {
    if (ledger.cases.some((item) => item.name === name && item.status === 'passed')) return;
    const start = Date.now();
    try { await action(); ledger.cases.push({ name, status: 'passed', durationMs: Date.now() - start }); }
    catch (error) { ledger.cases.push({ name, status: 'failed', code: safeCode(error), durationMs: Date.now() - start }); }
    await save(); const latest = ledger.cases.at(-1); process.stdout.write(`${latest.status}: ${name}${latest.code ? ` (${latest.code})` : ''}\n`);
  };

  async function inventoryAndCleanup() {
    // Planned-but-never-created UUIDs and already deleted users are harmless.
    // Every account that does exist must still match the immutable admin marker.
    for (const user of ledger.users) await remoteIdentity(user, true);
    const users = ledger.users.map((user) => user.id), owned = new Set(users);
    ensure(users.every((id) => UUID.test(id)), 'cleanup_unconfirmed_user');
    // Rebuild from verified fixture owners. Never trust stale or edited child IDs
    // in an input ledger as authority to delete an unrelated production record.
    ledger.records = {}; ledger.media = [];
    // Freeze only confirmed fixture listings before inventory, preventing new bookings.
    const listings = await readRows('listings', 'user_id', users);
    for (const listing of listings) { await addRecord('listings', listing); unwrap(await admin.from('listings').update({ status: 'canceled' }).eq('id', listing.id).eq('user_id', listing.user_id), 'freeze_fixture_listing'); }
    const listingIds = listings.map((row) => row.id), transactions = await readRows('transactions', 'listing_id', listingIds);
    ensure(transactions.every((row) => owned.has(row.giver_id) && owned.has(row.taker_id) && owned.has(row.booked_by)), 'cleanup_foreign_transaction_review_required');
    const byGiver = await readRows('transactions', 'giver_id', users), byTaker = await readRows('transactions', 'taker_id', users);
    ensure([...byGiver, ...byTaker].every((row) => listingIds.includes(row.listing_id) && owned.has(row.giver_id) && owned.has(row.taker_id)), 'cleanup_fixture_touched_nonfixture_listing');
    const transactionIds = transactions.map((row) => row.id);
    const points = await readRows('collection_points', 'created_by', users), pointIds = points.map((row) => row.id);
    const foreignMatches = await readRows('listing_matches', 'listing_id', listingIds);
    ensure(foreignMatches.every((row) => owned.has(row.user_id)), 'cleanup_foreign_discovery_reference_review_required');
    ensure((await readRows('listing_favourites', 'listing_id', listingIds)).every((row) => owned.has(row.user_id)), 'cleanup_foreign_favourite_review_required');
    const votes = await readRows('collection_point_votes', 'point_id', pointIds), edits = await readRows('collection_point_edits', 'point_id', pointIds);
    ensure([...votes, ...edits].every((row) => owned.has(row.user_id)), 'cleanup_foreign_point_activity_review_required');
    ensure((await readRows('collection_point_votes', 'user_id', users)).every((row) => pointIds.includes(row.point_id)), 'cleanup_fixture_voted_on_nonfixture_point');
    ensure((await readRows('collection_point_edits', 'user_id', users)).every((row) => pointIds.includes(row.point_id)), 'cleanup_fixture_edited_nonfixture_point');
    const reports = await readRows('reports', 'target_user_id', users);
    ensure(reports.every((row) => owned.has(row.reporter_id) && (!row.resolved_by || owned.has(row.resolved_by))), 'cleanup_foreign_report_review_required');
    ensure((await readRows('reports', 'reporter_id', users)).every((row) => owned.has(row.target_user_id)), 'cleanup_fixture_reported_nonfixture_user');
    const moderation = await readRows('moderation_actions', 'listing_id', listingIds);
    ensure(moderation.every((row) => owned.has(row.moderator_id)), 'cleanup_foreign_moderation_review_required');
    const ownTables = ['digest_deliveries', 'user_inbox', 'listing_matches', 'listing_favourites', 'search_history', 'saved_searches', 'web_push_subscriptions', 'profile_contacts', 'user_feedback'];
    for (const table of ownTables) for (const row of await readRows(table, 'user_id', users)) await addRecord(table, row);
    const feedbackIds = (ledger.records.user_feedback || []).map((row) => row.id);
    for (const row of await readRows('feedback_telegram_deliveries', 'feedback_id', feedbackIds)) await addRecord('feedback_telegram_deliveries', row);
    for (const row of transactions) await addRecord('transactions', row);
    for (const row of points) await addRecord('collection_points', row);
    for (const row of votes) await addRecord('collection_point_votes', row);
    for (const row of edits) await addRecord('collection_point_edits', row);
    for (const row of await readRows('collection_point_materials', 'point_id', pointIds)) await addRecord('collection_point_materials', row);
    for (const row of await readRows('handover_appointments', 'transaction_id', transactionIds)) await addRecord('handover_appointments', row);
    for (const row of await readRows('reuse_events', 'transaction_id', transactionIds)) await addRecord('reuse_events', row);
    for (const row of await readRows('reviews', 'transaction_id', transactionIds)) { ensure(owned.has(row.from_user_id) && owned.has(row.to_user_id), 'cleanup_foreign_review'); await addRecord('reviews', row); }
    for (const row of reports) await addRecord('reports', row);
    for (const row of moderation) await addRecord('moderation_actions', row);
    for (const row of await readRows('reputation_penalties', 'user_id', users)) { ensure(owned.has(row.applied_by), 'cleanup_foreign_penalty'); await addRecord('reputation_penalties', row); }
    for (const id of users) await addRecord('profiles', { id });
    for (const user of ledger.users) for (const bucket of ['AVATARS', 'LISTING-PHOTOS', 'FEEDBACK-ATTACHMENTS']) {
      const files = unwrap(await admin.storage.from(bucket).list(user.id, { limit: 1000 }), 'inventory_storage'); ensure(files.length < 1000, 'fixture_storage_inventory_limit');
      for (const file of files) { ensure(file.id && !file.name.includes('/'), 'fixture_storage_nested_path'); const asset = { bucket, path: `${user.id}/${file.name}` }; if (!ledger.media.some((item) => item.bucket === bucket && item.path === asset.path)) ledger.media.push(asset); }
    }
    ledger.cleanupStarted = new Date().toISOString(); await save(); assertFixtureLedger(ledger);
    for (const user of ledger.users) {
      if (!await remoteIdentity(user, true)) continue;
      const client = await signIn(user); const session = unwrap(await client.auth.getSession(), 'cleanup_session').session;
      unwrap(await admin.auth.admin.signOut(session.access_token, 'global'), 'revoke_fixture_sessions');
    }
    const cleanup = await executeExactCleanup(buildExactCleanupPlan(ledger), {
      remove: async ({ table, filters }) => {
        if (table === '$storage') { unwrap(await admin.storage.from(filters.bucket).remove([filters.path]), 'remove_exact_storage'); return; }
        if (table === '$auth') { const result = await admin.auth.admin.deleteUser(filters.id); if (result.error?.status !== 404) unwrap(result, 'remove_exact_auth'); return; }
        let query = admin.from(table).delete(); for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
        unwrap(await query, `remove_exact_${table}`);
      },
      record: async (event) => { ledger.cleanup.push({ ...event, at: new Date().toISOString() }); await save(); },
    });
    ensure(cleanup.complete, 'cleanup_incomplete_see_private_ledger');
    for (const user of ledger.users) { const result = await admin.auth.admin.getUserById(user.id); ensure(result.error?.status === 404 || result.data?.user == null, 'cleanup_auth_still_exists'); }
    for (const table of ['profiles', 'listings', 'transactions', 'user_feedback', 'saved_searches', 'user_inbox']) {
      const column = table === 'profiles' ? 'id' : table === 'transactions' ? 'giver_id' : 'user_id'; ensure((await readRows(table, column, users)).length === 0, 'cleanup_rows_still_exist');
    }
    for (const user of ledger.users) for (const bucket of ['AVATARS', 'LISTING-PHOTOS', 'FEEDBACK-ATTACHMENTS']) ensure(unwrap(await admin.storage.from(bucket).list(user.id, { limit: 1 }), 'verify_storage_cleanup').length === 0, 'cleanup_storage_still_exists');
    for (const user of ledger.users) { delete user.password; delete user.session; }
    ledger.cleanedAt = new Date().toISOString(); await save(); return cleanup;
  }

  if (options.cleanupLedger) { const cleanup = await inventoryAndCleanup(); process.stdout.write(JSON.stringify({ mode: 'cleanup', runId: ledger.runId, complete: cleanup.complete, ledger: privatePath }) + '\n'); return; }
  ensure(!ledger.cleanedAt, 'run_already_cleaned');
  ensure(!ledger.cleanupStarted, 'cleanup_started_use_cleanup_mode');
  if (!ledger.users.length) {
    ledger.users = LANGUAGES.flatMap((language, pair) => [0, 1].map((member) => { const index = pair * 2 + member + 1; return { id: randomUUID(), language, index, email: `vratime-release-${ledger.runId}-${String(index).padStart(2, '0')}@example.invalid`, password: `Vr!${randomUUID()}9a`, profileName: `TEST ${language.toUpperCase()} ${index} ${ledger.runId.slice(0, 8)}` }; }));
    await save();
  }
  process.stdout.write(`Private run ledger: ${privatePath}\n`);
  ensure(ledger.users.length === 10 && LANGUAGES.every((language) => ledger.users.filter((user) => user.language === language).length === 2), 'ten_users_two_per_language_required');
  try { for (const user of ledger.users) {
    await step(`user:${user.id}`, async () => {
      const existing = await admin.auth.admin.getUserById(user.id);
      if (existing.data?.user) await remoteIdentity(user);
      else { ensure(existing.error?.status === 404, 'unexpected_auth_lookup'); unwrap(await admin.auth.admin.createUser({ id: user.id, email: user.email, password: user.password, email_confirm: true, app_metadata: { vratime_release_test: ledger.runId }, user_metadata: { full_name: user.profileName } }), 'create_fixture_user'); await remoteIdentity(user); }
      return user.id;
    });
    clients.push(await signIn(user));
    await step(`profile:${user.id}`, async () => {
      await rpc(clients.at(-1), 'upsert_my_profile_v2', { profile_name: user.profileName, profile_language: user.language, profile_channels: [{ messenger_type: 'tg', contact_value: `@vrqa_${ledger.runId.replaceAll('-', '').slice(0, 12)}_${user.index}` }, { messenger_type: 'wa', contact_value: `+120255501${String(user.index).padStart(2, '0')}` }, { messenger_type: 'viber', contact_value: `+120255501${String(user.index).padStart(2, '0')}` }] });
      const row = unwrap(await clients.at(-1).from('profiles').select('language,preferred_language').eq('id', user.id).single(), 'read_fixture_language'); ensure(row.language === user.language && row.preferred_language === user.language, 'profile_language_not_saved'); return true;
    });
  } } catch (error) {
    const failure = { name: 'bootstrap_ten_users_profiles', status: 'failed', code: safeCode(error) }; ledger.cases.push(failure); await save();
    process.stdout.write(`failed: ${failure.name} (${failure.code})\n`);
    let cleaned = false; if (!options.keepFixtures) { await inventoryAndCleanup(); cleaned = true; }
    process.stdout.write(JSON.stringify({ mode: 'ten-user-release-check', runId: ledger.runId, failed: [failure], cleaned, ledger: privatePath, liveExecution: true }) + '\n'); process.exitCode = 1; return;
  }
  const categories = unwrap(await anon.from('categories').select('*'), 'categories');
  const parentIds = new Set(categories.map((row) => row.parent_id));
  const category = categories.find((row) => row.category_path?.startsWith('cloth/clothing/') && !parentIds.has(row.id)) || categories.find((row) => row.category_path && !parentIds.has(row.id)); ensure(category, 'leaf_category_missing');
  const marker = `[TEST ${ledger.runId} DO NOT BOOK]`;
  const media = async (userIndex, kind, key, color = 50) => step(`media:${key}`, async () => {
    const operationId = await stableId(`media:${key}`), client = clients[userIndex], user = ledger.users[userIndex];
    const output = unwrap(await client.functions.invoke('media-upload', { body: new Blob([testPng(color)], { type: 'image/png' }), headers: { 'Content-Type': 'image/png', 'X-Media-Kind': kind, 'X-Operation-Id': operationId, Authorization: `Bearer ${user.session.access_token}` } }), 'media_upload');
    ensure(UUID.test(output?.assetId || '') && output.path === `${user.id}/${output.assetId}.jpg`, 'media_owner_path');
    const asset = { ...output, bucket: { avatar: 'AVATARS', listing: 'LISTING-PHOTOS', feedback: 'FEEDBACK-ATTACHMENTS' }[kind], kind, operationId, userId: user.id }; if (!ledger.media.some((item) => item.path === asset.path && item.bucket === asset.bucket)) ledger.media.push(asset); await save(); return asset;
  });
  const listing = async (ownerIndex, key, overrides = {}) => step(`listing:${key}`, async () => {
    const id = await stableId(`listing:${key}`), owner = ledger.users[ownerIndex];
    const payload = { id, user_id: owner.id, type: 'give', status: 'active', category_id: category.id, category: category.name_ru || category.name, category_path: category.category_path, description: `${marker} ${key}`, quantity: 10, lat: 42.441123, lng: 19.263456, location_label: `${marker} Podgorica public test pickup`, location_verified_at: new Date().toISOString(), moderation_status: 'approved', image_urls: [], image_url: null, condition: 'usable', pickup_mode: 'public_place', pickup_windows: [], ...overrides };
    await addRecord('listings', { id });
    const result = await clients[ownerIndex].from('listings').insert(payload); if (result.error?.code !== '23505') unwrap(result, 'create_fixture_listing');
    const row = unwrap(await clients[ownerIndex].from('listings').select('*').eq('id', id).single(), 'read_fixture_listing'); ensure(row.user_id === owner.id && row.description === payload.description && row.quantity === payload.quantity && row.type === payload.type, 'listing_identity_conflict'); return row;
  });
  const transaction = async (requesterIndex, row, key, quantity = 1) => step(`transaction:${key}`, async () => {
    const existing = unwrap(await admin.from('transactions').select('id').eq('listing_id', row.id).eq('booked_by', ledger.users[requesterIndex].id).maybeSingle(), 'find_fixture_request');
    const id = existing?.id || await rpc(clients[requesterIndex], 'book_listing', { target_listing_id: row.id, requested_quantity: quantity }); await addRecord('transactions', { id }); return id;
  });
  const stock = async (id) => unwrap(await admin.from('listings').select('quantity,available_quantity,reserved_quantity,status').eq('id', id).single(), 'stock');
  const txn = async (id) => unwrap(await admin.from('transactions').select('*').eq('id', id).single(), 'transaction');
  const points = async (index) => Number(unwrap(await clients[index].from('profiles').select('eco_points').eq('id', ledger.users[index].id).single(), 'eco_points').eco_points || 0);
  const simulateExpiry = (ownerIndex, requesterIndex, row, id, accepted) => simulateRecordedFixtureExpiry({
    ledger, listing: row, transactionId: id, accepted,
    adapter: {
      readTransaction: () => txn(id), readStock: () => stock(row.id),
      updateDeadline: async (filters, expiresAt) => {
        let query = admin.from('transactions').update({ expires_at: expiresAt });
        for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
        return unwrap(await query.is('canceled_at', null).is('handed_over_at', null).is('returned_at', null).is('completed_at', null).select('id'), 'expiry_exact_deadline_update');
      },
      refresh: () => rpc(clients[requesterIndex], 'refresh_expired_deals'),
      readDeal: async () => (await rpc(clients[requesterIndex], 'get_my_deals')).find((deal) => deal.transaction_id === id),
      attemptAccept: () => clients[ownerIndex].rpc('accept_deal', { target_transaction_id: id }),
    },
  });

  for (let i = 0; i < 10; i += 1) await runCase(`profile_media_public_${ledger.users[i].language}_${i + 1}`, async () => {
    for (const version of [1, 2]) await step(`avatar_apply:${i}:${version}`, async () => { const asset = await media(i, 'avatar', `avatar:${i}:${version}`, 40 + version); await rpc(clients[i], 'set_my_avatar', { next_avatar_url: asset.url }); const row = unwrap(await clients[i].from('profiles').select('avatar_url').eq('id', ledger.users[i].id).single(), 'avatar_read'); ensure(row.avatar_url === asset.url, 'avatar_not_saved'); return true; });
    const first = ledger.checkpoints[`media:avatar:${i}:1`], replacement = ledger.checkpoints[`media:avatar:${i}:2`]; ensure(first.url !== replacement.url, 'avatar_not_immutable');
    const oldAvatar = await fetch(first.url, { redirect: 'error', signal: AbortSignal.timeout(20000) }); ensure(oldAvatar.ok, 'old_avatar_broken_by_replacement');
    const photo = await media(i, 'listing', `listing:${i}`), row = await listing(i, `browser:${i}`, { image_url: photo.url, image_urls: [photo.url] });
    const publicRows = await rpc(anon, 'get_public_map_listings'), publicRow = publicRows.find((item) => item.id === row.id); ensure(publicRow && publicRow.quantity === 10 && publicRow.available_quantity === 10, 'auto_public_listing_count'); ensure(Number(publicRow.lat) !== row.lat && Number(publicRow.lng) !== row.lng && !('location_label' in publicRow), 'public_pickup_privacy');
    denied(await clients[i].rpc('book_listing', { target_listing_id: row.id, requested_quantity: 1 }), 'self_request_was_allowed');
  });

  await runCase('media_validation_ownership_and_direct_storage_bypass', async () => {
    const asset = ledger.checkpoints['media:listing:0']; ensure(asset, 'prerequisite_listing_photo');
    const input = new Blob([testPng(50)], { type: 'image/png' });
    const retry = unwrap(await clients[0].functions.invoke('media-upload', { body: input, headers: { 'Content-Type': 'image/png', 'X-Media-Kind': 'listing', 'X-Operation-Id': asset.operationId, Authorization: `Bearer ${ledger.users[0].session.access_token}` } }), 'media_retry'); ensure(retry.assetId === asset.assetId && retry.url === asset.url, 'media_retry_duplicate');
    const foreignId = await stableId('invalid_foreign_listing'); await addRecord('listings', { id: foreignId });
    denied(await clients[1].from('listings').insert({ id: foreignId, user_id: ledger.users[1].id, type: 'give', status: 'active', category_id: category.id, category: category.name, category_path: category.category_path, quantity: 1, lat: 42.44, lng: 19.26, location_label: `${marker} invalid`, location_verified_at: new Date().toISOString(), moderation_status: 'approved', image_url: asset.url, image_urls: [asset.url] }), 'foreign_media_reference_allowed');
    const pathName = `${ledger.users[0].id}/direct-denial-${ledger.runId}.jpg`; ledger.media.push({ bucket: 'LISTING-PHOTOS', path: pathName }); await save();
    denied(await clients[0].storage.from('LISTING-PHOTOS').upload(pathName, input, { contentType: 'image/jpeg' }), 'direct_storage_upload_allowed', [400, 403]);
    denied(await clients[0].storage.from('AVATARS').upload(pathName, input, { contentType: 'image/jpeg', upsert: true }), 'direct_avatar_upsert_allowed', [400, 403]);
    const old = ledger.checkpoints['media:avatar:0:1']; denied(await clients[0].storage.from('AVATARS').update(old.path, input, { contentType: 'image/jpeg' }), 'direct_avatar_update_allowed');
    denied(await clients[1].rpc('set_my_avatar', { next_avatar_url: old.url }), 'foreign_avatar_reference_allowed');
    denied(await anon.functions.invoke('media-upload', { body: input, headers: { 'Content-Type': 'image/png', 'X-Media-Kind': 'listing', 'X-Operation-Id': randomUUID() } }), 'anonymous_media_upload_allowed');
    const invalid = async (body, type) => clients[0].functions.invoke('media-upload', { body, headers: { 'Content-Type': type, 'X-Media-Kind': 'listing', 'X-Operation-Id': randomUUID(), Authorization: `Bearer ${ledger.users[0].session.access_token}` } });
    denied(await invalid(new Blob(['not image bytes'], { type: 'image/png' }), 'image/png'), 'fake_image_accepted');
    denied(await invalid(input, 'video/mp4'), 'video_accepted');
    denied(await invalid(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'image/png'), 'oversize_accepted');
    const ownerRow = ledger.checkpoints['listing:browser:0'];
    denied(await clients[0].rpc('update_my_listing', {
      target_listing_id: ownerRow.id, target_category_id: ownerRow.category_id, target_category: ownerRow.category,
      target_category_path: ownerRow.category_path, target_description: ownerRow.description, target_quantity: ownerRow.quantity,
      target_lat: ownerRow.lat, target_lng: ownerRow.lng, target_location_label: ownerRow.location_label,
      target_image_url: asset.url, target_image_urls: Array(6).fill(asset.url), target_condition: 'usable',
      target_pickup_mode: 'public_place', target_pickup_windows: [], target_weight_kg: null, target_loan_duration_days: null,
    }), 'six_photos_accepted');
  });

  const requestTitles = { ru: 'Новый запрос', me: 'Novi zahtjev', en: 'New request', fr: 'Nouvelle demande', de: 'Neue Anfrage' };
  for (let pair = 0; pair < 5; pair += 1) {
    const owner = pair * 2, taker = owner + 1, outsider = (owner + 2) % 10, language = LANGUAGES[pair];
    await runCase(`give_meeting_contacts_points_${language}`, async () => {
      const row = await listing(owner, `give:${pair}`, { quantity: 3 }), id = await transaction(taker, row, `give:${pair}`, 2);
      await step(`requested_checks:${pair}`, async () => { const value = await txn(id); approx(hours(value.expires_at, value.created_at), 12, 'request_deadline_not_12h'); const feed = await rpc(clients[owner], 'get_my_discovery_feed'); const item = feed.inbox?.find((entry) => entry.payload?.transaction_id === id); ensure(item && item.title === requestTitles[language], 'localized_request_inbox_missing'); await rpc(clients[owner], 'mark_inbox_item_read', { target_inbox_id: item.id }); denied(await clients[outsider].rpc('mark_inbox_item_read', { target_inbox_id: item.id }), 'foreign_inbox_write'); return true; });
      await step(`accept_give:${pair}`, async () => { await rpc(clients[owner], 'accept_deal', { target_transaction_id: id }); const value = await txn(id); approx(hours(value.expires_at, value.accepted_at), 24, 'accepted_deadline_not_24h'); const valueStock = await stock(row.id); ensure(valueStock.available_quantity === 1 && valueStock.reserved_quantity === 2, 'partial_stock_inexact'); return true; });
      await step(`contact_privacy:${pair}`, async () => {
        const deals = await rpc(clients[taker], 'get_my_deals'), deal = deals.find((entry) => entry.transaction_id === id); ensure(deal?.contacts?.length === 3, 'participant_contacts_missing');
        const { contactHref } = await import('../src/lib/contacts.js'); for (const contact of deal.contacts) ensure(/^(https:\/\/(wa\.me|t\.me)\/|tg:\/\/resolve\?phone=|viber:\/\/chat\?number=)/.test(contactHref(contact) || ''), 'contact_link_invalid');
        ensure(!(await rpc(clients[outsider], 'get_my_deals')).some((entry) => entry.transaction_id === id), 'outsider_deal_leak');
        const contacts = unwrap(await clients[outsider].from('profile_contacts').select('*').eq('user_id', ledger.users[owner].id), 'outsider_contacts'); ensure(contacts.length === 0, 'outsider_contacts_leak');
        const direct = unwrap(await clients[outsider].from('listings').select('id,lat,lng,location_label').eq('id', row.id), 'outsider_listing'); ensure(direct.length === 0, 'exact_listing_location_leak');
        const pickup = await rpc(clients[taker], 'get_transaction_pickup_details', { target_transaction_id: id }); ensure(pickup.length === 1 && Number(pickup[0].lat) === 42.441123, 'participant_pickup_missing'); ensure((await rpc(clients[outsider], 'get_transaction_pickup_details', { target_transaction_id: id })).length === 0, 'outsider_pickup_leak'); return true;
      });
      const appointment = await step(`meeting:${pair}`, async () => { const time = new Date(Date.now() + 6 * 3600000).toISOString(); denied(await clients[outsider].rpc('schedule_handover', { target_transaction_id: id, scheduled_for: time, note: marker }), 'outsider_scheduled_meeting'); const appointmentId = await rpc(clients[taker], 'schedule_handover', { target_transaction_id: id, scheduled_for: time, note: marker }); await addRecord('handover_appointments', { id: appointmentId }); return appointmentId; });
      await step(`meeting_reschedule_cancel:${pair}`, async () => { ensure(await rpc(clients[taker], 'set_handover_outcome', { target_appointment_id: appointment, outcome: 'reschedule' }) === 'reschedule_requested', 'reschedule_not_recorded'); const next = await rpc(clients[owner], 'schedule_handover', { target_transaction_id: id, scheduled_for: new Date(Date.now() + 8 * 3600000).toISOString(), note: marker }); ensure(next === appointment, 'reschedule_duplicate_meeting'); ensure(await rpc(clients[owner], 'set_handover_outcome', { target_appointment_id: appointment, outcome: 'canceled' }) === 'canceled', 'meeting_not_canceled'); return true; });
      const before = await step(`points_before_give:${pair}`, async () => ({ owner: await points(owner), taker: await points(taker) }));
      await step(`confirm_give:${pair}`, async () => { if (!(await txn(id)).completed_at) { const a = await rpc(clients[owner], 'confirm_handover', { target_transaction_id: id }); ensure(!a.completed, 'one_sided_give_completed'); const b = await rpc(clients[taker], 'confirm_handover', { target_transaction_id: id }); ensure(b.completed, 'two_sided_give_incomplete'); } const again = await rpc(clients[owner], 'confirm_handover', { target_transaction_id: id }); ensure(again.completed && Number(again.eco_reward) === 0, 'duplicate_give_reward'); ensure(await points(owner) === before.owner + 50 && await points(taker) === before.taker + 25, 'give_points_inexact'); const events = await readRows('reuse_events', 'transaction_id', [id]); ensure(events.length === 1 && events[0].item_count === 2, 'give_impact_duplicate'); return true; });
    });
    await runCase(`partial_concurrent_reservation_cancel_${language}`, async () => {
      const row = await listing(owner, `race:${pair}`, { quantity: 10 });
      const [a, b] = await Promise.all([transaction(taker, row, `race-a:${pair}`, 7), transaction(outsider, row, `race-b:${pair}`, 6)]);
      const winner = await step(`race_accept:${pair}`, async () => { const results = await Promise.all([clients[owner].rpc('accept_deal', { target_transaction_id: a }), clients[owner].rpc('accept_deal', { target_transaction_id: b })]); const accepted = results.flatMap((result, index) => result.error ? [] : [index]); ensure(accepted.length === 1, 'race_accept_winner_count'); const quantity = accepted[0] === 0 ? 7 : 6; const value = await stock(row.id); ensure(value.available_quantity === 10 - quantity && value.reserved_quantity === quantity, 'race_stock_inexact'); return accepted[0] === 0 ? a : b; });
      await step(`race_cancel:${pair}`, async () => { if (!(await txn(winner)).canceled_at) await rpc(clients[owner], 'cancel_booking', { target_transaction_id: winner }); denied(await clients[owner].rpc('cancel_booking', { target_transaction_id: winner }), 'repeated_cancel_not_refused'); const value = await stock(row.id); ensure(value.available_quantity === 10 && value.reserved_quantity === 0, 'cancel_stock_not_exactly_restored'); const canceled = await txn(winner); ensure(canceled.canceled_at, 'cancel_history_missing'); return true; });
    });
    await runCase(`loan_seven_day_issue_and_return_${language}`, async () => {
      const photo = ledger.checkpoints[`media:listing:${owner}`]; ensure(photo, 'loan_photo_prerequisite');
      const row = await listing(owner, `loan:${pair}`, { quantity: 1, type: 'lend', loan_duration_days: 7, image_url: photo.url, image_urls: [photo.url] }), id = await transaction(taker, row, `loan:${pair}`);
      await step(`loan_accept:${pair}`, async () => { await rpc(clients[owner], 'accept_deal', { target_transaction_id: id }); const value = await txn(id); approx(hours(value.return_due_at, value.accepted_at), 7 * 24, 'loan_due_not_7_days'); denied(await clients[taker].rpc('confirm_loan_return', { target_transaction_id: id }), 'loan_returned_before_issue'); denied(await clients[owner].rpc('confirm_handover', { target_transaction_id: id }), 'loan_used_give_flow'); return true; });
      await step(`loan_issue:${pair}`, async () => { if (!(await txn(id)).handed_over_at) { ensure(!(await rpc(clients[owner], 'confirm_loan_handover', { target_transaction_id: id })).handed_over, 'one_sided_loan_issued'); ensure((await rpc(clients[taker], 'confirm_loan_handover', { target_transaction_id: id })).handed_over, 'two_sided_loan_not_issued'); } const value = await txn(id); ensure(value.handed_over_at && !value.completed_at, 'loan_issue_closed_early'); const stockValue = await stock(row.id); ensure(stockValue.available_quantity === 0 && stockValue.reserved_quantity === 0, 'loan_issue_stock'); return true; });
      const before = await step(`points_before_loan:${pair}`, async () => ({ owner: await points(owner), taker: await points(taker) }));
      await step(`loan_return:${pair}`, async () => { if (!(await txn(id)).returned_at) { ensure(!(await rpc(clients[taker], 'confirm_loan_return', { target_transaction_id: id })).returned, 'one_sided_loan_returned'); ensure((await rpc(clients[owner], 'confirm_loan_return', { target_transaction_id: id })).returned, 'two_sided_loan_not_returned'); } await rpc(clients[owner], 'confirm_loan_return', { target_transaction_id: id }); const value = await stock(row.id); ensure(value.available_quantity === 1 && value.reserved_quantity === 0, 'loan_stock_not_restored'); ensure(await points(owner) === before.owner + 25 && await points(taker) === before.taker + 25, 'loan_points_duplicate'); const events = await readRows('reuse_events', 'transaction_id', [id]); ensure(events.length === 1 && events[0].event_kind === 'loan_returned', 'loan_impact_duplicate'); return true; });
    });
    await runCase(`pending_expiry_timestamp_simulation_${language}`, async () => {
      const key = `expiry-v1:pending:${pair}`, row = await listing(owner, key, { quantity: 4 }), id = await transaction(taker, row, key, 2);
      await step(`${key}:simulate`, () => simulateExpiry(owner, taker, row, id, false));
    });
    await runCase(`accepted_expiry_release_timestamp_simulation_${language}`, async () => {
      const key = `expiry-v1:accepted:${pair}`, row = await listing(owner, key, { quantity: 4 }), id = await transaction(taker, row, key, 2);
      await step(`${key}:reserve`, async () => {
        const value = await txn(id);
        if (value.canceled_reason === 'expired' && value.canceled_at) return true;
        await rpc(clients[owner], 'accept_deal', { target_transaction_id: id });
        const reserved = await stock(row.id);
        ensure(reserved.quantity === 4 && reserved.available_quantity === 2 && reserved.reserved_quantity === 2, 'expiry_accept_stock_not_2_of_4');
        return true;
      });
      await step(`${key}:simulate`, () => simulateExpiry(owner, taker, row, id, true));
    });
  }

  for (let i = 0; i < 10; i += 1) await runCase(`private_feedback_idempotency_${ledger.users[i].language}_${i + 1}`, async () => {
    const asset = await media(i, 'feedback', `feedback:${i}`), requestId = await stableId(`feedback:${i}`), message = `${marker} ${ledger.users[i].language} private feedback; DO NOT SEND TO TELEGRAM`;
    const payload = { feedback_type: 'problem', message, screenshot_url: asset.url, request_id: requestId };
    const ids = await Promise.all([rpc(clients[i], 'create_feedback_once', payload), rpc(clients[i], 'create_feedback_once', payload)]); ensure(ids[0] === ids[1], 'feedback_duplicate_ids'); await addRecord('user_feedback', { id: ids[0] });
    denied(await clients[i].rpc('create_feedback_once', { ...payload, message: `${message} changed` }), 'feedback_changed_payload_reused_id');
    const own = unwrap(await clients[i].from('user_feedback').select('id,screenshot_url').eq('id', ids[0]).single(), 'own_feedback'); ensure(own.screenshot_url === `media:${asset.assetId}`, 'feedback_not_private_reference');
    const sign = unwrap(await clients[i].functions.invoke('media-upload', { body: { action: 'sign', assetId: asset.assetId } }), 'own_private_sign'); ensure(sign.expiresIn === 300 && sign.url.startsWith(`${PROJECT_URL}/storage/v1/object/sign/FEEDBACK-ATTACHMENTS/`), 'private_sign_bad_url'); ensure((await fetch(sign.url, { redirect: 'error', signal: AbortSignal.timeout(20000) })).ok, 'private_signed_image_unreadable');
    denied(await clients[(i + 1) % 10].functions.invoke('media-upload', { body: { action: 'sign', assetId: asset.assetId } }), 'foreign_private_sign_allowed');
    const publicProbe = await fetch(`${PROJECT_URL}/storage/v1/object/public/FEEDBACK-ATTACHMENTS/${asset.path}`, { redirect: 'error', signal: AbortSignal.timeout(20000) }); ensure([400, 401, 403, 404].includes(publicProbe.status), 'feedback_public_bucket_leak_or_unexpected_failure');
    const outsider = unwrap(await clients[(i + 1) % 10].from('user_feedback').select('id').eq('id', ids[0]), 'foreign_feedback'); ensure(outsider.length === 0, 'foreign_feedback_read');
    const receipt = unwrap(await admin.from('feedback_telegram_deliveries').select('status,attempts').eq('feedback_id', ids[0]).single(), 'feedback_unsent_receipt'); ensure(receipt.status === 'queued' && receipt.attempts === 0, 'unexpected_external_feedback_delivery');
  });

  await runCase('discovery_favourites_inbox_and_collection_points', async () => {
    const client = clients[1], user = ledger.users[1], other = clients[4], row = ledger.checkpoints['listing:browser:0']; ensure(row, 'discovery_listing_prerequisite');
    const searchId = await step('saved_search', async () => { const id = await rpc(client, 'save_search', { search_query: marker.slice(0, 100), search_filters: { type: 'give' }, wants_daily_digest: false }); await addRecord('saved_searches', { id }); return id; });
    await step('favourite', async () => { const present = unwrap(await client.from('listing_favourites').select('listing_id').eq('listing_id', row.id).eq('user_id', user.id), 'favourite_probe'); if (!present.length) ensure(await rpc(client, 'toggle_listing_favourite', { target_listing_id: row.id }), 'favourite_not_added'); await addRecord('listing_favourites', { user_id: user.id, listing_id: row.id }); return true; });
    const feed = await rpc(client, 'get_my_discovery_feed'); ensure(feed.saved_searches.some((item) => item.id === searchId) && feed.favourites.some((item) => item.listing_id === row.id), 'discovery_feed_missing_own_data'); ensure(unwrap(await other.from('saved_searches').select('id').eq('id', searchId), 'foreign_search').length === 0, 'foreign_search_leak');
    const point = await step('collection_point', async () => { const id = await rpc(clients[0], 'create_collection_point', { point_name: `${marker} collection`, point_lat: 42.44, point_lng: 19.26, point_location_label: `${marker} public collection`, material_keys: ['glass', 'paper'], point_description: 'Disposable release verification fixture' }); await addRecord('collection_points', { id }); return id; });
    denied(await clients[0].rpc('vote_collection_point', { target_point_id: point, vote_value: 'exists' }), 'point_self_vote_allowed');
    for (const i of [1, 2, 3]) { await rpc(clients[i], 'vote_collection_point', { target_point_id: point, vote_value: 'exists' }); await addRecord('collection_point_votes', { point_id: point, user_id: ledger.users[i].id }); }
    const found = (await rpc(anon, 'get_collection_points')).find((item) => item.id === point); ensure(found?.status === 'verified' && Number(found.exists_votes) === 3 && !('created_by' in found) && !('user_id' in found), 'collection_public_aggregate_privacy');
    denied(await anon.from('collection_point_votes').select('*').eq('point_id', point), 'anonymous_voter_identity_read');
  });

  await runCase('own_listing_favourites_and_reports_are_denied_for_all_ten_users', async () => {
    for (let i = 0; i < 10; i += 1) {
      const own = ledger.checkpoints[`listing:browser:${i}`]; ensure(own?.user_id === ledger.users[i].id, 'own_action_fixture_owner');
      const favourite = await clients[i].rpc('toggle_listing_favourite', { target_listing_id: own.id });
      denied(favourite, 'own_favourite_rpc_allowed', [400]); ensure(/own listing/i.test(favourite.error.message), 'own_favourite_wrong_denial');
      denied(await clients[i].from('listing_favourites').insert({ user_id: ledger.users[i].id, listing_id: own.id }), 'own_favourite_direct_allowed', [403]);
      const report = await clients[i].rpc('create_report', { target_kind: 'listing', target_id: own.id, reason: 'misleading', details: null });
      denied(report, 'own_report_rpc_allowed', [400]); ensure(/Invalid report target/.test(report.error.message), 'own_report_wrong_denial');
      denied(await clients[i].from('reports').insert({ reporter_id: ledger.users[i].id, target_kind: 'listing', target_id: own.id, target_user_id: ledger.users[i].id, reason: 'misleading' }), 'own_report_direct_allowed', [403]);
    }
  });

  const latest = [...new Map(ledger.cases.map((item) => [item.name, item])).values()], failures = latest.filter((item) => item.status === 'failed');
  ledger.finishedAt = new Date().toISOString(); await save();
  let cleaned = false;
  if (!options.keepFixtures) { await inventoryAndCleanup(); cleaned = true; }
  process.stdout.write(JSON.stringify({ mode: 'ten-user-release-check', runId: ledger.runId, passed: latest.length - failures.length, failed: failures.map(({ name, code }) => ({ name, code })), cleaned, fixtureUsers: 10, languages: LANGUAGES, ledger: privatePath, liveExecution: true, telegramInvoked: false, manualChecksStillRequired: true }) + '\n');
  if (failures.length) process.exitCode = 1;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseReleaseArguments(args);
  if (!options.execute || options.help) { process.stdout.write(`${HELP}\n`); return; }
  await runReleaseTenUsers(options);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`Ten-user verification stopped (${safeCode(error)}). No credentials are printed; inspect the exact private run ledger.\n`); process.exitCode = 1; });
