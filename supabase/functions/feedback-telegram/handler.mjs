const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY_LIMIT = 1024;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function reply(status, data) {
  return new Response(data === null ? null : JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function boundedJson(request) {
  if (Number(request.headers.get('content-length')) > BODY_LIMIT) throw new RangeError('body_size');
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('body');
  const parts = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > BODY_LIMIT) { await reader.cancel(); throw new RangeError('body_size'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function screenshotLink(value, base, userId) {
  if (typeof value !== 'string' || value.length > 700) return '';
  try {
    const url = new URL(value);
    const expected = new URL(base);
    const prefix = `/storage/v1/object/public/LISTING-PHOTOS/${userId}/feedback/`;
    if (url.origin !== expected.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) return '';
    if (!/^[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname.slice(prefix.length))) return '';
    return url.href;
  } catch { return ''; }
}

function telegramText(feedback, base, privateScreenshot = '') {
  const types = { feature: 'Идея / функция', category: 'Категория / предмет', problem: 'Проблема', support: 'Поддержка' };
  const message = String(feedback.message ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const screenshot = privateScreenshot || screenshotLink(feedback.screenshot_url, base, feedback.user_id);
  const heading = `VratiMe — новый отзыв\nID: ${feedback.id}\nАвтор: ${feedback.user_id}\nТип: ${types[feedback.feedback_type] ?? 'Отзыв'}\nДата: ${feedback.created_at}\n\n`;
  const suffix = screenshot ? `\n\nСкриншот: ${screenshot}` : String(feedback.screenshot_url || '').startsWith('media:') ? '\n\nСкриншот сохранён в приложении; временная ссылка сейчас недоступна.' : '';
  const available = 4096 - heading.length - suffix.length;
  const clipped = message.length > available ? `${message.slice(0, Math.max(0, available - 1)).replace(/[\uD800-\uDBFF]$/, '')}…` : message;
  return `${heading}${clipped}${suffix}`;
}

/** Uses only built-in fetch. Injecting the HTTP boundary keeps offline tests off real services. */
export function createFeedbackTelegramDelivery({ env, fetchImpl = globalThis.fetch }) {
  const base = String(env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = env.TELEGRAM_BOT_TOKEN ?? '';
  const chatId = env.TELEGRAM_CHAT_ID ?? '';
  const configured = /^\d+:[A-Za-z0-9_-]+$/.test(botToken) && /^[1-9]\d{0,19}$/.test(chatId);

  async function rpc(name, args) {
    const response = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (!response.ok) throw new Error('database_unavailable');
    return response.json();
  }

  async function privateScreenshot(feedback) {
    const assetId = String(feedback.screenshot_url || '').replace(/^media:/, '');
    if (!String(feedback.screenshot_url || '').startsWith('media:') || !UUID.test(assetId)) return '';
    try {
      const asset = await rpc('media_private_asset', {expected_user_id:feedback.user_id,target_asset_id:assetId});
      if (asset?.bucket !== 'FEEDBACK-ATTACHMENTS' || typeof asset.path !== 'string' || !asset.path.startsWith(`${feedback.user_id}/`) || !/^[a-zA-Z0-9/_\-.]+$/.test(asset.path) || asset.path.includes('..')) return '';
      const path = asset.path.split('/').map(encodeURIComponent).join('/');
      const response = await fetchImpl(`${base}/storage/v1/object/sign/FEEDBACK-ATTACHMENTS/${path}`, {
        method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300}),signal:AbortSignal.timeout(8000),redirect:'error',
      });
      if (!response.ok) return '';
      const result = await response.json();
      const signed = result.signedURL || result.signedUrl;
      if (typeof signed !== 'string') return '';
      const url = new URL(signed.startsWith('/object/') ? `${base}/storage/v1${signed}` : signed, base);
      if (url.origin !== new URL(base).origin || url.username || url.password || url.pathname !== `/storage/v1/object/sign/FEEDBACK-ATTACHMENTS/${path}` || !url.searchParams.get('token') || url.href.length>1200) return '';
      return url.href;
    } catch { return ''; }
  }

  // IDs here come only from the user endpoint's Auth result or the worker's
  // service-only queue rows. This factory is not itself an HTTP endpoint.
  return async function deliverFeedback(feedbackId,userId) {
    if(!base||!serviceKey||!UUID.test(feedbackId??'')||!UUID.test(userId??''))return reply(503,{error:'temporarily_unavailable'});
    const user={id:userId};
    let claimed;
    try { claimed = await rpc('claim_feedback_telegram', { target_feedback_id: feedbackId, expected_user_id: user.id, is_configured: configured }); }
    catch { return reply(503, { error: 'temporarily_unavailable' }); }
    if (claimed?.delivery === 'not_found') return reply(404, { error: 'not_found' });
    if (claimed?.delivery === 'delivered') return reply(200, { feedbackId, delivery: 'delivered', duplicate: true });
    if (['queued', 'unconfigured', 'ambiguous'].includes(claimed?.delivery)) {
      const retryAfterSeconds = Number(claimed.retryAfterSeconds);
      return reply(202, { feedbackId, delivery: claimed.delivery, ...(Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0 ? { retryAfterSeconds } : {}) });
    }
    if (!configured || claimed?.delivery !== 'claimed' || !UUID.test(claimed.claimToken ?? '') || claimed.feedback?.id !== feedbackId || claimed.feedback?.user_id !== user.id) return reply(503, { error: 'temporarily_unavailable' });
    const signedScreenshot = await privateScreenshot(claimed.feedback);

    const receipt = {
      target_feedback_id: feedbackId, claim_token: claimed.claimToken,
      outcome: 'ambiguous', error_code: 'telegram_acknowledgement_unknown', telegram_message_id: null, retry_after_seconds: 60,
    };
    try {
      const telegramResponse = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ chat_id: chatId, text: telegramText(claimed.feedback, base, signedScreenshot), link_preview_options: { is_disabled: true } }),
      });
      const telegram = await telegramResponse.json();
      if (telegramResponse.ok && telegram?.ok === true && Number.isSafeInteger(telegram.result?.message_id) && telegram.result.message_id > 0) {
        receipt.outcome = 'delivered'; receipt.error_code = null; receipt.telegram_message_id = String(telegram.result.message_id);
      } else if (telegram?.ok === false && Number.isInteger(telegram.error_code)) {
        receipt.outcome = 'failed'; receipt.error_code = `telegram_${Math.max(100, Math.min(599, telegram.error_code))}`;
        const delay = Number(telegram.parameters?.retry_after);
        receipt.retry_after_seconds = Number.isFinite(delay) ? Math.max(60, Math.min(86400, Math.ceil(delay))) : 60;
      }
    } catch {
      // Never log fetch exceptions: their URL contains the bot token.
      // A transport timeout cannot prove whether Telegram accepted the message.
    }
    try {
      const stored = await rpc('finish_feedback_telegram', receipt);
      if (stored !== true) return reply(202, { feedbackId, delivery: 'ambiguous' });
    } catch { return reply(202, { feedbackId, delivery: 'ambiguous' }); }
    if (receipt.outcome === 'delivered') return reply(200, { feedbackId, delivery: 'delivered' });
    return reply(202, { feedbackId, delivery: receipt.outcome === 'ambiguous' ? 'ambiguous' : 'queued', ...(receipt.outcome === 'failed' ? { retryAfterSeconds: receipt.retry_after_seconds } : {}) });
  };
}

export function createFeedbackTelegramHandler({env,fetchImpl=globalThis.fetch}) {
  const base=String(env.SUPABASE_URL??'').replace(/\/$/,'');
  const anonKey=env.SUPABASE_ANON_KEY,serviceKey=env.SUPABASE_SERVICE_ROLE_KEY;
  const deliver=createFeedbackTelegramDelivery({env,fetchImpl});
  return async function feedbackTelegram(request) {
    if(request.method==='OPTIONS')return reply(204,null);
    if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
    const authorization=request.headers.get('authorization')??'';
    if(!/^Bearer [^\s]+$/i.test(authorization)||authorization.length>8192)return reply(401,{error:'unauthorized'});
    if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'unsupported_media_type'});
    let body;
    try{body=await boundedJson(request);}catch(error){return reply(error instanceof RangeError?413:400,{error:'invalid_request'});}
    if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length!==1||typeof body.feedbackId!=='string'||!UUID.test(body.feedbackId))return reply(400,{error:'invalid_request'});
    const feedbackId=body.feedbackId.toLowerCase();
    if(!base||!anonKey||!serviceKey)return reply(503,{error:'temporarily_unavailable'});
    let user;
    try{
      const authResponse=await fetchImpl(`${base}/auth/v1/user`,{headers:{apikey:anonKey,Authorization:authorization},signal:AbortSignal.timeout(8000),redirect:'error'});
      if(authResponse.status===401||authResponse.status===403)return reply(401,{error:'unauthorized'});
      if(!authResponse.ok)return reply(503,{error:'temporarily_unavailable'});
      user=await authResponse.json();if(!UUID.test(user?.id??''))return reply(401,{error:'unauthorized'});
    }catch{return reply(503,{error:'temporarily_unavailable'});}
    return deliver(feedbackId,user.id);
  };
}
