import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Offline only: real handler, with HTTP restricted to these exact test fixtures.
const handlerModule = await import('../supabase/functions/feedback-telegram/handler.mjs').catch(() => null);
assert.ok(handlerModule?.createFeedbackTelegramHandler, 'The feedback Telegram handler must exist');
const { createFeedbackTelegramHandler } = handlerModule;
const feedbackId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const claimToken = '33333333-3333-4333-8333-333333333333';
const base = 'https://fixture.supabase.co';
const secret = '123456:THIS_IS_AN_OFFLINE_FIXTURE_TOKEN';
const env = { SUPABASE_URL: base, SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', TELEGRAM_BOT_TOKEN: secret, TELEGRAM_CHAT_ID: '123456789' };
const feedback = { id: feedbackId, user_id: userId, feedback_type: 'feature', message: '<b>Keep this plain</b> & useful', screenshot_url: `${base}/storage/v1/object/public/LISTING-PHOTOS/${userId}/feedback/44444444-4444-4444-8444-444444444444.png`, created_at: '2026-10-19T06:00:00Z' };
function response(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
function fixture(options = {}) {
  const calls = [];
  let delivered = false;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === `${base}/auth/v1/user`) {
      assert.equal(init.headers.Authorization, 'Bearer fixture-user-token');
      assert.equal(init.headers.apikey, 'fixture-anon');
      return response(options.auth ?? { id: userId }, options.authStatus ?? 200);
    }
    if (url === `${base}/rest/v1/rpc/claim_feedback_telegram`) {
      assert.equal(init.headers.Authorization, 'Bearer fixture-service');
      const body = JSON.parse(init.body);
      assert.equal(body.target_feedback_id, feedbackId);
      assert.equal(body.expected_user_id, userId);
      assert.equal(body.is_configured, options.configured ?? true);
      if (options.claimError) return response({ message: secret }, 500);
      return response(options.claim ?? (delivered ? { delivery: 'delivered' } : { delivery: 'claimed', claimToken, feedback: { ...feedback, ...options.feedback } }));
    }
    if (url === `https://api.telegram.org/bot${secret}/sendMessage`) {
      const body = JSON.parse(init.body);
      assert.equal(body.chat_id, '123456789');
      assert.equal(body.parse_mode, undefined);
      assert.equal(body.link_preview_options.is_disabled, true);
      assert.ok(body.text.includes(feedbackId));
      assert.ok(body.text.length <= 4096);
      if (options.telegramThrow) throw new Error(`network failure ${secret}`);
      if (options.telegramResponse) return response(options.telegramResponse, options.telegramStatus ?? 200);
      return response({ ok: true, result: { message_id: 71, chat: { id: 123456789, type: 'private' }, date: 1792389600, text: body.text } });
    }
    if (url === `${base}/rest/v1/rpc/finish_feedback_telegram`) {
      const body = JSON.parse(init.body);
      assert.equal(body.target_feedback_id, feedbackId);
      assert.equal(body.claim_token, claimToken);
      if (options.finishError) return response({ message: secret }, 500);
      if (body.outcome === 'delivered') delivered = true;
      return response(true);
    }
    if (url === `${base}/rest/v1/rpc/media_private_asset`) {
      assert.deepEqual(JSON.parse(init.body), {expected_user_id:userId,target_asset_id:'44444444-4444-4444-8444-444444444444'});
      return response(options.privateAsset ?? {bucket:'FEEDBACK-ATTACHMENTS',path:`${userId}/44444444-4444-4444-8444-444444444444.jpg`});
    }
    if (url === `${base}/storage/v1/object/sign/FEEDBACK-ATTACHMENTS/${userId}/44444444-4444-4444-8444-444444444444.jpg`) {
      assert.deepEqual(JSON.parse(init.body), {expiresIn:300});
      return response({signedURL: options.signedURL ?? `/object/sign/FEEDBACK-ATTACHMENTS/${userId}/44444444-4444-4444-8444-444444444444.jpg?token=offline-signed-token`});
    }
    throw new Error('Unexpected external request in offline test');
  };
  const handler = createFeedbackTelegramHandler({ env: { ...env, ...options.env }, fetchImpl });
  return { calls, handler, async invoke(body = { feedbackId }, init = {}) {
    const result = await handler(new Request('https://fixture.invalid/functions/v1/feedback-telegram', { method: 'POST', headers: { Authorization: 'Bearer fixture-user-token', 'Content-Type': 'application/json', ...init.headers }, body: JSON.stringify(body), ...init }));
    const text = await result.text();
    assert.ok(!text.includes(secret), 'Secrets never reach a client response');
    return { status: result.status, data: text ? JSON.parse(text) : null, headers: result.headers };
  } };
}
let count = 0;
async function test(name, run) { await run(); count++; console.log(`PASS ${name}`); }

await test('private feedback attachment is owner-checked and signed for five minutes', async () => {
  const f=fixture({feedback:{screenshot_url:'media:44444444-4444-4444-8444-444444444444'}});
  assert.equal((await f.invoke()).data.delivery,'delivered');
  const sent=JSON.parse(f.calls.find(call=>call.url.endsWith('/sendMessage')).init.body).text;
  assert.ok(sent.includes(`${base}/storage/v1/object/sign/FEEDBACK-ATTACHMENTS/`));
  assert.ok(!sent.includes('media:'));
});
await test('private signing cannot substitute an external screenshot link', async () => {
  const f=fixture({feedback:{screenshot_url:'media:44444444-4444-4444-8444-444444444444'},signedURL:'https://evil.invalid/private.jpg'});
  await f.invoke();
  const sent=JSON.parse(f.calls.find(call=>call.url.endsWith('/sendMessage')).init.body).text;
  assert.ok(!sent.includes('evil.invalid'));
  assert.ok(sent.includes('Скриншот сохранён'));
});

await test('missing bearer token is rejected before any network access', async () => {
  const f = fixture(); const r = await f.invoke({ feedbackId }, { headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 401); assert.equal(f.calls.length, 0);
});
await test('Auth getUser rejects an expired or forged session', async () => {
  const f = fixture({ authStatus: 401, auth: { message: 'invalid token' } });
  assert.equal((await f.invoke()).status, 401); assert.equal(f.calls.length, 1);
});
await test('feedback UUID and unexpected recipient/URL fields are rejected', async () => {
  for (const body of [{ feedbackId: 'bad' }, { feedbackId: [feedbackId] }, { feedbackId: {} }, { feedbackId, chat_id: '999' }, { feedbackId, url: 'https://evil.invalid' }, { feedbackId, userId }]) {
    const f = fixture(); assert.equal((await f.invoke(body)).status, 400); assert.equal(f.calls.length, 0);
  }
});
await test('method and streamed request size are bounded', async () => {
  const f = fixture();
  assert.equal((await f.handler(new Request('https://fixture.invalid', { method: 'GET' }))).status, 405);
  assert.equal((await f.invoke({ feedbackId, padding: 'x'.repeat(3000) })).status, 413);
  assert.equal(f.calls.length, 0);
});
await test('JSON media type is exact and a body that only claims to be small is still bounded', async () => {
  const f = fixture();
  assert.equal((await f.invoke({ feedbackId }, { headers: { Authorization: 'Bearer fixture-user-token', 'Content-Type': 'application/json-malicious' } })).status, 415);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(1025))); controller.close(); } });
  const result = await f.handler(new Request('https://fixture.invalid', { method: 'POST', headers: { Authorization: 'Bearer fixture-user-token', 'Content-Type': 'application/json', 'Content-Length': '2' }, body: stream, duplex: 'half' }));
  assert.equal(result.status, 413); assert.equal(f.calls.length, 0);
});
await test('malformed JSON is rejected before Auth or delivery access', async () => {
  const f = fixture(); const result = await f.handler(new Request('https://fixture.invalid', { method: 'POST', headers: { Authorization: 'Bearer fixture-user-token', 'Content-Type': 'application/json' }, body: '{' }));
  assert.equal(result.status, 400); assert.equal(f.calls.length, 0);
});
await test('foreign feedback is indistinguishable from a missing feedback', async () => {
  const f = fixture({ claim: { delivery: 'not_found' } }); assert.equal((await f.invoke()).status, 404);
  assert.equal(f.calls.length, 2);
});
await test('a mismatched database ownership payload never reaches Telegram', async () => {
  const f = fixture({ claim: { delivery: 'claimed', claimToken, feedback: { ...feedback, user_id: claimToken } } });
  assert.equal((await f.invoke()).status, 503); assert.equal(f.calls.length, 2);
});
await test('missing bot settings persists an unconfigured state without Telegram HTTP', async () => {
  const f = fixture({ configured: false, env: { TELEGRAM_BOT_TOKEN: '' }, claim: { delivery: 'unconfigured' } });
  const r = await f.invoke(); assert.equal(r.status, 202); assert.equal(r.data.delivery, 'unconfigured'); assert.equal(f.calls.length, 2);
});
await test('a username cannot silently stand in for a private numeric chat ID', async () => {
  const f = fixture({ configured: false, env: { TELEGRAM_CHAT_ID: '@vszaharov' }, claim: { delivery: 'unconfigured' } });
  assert.equal((await f.invoke()).data.delivery, 'unconfigured'); assert.equal(f.calls.length, 2);
});
await test('a group or channel ID cannot receive private-owner feedback', async () => {
  const f = fixture({ configured: false, env: { TELEGRAM_CHAT_ID: '-1001234567890' }, claim: { delivery: 'unconfigured' } });
  assert.equal((await f.invoke()).data.delivery, 'unconfigured'); assert.equal(f.calls.length, 2);
});
await test('stored feedback is sent as plain text to only the server destination', async () => {
  const f = fixture(); const r = await f.invoke(); assert.equal(r.status, 200); assert.equal(r.data.delivery, 'delivered');
  const sent = JSON.parse(f.calls[2].init.body); assert.ok(sent.text.includes('<b>Keep this plain</b> & useful')); assert.ok(sent.text.includes(feedback.screenshot_url));
  const saved = JSON.parse(f.calls[3].init.body); assert.equal(saved.outcome, 'delivered'); assert.equal(saved.telegram_message_id, '71');
  assert.equal(f.calls.length, 4);
});
await test('confirmed feedback is deduplicated on a second invocation', async () => {
  const f = fixture(); await f.invoke(); const r = await f.invoke(); assert.equal(r.data.delivery, 'delivered'); assert.equal(r.data.duplicate, true);
  assert.equal(f.calls.filter((c) => c.url.includes('api.telegram.org')).length, 1);
});
await test('external and non-owner storage screenshot links are excluded without fetching them', async () => {
  for (const screenshot_url of ['https://evil.invalid/pixel.png', `${base}/storage/v1/object/public/LISTING-PHOTOS/99999999-9999-4999-8999-999999999999/feedback/image.png`, `${feedback.screenshot_url}?token=bad`]) {
    const f = fixture({ feedback: { screenshot_url } }); await f.invoke(); assert.ok(!JSON.parse(f.calls[2].init.body).text.includes(screenshot_url)); assert.equal(f.calls.length, 4);
  }
});
await test('long Unicode feedback fits the Telegram text limit with trusted screenshot retained', async () => {
  const f = fixture({ feedback: { message: '😀'.repeat(3000) } }); await f.invoke();
  const sent = JSON.parse(f.calls[2].init.body).text;
  assert.ok(sent.includes(feedback.screenshot_url)); assert.ok(sent.includes('…')); assert.ok(sent.length <= 4096);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(sent));
});
await test('Telegram rejection is retained as retryable failure with bounded retry delay', async () => {
  const f = fixture({ telegramStatus: 429, telegramResponse: { ok: false, error_code: 429, description: secret, parameters: { retry_after: 75 } } });
  const r = await f.invoke(); assert.equal(r.status, 202); assert.equal(r.data.delivery, 'queued'); assert.equal(r.data.retryAfterSeconds, 75);
  const saved = JSON.parse(f.calls[3].init.body); assert.equal(saved.outcome, 'failed'); assert.equal(saved.error_code, 'telegram_429'); assert.equal(saved.retry_after_seconds, 75);
});
await test('a timeout or malformed acknowledgement is ambiguous and cannot claim delivery', async () => {
  for (const options of [{ telegramThrow: true }, { telegramResponse: { ok: true, result: {} } }]) {
    const f = fixture(options); const r = await f.invoke(); assert.equal(r.status, 202); assert.equal(r.data.delivery, 'ambiguous'); assert.equal(JSON.parse(f.calls[3].init.body).outcome, 'ambiguous');
  }
});
await test('receipt write failure never reports delivered or retries the external send', async () => {
  const f = fixture({ finishError: true }); const r = await f.invoke(); assert.equal(r.status, 202); assert.equal(r.data.delivery, 'ambiguous'); assert.equal(f.calls.length, 4);
});
await test('active lease and ambiguous previous attempt never send again', async () => {
  for (const delivery of ['queued', 'ambiguous']) { const f = fixture({ claim: { delivery, retryAfterSeconds: 60 } }); const r = await f.invoke(); assert.equal(r.data.delivery, delivery); assert.equal(f.calls.length, 2); }
});
await test('database failure is generic and never exposes provider errors', async () => {
  const f = fixture({ claimError: true }); const r = await f.invoke(); assert.equal(r.status, 503); assert.equal(r.data.error, 'temporarily_unavailable'); assert.equal(f.calls.length, 2);
});

const pgArg = process.argv.find((arg) => arg.startsWith('--pg-tools='));
if (pgArg) {
  const { PGlite } = await import(pathToFileURL(`${pgArg.slice('--pg-tools='.length)}/dist/index.js`).href);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.user_feedback (id uuid primary key default gen_random_uuid(), user_id uuid not null, feedback_type text not null, message text not null, screenshot_url text, created_at timestamptz not null default now());
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    const { readdir } = await import('node:fs/promises');
    const migration = (await readdir(dir)).find((name) => name.endsWith('_feedback_telegram_delivery_queue.sql'));
    assert.ok(migration, 'CLI-created Telegram delivery migration exists');
    await db.exec(await readFile(new URL(migration, dir), 'utf8'));
    await db.exec(`insert into public.user_feedback(id,user_id,feedback_type,message) values ('${feedbackId}','${userId}','feature','Offline fixture');`);
    async function claim(id = feedbackId, owner = userId, configured = true) { return (await db.query('select public.claim_feedback_telegram($1,$2,$3) as result', [id, owner, configured])).rows[0].result; }
    await test('real SQL trigger queues the saved feedback', async () => { assert.equal((await db.query('select status from public.feedback_telegram_deliveries')).rows[0].status, 'queued'); });
    await test('real SQL denies public table access and public RPC execution', async () => {
      for (const role of ['anon', 'authenticated']) {
        assert.equal((await db.query(`select has_table_privilege('${role}','public.feedback_telegram_deliveries','select') as allowed`)).rows[0].allowed, false);
        for (const signature of ['public.claim_feedback_telegram(uuid,uuid,boolean)', 'public.finish_feedback_telegram(uuid,uuid,text,text,text,integer)']) assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed', [role, signature, 'execute'])).rows[0].allowed, false);
      }
      assert.equal((await db.query(`select relrowsecurity from pg_class where oid='public.feedback_telegram_deliveries'::regclass`)).rows[0].relrowsecurity, true);
      assert.equal((await db.query(`select bool_and(not prosecdef) as invoker from pg_proc where proname in ('claim_feedback_telegram','finish_feedback_telegram','queue_feedback_telegram')`)).rows[0].invoker, true);
    });
    await test('real SQL authenticated role cannot bypass handler by calling private RPCs', async () => {
      await db.exec('set role authenticated');
      await assert.rejects(db.query('select public.claim_feedback_telegram($1,$2,true)', [feedbackId, userId]), /permission denied/);
      await assert.rejects(db.query('select * from public.feedback_telegram_deliveries'), /permission denied/);
      await db.exec('reset role');
    });
    await test('existing create_feedback still saves and queues as an authenticated user', async () => {
      const source = await readFile(new URL('20260922000000_roles_moderation_reports_support.sql', dir), 'utf8');
      const originalRpc = source.match(/create or replace function public\.create_feedback\(feedback_type text, message text, screenshot_url text default null\)[\s\S]*?\r?\n\$\$;/)?.[0];
      assert.ok(originalRpc, 'Use the existing save RPC without rewriting it');
      await db.exec(originalRpc);
      await db.exec('revoke all on function public.create_feedback(text,text,text) from public; grant execute on function public.create_feedback(text,text,text) to authenticated;');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
      await db.exec('set role authenticated');
      const saved = (await db.query("select public.create_feedback('feature','Existing RPC offline fixture',null) as id")).rows[0].id;
      await db.exec('reset role');
      assert.equal((await db.query('select status from public.feedback_telegram_deliveries where feedback_id=$1', [saved])).rows[0].status, 'queued');
      assert.equal((await db.query('select user_id from public.user_feedback where id=$1', [saved])).rows[0].user_id, userId);
    });
    await db.exec('set role service_role');
    await test('real SQL ownership check prevents claim by another authenticated user', async () => { assert.equal((await claim(feedbackId, claimToken)).delivery, 'not_found'); });
    await test('real SQL unconfigured feedback does not consume an attempt', async () => { assert.equal((await claim(feedbackId, userId, false)).delivery, 'unconfigured'); assert.equal((await db.query('select attempts from public.feedback_telegram_deliveries')).rows[0].attempts, 0); });
    let firstClaim;
    await test('real SQL grants one claim and suppresses a concurrent second sender', async () => { firstClaim = await claim(); assert.equal(firstClaim.delivery, 'claimed'); assert.equal((await claim()).delivery, 'queued'); });
    await test('real SQL receipt requires the matching lease and deduplicates success', async () => {
      assert.equal((await db.query("select public.finish_feedback_telegram($1,$2,'delivered',null,'71',60) as ok", [feedbackId, claimToken])).rows[0].ok, false);
      assert.equal((await db.query("select public.finish_feedback_telegram($1,$2,'delivered',null,'71',60) as ok", [feedbackId, firstClaim.claimToken])).rows[0].ok, true);
      assert.equal((await claim()).delivery, 'delivered');
      assert.equal((await db.query('select message from public.user_feedback')).rows[0].message, 'Offline fixture');
    });
    const secondId = '55555555-5555-4555-8555-555555555555';
    await db.exec('reset role');
    await db.query("insert into public.user_feedback(id,user_id,feedback_type,message) values ($1,$2,'problem','Second offline fixture')", [secondId, userId]);
    await db.exec('set role service_role');
    await claim(secondId);
    await db.query("update public.feedback_telegram_deliveries set lease_expires_at=now()-interval '1 second' where feedback_id=$1", [secondId]);
    await test('real SQL expired in-flight claim becomes ambiguous instead of sending again', async () => { assert.equal((await claim(secondId)).delivery, 'ambiguous'); assert.equal((await claim(secondId)).delivery, 'ambiguous'); });
    const retryId = '66666666-6666-4666-8666-666666666666';
    await db.exec('reset role');
    await db.query("insert into public.user_feedback(id,user_id,feedback_type,message) values ($1,$2,'support','Retry offline fixture')", [retryId, userId]);
    await db.exec('set role service_role');
    await test('real SQL failed delivery keeps original feedback and respects retry backoff', async () => {
      const attempt = await claim(retryId);
      assert.equal((await db.query("select public.finish_feedback_telegram($1,$2,'failed','telegram_429',null,75) as ok", [retryId, attempt.claimToken])).rows[0].ok, true);
      const queued = await claim(retryId); assert.equal(queued.delivery, 'queued'); assert.ok(queued.retryAfterSeconds >= 74);
      assert.equal((await db.query('select message from public.user_feedback where id=$1', [retryId])).rows[0].message, 'Retry offline fixture');
      await db.query("update public.feedback_telegram_deliveries set next_attempt_at=now()-interval '1 second' where feedback_id=$1", [retryId]);
      assert.equal((await claim(retryId)).delivery, 'claimed');
    });
    await test('real SQL exhausted feedback cannot consume a sixth delivery attempt', async () => {
      await db.query("update public.feedback_telegram_deliveries set status='failed',attempts=5,next_attempt_at=now()-interval '1 second' where feedback_id=$1", [retryId]);
      assert.equal((await claim(retryId)).delivery, 'queued');
      assert.equal((await db.query('select attempts,last_error_code from public.feedback_telegram_deliveries where feedback_id=$1', [retryId])).rows[0].last_error_code, 'retry_exhausted');
    });
    await test('real SQL per-user send limit protects against distinct-feedback spam', async () => {
      await db.exec('reset role');
      for (let index = 0; index < 4; index++) {
        const id = `77777777-7777-4777-8777-77777777777${index}`;
        await db.query("insert into public.user_feedback(id,user_id,feedback_type,message) values ($1,$2,'feature','Rate limit offline fixture')", [id, userId]);
      }
      await db.exec('set role service_role');
      assert.equal((await claim('77777777-7777-4777-8777-777777777770')).delivery, 'claimed');
      assert.equal((await claim('77777777-7777-4777-8777-777777777771')).delivery, 'claimed');
      assert.equal((await claim('77777777-7777-4777-8777-777777777772')).delivery, 'queued');
      assert.equal((await db.query("select attempts from public.feedback_telegram_deliveries where feedback_id='77777777-7777-4777-8777-777777777772'")).rows[0].attempts, 0);
    });
  } finally { await db.close(); }
}
console.log(`Feedback Telegram offline checks passed: ${count}. No real Telegram or production calls were made.`);
