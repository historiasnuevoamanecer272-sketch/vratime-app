import assert from 'node:assert/strict';

const encoder = new TextEncoder();
const secret = 'test-tribute-secret';
let handler;
let insertedContribution;

globalThis.Deno = {
  env: {
    get(name) {
      return {
        TRIBUTE_API_KEY: secret,
        TRIBUTE_SUPPORTER_SALT: 'test-supporter-salt',
        TRIBUTE_FEE_PERCENT: '10',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      }[name];
    },
  },
  serve(callback) {
    handler = callback;
  },
};

globalThis.fetch = async (url, options = {}) => {
  assert.match(String(url), /\/rest\/v1\/support_contributions\?on_conflict=external_event_id$/);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.prefer, 'resolution=ignore-duplicates,return=minimal');
  insertedContribution = JSON.parse(options.body);
  return new Response(null, { status: 201 });
};

await import('../supabase/functions/tribute-webhook/index.ts');
assert.equal(typeof handler, 'function');

const payload = {
  name: 'new_donation',
  created_at: '2026-09-20T10:15:00.000Z',
  sent_at: '2026-09-20T10:15:01.000Z',
  payload: {
    donation_request_id: 42,
    amount: 5000,
    currency: 'eur',
    period: 'onetime',
    trb_user_id: 'T-private-user',
    telegram_username: 'must-not-be-stored',
  },
};
const rawBody = JSON.stringify(payload);
const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const signatureBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)));
const signature = Array.from(signatureBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const rejected = await handler(new Request('https://example.supabase.co/functions/v1/tribute-webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'trbt-signature': 'invalid' },
  body: rawBody,
}));
assert.equal(rejected.status, 401);

const accepted = await handler(new Request('https://example.supabase.co/functions/v1/tribute-webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'trbt-signature': signature },
  body: rawBody,
}));
assert.equal(accepted.status, 200);
assert.equal(insertedContribution.net_amount_eur_cents, 4500);
assert.equal(insertedContribution.gross_amount_minor, 5000);
assert.equal(insertedContribution.original_currency, 'eur');
assert.equal(insertedContribution.event_type, 'new_donation');
assert.match(insertedContribution.external_event_id, /^[a-f0-9]{64}$/);
assert.match(insertedContribution.supporter_hash, /^[a-f0-9]{64}$/);
assert.equal('telegram_username' in insertedContribution, false);
assert.equal('trb_user_id' in insertedContribution, false);

process.stdout.write('Tribute webhook signature, fee and privacy checks passed.\n');
