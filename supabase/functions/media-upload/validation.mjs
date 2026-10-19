export const INPUT_MAX = 5 * 1024 * 1024;
export const MAX_PIXELS = 12_000_000;
export const OUTPUT_LIMITS = Object.freeze({ avatar: 512 * 1024, listing: 2 * 1024 * 1024, feedback: 2 * 1024 * 1024 });
export const BUCKETS = Object.freeze({ avatar: 'AVATARS', listing: 'LISTING-PHOTOS', feedback: 'FEEDBACK-ATTACHMENTS' });
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class MediaError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const invalid = () => { throw new MediaError('media_invalid_image', 415); };
const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n));

// This is a bounded preflight, NOT a decoder. The WASM decoder must succeed later.
export function inspectImage(bytes, declaredType) {
  if (!bytes.length || bytes.length > INPUT_MAX) throw new MediaError('media_input_too_large', 413);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format, type, width, height;
  if (bytes.length >= 33 && ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') {
    format = 'PNG'; type = 'image/png';
    if (v.getUint32(8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') invalid();
    width = v.getUint32(16); height = v.getUint32(20);
    let at = 8, ended = false;
    while (at + 12 <= bytes.length) {
      const size = v.getUint32(at), chunk = ascii(bytes, at + 4, 4);
      if (at + 12 + size > bytes.length) invalid();
      if (chunk === 'acTL' || chunk === 'fcTL' || chunk === 'fdAT') throw new MediaError('media_animation_not_allowed', 415);
      at += 12 + size;
      if (chunk === 'IEND') { ended = true; break; }
    }
    if (!ended || at !== bytes.length) invalid();
  } else if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    format = 'WEBP'; type = 'image/webp';
    if (v.getUint32(4, true) + 8 !== bytes.length) invalid();
    let at = 12;
    while (at + 8 <= bytes.length) {
      const chunk = ascii(bytes, at, 4), size = v.getUint32(at + 4, true), start = at + 8;
      if (start + size > bytes.length) invalid();
      if (chunk === 'ANIM' || chunk === 'ANMF' || (chunk === 'VP8X' && size >= 10 && (bytes[start] & 2))) throw new MediaError('media_animation_not_allowed', 415);
      if (chunk === 'VP8X' && size >= 10) {
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
      } else if (!width && chunk === 'VP8 ' && size >= 10 && ascii(bytes, start + 3, 3) === '\x9d\x01\x2a') {
        width = v.getUint16(start + 6, true) & 0x3fff; height = v.getUint16(start + 8, true) & 0x3fff;
      } else if (!width && chunk === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
        const bits = v.getUint32(start + 1, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
      }
      at = start + size + (size % 2);
    }
    if (at !== bytes.length) invalid();
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = 'JPEG'; type = 'image/jpeg';
    let at = 2;
    while (at + 3 < bytes.length) {
      if (bytes[at++] !== 0xff) invalid();
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > bytes.length) invalid();
      const size = v.getUint16(at);
      if (size < 2 || at + size > bytes.length) invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8) invalid(); height = v.getUint16(at + 3); width = v.getUint16(at + 5);
      }
      at += size;
    }
  } else throw new MediaError('media_unsupported_type', 415);
  if (declaredType !== type) throw new MediaError('media_type_mismatch', 415);
  if (!width || !height) invalid();
  if (width > 6000 || height > 6000 || width * height > MAX_PIXELS) throw new MediaError('media_pixel_limit', 413);
  return { format, type, width, height };
}

const REJECT_DRAIN_EXTRA = 64 * 1024;

// Hosted forwarding can stall an early response while the request body is
// unread. Discard a small, finite rejected body without retaining its bytes;
// never drain an unlimited upload or await transport cancellation.
async function discardReader(reader, budget, timeoutMs) {
  let timer, ended = false;
  const deadlineAt = Date.now() + Math.max(0, timeoutMs);
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, timeoutMs)); });
  try {
    while (budget > 0 && Date.now() < deadlineAt) {
      const result = await Promise.race([reader.read().catch(() => null), deadline]);
      if (!result) break;
      if (result.done) { ended = true; break; }
      budget -= result.value.byteLength;
    }
  } catch { /* Rejection still keeps its original HTTP status. */ }
  finally {
    clearTimeout(timer);
    if (!ended) reader.cancel().catch(() => {});
  }
}

export async function discardRejectedBody(request, budget = INPUT_MAX + REJECT_DRAIN_EXTRA, timeoutMs = 10_000) {
  if (!request.body || request.bodyUsed || request.body.locked) return;
  const reader = request.body.getReader();
  try { await discardReader(reader, budget, timeoutMs); }
  finally { reader.releaseLock(); }
}

export async function readBounded(request, limit = INPUT_MAX, timeoutMs = 10_000) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await discardRejectedBody(request, limit + REJECT_DRAIN_EXTRA, timeoutMs);
    throw new MediaError('media_input_too_large', 413);
  }
  if (!request.body) throw new MediaError('media_invalid_image', 415);
  const reader = request.body.getReader();
  const chunks = []; let size = 0, timer, timedOut = false;
  const deadlineAt = Date.now() + timeoutMs;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new MediaError('media_request_timeout', 408)); reader.cancel().catch(() => {}); }, timeoutMs); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (timedOut) throw new MediaError('media_request_timeout', 408);
      if (done) break;
      size += value.length;
      if (size > limit) {
        chunks.length = 0;
        clearTimeout(timer);
        await discardReader(reader, limit + REJECT_DRAIN_EXTRA - size, deadlineAt - Date.now());
        throw new MediaError('media_input_too_large', 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return bytes;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
