const authKeys = new Set(['code', 'state', 'access_token', 'refresh_token', 'id_token', 'token', 'token_hash', 'provider_token', 'provider_refresh_token', 'token_type', 'expires_in', 'expires_at', 'error', 'error_code', 'error_description']);

export function readAuthReturn(href) {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const failed = url.searchParams.has('error') || fragment.has('error');
  return { pending: !failed && (url.searchParams.has('code') || url.searchParams.has('access_token') || fragment.has('access_token')), failed };
}

export function cleanAuthReturnUrl(href) {
  const url = new URL(href);
  for (const key of authKeys) url.searchParams.delete(key);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if ([...fragment.keys()].some((key) => authKeys.has(key))) {
    for (const key of authKeys) fragment.delete(key);
    url.hash = fragment.toString();
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

// Subscribe before reading storage. A later auth event is authoritative over
// an older getSession result. Never await another Supabase operation inside
// onAuthStateChange: application work runs in the following task instead.
export function startSessionBootstrap(auth, { onSession, onError }, scheduler = globalThis) {
  let active = true;
  let revision = 0;
  let settled = false;
  const tasks = new Set();
  const defer = (run) => {
    const timer = scheduler.setTimeout(() => { tasks.delete(timer); if (active) run(); }, 0);
    tasks.add(timer);
  };
  const timeout = scheduler.setTimeout(() => {
    if (!active || settled) return;
    settled = true;
    onError('timeout');
  }, 15000);
  const accept = (session) => {
    settled = true;
    scheduler.clearTimeout(timeout);
    onSession(session || null);
  };
  const initialRevision = revision;
  const { data } = auth.onAuthStateChange((_event, session) => {
    const eventRevision = ++revision;
    defer(() => { if (eventRevision === revision) accept(session); });
  });
  Promise.resolve().then(() => active ? auth.getSession() : null).then((result) => {
    if (!active || revision !== initialRevision) return;
    defer(() => {
      if (revision !== initialRevision) return;
      if (result.error) { settled = true; scheduler.clearTimeout(timeout); onError('unavailable'); }
      else accept(result.data?.session);
    });
  }).catch(() => {
    if (!active || revision !== initialRevision) return;
    defer(() => { if (revision === initialRevision) { settled = true; scheduler.clearTimeout(timeout); onError('unavailable'); } });
  });
  return () => {
    active = false;
    scheduler.clearTimeout(timeout);
    for (const timer of tasks) scheduler.clearTimeout(timer);
    data.subscription.unsubscribe();
  };
}
