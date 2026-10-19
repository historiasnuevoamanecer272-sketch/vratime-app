/* Imported by the existing PWA worker; no second service-worker scope. */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'VRATIME_PUSH_READY') event.ports?.[0]?.postMessage({ ready: true, version: 1 });
});
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Always show a visible fallback for userVisibleOnly subscriptions. */ }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 180) : 'VratiMe';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 300) : 'Open VratiMe for details.';
  const tag = typeof payload.tag === 'string' ? payload.tag.slice(0, 120) : 'vratime-update';
  event.waitUntil(self.registration.showNotification(title, { body, tag, icon: new URL('app-logo-192.png', self.registration.scope).href, data: { open: 'inbox' } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = new URL(self.registration.scope);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => { try { const url = new URL(client.url); return url.origin === scope.origin && url.pathname.startsWith(scope.pathname); } catch { return false; } });
    if (existing) return existing.focus();
    return self.clients.openWindow(scope.href);
  })());
});
