// Public-map freshness must also work when database replication is unavailable.
export function subscribeMapRefresh({ host, document, refresh, interval = 15000 }) {
  let stopped = false, running = false, pending = false;
  const visible = () => document.visibilityState !== 'hidden' && host.navigator?.onLine !== false;
  const run = (background = true) => {
    if (stopped || !visible()) return;
    if (running) { pending = true; return; }
    running = true;
    Promise.resolve().then(() => refresh({ background })).catch(() => {}).finally(() => {
      running = false;
      if (pending && !stopped) { pending = false; run(true); }
    });
  };
  const changed = () => {
    try { host.localStorage?.setItem('vratime:listings-revision', `${Date.now()}-${Math.random()}`); } catch { /* Refresh works even when local storage is unavailable. */ }
    run(true);
  };
  const external = (event) => { if (event.key === 'vratime:listings-revision') run(true); };
  const resume = () => run(true);
  const initial = host.setTimeout(() => run(false), 0);
  const timer = host.setInterval(resume, interval);
  host.addEventListener('listings-updated', changed);
  host.addEventListener('storage', external);
  host.addEventListener('focus', resume);
  host.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  return () => {
    stopped = true; pending = false;
    host.clearTimeout(initial); host.clearInterval(timer);
    host.removeEventListener('listings-updated', changed);
    host.removeEventListener('storage', external);
    host.removeEventListener('focus', resume);
    host.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', resume);
  };
}
