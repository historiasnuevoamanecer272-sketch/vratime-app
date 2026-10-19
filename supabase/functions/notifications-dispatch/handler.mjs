import { notificationPayload } from './logic.mjs';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-scheduler-secret', 'access-control-allow-methods': 'POST,GET,OPTIONS' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const authorizedScheduler = (request, secret) => {
  if (!secret) return false;
  const candidate = request.headers.get('x-scheduler-secret') || request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  if (candidate.length !== secret.length) return false;
  let difference = 0;
  for (let index = 0; index < secret.length; index += 1) difference |= candidate.charCodeAt(index) ^ secret.charCodeAt(index);
  return difference === 0;
};
export async function smallBody(request) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 1024)) throw new Error('invalid_request');
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) { reader.cancel().catch(() => {}); throw new Error('invalid_request'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const body = text ? JSON.parse(text) : {};
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid_request');
  return body;
}

export function createNotificationHandler({ config, callRpc, send }) {
  const configured = Boolean(config.schedulerSecret && /^[A-Za-z0-9_-]{87}$/.test(config.publicKey || '') && /^[A-Za-z0-9_-]{43}$/.test(config.privateKey || '') && /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s/]+(?:\/.*)?)$/.test(config.subject || ''));
  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!['POST', 'GET'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
    let body;
    try {
      if (new URL(request.url).search) return json({ error: 'invalid_request' }, 400);
      body = request.method === 'GET' ? { action: 'config' } : await smallBody(request);
      if (Object.keys(body).some((key) => key !== 'action')) return json({ error: 'invalid_request' }, 400);
    } catch { return json({ error: 'invalid_request' }, 400); }
    if (body.action === 'config') return json({ configured, publicKey: configured ? config.publicKey : null });
    if (body.action !== 'dispatch' && body.action !== undefined) return json({ error: 'invalid_request' }, 400);
    if (!authorizedScheduler(request, config.schedulerSecret)) return json({ error: 'unauthorized' }, 401);
    if (!configured) return json({ error: 'push_not_configured' }, 503);
    try {
      const jobs = await callRpc('claim_notification_deliveries', { batch_limit: 10 });
      let accepted = 0, acknowledgmentFailures = 0;
      await Promise.all(jobs.map(async (job) => {
        let outcome;
        try { outcome = await send(job, notificationPayload(job)); } catch { outcome = { statusCode: 0 }; }
        try {
          const acknowledged = await callRpc('finish_notification_delivery', { delivery_id: job.id, claim_token: job.lease_token, status_code: outcome.statusCode });
          if (acknowledged && outcome.statusCode >= 200 && outcome.statusCode < 300) accepted += 1;
          if (!acknowledged) acknowledgmentFailures += 1;
        } catch { acknowledgmentFailures += 1; }
      }));
      return json({ status: acknowledgmentFailures ? 'retry_needed' : 'ok', processed: jobs.length, accepted, acknowledgmentFailures }, acknowledgmentFailures ? 503 : 200);
    } catch { return json({ error: 'notification_processing_unavailable' }, 503); }
  };
}
