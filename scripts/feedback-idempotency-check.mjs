import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';

let failures = 0, passed = 0;
const check = async (name, run) => {
  try { await run(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}: ${error.message}`); }
};
const srcUrl = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === new URL('../src/lib/api.js', import.meta.url).href && specifier === '../supabaseClient') return { url: 'feedback-once-test:supabase', shortCircuit: true };
    if (context.parentURL?.startsWith(srcUrl) && specifier.startsWith('.') && !path.extname(specifier)) return next(`${specifier}.js`, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'feedback-once-test:supabase') return { format: 'module', shortCircuit: true, source: `
      export const calls = [];
      export const supabase = { rpc: async (name, params) => { calls.push({ name, params }); return { data: '11111111-1111-4111-8111-111111111111', error: null }; } };
    ` };
    return next(url, context);
  },
});
try {
  const { createFeedback } = await import('../src/lib/api.js');
  const { calls } = await import('feedback-once-test:supabase');
  await check('feedback API preserves the legacy RPC when requestId is absent or null', async () => {
    calls.length = 0;
    await createFeedback({ type: 'feature', message: 'A useful suggestion' });
    await createFeedback({ type: 'problem', message: 'A useful report', screenshotUrl: 'media:legacy', requestId: null });
    assert.deepEqual(calls, [
      { name: 'create_feedback', params: { feedback_type: 'feature', message: 'A useful suggestion', screenshot_url: null } },
      { name: 'create_feedback', params: { feedback_type: 'problem', message: 'A useful report', screenshot_url: 'media:legacy' } },
    ]);
  });
  await check('feedback API sends the stable request UUID to the idempotent RPC', async () => {
    calls.length = 0;
    const requestId = '33333333-3333-4333-8333-333333333333';
    const result = await createFeedback({ type: 'support', message: 'Please help', screenshotUrl: 'media:attachment', requestId });
    assert.equal(result, '11111111-1111-4111-8111-111111111111');
    assert.deepEqual(calls, [{ name: 'create_feedback_once', params: { feedback_type: 'support', message: 'Please help', screenshot_url: 'media:attachment', request_id: requestId } }]);
  });
  await check('an invalid present requestId does not silently fall back to duplicate-prone legacy submission', async () => {
    calls.length = 0;
    await createFeedback({ type: 'support', message: 'Please help', requestId: '' });
    assert.equal(calls[0].name, 'create_feedback_once');
    assert.equal(calls[0].params.request_id, '');
  });
} finally { hooks.deregister(); }

const toolPath = process.argv.find((arg) => arg.startsWith('--pg-tools='))?.slice('--pg-tools='.length);
const require = createRequire(import.meta.url);
let PGlite;
try { ({ PGlite } = require(toolPath ? path.resolve(toolPath) : '@electric-sql/pglite')); }
catch (error) {
  if (toolPath) throw error;
  console.log('SKIP SQL checks: pass --pg-tools=/absolute/path/to/@electric-sql/pglite to run the offline database suite.');
}

if (PGlite) {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
  const request = '33333333-3333-4333-8333-333333333333';
  const ownerAsset = '44444444-4444-4444-8444-444444444444', otherAsset = '55555555-5555-4555-8555-555555555555';
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const file = readdirSync(migrations).find((name) => name.endsWith('_feedback_idempotent_submission.sql'));
  assert.ok(file, 'CLI-created feedback idempotency migration is missing');
  const migration = readFileSync(new URL(file, migrations), 'utf8');
  const originalSource = readFileSync(new URL('20260922000000_roles_moderation_reports_support.sql', migrations), 'utf8');
  const originalStart = originalSource.indexOf('create or replace function public.create_feedback(');
  const originalEnd = originalSource.indexOf('create or replace function public.set_feedback_status(', originalStart);
  const mediaSource = readFileSync(new URL('20261019072832_secure_user_media_pipeline.sql', migrations), 'utf8');
  const mediaStart = mediaSource.indexOf('create function media_private.validate_feedback_media()');
  const mediaEndMarker = 'for each row execute function media_private.validate_feedback_media();';
  const mediaEnd = mediaSource.indexOf(mediaEndMarker, mediaStart) + mediaEndMarker.length;
  const actor = (role, userId, run) => db.transaction(async (tx) => {
    assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId || '']);
    return run(tx);
  });
  const submit = (userId, id = request, type = 'feature', message = 'A useful suggestion', screenshot = null) => actor('authenticated', userId, async (tx) => (await tx.query('select public.create_feedback_once($1, $2, $3, $4::uuid) as id', [type, message, screenshot, id])).rows[0].id);
  const count = async () => Number((await db.query('select count(*) as count from public.user_feedback')).rows[0].count);
  let firstId;
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon, service_role;
      grant execute on function auth.uid() to authenticated, anon, service_role;
      create table public.user_feedback (
        id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
        feedback_type text not null check(feedback_type in ('feature', 'category', 'problem', 'support')),
        message text not null, screenshot_url text
      );
      alter table public.user_feedback enable row level security;
      grant select on public.user_feedback to authenticated;
      create policy feedback_owner_read on public.user_feedback for select to authenticated using(user_id = auth.uid());
      create table public.test_feedback_delivery_queue(feedback_id uuid primary key references public.user_feedback(id));
      create function public.test_queue_feedback() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.test_feedback_delivery_queue values(new.id); return new; end $$;
      create trigger test_feedback_delivery after insert on public.user_feedback for each row execute function public.test_queue_feedback();
      create schema media_private;
      create table media_private.assets(id uuid primary key, user_id uuid not null, kind text, status text);
    `);
    await db.query('insert into auth.users values($1),($2)', [owner, other]);
    await db.query("insert into media_private.assets values($1,$2,'feedback','complete'),($3,$4,'feedback','complete')", [ownerAsset, owner, otherAsset, other]);
    // Use the actual existing function and media ownership trigger unchanged.
    await db.exec(originalSource.slice(originalStart, originalEnd));
    await db.exec('revoke execute on function public.create_feedback(text,text,text) from public,anon; grant execute on function public.create_feedback(text,text,text) to authenticated;');
    await db.exec(mediaSource.slice(mediaStart, mediaEnd));
    await db.exec(migration);

    await check('a lost-ack retry returns the original feedback UUID and queues delivery only once', async () => {
      firstId = await submit(owner);
      assert.match(firstId, /^[0-9a-f-]{36}$/);
      assert.equal(await submit(owner), firstId);
      assert.equal(await count(), 1);
      assert.equal(Number((await db.query('select count(*) as count from public.test_feedback_delivery_queue')).rows[0].count), 1);
    });
    await check('payload normalization preserves the original function trimmed-message behavior', async () => {
      assert.equal(await submit(owner, request, 'feature', '  A useful suggestion  ', '  '), firstId);
      assert.equal((await db.query('select message,screenshot_url from public.user_feedback where id=$1', [firstId])).rows[0].message, 'A useful suggestion');
    });
    await check('the same committed request UUID rejects changed type, message or screenshot', async () => {
      for (const [type, message, screenshot] of [
        ['problem', 'A useful suggestion', null], ['feature', 'A changed suggestion', null], ['feature', 'A useful suggestion', `media:${ownerAsset}`],
      ]) await assert.rejects(submit(owner, request, type, message, screenshot), /feedback_request_payload_mismatch/);
      assert.equal(await count(), 1);
    });
    await check('a new request UUID submits independently while another user cannot collide with the owner', async () => {
      const second = await submit(owner, '66666666-6666-4666-8666-666666666666');
      const foreign = await submit(other, request, 'support', 'A separate user request');
      assert.notEqual(second, firstId); assert.notEqual(foreign, firstId); assert.notEqual(foreign, second);
      assert.equal(await submit(owner), firstId);
      assert.equal(await submit(other, request, 'support', 'A separate user request'), foreign);
      const readable = await actor('authenticated', other, async (tx) => (await tx.query('select id from public.user_feedback')).rows.map((row) => row.id));
      assert.deepEqual(readable, [foreign]);
    });
    await check('null or malformed UUIDs, missing auth and invalid required input cannot create claims or feedback', async () => {
      const before = await count();
      for (const [id, type, message] of [[null, 'feature', 'Valid body'], ['not-a-uuid', 'feature', 'Valid body'], [request, null, 'Valid body'], [request, 'invalid', 'Valid body'], [request, 'feature', null], [request, 'feature', '   '], [request, 'feature', 'tiny']]) await assert.rejects(submit(owner, id, type, message));
      await assert.rejects(submit(null), /Authentication required/);
      assert.equal(await count(), before);
    });
    await check('anonymous and service roles cannot execute the endpoint or read/write its private mappings', async () => {
      for (const role of ['anon', 'service_role']) await assert.rejects(actor(role, owner, (tx) => tx.query("select public.create_feedback_once('feature','Valid body',null,$1::uuid)", [request])), (error) => error.code === '42501');
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const query of ['select * from feedback_private.submission_requests', 'delete from feedback_private.submission_requests']) await assert.rejects(actor(role, owner, (tx) => tx.query(query)), (error) => error.code === '42501');
      }
    });
    await check('the existing private-media trigger still rejects foreign attachments and a failed submission remains retryable', async () => {
      const id = '77777777-7777-4777-8777-777777777777';
      const before = await count();
      await assert.rejects(submit(owner, id, 'problem', 'Attachment report', `media:${otherAsset}`), /media_unowned_feedback/);
      assert.equal(await count(), before);
      const saved = await submit(owner, id, 'problem', 'Attachment report', `media:${ownerAsset}`);
      assert.equal(await submit(owner, id, 'problem', 'Attachment report', `media:${ownerAsset}`), saved);
      assert.equal((await db.query('select screenshot_url from public.user_feedback where id=$1', [saved])).rows[0].screenshot_url, `media:${ownerAsset}`);
    });
    await check('a transaction rollback removes both the feedback and the dedupe claim', async () => {
      const id = '88888888-8888-4888-8888-888888888888';
      const before = await count();
      await assert.rejects(actor('authenticated', owner, async (tx) => {
        await tx.query("select public.create_feedback_once('feature','Rolled back report',null,$1::uuid)", [id]);
        throw new Error('Simulated transaction rollback');
      }), /Simulated transaction rollback/);
      assert.equal(await count(), before);
      const saved = await submit(owner, id, 'feature', 'Changed after rollback');
      assert.equal(await submit(owner, id, 'feature', 'Changed after rollback'), saved);
    });
    await check('queued duplicate calls return one UUID and create one row', async () => {
      const id = '99999999-9999-4999-8999-999999999999';
      const before = await count();
      const results = await Promise.all(Array.from({ length: 8 }, () => submit(owner, id)));
      assert.equal(new Set(results).size, 1);
      assert.equal(await count(), before + 1);
    });
    console.log('Concurrency limit: PGlite serializes calls on one connection; this checks queued retry behavior, not contention between independent PostgreSQL sessions.');
  } finally { await db.close(); }
}

if (failures) process.exitCode = 1;
else console.log(`Feedback idempotency: ${passed} checks passed. No live database, auth or network calls were made.`);
