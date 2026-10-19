import { BUCKETS, MediaError, OUTPUT_LIMITS, UUID, inspectImage, readBounded } from './validation.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-media-kind, x-operation-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store',
};
const reply = (status, value) => new Response(value == null ? null : JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function createMediaUploadHandler({ env, processImage, fetchImpl = globalThis.fetch }) {
  const base = String(env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY, secret = env.SUPABASE_SERVICE_ROLE_KEY;
  let busy = false;
  const adminHeaders = () => ({ apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' });
  async function rpc(name, args) {
    const res = await fetchImpl(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify(args), redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new MediaError('media_service_unavailable', 503);
    return res.json();
  }
  return async function upload(request) {
    if (request.method === 'OPTIONS') return reply(204, null);
    if (request.method !== 'POST') return reply(405, { error: 'media_method_not_allowed' });
    const authorization = request.headers.get('authorization') ?? '';
    if (!/^Bearer [^\s]+$/i.test(authorization) || authorization.length > 8192) return reply(401, { error: 'media_unauthorized' });
    if (!base || !anonKey || !secret || !processImage) return reply(503, { error: 'media_service_unavailable' });
    let user;
    try {
      const res = await fetchImpl(`${base}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (res.status === 401 || res.status === 403) return reply(401, { error: 'media_unauthorized' });
      if (!res.ok) return reply(503, { error: 'media_service_unavailable' });
      user = await res.json();
      if (!UUID.test(user?.id ?? '') || user.is_anonymous === true) return reply(401, { error: 'media_unauthorized' });
    } catch { return reply(503, { error: 'media_service_unavailable' }); }

    // Limit memory retained by slow readers and simultaneous decodes in one isolate.
    if (busy) return reply(429, { error: 'media_busy' });
    busy = true;
    let reserved;
    try {
      const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (type === 'application/json') {
        let body;
        try { body = JSON.parse(new TextDecoder().decode(await readBounded(request, 512))); } catch (error) { if (error instanceof MediaError) throw error; throw new MediaError('media_invalid_request'); }
        if (body?.action !== 'sign' || !UUID.test(body.assetId ?? '') || Object.keys(body).some((key) => !['action', 'assetId'].includes(key))) throw new MediaError('media_invalid_request');
        const asset = await rpc('media_private_asset', { expected_user_id: user.id, target_asset_id: body.assetId });
        if (!asset?.path || asset.bucket !== BUCKETS.feedback) throw new MediaError('media_private_access_denied', 404);
        const res = await fetchImpl(`${base}/storage/v1/object/sign/${asset.bucket}/${asset.path}`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ expiresIn: 300 }), redirect: 'error', signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new MediaError('media_service_unavailable', 503);
        const signed = await res.json();
        const signedPath = signed.signedURL ?? signed.signedUrl;
        if (typeof signedPath !== 'string') throw new MediaError('media_service_unavailable', 503);
        const url = new URL(signedPath.startsWith('/object/sign/') ? `${base}/storage/v1${signedPath}` : signedPath, `${base}/storage/v1/`);
        if (url.origin !== new URL(base).origin || !url.pathname.startsWith('/storage/v1/object/sign/FEEDBACK-ATTACHMENTS/')) throw new MediaError('media_service_unavailable', 503);
        return reply(200, { url: url.href, expiresIn: 300 });
      }
      const kind = request.headers.get('x-media-kind'), operationId = request.headers.get('x-operation-id');
      if (!Object.hasOwn(BUCKETS, kind) || !UUID.test(operationId ?? '')) throw new MediaError('media_invalid_request');
      const bytes = await readBounded(request);
      inspectImage(bytes, type);
      const hash = await sha256(bytes);
      reserved = await rpc('media_reserve_upload', { expected_user_id: user.id, upload_operation_id: operationId, media_kind: kind, input_hash: hash });
      if (reserved?.status === 'complete') return reply(200, { url: reserved.url, path: reserved.path, assetId: reserved.assetId });
      if (!['reserved','reconcile'].includes(reserved?.status) || !reserved.claimToken) {
        const code = reserved?.error ?? 'media_upload_in_progress';
        throw new MediaError(code, code === 'media_quota_exceeded' || code === 'media_rate_limit' ? 429 : 409);
      }
      const url = kind === 'feedback' ? `media:${reserved.assetId}` : `${base}/storage/v1/object/public/${BUCKETS[kind]}/${reserved.path}`;
      async function finish(outputBytes) {
        const complete = await rpc('media_complete_upload', { expected_user_id: user.id, target_asset_id: reserved.assetId, claim_token: reserved.claimToken, output_bytes: outputBytes, output_url: url });
        if (complete?.status !== 'complete') throw new MediaError('media_upload_pending', 503);
        return reply(200, { url: complete.url, path: complete.path, assetId: complete.assetId });
      }
      async function verifyStored(expectedHash, expectedBytes) {
        const stored = await fetchImpl(`${base}/storage/v1/object/${BUCKETS[kind]}/${reserved.path}`, { headers: { apikey: secret, Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
        if (!stored.ok) throw new MediaError('media_reconciliation_required', 503);
        const storedBytes = await readBounded(stored, OUTPUT_LIMITS[kind]);
        if (storedBytes.length !== expectedBytes || await sha256(storedBytes) !== expectedHash) throw new MediaError('media_reconciliation_required', 503);
        inspectImage(storedBytes,'image/jpeg');
        return finish(storedBytes.length);
      }
      if (reserved.status === 'reconcile') return await verifyStored(reserved.outputHash,reserved.outputBytes);
      const output = await processImage(bytes, kind, type);
      if (!(output?.bytes instanceof Uint8Array) || output.contentType !== 'image/jpeg' || output.bytes.length > OUTPUT_LIMITS[kind]) throw new MediaError('media_invalid_output', 500);
      const validSize = kind === 'avatar' ? output.width === 512 && output.height === 512 : Math.max(output.width, output.height) <= 1600;
      if (!validSize) throw new MediaError('media_invalid_output', 500);
      const outputHash = await sha256(output.bytes);
      const prepared = await rpc('media_prepare_upload', { expected_user_id: user.id, target_asset_id: reserved.assetId, claim_token: reserved.claimToken, output_bytes: output.bytes.length, output_hash: outputHash });
      if (prepared?.status !== 'prepared') throw new MediaError(prepared?.error ?? 'media_upload_pending',409);
      const res = await fetchImpl(`${base}/storage/v1/object/${BUCKETS[kind]}/${reserved.path}`, {
        method: 'POST', headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'Cache-Control': kind === 'feedback' ? 'private, no-store' : 'max-age=31536000' },
        body: output.bytes, redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        // Another expired worker may have won the immutable insert, or an upload
        // may have succeeded before Storage returned an error. Never overwrite it.
        if (res.status === 409 || res.status >= 500) return await verifyStored(outputHash,output.bytes.length);
        throw new MediaError('media_storage_unavailable',503);
      }
      return await finish(output.bytes.length);
    } catch (error) {
      // SQL releases a failed lease only when no object exists. A late write is
      // still harmless: the deterministic path and persisted hash cannot change.
      if (reserved?.claimToken) {
        try { await rpc('media_fail_upload', { expected_user_id: user.id, target_asset_id: reserved.assetId, claim_token: reserved.claimToken }); } catch { /* Bounded lease also releases reserved capacity. */ }
      }
      return reply(error instanceof MediaError ? error.status : 503, { error: error instanceof MediaError ? error.code : 'media_service_unavailable' });
    } finally { busy = false; }
  };
}
