const encoder = new TextEncoder();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const digestHex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
};

const secureEqual = (left: string, right: string) => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
};

const verifySignature = async (rawBody: string, signature: string, secret: string) => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)));
  const normalized = signature.trim().replace(/^sha256=/i, '');
  return secureEqual(normalized.toLowerCase(), bytesToHex(signed)) || secureEqual(normalized, bytesToBase64(signed));
};

const canonicalEventId = async (event: Record<string, unknown>, payload: Record<string, unknown>) => digestHex(JSON.stringify({
  name: event.name,
  created_at: event.created_at,
  donation_request_id: payload.donation_request_id,
  transaction_id: payload.transaction_id,
  trb_user_id: payload.trb_user_id,
  telegram_user_id: payload.telegram_user_id,
  amount: payload.amount,
  currency: payload.currency,
  period: payload.period,
}));

const supporterHash = async (payload: Record<string, unknown>, salt: string) => {
  const supporter = payload.trb_user_id || payload.telegram_user_id;
  return supporter ? digestHex(`${salt}:${String(supporter)}`) : null;
};

const minorUnitsToEurCents = async (amountMinor: number, currency: string) => {
  if (currency === 'eur') return amountMinor;
  const response = await fetch('https://open.er-api.com/v6/latest/EUR', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('FX service is unavailable');
  const rates = (await response.json())?.rates || {};
  const eurToCurrency = Number(rates[currency.toUpperCase()]);
  if (!Number.isFinite(eurToCurrency) || eurToCurrency <= 0) throw new Error(`Missing EUR rate for ${currency}`);
  return Math.round(amountMinor / eurToCurrency);
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const tributeSecret = Deno.env.get('TRIBUTE_API_KEY') || '';
  const supporterSalt = Deno.env.get('TRIBUTE_SUPPORTER_SALT') || tributeSecret;
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!tributeSecret || !supporterSalt || !supabaseUrl || !serviceRoleKey) return json({ error: 'Webhook is not configured' }, 503);

  const rawBody = await request.text();
  const signature = request.headers.get('trbt-signature') || '';
  if (!signature || !await verifySignature(rawBody, signature, tributeSecret)) return json({ error: 'Invalid signature' }, 401);

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (!['new_donation', 'recurrent_donation'].includes(String(event.name))) return json({ status: 'ignored' });
  const payload = event.payload as Record<string, unknown> | undefined;
  const amountMinor = Number(payload?.amount);
  const currency = String(payload?.currency || '').toLowerCase();
  const occurredAt = String(event.created_at || '');
  if (!payload || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !['eur', 'rub', 'usd'].includes(currency) || !Number.isFinite(Date.parse(occurredAt))) {
    return json({ error: 'Invalid donation payload' }, 400);
  }

  try {
    const grossEurCents = await minorUnitsToEurCents(amountMinor, currency);
    const feePercent = Math.min(100, Math.max(0, Number(Deno.env.get('TRIBUTE_FEE_PERCENT') || 10)));
    const netEurCents = Math.max(1, Math.round(grossEurCents * (1 - feePercent / 100)));
    const contribution = {
      provider: 'tribute',
      external_event_id: await canonicalEventId(event, payload),
      supporter_hash: await supporterHash(payload, supporterSalt),
      event_type: String(event.name),
      gross_amount_minor: amountMinor,
      original_currency: currency,
      net_amount_eur_cents: netEurCents,
      occurred_at: new Date(occurredAt).toISOString(),
    };

    const insert = await fetch(`${supabaseUrl}/rest/v1/support_contributions?on_conflict=external_event_id`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
        prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(contribution),
    });
    if (!insert.ok) throw new Error(`Database rejected contribution: ${insert.status}`);
    return json({ status: 'ok' });
  } catch (error) {
    console.error('Tribute webhook failed', error instanceof Error ? error.message : error);
    return json({ error: 'Could not record donation' }, 503);
  }
});
