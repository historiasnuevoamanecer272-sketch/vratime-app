import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'rolldown/utils';

// Exercise App's actual auth observer and edit handlers. Child screens, browser
// APIs and Supabase are offline boundaries; no source-text assertions are used.
const appUrl = new URL('../src/App.jsx', import.meta.url).href;
const srcUrl = new URL('../src/', import.meta.url).href;
const reactUrl = import.meta.resolve('react');
const bootstrapUrl = new URL('../src/lib/sessionBootstrap.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === appUrl) {
      const seams = {
        react: 'hooks', 'react/jsx-runtime': 'elements', 'react-i18next': 'translation',
        './supabaseClient': 'supabase', './i18n': 'translation',
        './hooks/useAppNavigation': 'navigation', './lib/sessionBootstrap': 'session',
        './lib/api': 'push-api', './lib/visualViewport': 'viewport', './components/Icon': 'child',
        './components/CreationLayer': 'child', './pages/LegalPage': 'legal',
        './pages/SupportPage': 'child',
        './components/OfflineNotice': 'child', './components/UpdateNotice': 'child',
      };
      if (seams[specifier]) return { url: `account-test:${seams[specifier]}`, shortCircuit: true };
    }
    if (context.parentURL?.startsWith(srcUrl) && specifier.startsWith('.')) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of ['', '.js', '.jsx', '/index.js']) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(candidate) && !candidate.pathname.endsWith('/i18n')) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const module = source => ({ format: 'module', source, shortCircuit: true });
    if (url === 'account-test:push-api') return module(`export const disablePushSubscriptionForSession = async () => true;`);
    if (url === 'account-test:hooks') return module(`
      export * from ${JSON.stringify(reactUrl)};
      let slots = [], cursor = 0, pending = [];
      export let dirty = false;
      const changed = (before, after) => !before || !after || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
      export const reset = () => {
        for (const slot of slots) slot.cleanup?.();
        slots = []; cursor = 0; pending = []; dirty = false;
      };
      export const begin = () => { cursor = 0; dirty = false; };
      export const flushEffects = () => {
        const work = pending; pending = [];
        for (const { slot, effect } of work) { slot.cleanup?.(); slot.cleanup = effect(); }
      };
      export const useState = initial => {
        const index = cursor++;
        if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
        const slot = slots[index];
        return [slot.value, next => {
          const value = typeof next === 'function' ? next(slot.value) : next;
          if (!Object.is(slot.value, value)) { slot.value = value; dirty = true; }
        }];
      };
      export const useRef = initial => {
        const index = cursor++;
        if (!slots[index]) slots[index] = { value: { current: initial } };
        return slots[index].value;
      };
      export const useMemo = (compute, deps) => {
        const index = cursor++;
        if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { value: compute(), deps };
        return slots[index].value;
      };
      export const useCallback = (callback, deps) => useMemo(() => callback, deps);
      export const useEffect = (effect, deps) => {
        const index = cursor++;
        const slot = slots[index] || (slots[index] = {});
        if (changed(slot.deps, deps)) { slot.deps = deps; pending.push({ slot, effect }); }
      };
      export const useLayoutEffect = useEffect;
      // App's lazy children are intentionally not mounted: the test inspects the
      // real props App passes at the account boundary, without loading a map.
      export const lazy = () => function OfflineScreen() {};
    `);
    if (url === 'account-test:elements') return module(`
      export const elements = [];
      export const Fragment = Symbol('fragment');
      export const jsx = (type, props, key) => {
        const element = { type, props: props || {}, key };
        elements.push(element); return element;
      };
      export const jsxs = jsx;
    `);
    if (url === 'account-test:translation') return module(`
      const t = key => key;
      export default { t };
      export const useTranslation = () => ({ t });
      export const getAppLanguage = () => 'en';
      export const setAppLanguage = () => {};
    `);
    if (url === 'account-test:session') return module(`
      export { readAuthReturn, cleanAuthReturnUrl } from ${JSON.stringify(bootstrapUrl)};
      let observer;
      export function startSessionBootstrap(_auth, callbacks) {
        observer = callbacks;
        return () => { if (observer === callbacks) observer = undefined; };
      }
      export const emitError = () => observer.onError('timeout');
      export function emitSession(session) {
        if (!observer) throw new Error('App did not subscribe to authentication');
        observer.onSession(session);
      }
    `);
    if (url === 'account-test:supabase') return module(`
      const allowed = new Set(['account-a', 'account-b']);
      export const calls = [];
      export const supabase = {
        auth: {},
        from(table) {
          if (!['profiles', 'profile_contacts'].includes(table)) throw new Error('Unexpected offline database table');
          return { select: () => ({ eq: (_column, userId) => {
            if (!allowed.has(userId)) throw new Error('Unexpected offline account');
            calls.push([table, userId]);
            const result = { data: table === 'profiles' ? { id: userId, language: 'en' } : [{ messenger_type: 'tg' }], error: null };
            return table === 'profiles' ? { maybeSingle: async () => result } : Promise.resolve(result);
          } }) };
        },
      };
    `);
    if (url === 'account-test:navigation') return module(`
      export const useAppNavigationState = () => ({ activeTab: 'profile', visitedTabs: ['map', 'profile'], overlayCount: 0, navigate() {}, context: {} });
    `);
    if (url === 'account-test:viewport') return module('export const observeVisualViewport = () => () => {};');
    if (url === 'account-test:child') return module('export default function OfflineChild() {}');
    if (url === 'account-test:legal') return module('export const OfferPage = () => null; export const PrivacyPage = () => null;');
    if (url.startsWith(srcUrl) && /\.(png|webp|css)$/.test(url)) return module(`export default ${JSON.stringify(url)};`);
    if (url === appUrl) {
      const result = transformSync(fileURLToPath(url), readFileSync(new URL(url), 'utf8'), { jsx: { runtime: 'automatic' } });
      assert.equal(result.errors.length, 0);
      return module(result.code);
    }
    return nextLoad(url, context);
  },
});

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
try {
  const timers = new Map();
  let timerId = 0;
  const location = { href: 'https://offline.invalid/', pathname: '/', search: '', hash: '' };
  globalThis.window = {
    location, navigator: { standalone: true, userAgent: 'offline', languages: ['en'], language: 'en' },
    matchMedia: () => ({ matches: true }),
    history: { state: null, replaceState() {} },
    setTimeout(run) { timers.set(++timerId, run); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.fetch = () => { throw new Error('Account regression must never access the network'); };

  const [{ default: App }, state, capture, auth, { showToast }, database] = await Promise.all([
    import('../src/App.jsx'), import('account-test:hooks'), import('account-test:elements'),
    import('account-test:session'), import('../src/lib/toast.js'), import('account-test:supabase'),
  ]);
  let tree;
  const render = () => { state.begin(); capture.elements.length = 0; tree = App(); return tree; };
  const settle = async () => {
    render();
    for (let pass = 0; pass < 20; pass++) {
      state.flushEffects();
      const tasks = [...timers.values()]; timers.clear();
      for (const run of tasks) run();
      await new Promise(resolve => setImmediate(resolve));
      if (!state.dirty && !timers.size) return tree;
      render();
    }
    throw new Error('App did not settle after the offline account event');
  };
  const session = (id, accessToken = 'offline-token') => ({ user: { id }, access_token: accessToken });
  const listingA = { id: 'listing-a', user_id: 'account-a', location_label: 'Account A private pickup address', description: 'Private draft details', image_url: 'https://offline.invalid/account-a/private.jpg' };
  const listingB = { id: 'listing-b', user_id: 'account-b', location_label: 'Account B pickup address' };
  const privateToast = 'ACCOUNT_A_PRIVATE_TOAST';
  const creation = () => capture.elements.find(({ props }) => Object.hasOwn(props, 'editingListing'));
  const profile = () => capture.elements.find(({ props }) => typeof props.onEditListing === 'function');
  const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' ? node : '';
  const prepareAccountA = async () => {
    state.reset(); timers.clear(); database.calls.length = 0;
    await settle();
    auth.emitSession(session('account-a'));
    await settle();
    assert.equal(profile()?.props.userId, 'account-a', 'Account A must finish the real App profile check');
    profile().props.onEditListing(listingA);
    showToast(privateToast);
    await settle();
    assert.equal(creation()?.props.editingListing, listingA, 'The real edit action must open account A listing');
    assert.ok(text(tree).includes(privateToast), 'The fixture must contain an account A toast');
  };
  const assertAccountBIsClear = async () => {
    assert.equal(profile()?.props.userId, 'account-b', 'Account B must reach its own profile');
    assert.equal(creation(), undefined, 'Account A creation/edit state must not appear under account B');
    assert.ok(!capture.elements.some(({ props }) => props.inert === true), 'The new account must not remain inert behind an old creation layer');
    assert.ok(!text(tree).includes(privateToast), 'Account A toast must be cleared at the identity boundary');
    profile().props.onEditListing(listingB);
    await settle();
    assert.equal(creation()?.props.userId, 'account-b');
    assert.equal(creation()?.props.editingListing, listingB, 'Account B must still be able to open its own edit');
  };
  let failures = 0;
  const check = async (name, run) => {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
  };

  await check('auth timeout shows a recoverable error without throwing or clearing the prior binding', async () => {
    state.reset(); timers.clear(); await settle();
    auth.emitError(); await settle();
    assert.ok(text(tree).includes('navigationExperience.sessionUnavailable') && text(tree).includes('common.retry'));
  });
  await check('same-user TOKEN_REFRESHED keeps the current edit and toast', async () => {
    await prepareAccountA();
    const profileReads = database.calls.length;
    auth.emitSession(session('account-a', 'offline-refreshed-token'));
    await settle();
    assert.equal(creation()?.props.editingListing, listingA);
    assert.ok(text(tree).includes(privateToast));
    assert.equal(database.calls.length, profileReads, 'Same-user refresh must not restart profile bootstrap');
  });
  await check('A to logout to B clears old edits and toasts before the new account can edit', async () => {
    await prepareAccountA();
    auth.emitSession(null); await settle();
    const loggedOutToast = text(tree).includes(privateToast);
    auth.emitSession(session('account-b')); await settle();
    await assertAccountBIsClear();
    assert.equal(loggedOutToast, false, 'The login screen must not retain account A toast');
  });
  await check('direct A to B replacement clears old edits and toasts', async () => {
    await prepareAccountA();
    auth.emitSession(session('account-b')); await settle();
    await assertAccountBIsClear();
  });

  await check('retired creation cannot unlock replacement after same-account relogin', async () => {
    await prepareAccountA();
    const retiredBusy = creation().props.onBusyChange;
    retiredBusy(true);
    auth.emitSession(null); await settle();
    auth.emitSession(session('account-a')); await settle();
    profile().props.onEditListing(listingA); await settle();
    creation().props.onBusyChange(true);
    assert.equal(creation().props.onBack(), false);
    retiredBusy(false);
    assert.equal(creation().props.onBack(), false, 'Retired generation must not clear current busy veto');
    await settle();
    assert.ok(creation());
  });
  await check('closed creation cannot unlock later creation in the same session', async () => {
    await prepareAccountA();
    const retiredBusy = creation().props.onBusyChange;
    assert.equal(creation().props.onBack(), true); await settle();
    profile().props.onEditListing(listingA); await settle();
    creation().props.onBusyChange(true);
    retiredBusy(false);
    assert.equal(creation().props.onBack(), false);
    creation().props.onBusyChange(false);
    assert.equal(creation().props.onBack(), true);
  });

  if (failures) process.exitCode = 1;
  else console.log('App account scope checks passed. Real App handlers; no live auth, API, account or database calls.');
  state.reset();
} finally {
  hooks.deregister();
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
}
