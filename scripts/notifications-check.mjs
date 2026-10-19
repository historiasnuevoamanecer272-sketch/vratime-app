import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { createECDH, randomBytes, createPublicKey, verify } from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const subject = await import('../supabase/functions/notifications-dispatch/logic.mjs').catch((error) => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const matching = await import('../supabase/functions/daily-digest/matching.mjs').catch((error) => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const handlers = await import('../supabase/functions/notifications-dispatch/handler.mjs').catch((error) => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const dailyHandlers = await import('../supabase/functions/daily-digest/handler.mjs').catch((error) => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const browserPush = await import('../src/lib/pushPreferences.js').catch((error) => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
let failures = 0, passed = 0;
export const check = async (name, run) => {
  try { await run(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}: ${error.message}`); }
};
const browser = createECDH('prime256v1'); browser.generateKeys();
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-token', p256dh: browser.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };

await check('subscriptions accept real browser keys and only trusted HTTPS push service origins', () => {
  assert.equal(typeof subject.validateSubscription, 'function', 'strict push subscription validation is missing');
  for (const endpoint of [subscription.endpoint, 'https://updates.push.services.mozilla.com/wpush/v2/test-token', 'https://web.push.apple.com/test-token', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) assert.equal(subject.validateSubscription({ ...subscription, endpoint }), true, endpoint);
  for (const endpoint of ['http://fcm.googleapis.com/test', 'https://127.0.0.1/test', 'https://169.254.169.254/latest/meta-data', 'https://fcm.googleapis.com.evil.example/test', 'https://fcm.googleapis.com@127.0.0.1/test', 'https://fcm.googleapis.com:444/test', 'https://web.push.apple.com/test#secret', 'https://evil.example/test']) assert.equal(subject.validateSubscription({ ...subscription, endpoint }), false, endpoint);
  assert.equal(subject.validateSubscription({ ...subscription, auth: 'tiny' }), false);
  assert.equal(subject.validateSubscription({ ...subscription, p256dh: Buffer.concat([Buffer.from([3]), randomBytes(64)]).toString('base64url') }), false);
});

await check('push copy follows all five user languages and contains no private inbox payload', () => {
  assert.equal(typeof subject.notificationPayload, 'function', 'localized privacy-safe push payload is missing');
  const bodies = [];
  for (const language of ['ru', 'me', 'en', 'fr', 'de']) {
    const payload = subject.notificationPayload({ id: 'job-1', language, event_type: 'requested', body: 'CONTACT +12345', payload: { lat: 42.4, lng: 19.2, contact: 'PRIVATE' } });
    assert.equal(typeof payload.title, 'string'); assert.equal(typeof payload.body, 'string');
    assert.equal(payload.tag, 'vratime-job-1');
    assert.doesNotMatch(JSON.stringify(payload), /CONTACT|PRIVATE|12345|42\.4|19\.2/);
    bodies.push(payload.title);
  }
  assert.equal(new Set(bodies).size, 5);
  assert.equal(subject.notificationPayload({ id: 'job', language: 'unsupported', event_type: 'accepted' }).title, 'Request accepted');
});

await check('saved search matching respects type and normalized query across category languages', () => {
  assert.equal(typeof matching.findDigestMatches, 'function', 'real saved search matching is missing');
  const searches = [{ id: 's1', query: 'bouteilles', filters: { type: 'give' } }, { id: 's2', query: 'Gläser', filters: { type: 'lend' } }];
  const candidates = [
    { id: 'l1', saved_search_id: 's1', type: 'give', category_text: 'Glass jars Bouteilles' },
    { id: 'l2', saved_search_id: 's1', type: 'take', category_text: 'Bouteilles' },
    { id: 'l3', saved_search_id: 's2', type: 'lend', category_text: 'Glaser' },
    { id: 'l4', saved_search_id: 's2', type: 'give', category_text: 'Gläser' },
    { id: 'l5', saved_search_id: 's1', type: 'give', description: 'unrelated cardboard' },
  ];
  assert.deepEqual(matching.findDigestMatches(searches, candidates), [{ search_id: 's1', listing_id: 'l1' }, { search_id: 's2', listing_id: 'l3' }]);
});

await check('push config exposes only the public key; scheduler auth and request schema reject forged recipients', async () => {
  assert.equal(typeof handlers.createNotificationHandler, 'function', 'authenticated notification dispatcher is missing');
  const calls = [];
  const handler = handlers.createNotificationHandler({ config: { schedulerSecret: 'private-scheduler', publicKey: subscription.p256dh, privateKey: randomBytes(32).toString('base64url'), subject: 'mailto:operator@example.test' }, callRpc: async (...args) => { calls.push(args); return []; }, send: async () => ({ statusCode: 201 }) });
  const config = await (await handler(new Request('https://app.example/notifications', { method: 'POST', body: '{"action":"config"}' }))).json();
  assert.equal(config.publicKey, subscription.p256dh); assert.equal(config.configured, true);
  assert.doesNotMatch(JSON.stringify(config), /private-scheduler|privateKey/);
  assert.equal((await handler(new Request('https://app.example/notifications', { method: 'POST', body: '{"action":"dispatch"}' }))).status, 401);
  assert.equal((await handler(new Request('https://app.example/notifications', { method: 'POST', headers: { authorization: 'Bearer private-scheduler' }, body: '{"action":"dispatch","userId":"forged"}' }))).status, 400);
  assert.equal(calls.length, 0);
});

await check('dispatch acknowledges the exact provider outcome and does not claim unacknowledged success', async () => {
  assert.equal(typeof handlers.createNotificationHandler, 'function', 'notification acknowledgment handler is missing');
  const calls = [];
  const handler = handlers.createNotificationHandler({ config: { schedulerSecret: 'private-scheduler', publicKey: subscription.p256dh, privateKey: randomBytes(32).toString('base64url'), subject: 'mailto:operator@example.test' }, callRpc: async (name, body) => { calls.push({ name, body }); return name === 'claim_notification_deliveries' ? [{ id: 'delivery', lease_token: 'lease', ...subscription, language: 'en' }] : true; }, send: async () => ({ statusCode: 503 }) });
  const result = await (await handler(new Request('https://app.example/notifications', { method: 'POST', headers: { 'x-scheduler-secret': 'private-scheduler' }, body: '{"action":"dispatch"}' }))).json();
  assert.equal(result.accepted, 0);
  assert.deepEqual(calls.at(-1), { name: 'finish_notification_delivery', body: { delivery_id: 'delivery', claim_token: 'lease', status_code: 503 } });
});

await check('public request parsing caps UTF-8 bytes while streaming and rejects malformed JSON before any RPC', async () => {
  const calls = [];
  const handler = handlers.createNotificationHandler({ config: {}, callRpc: async (...args) => calls.push(args), send: async () => ({ statusCode: 201 }) });
  const request = (body, headers = {}) => new Request('https://app.example/notifications', { method: 'POST', body, headers, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) });
  assert.equal((await handler(request('{invalid'))).status, 400);
  assert.equal((await handler(request(JSON.stringify({ action: 'é'.repeat(600) })))).status, 400);
  let pulled = 0, canceled = false;
  const oversized = new ReadableStream({ pull(controller) { pulled += 1; if (pulled <= 4) controller.enqueue(new Uint8Array(600)); else controller.close(); }, cancel() { canceled = true; } });
  assert.equal((await handler(request(oversized))).status, 400);
  assert.equal(canceled, true, 'oversized input must cancel the stream instead of reading it to completion');
  assert.ok(pulled <= 3, 'the handler read past its small byte budget');
  const declared = new ReadableStream({ pull() { throw new Error('body must not be read'); } });
  assert.equal((await handler(request(declared, { 'content-length': '99999999' }))).status, 400);
  assert.equal(calls.length, 0);
});

await check('daily digest uses matching results and returns processing failures to the leased job for retry', async () => {
  assert.equal(typeof dailyHandlers.createDailyDigestHandler, 'function', 'reliable daily digest handler is missing');
  const calls = [];
  const handler = dailyHandlers.createDailyDigestHandler({ schedulerSecret: 'digest-private', callRpc: async (name, body) => {
    calls.push({ name, body });
    if (name === 'claim_daily_digest_jobs') return [{ id: 'digest', lease_token: 'lease', searches: [{ id: 'search', query: 'glass', filters: { type: 'give' } }], candidates: [{ id: 'listing', saved_search_id: 'search', type: 'give', category_text: 'glass' }] }];
    if (name === 'finish_daily_digest_job' && !body.error_code) throw new Error('database temporarily unavailable');
    return true;
  } });
  const response = await handler(new Request('https://app.example/daily-digest', { method: 'POST', headers: { authorization: 'Bearer digest-private' } }));
  assert.equal(response.status, 503);
  const attempts = calls.filter((call) => call.name === 'finish_daily_digest_job');
  assert.deepEqual(attempts[0].body.matches, [{ search_id: 'search', listing_id: 'listing' }]);
  assert.equal(attempts[1].body.error_code, 'processing_failed');
  assert.equal((await handler(new Request('https://app.example/daily-digest', { method: 'POST', headers: { authorization: 'Bearer digest-private' }, body: '{"user_id":"forged"}' }))).status, 400);
});

function browserFixture() {
  const calls = []; let subscribed = false;
  const sub = { endpoint: subscription.endpoint, toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }), unsubscribe: async () => { subscribed = false; calls.push('unsubscribe'); return true; } };
  const registration = { active: { postMessage: (_message, ports) => ports[0].postMessage({ ready: true, version: 1 }) }, pushManager: { getSubscription: async () => subscribed ? sub : null, subscribe: async (options) => { calls.push({ subscribe: options }); subscribed = true; return sub; } } };
  const memory = new Map();
  const environment = { isSecureContext: true, MessageChannel, PushManager: function() {}, Notification: { permission: 'default', requestPermission: async () => { calls.push('permission'); return 'granted'; } }, navigator: { userAgent: 'Chromium test', serviceWorker: { getRegistration: async () => registration } }, matchMedia: () => ({ matches: false }), localStorage: { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) } };
  const api = { getMyPushStatus: async () => ({ enabled: subscribed }), registerPushSubscription: async () => { calls.push('register'); return 'sub-id'; }, disablePushSubscription: async () => { calls.push('disable'); return true; } };
  return { environment, api, calls, registration };
}
await check('reading preferences never requests permission and iOS requires an installed app before opting in', async () => {
  assert.equal(typeof browserPush.readPushPreference, 'function', 'explicit browser opt-in helper is missing');
  const fixture = browserFixture();
  await browserPush.readPushPreference({ userId: 'owner', ...fixture });
  assert.deepEqual(fixture.calls, []);
  fixture.environment.navigator.userAgent = 'iPhone';
  const result = await browserPush.enablePushPreference({ userId: 'owner', config: { configured: true, publicKey: subscription.p256dh }, ...fixture });
  assert.equal(result.state, 'installRequired'); assert.deepEqual(fixture.calls, []);
});
await check('explicit opt-in requests permission before awaiting browser work and registers only after subscription succeeds', async () => {
  assert.equal(typeof browserPush.enablePushPreference, 'function', 'browser subscription lifecycle is missing');
  const fixture = browserFixture();
  const result = await browserPush.enablePushPreference({ userId: 'owner', config: { configured: true, publicKey: subscription.p256dh }, ...fixture });
  assert.equal(fixture.calls[0], 'permission');
  assert.equal(result.enabled, true);
  assert.equal(fixture.calls.at(-1), 'register');
  assert.equal(fixture.calls.find((call) => call.subscribe).subscribe.userVisibleOnly, true);
});
await check('an old service worker cannot create subscriptions until its visible notification handler is ready', async () => {
  const fixture = browserFixture();
  fixture.registration.active = null;
  assert.equal((await browserPush.readPushPreference({ userId: 'owner', ...fixture })).state, 'workerUnavailable');
  assert.equal((await browserPush.enablePushPreference({ userId: 'owner', config: { configured: true, publicKey: subscription.p256dh }, ...fixture })).state, 'workerUnavailable');
  assert.ok(!fixture.calls.some((call) => call.subscribe || call === 'register'));
  fixture.registration.active = { postMessage: (_message, ports) => ports[0].postMessage({ ready: true, version: 0 }) };
  assert.equal((await browserPush.enablePushPreference({ userId: 'owner', config: { configured: true, publicKey: subscription.p256dh }, ...fixture })).state, 'workerUnavailable');
});
await check('auth changes or registration failures unsubscribe a new browser subscription instead of claiming enabled', async () => {
  assert.equal(typeof browserPush.enablePushPreference, 'function', 'subscription failure cleanup is missing');
  for (const mode of ['auth', 'network']) {
    const fixture = browserFixture(); let current = true;
    fixture.registration.pushManager.subscribe = async () => { if (mode === 'auth') current = false; return { endpoint: subscription.endpoint, toJSON: () => ({}), unsubscribe: async () => { fixture.calls.push('unsubscribe'); return true; } }; };
    if (mode === 'network') fixture.api.registerPushSubscription = async () => { throw new Error('offline'); };
    await assert.rejects(browserPush.enablePushPreference({ userId: 'owner', config: { configured: true, publicKey: subscription.p256dh }, isCurrent: () => current, ...fixture }));
    assert.ok(fixture.calls.includes('unsubscribe'));
  }
});
await check('logout and an account switch retire the previous subscription with the captured owner bearer', async () => {
  assert.equal(typeof browserPush.retirePushForAccountChange, 'function');
  for (const nextSession of [null, { user: { id: 'other' }, access_token: 'other-bearer' }]) {
    const fixture = browserFixture();
    await browserPush.enablePushPreference({ userId: 'owner', config: { configured: true, publicKey: subscription.p256dh }, ...fixture });
    const previousSession = { user: { id: 'owner' }, access_token: 'previous-owner-bearer' };
    fixture.api.disablePushSubscriptionForSession = async (endpoint, session) => { fixture.calls.push({ retire: endpoint, session }); return true; };
    const outcome = await browserPush.retirePushForAccountChange({ previousSession, nextSession, ...fixture });
    assert.equal(outcome.localDisabled, true); assert.equal(outcome.serverDisabled, true);
    assert.ok(fixture.calls.includes('unsubscribe'));
    assert.deepEqual(fixture.calls.find((call) => call.retire), { retire: subscription.endpoint, session: previousSession });
  }
});
await check('same-account token refresh keeps subscriptions; failed retirement still turns off this browser before another opt-in', async () => {
  const fixture = browserFixture();
  await browserPush.enablePushPreference({ userId: 'owner', config: { configured: true, publicKey: subscription.p256dh }, ...fixture });
  const previousSession = { user: { id: 'owner' }, access_token: 'previous-owner-bearer' };
  const before = fixture.calls.length;
  fixture.api.disablePushSubscriptionForSession = async () => { throw new Error('offline'); };
  assert.equal((await browserPush.retirePushForAccountChange({ previousSession, nextSession: { user: { id: 'owner' }, access_token: 'refreshed-bearer' }, ...fixture })).changed, false);
  assert.equal(fixture.calls.length, before);
  const retiring = browserPush.retirePushForAccountChange({ previousSession, nextSession: { user: { id: 'other' } }, ...fixture });
  const enabling = browserPush.enablePushPreference({ userId: 'other', config: { configured: true, publicKey: subscription.p256dh }, ...fixture });
  const outcome = await retiring;
  assert.equal(outcome.localDisabled, true); assert.equal(outcome.serverDisabled, false);
  assert.equal((await enabling).enabled, true);
  assert.ok(fixture.calls.indexOf('unsubscribe') < fixture.calls.findLastIndex((call) => call.subscribe));
});
await check('a delayed retirement never unsubscribes or removes the binding of a new account subscription', async () => {
  const fixture = browserFixture();
  await browserPush.enablePushPreference({ userId: 'owner', config: { configured: true, publicKey: subscription.p256dh }, ...fixture });
  let release;
  fixture.environment.navigator.serviceWorker.getRegistration = () => new Promise((resolve) => { release = resolve; });
  fixture.api.disablePushSubscriptionForSession = async () => true;
  const retiring = browserPush.retirePushForAccountChange({ previousSession: { user: { id: 'owner' }, access_token: 'previous-owner-bearer' }, nextSession: { user: { id: 'other' } }, ...fixture });
  await new Promise((resolve) => setImmediate(resolve));
  let wrongUnsubscribe = false;
  const newEndpoint = 'https://web.push.apple.com/new-owner-subscription';
  fixture.environment.localStorage.setItem('vratime-push-owner-v1', JSON.stringify({ userId: 'other', endpoint: newEndpoint }));
  fixture.registration.pushManager.getSubscription = async () => ({ endpoint: newEndpoint, unsubscribe: async () => { wrongUnsubscribe = true; return true; } });
  release(fixture.registration);
  assert.equal((await retiring).localDisabled, false);
  assert.equal(wrongUnsubscribe, false);
  assert.equal(JSON.parse(fixture.environment.localStorage.getItem('vratime-push-owner-v1')).userId, 'other');
});
await check('account retirement works with blocked storage and a restored subscription without an owner marker', async () => {
  for (const restored of [false, true]) {
    const fixture = browserFixture();
    fixture.environment.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    await browserPush.enablePushPreference({ userId: 'owner', config: { configured: true, publicKey: subscription.p256dh }, ...fixture });
    const environment = restored ? { ...fixture.environment } : fixture.environment;
    fixture.api.disablePushSubscriptionForSession = async () => true;
    const outcome = await browserPush.retirePushForAccountChange({ previousSession: { user: { id: 'owner' }, access_token: 'previous-owner-bearer' }, nextSession: null, ...fixture, environment });
    assert.equal(outcome.localDisabled, true); assert.equal(outcome.serverDisabled, true);
    assert.ok(fixture.calls.includes('unsubscribe'));
  }
});

await check('the actual service worker shows visible fallback notifications and only opens the app scope', async () => {
  const listeners = {}, notices = [], navigation = [];
  const self = { addEventListener: (name, listener) => { listeners[name] = listener; }, registration: { scope: 'https://app.example/vratime/', showNotification: async (title, options) => notices.push({ title, options }) }, clients: { matchAll: async () => [{ url: 'https://evil.example/', focus: async () => navigation.push('foreign') }], openWindow: async (url) => navigation.push(url) } };
  vm.runInNewContext(readFileSync(new URL('../public/push-notifications.js', import.meta.url), 'utf8'), { self, URL });
  let wait;
  listeners.push({ data: { json() { throw new Error('malformed'); } }, waitUntil: (promise) => { wait = promise; } });
  await wait;
  assert.equal(notices[0].title, 'VratiMe'); assert.equal(notices[0].options.body, 'Open VratiMe for details.');
  assert.equal(notices[0].options.icon, 'https://app.example/vratime/app-logo-192.png');
  listeners.notificationclick({ notification: { data: { url: 'https://evil.example/' }, close() {} }, waitUntil: (promise) => { wait = promise; } });
  await wait; assert.deepEqual(navigation, ['https://app.example/vratime/']);
  self.clients.matchAll = async () => [{ url: 'https://app.example/vratime/', focus: async () => navigation.push('focused') }];
  listeners.notificationclick({ notification: { close() {} }, waitUntil: (promise) => { wait = promise; } }); await wait;
  assert.equal(navigation.at(-1), 'focused');
  const messages = [];
  listeners.message({ data: { type: 'VRATIME_PUSH_READY' }, ports: [{ postMessage: (message) => messages.push(message) }] });
  assert.equal(messages[0].version, 1);
});

const apiUrl = new URL('../src/lib/api.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === apiUrl && specifier === '../supabaseClient') return { url: 'notification-api-test:supabase', shortCircuit: true };
    if (context.parentURL?.startsWith(new URL('../src/', import.meta.url).href) && specifier.startsWith('.') && !path.extname(specifier)) return next(`${specifier}.js`, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'notification-api-test:supabase') return { format: 'module', shortCircuit: true, source: `
      export const state = { session: { user: { id: 'owner' }, access_token: 'owner-session-token' }, calls: [], error: null, beforeResult: null };
      export const supabase = {
        auth: { getSession: async () => ({ data: { session: state.session }, error: null }) },
        functions: { invoke: async (name, options) => { state.calls.push({ name, ...options }); return { data: { configured: true, publicKey: 'public-key' }, error: null }; } },
        rpc(name, params) {
          const call = { name, params, headers: {} }; state.calls.push(call);
          const builder = { setHeader(key, value) { call.headers[key] = value; return builder; }, abortSignal(signal) { call.signal = signal; return builder; }, then(resolve, reject) { state.beforeResult?.(); return Promise.resolve({ data: { enabled: true }, error: state.error }).then(resolve, reject); } };
          return builder;
        },
      };
    ` };
    return next(url, context);
  },
});
try {
  const api = await import('../src/lib/api.js');
  const { state } = await import('notification-api-test:supabase');
  await check('push API rejects a changed or absent account and aborted work before making any RPC', async () => {
    state.calls.length = 0;
    state.session = { user: { id: 'other' }, access_token: 'other-session-token' };
    await assert.rejects(api.getMyPushStatus(subscription.endpoint, { expectedUserId: 'owner' }), /push_auth_changed/);
    state.session = null;
    await assert.rejects(api.disablePushSubscription(subscription.endpoint, { expectedUserId: 'owner' }), /push_auth_changed/);
    state.session = { user: { id: 'owner' }, access_token: 'owner-session-token' };
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api.getMyPushStatus(subscription.endpoint, { expectedUserId: 'owner', signal: controller.signal }), /push_auth_changed/);
    await assert.rejects(api.getMyPushStatus(subscription.endpoint), /push_auth_changed/);
    assert.equal(state.calls.length, 0);
  });
  await check('push API pins the expected bearer, sends no recipient and discards canceled responses', async () => {
    state.calls.length = 0;
    const controller = new AbortController();
    state.beforeResult = () => { state.session = { user: { id: 'other' }, access_token: 'other-session-token' }; };
    await api.registerPushSubscription({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth }, user_id: 'forged' }, { expectedUserId: 'owner', signal: controller.signal });
    assert.deepEqual(state.calls[0], { name: 'register_push_subscription', params: { push_endpoint: subscription.endpoint, push_p256dh: subscription.p256dh, push_auth: subscription.auth }, headers: { Authorization: 'Bearer owner-session-token' }, signal: controller.signal });
    state.session = { user: { id: 'owner' }, access_token: 'owner-session-token' };
    state.beforeResult = () => controller.abort();
    await assert.rejects(api.disablePushSubscription(subscription.endpoint, { expectedUserId: 'owner', signal: controller.signal }), /push_auth_changed/);
    state.beforeResult = null;
  });
  await check('public config requests only metadata and database errors do not expose subscription or credential details', async () => {
    state.calls.length = 0;
    await api.getPushPublicConfig();
    assert.deepEqual(state.calls, [{ name: 'notifications-dispatch', body: { action: 'config' } }]);
    state.error = new Error('private-session-token endpoint-and-keys');
    await assert.rejects(api.getMyPushStatus(subscription.endpoint, { expectedUserId: 'owner' }), (error) => error.message === 'push_request_failed');
    state.error = null;
  });
  await check('retirement API uses the previous snapshot bearer even after global auth belongs to another account', async () => {
    assert.equal(typeof api.disablePushSubscriptionForSession, 'function');
    state.calls.length = 0;
    state.session = { user: { id: 'other' }, access_token: 'new-owner-bearer' };
    await api.disablePushSubscriptionForSession(subscription.endpoint, { user: { id: 'owner' }, access_token: 'previous-owner-bearer' });
    assert.deepEqual(state.calls, [{ name: 'disable_push_subscription', params: { push_endpoint: subscription.endpoint }, headers: { Authorization: 'Bearer previous-owner-bearer' } }]);
  });
} finally { hooks.deregister(); }

const pushTools = process.argv.find((arg) => arg.startsWith('--push-tools='))?.slice('--push-tools='.length);
if (pushTools) {
  const require = createRequire(path.resolve(pushTools, 'package.json'));
  const webpush = require('web-push'), ece = require('http_ece');
  const vapid = { ...webpush.generateVAPIDKeys(), subject: 'mailto:operator@example.test' };
  await check('real pinned web-push produces decryptable aes128gcm data and a valid ES256 VAPID signature', async () => {
    assert.equal(typeof subject.createPushSender, 'function', 'encrypted Web Push sender is missing');
    let request;
    const send = subject.createPushSender(webpush, vapid, async (url, options) => { request = { url, ...options }; return new Response('', { status: 201 }); });
    const payload = subject.notificationPayload({ id: 'cryptographic-job', language: 'en', event_type: 'handover' });
    assert.deepEqual(await send(subscription, payload), { statusCode: 201 });
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
    const clear = ece.decrypt(Buffer.from(request.body), { version: 'aes128gcm', privateKey: browser, authSecret: Buffer.from(subscription.auth, 'base64url') }).toString();
    assert.deepEqual(JSON.parse(clear), payload);
    assert.ok(!Buffer.from(request.body).includes(Buffer.from(payload.body)));
    const authorization = request.headers.Authorization;
    const jwt = authorization.match(/t=([^, ]+)/)[1];
    const [header, body, signature] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(body, 'base64url'));
    assert.equal(claims.aud, 'https://fcm.googleapis.com');
    assert.equal(claims.sub, vapid.subject);
    const raw = Buffer.from(vapid.publicKey, 'base64url');
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.equal(verify('sha256', Buffer.from(`${header}.${body}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
  });
  await check('provider rejection or transport failure never reports a successful push acknowledgment', async () => {
    for (const status of [410, 429, 503]) {
      const send = subject.createPushSender(webpush, vapid, async () => new Response('', { status }));
      assert.deepEqual(await send(subscription, {}), { statusCode: status });
    }
    const send = subject.createPushSender(webpush, vapid, async () => { throw new Error('network unavailable'); });
    assert.deepEqual(await send(subscription, {}), { statusCode: 0 });
  });
} else console.log('SKIP crypto checks: pass --push-tools=/absolute/path/to/private-push-tools.');

if (failures) process.exitCode = 1;
else console.log(`Notifications logic: ${passed} checks passed. No push provider or live account was contacted.`);
