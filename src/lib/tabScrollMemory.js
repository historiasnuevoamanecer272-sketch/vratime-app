export function createTabScrollMemory(host = window) {
  const positions = new Map();
  return {
    capture(tab) { positions.set(tab, Math.max(0, host.scrollY || 0)); },
    restore(tab) { host.scrollTo({ top: positions.get(tab) || 0, left: 0, behavior: 'instant' }); },
  };
}
