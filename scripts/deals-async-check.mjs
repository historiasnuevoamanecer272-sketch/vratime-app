import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'rolldown/utils';

// Run the real event handlers with persistent hook state and controlled offline
// network promises. Components below these two screens are left unmounted.
const srcUrl = new URL('../src/', import.meta.url).href;
const myDealsUrl = new URL('../src/pages/MyDeals.jsx', import.meta.url).href;
const appointmentUrl = new URL('../src/components/AppointmentCard.jsx', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if ([myDealsUrl, appointmentUrl].includes(context.parentURL)) {
      const seams = { react: 'hooks', 'react/jsx-runtime': 'elements', 'react-i18next': 'translation', '../i18n': 'translation', '../lib/api': 'api', '../supabaseClient': 'database', '../hooks/useAppNavigation': 'navigation', '../hooks/useDialogFocus': 'focus' };
      if (seams[specifier]) return { url: `deals-async:${seams[specifier]}`, shortCircuit: true };
    }
    if (context.parentURL?.startsWith(srcUrl) && specifier.startsWith('.')) {
      if (specifier === '../lib/api') return { url: 'deals-async:api', shortCircuit: true };
      if (specifier === '../supabaseClient') return { url: 'deals-async:database', shortCircuit: true };
      const base = new URL(specifier, context.parentURL);
      for (const extension of ['.js', '.jsx', '/index.js']) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const module = source => ({ format: 'module', source, shortCircuit: true });
    if (url === 'deals-async:hooks') return module(`
      let slots = [], cursor = 0, pending = [];
      export let writes = 0;
      const changed = (a, b) => !a || !b || a.length !== b.length || b.some((v, i) => !Object.is(v, a[i]));
      export const unmount = () => { for (const slot of slots) slot.cleanup?.(); pending = []; };
      export const reset = () => { unmount(); slots = []; cursor = 0; writes = 0; };
      export const begin = () => { cursor = 0; };
      export const flushEffects = () => { const work = pending; pending = []; for (const { slot, effect } of work) { slot.cleanup?.(); slot.cleanup = effect(); } };
      export const useState = initial => {
        const index = cursor++; const slot = slots[index] || (slots[index] = { value: typeof initial === 'function' ? initial() : initial });
        return [slot.value, next => { writes++; slot.value = typeof next === 'function' ? next(slot.value) : next; }];
      };
      export const useRef = initial => { const i = cursor++; return (slots[i] || (slots[i] = { value: { current: initial } })).value; };
      export const useMemo = (compute, deps) => { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: compute(), deps }; return slots[i].value; };
      export const useCallback = (callback, deps) => useMemo(() => callback, deps);
      export const useEffect = (effect, deps) => { const i = cursor++; const slot = slots[i] || (slots[i] = {}); if (changed(slot.deps, deps)) { slot.deps = deps; pending.push({ slot, effect }); } };
    `);
    if (url === 'deals-async:elements') return module(`
      export const elements = []; export const Fragment = Symbol('fragment');
      export const jsx = (type, props, key) => { const element = { type, props: props || {}, key }; elements.push(element); return element; }; export const jsxs = jsx;
    `);
    if (url === 'deals-async:translation') return module(`const t = key => key; export const useTranslation = () => ({ t }); export const getAppLanguage = () => 'en';`);
    if (url === 'deals-async:navigation') return module('export const useAppOverlay = () => {};');
    if (url === 'deals-async:focus') return module('export const useDialogFocus = () => ({});');
    if (url === 'deals-async:api') return module(`
      export const requests = [], mutations = [];
      export const getMyDeals = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
      const mutate = (...args) => new Promise((resolve, reject) => mutations.push({ args, resolve, reject }));
      export const acceptDeal = mutate, cancelBooking = mutate, confirmHandover = mutate, confirmLoanHandover = mutate, confirmLoanReturn = mutate, submitReview = mutate, scheduleHandover = mutate, setHandoverOutcome = mutate, createReport = mutate;
    `);
    if (url === 'deals-async:database') return module(`
      export const appointments = []; let authCallback;
      export const changeAccount = userId => authCallback?.('SIGNED_IN', { user: { id: userId } });
      export const supabase = {
        auth: { onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() { if (authCallback === callback) authCallback = undefined; } } } }; } },
        from(table) { if (table !== 'handover_appointments') throw Error('Unexpected table'); return { select: () => ({ order: () => new Promise((resolve, reject) => appointments.push({ resolve, reject })) }) }; },
      };
    `);
    if (url.startsWith(srcUrl) && /\.(webp|png|css)$/.test(url)) return module(`export default ${JSON.stringify(url)};`);
    if (url.startsWith(srcUrl) && url.endsWith('.jsx')) {
      const result = transformSync(fileURLToPath(url), readFileSync(new URL(url), 'utf8'), { jsx: { runtime: 'automatic' } });
      assert.equal(result.errors.length, 0); return module(result.code);
    }
    return nextLoad(url, context);
  },
});

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const timers = new Map(), listeners = new Map(), events = [];
let timerId = 0;
globalThis.window = {
  setTimeout(run) { timers.set(++timerId, run); return timerId; }, clearTimeout(id) { timers.delete(id); },
  addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  dispatchEvent(event) { events.push(event.type); listeners.get(event.type)?.(event); }, confirm: () => true,
};
globalThis.fetch = () => { throw Error('Offline regression must never access network'); };
try {
  const [{ default: MyDeals }, { default: AppointmentCard }, state, capture, api, database, { subscribeToasts }] = await Promise.all([
    import('../src/pages/MyDeals.jsx'), import('../src/components/AppointmentCard.jsx'), import('deals-async:hooks'), import('deals-async:elements'), import('deals-async:api'), import('deals-async:database'), import('../src/lib/toast.js'),
  ]);
  const toasts = [], stopToasts = subscribeToasts(value => toasts.push(value));
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const render = (Component = MyDeals, props = { userId: 'account-a' }) => { state.begin(); capture.elements.length = 0; const tree = Component(props); state.flushEffects(); return tree; };
  const reset = () => { state.reset(); timers.clear(); events.length = 0; api.requests.length = 0; api.mutations.length = 0; database.appointments.length = 0; toasts.length = 0; };
  const start = () => { reset(); render(); const work = [...timers.values()]; timers.clear(); work.forEach(run => run()); };
  const deal = name => ({ transaction_id: name, partner_name: name, role: 'giver', listing_type: 'give', is_listing_owner: true, created_at: '2026-10-21T08:00:00Z', quantity: 1, status: 'pending', expires_at: '2099-10-22T08:00:00Z' });
  const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' ? node : '';
  const button = key => capture.elements.find(element => element.type === 'button' && text(element) === key)?.props;
  const load = async name => { api.requests.at(-1).resolve([deal(name)]); await tick(); database.appointments.at(-1).resolve({ data: [], error: null }); await tick(); render(); };
  const failures = [];
  const check = async (name, test) => { try { await test(); } catch (error) { failures.push(`${name}: ${error.message}`); } };

  await check('older deal response cannot replace a newer refresh', async () => {
    start(); const old = api.requests[0]; listeners.get('deals-updated')();
    await load('newest'); old.resolve([deal('stale')]); await tick();
    database.appointments.at(-1).resolve({ data: [], error: null }); await tick();
    assert.ok(text(render()).includes('newest')); assert.ok(!text(render()).includes('stale'));
  });
  await check('older appointment response cannot replace the current refresh', async () => {
    start(); api.requests[0].resolve([{ ...deal('current'), accepted_at: '2026-10-21T09:00:00Z' }]); await tick();
    const old = database.appointments[0]; listeners.get('deals-updated')();
    api.requests[1].resolve([{ ...deal('current'), accepted_at: '2026-10-21T09:00:00Z' }]); await tick();
    database.appointments[1].resolve({ data: [{ id: 'new-meeting', transaction_id: 'current', state: 'scheduled', scheduled_for: '2099-01-02T10:00:00Z' }], error: null }); await tick();
    old.resolve({ data: [{ id: 'stale-meeting', transaction_id: 'current', state: 'scheduled', scheduled_for: '2099-01-01T10:00:00Z' }], error: null }); await tick(); render();
    assert.equal(capture.elements.find(element => element.type === AppointmentCard)?.props.appointment.id, 'new-meeting');
  });
  await check('expired reservation does not offer meeting mutations while awaiting server cleanup', async () => {
    start(); api.requests[0].resolve([{ ...deal('expired-reservation'), listing_type: 'lend', accepted_at: '2026-01-01T10:00:00Z', expires_at: '2026-01-02T10:00:00Z', status: 'reserved' }]); await tick();
    database.appointments[0].resolve({ data: [], error: null }); await tick(); render();
    assert.equal(capture.elements.some(element => element.type === AppointmentCard), false);
    assert.equal(button('lending.confirmHandover'), undefined);
  });
  for (const invalidate of ['unmount', 'account-change']) {
    await check(`${invalidate} suppresses settled mutation side effects`, async () => {
      start(); await load('action'); const pending = button('deals.accept').onClick();
      if (invalidate === 'unmount') state.unmount(); else database.changeAccount('account-b');
      const writes = state.writes; api.mutations[0].resolve({}); await tick();
      // An obsolete continuation must finish without starting another load.
      assert.equal(api.requests.length, 1); await pending;
      assert.equal(toasts.length, 0); assert.equal(events.length, 0); assert.equal(state.writes, writes);
    });
    await check(`${invalidate} suppresses late load state writes`, async () => {
      start(); if (invalidate === 'unmount') state.unmount(); else database.changeAccount('account-b');
      const writes = state.writes; api.requests[0].resolve([deal('private-old-account')]); await tick();
      if (database.appointments.length) { database.appointments[0].resolve({ data: [], error: null }); await tick(); }
      assert.equal(state.writes, writes); assert.equal(database.appointments.length, 0);
    });
  }
  await check('appointment remains locked until refreshed data finishes loading', async () => {
    reset(); let finishRefresh; let refreshes = 0;
    const refresh = new Promise(resolve => { finishRefresh = resolve; });
    const props = { deal: { ...deal('appointment'), accepted_at: '2026-10-21T09:00:00Z' }, onChanged: () => { refreshes++; return refresh; } };
    render(AppointmentCard, props); const save = button('appointment.schedule'); const first = save.onClick();
    api.mutations[0].resolve({}); await tick(); render(AppointmentCard, props);
    assert.equal(button('appointment.schedule').disabled, true);
    const second = save.onClick(); await tick(); assert.equal(api.mutations.length, 1);
    finishRefresh(); await Promise.all([first, second]); assert.equal(refreshes, 1);
    render(AppointmentCard, props); assert.equal(button('appointment.schedule').disabled, false);
  });
  await check('unmounted appointment ignores late mutation failures', async () => {
    reset(); const props = { deal: { ...deal('appointment'), accepted_at: '2026-10-21T09:00:00Z' }, onChanged: () => { throw Error('Obsolete refresh'); } };
    render(AppointmentCard, props); const pending = button('appointment.schedule').onClick(); state.unmount(); const writes = state.writes;
    api.mutations[0].reject(new Error('late-network-error')); await pending;
    assert.equal(toasts.length, 0); assert.equal(state.writes, writes);
  });
  reset(); stopToasts();
  assert.deepEqual(failures, [], 'Deal async regressions');
  console.log('Deal async checks passed: latest refresh wins; unmount/account changes suppress old effects; appointment lock covers refresh.');
} finally { hooks.deregister(); globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
