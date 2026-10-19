const bindingKey = 'vratime-push-owner-v1';
const memoryBindings = new WeakMap();
const currentBinding = (environment) => {
  try {
    const stored = JSON.parse(environment.localStorage.getItem(bindingKey) || 'null');
    if (typeof stored?.userId === 'string' && typeof stored.endpoint === 'string') { memoryBindings.set(environment, stored); return stored; }
  } catch { /* The in-memory owner survives when storage is blocked. */ }
  return memoryBindings.get(environment) || null;
};
const remember = (environment, value) => {
  memoryBindings.set(environment, value);
  try { if (value) environment.localStorage.setItem(bindingKey, JSON.stringify(value)); else environment.localStorage.removeItem(bindingKey); } catch { /* Permission and server status remain authoritative when local storage is disabled. */ }
};
const retirements = new WeakMap();

export function pushSupport(environment = window) {
  if (!environment.isSecureContext || !environment.PushManager || !environment.Notification || !environment.navigator?.serviceWorker) return 'unsupported';
  const ios = /iphone|ipad|ipod/i.test(environment.navigator.userAgent || '') || (environment.navigator.platform === 'MacIntel' && environment.navigator.maxTouchPoints > 1);
  if (ios && !environment.navigator.standalone && !environment.matchMedia?.('(display-mode: standalone)').matches) return 'installRequired';
  return 'supported';
}
const publicKeyBytes = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
const assertCurrent = (isCurrent) => { if (!isCurrent()) throw new Error('push_auth_changed'); };

// An existing PWA worker may predate push support until its update activates.
// A subscription is usable only after the active worker confirms its handler.
const workerSupportsPush = (registration, environment) => new Promise((resolve) => {
  if (!registration.active || !environment.MessageChannel) { resolve(false); return; }
  const channel = new environment.MessageChannel();
  const finish = (ready) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(ready); };
  const timer = setTimeout(() => finish(false), 1500);
  channel.port1.onmessage = (event) => finish(event.data?.ready === true && event.data.version === 1);
  try { registration.active.postMessage({ type: 'VRATIME_PUSH_READY' }, [channel.port2]); }
  catch { finish(false); }
});

export async function readPushPreference({ userId, api, environment = window, isCurrent = () => true, signal }) {
  const support = pushSupport(environment);
  if (support !== 'supported') return { state: support, enabled: false };
  if (environment.Notification.permission === 'denied') return { state: 'denied', enabled: false };
  const registration = await environment.navigator.serviceWorker.getRegistration();
  assertCurrent(isCurrent);
  if (!registration) return { state: 'workerUnavailable', enabled: false };
  const subscription = await registration.pushManager.getSubscription();
  assertCurrent(isCurrent);
  const ready = await workerSupportsPush(registration, environment);
  assertCurrent(isCurrent);
  if (!subscription) return { state: ready ? 'disabled' : 'workerUnavailable', enabled: false };
  const status = await api.getMyPushStatus(subscription.endpoint, { expectedUserId: userId, signal });
  assertCurrent(isCurrent);
  if (status.enabled) remember(environment, { userId, endpoint: subscription.endpoint });
  return { ...status, state: !ready ? 'workerUnavailable' : status.enabled && environment.Notification.permission === 'granted' ? 'enabled' : 'disabled', enabled: Boolean(status.enabled && environment.Notification.permission === 'granted') };
}

// Called only by the Enable button. Permission is requested before the first
// awaited browser/server operation so the iOS user gesture is retained.
export async function enablePushPreference({ userId, api, config, environment = window, isCurrent = () => true, signal }) {
  const support = pushSupport(environment);
  if (support !== 'supported') return { state: support, enabled: false };
  if (!config?.configured || !/^[A-Za-z0-9_-]{87}$/.test(config.publicKey || '')) return { state: 'notConfigured', enabled: false };
  const permission = environment.Notification.permission === 'default' ? await environment.Notification.requestPermission() : environment.Notification.permission;
  assertCurrent(isCurrent);
  if (permission !== 'granted') return { state: permission === 'denied' ? 'denied' : 'disabled', enabled: false };
  await retirements.get(environment);
  assertCurrent(isCurrent);
  const registration = await environment.navigator.serviceWorker.getRegistration();
  assertCurrent(isCurrent);
  if (!registration) return { state: 'workerUnavailable', enabled: false };
  const ready = await workerSupportsPush(registration, environment);
  assertCurrent(isCurrent);
  if (!ready) return { state: 'workerUnavailable', enabled: false };
  let subscription = await registration.pushManager.getSubscription();
  let created = false;
  try {
    assertCurrent(isCurrent);
    if (subscription) {
      const binding = currentBinding(environment);
      const status = await api.getMyPushStatus(subscription.endpoint, { expectedUserId: userId, signal });
      assertCurrent(isCurrent);
      if ((binding && binding.userId !== userId) || !status.enabled) {
        await subscription.unsubscribe();
        assertCurrent(isCurrent);
        const remaining = await registration.pushManager.getSubscription();
        assertCurrent(isCurrent);
        if (remaining?.endpoint === subscription.endpoint) throw new Error('push_unsubscribe_failed');
        subscription = remaining;
      }
    }
    if (!subscription) { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(config.publicKey) }); created = true; }
    assertCurrent(isCurrent);
    await api.registerPushSubscription(subscription.toJSON(), { expectedUserId: userId, signal });
    assertCurrent(isCurrent);
    remember(environment, { userId, endpoint: subscription.endpoint });
    return { state: 'enabled', enabled: true };
  } catch (error) {
    if (created) { try { await subscription?.unsubscribe(); } catch { /* A later provider410 also retires an abandoned subscription. */ } }
    throw error;
  }
}

export async function disablePushPreference({ userId, api, environment = window, isCurrent = () => true, signal }) {
  const registration = await environment.navigator.serviceWorker.getRegistration();
  assertCurrent(isCurrent);
  const subscription = await registration?.pushManager.getSubscription();
  assertCurrent(isCurrent);
  if (!subscription) return { state: 'disabled', enabled: false };
  let serverUpdated = false, localDisabled = false;
  try { await api.disablePushSubscription(subscription.endpoint, { expectedUserId: userId, signal }); serverUpdated = true; } catch { /* Still turn this browser off when the server is temporarily unavailable. */ }
  assertCurrent(isCurrent);
  try { localDisabled = await subscription.unsubscribe(); } catch { /* Server disabled subscriptions cannot be claimed for delivery. */ }
  if (!serverUpdated && !localDisabled) throw new Error('push_disable_failed');
  if (currentBinding(environment)?.userId === userId) remember(environment, null);
  return { state: serverUpdated ? 'disabled' : 'disabledLocal', enabled: false };
}

// Invoke synchronously on an identity change, without awaiting inside the
// Supabase auth callback. Only the captured previous bearer may retire its row.
// Local retirement forms a barrier before the next account can subscribe.
export function retirePushForAccountChange({ previousSession, nextSession, api, environment = window }) {
  const previousId = previousSession?.user?.id;
  const nextId = nextSession?.user?.id;
  const binding = currentBinding(environment);
  const retiringId = previousId || binding?.userId;
  if ((previousId && previousId === nextId) || !retiringId || (binding && binding.userId === nextId) || (previousId && binding && binding.userId !== previousId)) {
    return Promise.resolve({ changed: false, localDisabled: false, serverDisabled: false });
  }
  let endpoint = binding?.endpoint;
  const previousLocal = retirements.get(environment) || Promise.resolve();
  const local = previousLocal.catch(() => {}).then(async () => {
    try {
      const registration = await environment.navigator?.serviceWorker?.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      const current = currentBinding(environment);
      if (current && (current.userId !== retiringId || (endpoint && current.endpoint !== endpoint))) return false;
      if (subscription && endpoint && subscription.endpoint !== endpoint) return false;
      endpoint ||= subscription?.endpoint;
      const disabled = subscription ? await subscription.unsubscribe() : true;
      const after = currentBinding(environment);
      if (disabled && after?.userId === retiringId && after.endpoint === endpoint) remember(environment, null);
      return Boolean(disabled);
    } catch { return false; }
  });
  retirements.set(environment, local);
  const server = local.then(() => previousId === retiringId && previousSession.access_token && endpoint && api?.disablePushSubscriptionForSession
    ? api.disablePushSubscriptionForSession(endpoint, previousSession, { signal: AbortSignal.timeout(10000) }) : false).then(Boolean, () => false);
  return Promise.all([local, server]).then(([localDisabled, serverDisabled]) => ({ changed: true, localDisabled, serverDisabled }));
}
