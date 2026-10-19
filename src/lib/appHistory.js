const tabs = new Set(['map', 'deals', 'profile']);
const stateKey = 'vratimeNavigation';
const readState = (state) => ({
  tab: tabs.has(state?.[stateKey]?.tab) ? state[stateKey].tab : 'map',
  overlays: Array.isArray(state?.[stateKey]?.overlays) ? state[stateKey].overlays.filter((id) => typeof id === 'string') : [],
  position: Number.isInteger(state?.[stateKey]?.position) ? state[stateKey].position : 0,
});

// History contains only public UI identifiers. Listing data, queries and auth
// credentials belong neither in these entries nor in a navigation URL.
export function createAppHistory(host, onChange) {
  let current = { ...readState(host.history.state), overlays: [] };
  let disposed = false;
  let pendingBack = false;
  let serial = 0;
  const overlays = new Map();
  const queued = [];
  const write = (push = false) => {
    const state = { ...host.history.state, [stateKey]: current };
    host.history[push ? 'pushState' : 'replaceState'](state, '');
  };
  const emit = () => onChange({ activeTab: current.tab, overlayCount: overlays.size });
  const enqueue = (run, kind) => { if (pendingBack) queued.push({ run, kind }); else run(); };
  const drain = () => { while (queued.length && !pendingBack) queued.shift().run(); };
  const back = () => { pendingBack = true; host.history.back(); };
  const unregister = (entry) => {
    if (!entry.active) return;
    entry.active = false;
    if (!overlays.delete(entry.id)) return;
    const isTop = current.overlays.at(-1) === entry.id;
    current = { ...current, overlays: current.overlays.filter((id) => id !== entry.id) };
    if (isTop && !pendingBack) back();
    else if (!pendingBack) write();
    emit();
  };
  const navigate = (tab) => {
    if (disposed || !tabs.has(tab)) return false;
    let accepted = true;
    enqueue(() => {
      if (disposed || current.tab === tab) return;
      const top = [...overlays.values()].at(-1);
      if (top) {
        // A submit in flight may veto dismissal. Ask before unregistering so
        // the live form keeps both its UI and its browser Back marker.
        if (top.close() === false) { accepted = false; return; }
        unregister(top);
        queued.push({ run: () => navigate(tab), kind: 'navigate' });
        return;
      }
      current = { tab, overlays: [], position: current.position + 1 };
      write(true); emit();
    }, 'navigate');
    return accepted;
  };
  const pop = (event) => {
    if (disposed) return;
    pendingBack = false;
    const target = readState(event.state);
    const backwards = target.position < current.position;
    for (const entry of [...overlays.values()].reverse()) {
      if (target.overlays.includes(entry.id)) continue;
      if (entry.close() === false) {
        // Native traversal already moved the cursor. Reinsert just the live
        // public UI marker instead of issuing an opposing traversal/pop loop.
        // Children already closed above stay closed. A later Back works as
        // soon as the callback stops vetoing.
        current = { ...current, overlays: current.overlays.filter((id) => overlays.has(id)), position: target.position + 1 };
        write(true); emit();
        for (let index = queued.length - 1; index >= 0; index -= 1) if (queued[index].kind === 'navigate') queued.splice(index, 1);
        drain();
        return;
      }
      overlays.delete(entry.id);
      entry.active = false;
    }
    current = { ...target, overlays: target.overlays.filter((id) => overlays.has(id)) };
    // Forward may reach a marker for an already closed dialog. It cannot
    // reconstruct private dialog state; turn that marker into its base tab.
    write(); emit();
    // Closing a parent and its nested dialog in one render can leave the
    // parent's older marker behind. Skip that spent marker on the way back.
    if (backwards && target.overlays.length && !current.overlays.length) { back(); return; }
    drain();
  };
  write(); emit();
  host.addEventListener('popstate', pop);
  return {
    navigate,
    registerOverlay(key, close) {
      const entry = { id: `${key}:${++serial}`, close, active: true };
      enqueue(() => {
        if (disposed || !entry.active) return;
        overlays.set(entry.id, entry);
        current = { ...current, overlays: [...current.overlays, entry.id], position: current.position + 1 };
        write(true); emit();
      }, 'overlay');
      return () => unregister(entry);
    },
    dispose() {
      disposed = true;
      queued.length = 0;
      overlays.clear();
      host.removeEventListener('popstate', pop);
    },
  };
}
