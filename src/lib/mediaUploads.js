import { supabase } from '../supabaseClient';

export const MEDIA_INPUT_MAX_BYTES = 5 * 1024 * 1024;
const kinds = new Set(['avatar', 'listing', 'feedback']);
const types = new Set(['image/jpeg', 'image/png', 'image/webp']);

// The operation ID belongs to one immutable file. Keep it when retrying a request.
export async function uploadUserMedia({ kind, file, operationId = crypto.randomUUID(), expectedUserId, signal }) {
  if (!kinds.has(kind)) throw new Error('media_invalid_kind');
  if (!(file instanceof Blob) || !types.has(file.type)) throw new Error('media_unsupported_type');
  if (!file.size || file.size > MEDIA_INPUT_MAX_BYTES) throw new Error('media_input_too_large');
  if (signal?.aborted) throw new Error('media_auth_changed');
  const { data: auth, error: authError } = await supabase.auth.getSession();
  const session = auth?.session;
  if (authError || !session?.access_token || !session.user?.id) throw new Error('media_unauthorized');
  if (signal?.aborted || (expectedUserId && session.user.id !== expectedUserId)) throw new Error('media_auth_changed');
  const { data, error } = await supabase.functions.invoke('media-upload', {
    body: file,
    signal,
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': file.type, 'X-Media-Kind': kind, 'X-Operation-Id': operationId },
  });
  if (signal?.aborted) throw new Error('media_auth_changed');
  if (error) {
    let code;
    try { code = (await error.context?.json())?.error; } catch { /* Network errors have no JSON response. */ }
    throw new Error(code || error.message || 'media_upload_failed');
  }
  if (!data?.assetId || !data.path || !data.url) throw new Error('media_upload_failed');
  return { url: data.url, path: data.path, assetId: data.assetId };
}

export async function getPrivateMediaUrl(assetId) {
  const { data, error } = await supabase.functions.invoke('media-upload', {
    body: { action: 'sign', assetId: String(assetId).replace(/^media:/, '') },
  });
  if (error || !data?.url) throw new Error('media_private_access_denied');
  return data.url;
}
