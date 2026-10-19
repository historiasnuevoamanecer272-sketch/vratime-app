import { createHash } from 'node:crypto';
export const PROJECT_REF = 'kuoflaaankpjksyssfka';
export const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
export const PRODUCTION_ORIGIN = 'https://vratime.vzdigital.online';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LANGUAGES = ['ru', 'me', 'en', 'fr', 'de'];
export const CLEANUP_ORDER = ['feedback_telegram_deliveries', 'digest_deliveries', 'user_inbox', 'listing_matches', 'listing_favourites', 'search_history', 'saved_searches', 'web_push_subscriptions', 'collection_point_edits', 'collection_point_votes', 'collection_point_materials', 'collection_points', 'handover_appointments', 'reuse_events', 'reputation_penalties', 'reports', 'moderation_actions', 'reviews', 'user_feedback', 'transactions', 'listings', 'profile_contacts', 'profiles'];
const keys = { feedback_telegram_deliveries: ['feedback_id'], profile_contacts: ['user_id', 'messenger_type'], listing_favourites: ['user_id', 'listing_id'], collection_point_votes: ['point_id', 'user_id'], collection_point_materials: ['point_id', 'material_key'], reuse_events: ['transaction_id'] };
export const safeCode = (error) => /^[a-zA-Z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'request_failed';
export const ensure = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };

export function parseReleaseArguments(args) {
  const options = { execute: false, keepFixtures: false };
  for (const arg of args) {
    if (arg === '--execute') options.execute = true;
    else if (arg === '--keep-fixtures') options.keepFixtures = true;
    else if (arg === '--help') options.help = true;
    else if (arg.startsWith('--expected-release-hash=')) options.expectedReleaseHash = arg.slice(24).toLowerCase();
    else if (arg.startsWith('--resume-ledger=')) options.resumeLedger = arg.slice(16);
    else if (arg.startsWith('--cleanup-ledger=')) options.cleanupLedger = arg.slice(17);
    else throw new Error(`Unknown option: ${arg.split('=')[0]}`);
  }
  if (options.resumeLedger && options.cleanupLedger) throw new Error('Resume and cleanup modes are mutually exclusive');
  if (options.execute && !/^[0-9a-f]{64}$/.test(options.expectedReleaseHash || '')) throw new Error('--expected-release-hash=<64 lowercase SHA256 hex digits> is required with --execute');
  if (options.cleanupLedger && options.keepFixtures) throw new Error('Cleanup and keep-fixtures are mutually exclusive');
  return options;
}

export function assertTargetProject(url) { ensure(url?.replace(/\/$/, '') === PROJECT_URL, 'wrong_project'); }

export async function verifyPublicRelease({ expectedHash, fetchImpl = globalThis.fetch }) {
  ensure(/^[0-9a-f]{64}$/.test(expectedHash || ''), 'release_hash_required');
  const get = async (pathname, limit) => {
    const response = await fetchImpl(`${PRODUCTION_ORIGIN}${pathname}${pathname.includes('?') ? '&' : '?'}qa=${Date.now()}`, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'cache-control': 'no-cache' } });
    ensure(response.ok, 'release_http_failed');
    const bytes = new Uint8Array(await response.arrayBuffer()); ensure(bytes.length <= limit, 'release_size_limit'); return bytes;
  };
  const html = new TextDecoder().decode(await get('/', 1024 * 1024));
  const asset = html.match(/<script[^>]+src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/i)?.[1];
  ensure(asset, 'release_asset_missing');
  const bytes = await get(asset, 10 * 1024 * 1024);
  ensure(createHash('sha256').update(bytes).digest('hex') === expectedHash, 'release_hash_mismatch');
  let source = new TextDecoder().decode(bytes), projectFound = source.includes(PROJECT_REF);
  const visited = new Set([asset]), pending = [];
  const queueImports = (text, parent) => { for (const match of text.matchAll(/["'](\.\/[A-Za-z0-9_-]+\.js)["']/g)) { const pathname = new URL(match[1], `${PRODUCTION_ORIGIN}${parent}`).pathname; if (/^\/assets\/[A-Za-z0-9_-]+\.js$/.test(pathname) && !visited.has(pathname)) pending.push(pathname); } };
  queueImports(source, asset);
  while (!projectFound && pending.length && visited.size < 20) {
    const pathname = pending.shift(); if (visited.has(pathname)) continue; visited.add(pathname);
    source = new TextDecoder().decode(await get(pathname, 5 * 1024 * 1024)); projectFound = source.includes(PROJECT_REF); queueImports(source, pathname);
  }
  ensure(projectFound, 'release_wrong_project');
  const release = new TextDecoder().decode(await get('/RELEASE.txt', 65536));
  const releaseId = release.match(/^RELEASE_ID=(.+)$/m)?.[1]?.trim(); ensure(releaseId, 'release_id_missing');
  return { asset, releaseId, verifiedAt: new Date().toISOString() };
}

export function assertFixtureLedger(ledger) {
  ensure(ledger?.version === 1 && ledger.projectRef === PROJECT_REF && UUID.test(ledger.runId || '') && /^[0-9a-f]{64}$/.test(ledger.expectedReleaseHash || ''), 'invalid_ledger');
  ensure(Array.isArray(ledger.users) && ledger.users.length <= 10, 'invalid_ledger_users');
  const ids = new Set();
  for (const user of ledger.users) {
    ensure(user.email?.startsWith(`vratime-release-${ledger.runId}-`) && user.email.endsWith('@example.invalid') && LANGUAGES.includes(user.language), 'invalid_fixture_marker');
    if (user.id) { ensure(UUID.test(user.id) && !ids.has(user.id), 'invalid_fixture_user'); ids.add(user.id); }
  }
  for (const asset of ledger.media || []) ensure(['AVATARS', 'LISTING-PHOTOS', 'FEEDBACK-ATTACHMENTS'].includes(asset.bucket) && ids.has(asset.path?.split('/')[0]) && asset.path.split('/').length === 2 && /^[a-zA-Z0-9_.-]+$/.test(asset.path.split('/')[1]), 'invalid_fixture_media');
  for (const [table, records] of Object.entries(ledger.records || {})) {
    ensure(CLEANUP_ORDER.includes(table) && Array.isArray(records), 'invalid_fixture_table');
    for (const record of records) {
      const columns = keys[table] || ['id'];
      ensure(Object.keys(record).every((key) => columns.includes(key)) && columns.every((key) => typeof record[key] === 'string' && (key === 'material_key' ? /^[a-z0-9_-]{1,80}$/.test(record[key]) : key === 'messenger_type' ? ['tg', 'wa', 'viber'].includes(record[key]) : UUID.test(record[key]))), 'invalid_fixture_record');
      if (table === 'profiles') ensure(ids.has(record.id), 'invalid_fixture_profile');
    }
  }
}

export function buildExactCleanupPlan(ledger) {
  assertFixtureLedger(ledger);
  return [
    ...(ledger.media || []).map((asset) => ({ table: '$storage', filters: { bucket: asset.bucket, path: asset.path } })),
    ...CLEANUP_ORDER.flatMap((table) => (ledger.records?.[table] || []).map((filters) => ({ table, filters }))),
    ...ledger.users.filter((user) => user.id).map((user) => ({ table: '$auth', filters: { id: user.id } })),
  ];
}

export async function executeExactCleanup(plan, { remove, record = async () => {} }) {
  const completed = [], failures = [];
  for (const step of plan) {
    try { await remove(step); completed.push(step); await record({ step, ok: true }); }
    catch (error) { const failure = { step, code: safeCode(error) }; failures.push(failure); await record({ ...failure, ok: false }); break; }
  }
  return { complete: failures.length === 0, completed: completed.length, remaining: plan.length - completed.length, failures };
}
