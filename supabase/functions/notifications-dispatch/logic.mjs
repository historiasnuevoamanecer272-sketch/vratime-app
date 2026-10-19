const supported = new Set(['ru', 'me', 'en', 'fr', 'de']);
const titles = {
  ru: { requested: 'Новый запрос', accepted: 'Запрос принят', handover: 'Передача обновлена', digest: 'Новые совпадения поиска', reminder: 'Напоминание', activity: 'Новое событие' },
  me: { requested: 'Novi zahtjev', accepted: 'Zahtjev je prihvaćen', handover: 'Primopredaja je ažurirana', digest: 'Nova podudaranja pretrage', reminder: 'Podsjetnik', activity: 'Nova aktivnost' },
  en: { requested: 'New request', accepted: 'Request accepted', handover: 'Handover updated', digest: 'New search matches', reminder: 'Reminder', activity: 'New activity' },
  fr: { requested: 'Nouvelle demande', accepted: 'Demande acceptée', handover: 'Remise mise à jour', digest: 'Nouveaux résultats de recherche', reminder: 'Rappel', activity: 'Nouvelle activité' },
  de: { requested: 'Neue Anfrage', accepted: 'Anfrage angenommen', handover: 'Übergabe aktualisiert', digest: 'Neue Suchtreffer', reminder: 'Erinnerung', activity: 'Neue Aktivität' },
};
const bodies = { ru: 'Откройте VratiMe, чтобы посмотреть подробности.', me: 'Otvorite VratiMe za detalje.', en: 'Open VratiMe for details.', fr: 'Ouvrez VratiMe pour voir les détails.', de: 'Öffnen Sie VratiMe für weitere Informationen.' };

export function validateSubscription(value) {
  try {
    if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 2048 || /[\s#]/.test(value.endpoint)) return false;
    const url = new URL(value.endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || url.pathname === '/') return false;
    if (!['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) && !/^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)) return false;
    if (!/^[A-Za-z0-9_-]{87}$/.test(value.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(value.auth)) return false;
    const decode = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
    const key = decode(value.p256dh), auth = decode(value.auth);
    return key.length === 65 && key[0] === 4 && auth.length === 16;
  } catch { return false; }
}

export function notificationPayload(job) {
  const language = supported.has(job.language) ? job.language : 'en';
  const event = Object.hasOwn(titles[language], job.event_type) ? job.event_type : 'activity';
  return { title: titles[language][event], body: bodies[language], tag: `vratime-${job.id}`, data: { open: 'inbox' } };
}

// The pinned web-push library supplies RFC8291 aes128gcm encryption and VAPID.
// Fetch is used for Edge compatibility and refuses redirects to prevent SSRF.
export function createPushSender(webpush, vapid, fetcher = fetch) {
  return async (subscription, payload) => {
    if (!validateSubscription(subscription)) return { statusCode: 400 };
    try {
      const details = webpush.generateRequestDetails({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), {
        vapidDetails: vapid, contentEncoding: 'aes128gcm', TTL: 3600, urgency: 'normal', topic: String(payload.tag || '').replace(/[^A-Za-z0-9_-]/g, '').slice(-32) || undefined,
      });
      const response = await fetcher(details.endpoint, { method: 'POST', headers: details.headers, body: new Uint8Array(details.body), redirect: 'error', signal: AbortSignal.timeout(10000) });
      return { statusCode: response.status };
    } catch { return { statusCode: 0 }; }
  };
}
