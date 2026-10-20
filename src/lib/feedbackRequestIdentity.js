const PREFIX = 'vratime:feedback-request:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function browserStorage() { try { return window.localStorage; } catch { return null; } }

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', value);
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Persist only an account-scoped payload hash and UUID. Report text, contacts,
// screenshot bytes, asset URLs and session credentials never enter storage.
export function createFeedbackRequestStore({ storage = browserStorage() } = {}) {
  const pending = new Map();
  return {
    async reserve(userId, { type, message, screenshot = null }) {
      if (!userId) throw new Error('form_auth_changed');
      const screenshotHash = screenshot ? await digest(await screenshot.arrayBuffer()) : null;
      const fingerprint = await digest(new TextEncoder().encode(JSON.stringify([type, message, screenshotHash])));
      const key = `${PREFIX}${encodeURIComponent(userId)}:${fingerprint}`;
      let requestId = pending.get(key);
      if (!requestId) {
        try { const stored = storage?.getItem(key); if (UUID.test(stored || '')) requestId = stored; } catch { /* Storage can be disabled. */ }
      }
      requestId ||= crypto.randomUUID();
      pending.set(key, requestId);
      try { storage?.setItem(key, requestId); } catch { /* Keep same-mounted retries stable when persistence is unavailable. */ }
      return { key, requestId };
    },
    confirm({ key, requestId }) {
      if (pending.get(key) === requestId) pending.delete(key);
      try { if (storage?.getItem(key) === requestId) storage.removeItem(key); } catch { /* A later retry can still recover the confirmed row. */ }
    },
  };
}
