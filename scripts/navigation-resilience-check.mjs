import assert from 'node:assert/strict';

const load = async (file) => import(file).catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const historyModule = await load('../src/lib/appHistory.js');
const authModule = await load('../src/lib/sessionBootstrap.js');
const installModule = await load('../src/lib/installExperience.js');
const viewportModule = await load('../src/lib/visualViewport.js');
const focusModule = await load('../src/lib/dialogFocus.js');
const scrollModule = await load('../src/lib/tabScrollMemory.js');
let failures = 0;
const check = async (name, run) => {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}: ${error.message}`); }
};

function historyHost() {
  const listeners = new Set();
  const entries = [{ unrelated: 'preserved' }];
  let index = 0;
  const pending = [];
  return {
    scrollY: 0,
    history: {
      get state() { return entries[index]; },
      get length() { return entries.length; },
      replaceState(state) { entries[index] = state; },
      pushState(state) { entries.splice(index + 1); entries.push(state); index += 1; },
      back() { pending.push(-1); },
      forward() { pending.push(1); },
      go(delta) { pending.push(delta); },
    },
    addEventListener(type, listener) { if (type === 'popstate') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'popstate') listeners.delete(listener); },
    flush() {
      let events = 0;
      while (pending.length) {
        assert.ok(++events <= 100, 'history restoration must not cause a permanent popstate loop');
        const next = index + pending.shift();
        if (next < 0 || next >= entries.length) continue;
        index = next;
        for (const listener of listeners) listener({ state: entries[index] });
      }
    },
  };
}

await check('tab history ignores repeated taps and Back restores the preceding tab', () => {
  assert.equal(typeof historyModule.createAppHistory, 'function', 'app history controller is missing');
  const host = historyHost();
  const seen = [];
  const navigation = historyModule.createAppHistory(host, (state) => seen.push(state));
  navigation.navigate('deals'); navigation.navigate('deals'); navigation.navigate('profile');
  assert.equal(host.history.length, 3);
  host.history.back(); host.flush();
  assert.equal(seen.at(-1).activeTab, 'deals');
  assert.equal(host.history.state.unrelated, 'preserved');
  assert.equal(navigation.navigate('https://outside.example'), false);
  navigation.dispose();
});

await check('Back closes nested overlays once before leaving the tab', () => {
  assert.equal(typeof historyModule.createAppHistory, 'function', 'overlay history is missing');
  const host = historyHost(); const closed = [];
  const navigation = historyModule.createAppHistory(host, () => {});
  navigation.navigate('deals');
  const closeListing = navigation.registerOverlay('listing', () => closed.push('listing'));
  const closeBooking = navigation.registerOverlay('booking', () => closed.push('booking'));
  host.history.back(); host.flush();
  assert.deepEqual(closed, ['booking']);
  closeBooking();
  host.history.back(); host.flush();
  assert.deepEqual(closed, ['booking', 'listing']);
  closeListing();
  assert.equal(host.history.state.vratimeNavigation.tab, 'deals');
  navigation.dispose();
});

await check('explicit overlay close consumes its entry and Forward never resurrects closed UI', () => {
  assert.equal(typeof historyModule.createAppHistory, 'function', 'overlay cleanup is missing');
  const host = historyHost(); const closed = [];
  const navigation = historyModule.createAppHistory(host, () => {});
  const unregister = navigation.registerOverlay('create', () => closed.push('create'));
  unregister();
  navigation.navigate('profile'); // must wait for the pending native Back
  host.flush();
  assert.equal(host.history.state.vratimeNavigation.tab, 'profile');
  assert.deepEqual(closed, []);
  host.history.back(); host.flush();
  assert.equal(host.history.state.vratimeNavigation.tab, 'map');
  host.history.forward(); host.flush();
  assert.deepEqual(host.history.state.vratimeNavigation.overlays, []);
  navigation.dispose();
});

await check('switching tabs restores each tab window scroll without resetting nested scroll containers', () => {
  assert.equal(typeof scrollModule.createTabScrollMemory, 'function', 'tab scroll memory is missing');
  const host = { scrollY: 180, scrollTo({ top }) { this.scrollY = top; } };
  const memory = scrollModule.createTabScrollMemory(host);
  memory.capture('map'); memory.restore('deals');
  assert.equal(host.scrollY, 0);
  host.scrollY = 720; memory.capture('deals'); memory.restore('map');
  assert.equal(host.scrollY, 180);
  memory.restore('deals'); assert.equal(host.scrollY, 720);
});

await check('closing a parent and child overlay together does not leave a dead Back press', () => {
  const host = historyHost(); const navigation = historyModule.createAppHistory(host, () => {});
  navigation.navigate('deals');
  const parent = navigation.registerOverlay('listing', () => {});
  const child = navigation.registerOverlay('booking', () => {});
  parent(); child(); host.flush();
  assert.equal(host.history.state.vratimeNavigation.tab, 'deals');
  host.history.back(); host.flush();
  assert.equal(host.history.state.vratimeNavigation.tab, 'map');
  navigation.dispose();
});

await check('a busy overlay vetoes tab navigation without losing its Back registration', () => {
  const host = historyHost(); const seen = []; let busy = true; let closed = 0;
  const navigation = historyModule.createAppHistory(host, (state) => seen.push(state));
  navigation.registerOverlay('create', () => { if (busy) return false; closed += 1; });
  const before = structuredClone(host.history.state);
  assert.equal(navigation.navigate('profile'), false);
  assert.deepEqual(host.history.state, before);
  assert.equal(seen.at(-1).overlayCount, 1);
  assert.equal(closed, 0);
  busy = false;
  navigation.navigate('profile'); host.flush();
  assert.equal(closed, 1);
  assert.equal(seen.at(-1).activeTab, 'profile');
  assert.equal(seen.at(-1).overlayCount, 0);
  navigation.dispose();
});

await check('busy publication vetoes native Back without a loop and unlock permits normal Back and Forward', () => {
  const host = historyHost(); const seen = []; let busy = true; let closed = 0;
  const navigation = historyModule.createAppHistory(host, (state) => seen.push(state));
  navigation.navigate('deals');
  navigation.registerOverlay('create', () => { if (busy) return false; closed += 1; });
  const marker = structuredClone(host.history.state.vratimeNavigation);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    host.history.back(); host.flush();
    assert.deepEqual(host.history.state.vratimeNavigation, marker);
    assert.equal(host.history.length, 3, 'veto must replace the traversed marker rather than grow history');
    assert.equal(seen.at(-1).activeTab, 'deals');
    assert.equal(seen.at(-1).overlayCount, 1);
  }
  assert.equal(closed, 0);
  busy = false;
  host.history.back(); host.flush();
  assert.equal(closed, 1);
  assert.equal(seen.at(-1).overlayCount, 0);
  host.history.forward(); host.flush();
  assert.equal(seen.at(-1).overlayCount, 0);
  assert.deepEqual(host.history.state.vratimeNavigation.overlays, []);
  assert.equal(closed, 1, 'Forward must not recreate the closed publication');
  navigation.dispose();
});

await check('a nested child closes while its busy parent vetoes subsequent Back and queued tab navigation', () => {
  const host = historyHost(); const seen = []; let busy = true; const closed = [];
  const navigation = historyModule.createAppHistory(host, (state) => seen.push(state));
  navigation.registerOverlay('create', () => { if (busy) return false; closed.push('create'); });
  navigation.registerOverlay('preview', () => { closed.push('preview'); });
  navigation.navigate('profile'); host.flush();
  assert.deepEqual(closed, ['preview']);
  assert.equal(seen.at(-1).activeTab, 'map');
  assert.equal(seen.at(-1).overlayCount, 1);
  host.history.back(); host.flush();
  assert.deepEqual(closed, ['preview']);
  assert.equal(seen.at(-1).overlayCount, 1);
  busy = false;
  host.history.back(); host.flush();
  assert.deepEqual(closed, ['preview', 'create']);
  assert.equal(seen.at(-1).activeTab, 'map', 'a vetoed tab request must not resume after unlocking');
  assert.equal(seen.at(-1).overlayCount, 0);
  navigation.dispose();
});

await check('a multi-entry Back closes a child but restores its busy parent without resurrecting the child', () => {
  const host = historyHost(); const seen = []; let busy = true; const closed = [];
  const navigation = historyModule.createAppHistory(host, (state) => seen.push(state));
  navigation.navigate('deals');
  navigation.registerOverlay('create', () => { if (busy) return false; closed.push('create'); });
  navigation.registerOverlay('preview', () => { closed.push('preview'); });
  host.history.go(-2); host.flush();
  assert.deepEqual(closed, ['preview']);
  assert.equal(seen.at(-1).activeTab, 'deals');
  assert.equal(seen.at(-1).overlayCount, 1);
  assert.equal(host.history.state.vratimeNavigation.overlays.length, 1);
  busy = false;
  host.history.back(); host.flush();
  assert.deepEqual(closed, ['preview', 'create']);
  assert.equal(seen.at(-1).overlayCount, 0);
  navigation.dispose();
});

function clock() {
  const timers = new Map(); let id = 0;
  return {
    setTimeout(run, ms) { timers.set(++id, { run, ms }); return id; },
    clearTimeout(key) { timers.delete(key); },
    flush(ms = 0) { for (const [key, timer] of [...timers]) if (timer.ms <= ms) { timers.delete(key); timer.run(); } },
  };
}
const tick = async () => { await new Promise((resolve) => setImmediate(resolve)); };
function authFixture() {
  let callback; let resolve; let reject; let unsubscribed = false;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {
    api: {
      onAuthStateChange(run) { callback = run; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; },
      getSession() { return pending; },
    },
    emit(event, session) { return callback(event, session); }, resolve, reject,
    get unsubscribed() { return unsubscribed; },
  };
}

await check('auth callback returns synchronously and defers application work outside the auth lock', async () => {
  assert.equal(typeof authModule.startSessionBootstrap, 'function', 'session bootstrap is missing');
  const fixture = authFixture(); const scheduler = clock(); const seen = [];
  const stop = authModule.startSessionBootstrap(fixture.api, { onSession: (session) => seen.push(session), onError() {} }, scheduler);
  assert.equal(fixture.emit('SIGNED_IN', { user: { id: 'a' } }), undefined);
  assert.deepEqual(seen, []);
  scheduler.flush();
  assert.equal(seen[0].user.id, 'a');
  stop(); assert.equal(fixture.unsubscribed, true);
  fixture.resolve({ data: { session: null }, error: null }); await tick(); scheduler.flush();
  assert.equal(seen.length, 1);
});

await check('a delayed getSession cannot undo a newer sign-in or sign-out event', async () => {
  assert.equal(typeof authModule.startSessionBootstrap, 'function', 'session race protection is missing');
  for (const [event, session, oldSession] of [
    ['SIGNED_IN', { user: { id: 'new' } }, null],
    ['SIGNED_OUT', null, { user: { id: 'old' } }],
  ]) {
    const fixture = authFixture(); const scheduler = clock(); const seen = [];
    const stop = authModule.startSessionBootstrap(fixture.api, { onSession: (value) => seen.push(value), onError() {} }, scheduler);
    fixture.emit(event, session);
    fixture.resolve({ data: { session: oldSession }, error: null }); await tick(); scheduler.flush();
    assert.deepEqual(seen, [session]); stop();
  }
});

await check('an auth event emitted during subscription also wins over a stale storage result', async () => {
  const scheduler = clock(); const seen = [];
  const api = {
    onAuthStateChange(callback) { callback('SIGNED_IN', { user: { id: 'immediate' } }); return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session: null }, error: null }; },
  };
  const stop = authModule.startSessionBootstrap(api, { onSession: (value) => seen.push(value), onError() {} }, scheduler);
  await tick(); scheduler.flush();
  assert.deepEqual(seen, [{ user: { id: 'immediate' } }]); stop();
});

await check('persisted auth, initial errors and timeouts always settle into a recoverable state', async () => {
  assert.equal(typeof authModule.startSessionBootstrap, 'function', 'initial auth recovery is missing');
  for (const mode of ['persisted', 'rejected', 'timeout']) {
    const fixture = authFixture(); const scheduler = clock(); const seen = []; const errors = [];
    const stop = authModule.startSessionBootstrap(fixture.api, { onSession: (value) => seen.push(value), onError: (value) => errors.push(value) }, scheduler);
    if (mode === 'persisted') fixture.resolve({ data: { session: { user: { id: 'saved' } } }, error: null });
    if (mode === 'rejected') fixture.reject(new Error('private provider payload must not escape'));
    await tick(); scheduler.flush(mode === 'timeout' ? 15000 : 0);
    if (mode === 'persisted') assert.equal(seen[0].user.id, 'saved');
    else { assert.equal(errors.length, 1); assert.equal(typeof errors[0], 'string'); assert.doesNotMatch(errors[0], /private provider/); }
    stop();
  }
});

await check('OAuth return handling removes credentials without copying them into persisted navigation', () => {
  assert.equal(typeof authModule.readAuthReturn, 'function', 'OAuth return handling is missing');
  assert.deepEqual(authModule.readAuthReturn('https://app.example/?code=secret&keep=1#access_token=private'), { pending: true, failed: false });
  assert.deepEqual(authModule.readAuthReturn('https://app.example/#error=access_denied&error_description=private'), { pending: false, failed: true });
  assert.equal(authModule.cleanAuthReturnUrl('https://app.example/?code=secret&refresh_token=private&keep=1#access_token=private&token_type=bearer'), '/?keep=1');
  assert.equal(authModule.cleanAuthReturnUrl('https://app.example/?keep=1#section'), '/?keep=1#section');
});

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
await check('installation stays quiet until a meaningful action and dismissal survives remounts for its cooldown', () => {
  assert.equal(typeof installModule.canOfferInstall, 'function', 'install milestone eligibility is missing');
  const store = storage(); const now = 1000000;
  assert.equal(installModule.canOfferInstall(store, now), false);
  installModule.recordInstallMilestone(store, 'login', now);
  assert.equal(installModule.canOfferInstall(store, now), false);
  installModule.recordInstallMilestone(store, 'listing', now);
  assert.equal(installModule.canOfferInstall(store, now), true);
  installModule.recordInstallDismissal(store, now);
  assert.equal(installModule.canOfferInstall(store, now + 29 * 86400000), false);
  assert.equal(installModule.canOfferInstall(store, now + 31 * 86400000), true);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => installModule.recordInstallMilestone(broken, 'transaction', now));
  assert.equal(installModule.canOfferInstall(broken, now), false);
});

await check('visual viewport follows keyboard resizing while pinch zoom does not masquerade as keyboard', () => {
  assert.equal(typeof viewportModule.measureVisualViewport, 'function', 'visual viewport measurement is missing');
  assert.deepEqual(viewportModule.measureVisualViewport({ height: 480, offsetTop: 12, scale: 1 }, 800, true), { height: 480, top: 12, keyboardHeight: 308 });
  assert.equal(viewportModule.measureVisualViewport({ height: 400, offsetTop: 0, scale: 2 }, 800, true).keyboardHeight, 0);
  assert.equal(viewportModule.measureVisualViewport(null, 800, true).height, 800);
  assert.equal(viewportModule.measureVisualViewport({ height: 700, offsetTop: 0, scale: 1 }, 800, false).keyboardHeight, 0);
});

await check('visual viewport subscriptions update CSS values and clean up on unmount', () => {
  const listeners = new Map(); const values = new Map(); const frames = new Map(); let sequence = 0;
  const events = {
    addEventListener(name, run) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(run); },
    removeEventListener(name, run) { listeners.get(name)?.delete(run); },
  };
  const root = { dataset: {}, style: { setProperty: (key, value) => values.set(key, value), removeProperty: (key) => values.delete(key) } };
  const host = {
    ...events, innerHeight: 800,
    document: { ...events, documentElement: root, activeElement: { matches: () => true } },
    visualViewport: { ...events, height: 480, offsetTop: 0, scale: 1 },
    requestAnimationFrame(run) { frames.set(++sequence, run); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const cleanup = viewportModule.observeVisualViewport(host);
  assert.equal(values.get('--app-viewport-height'), '480px');
  assert.equal(root.dataset.keyboardOpen, 'true');
  host.visualViewport.height = 800;
  for (const run of listeners.get('resize')) run();
  for (const run of frames.values()) run();
  assert.equal(values.get('--app-viewport-height'), '800px');
  assert.equal(root.dataset.keyboardOpen, 'false');
  cleanup();
  assert.equal(values.size, 0);
  assert.equal([...listeners.values()].reduce((count, set) => count + set.size, 0), 0);
});

function dialogFixture() {
  const handlers = new Map();
  const doc = {
    activeElement: null,
    addEventListener(type, run) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(run); },
    removeEventListener(type, run) { handlers.get(type)?.delete(run); },
  };
  const element = (disabled = false) => ({
    disabled, isConnected: true, hidden: false, tabIndex: 0,
    getClientRects: () => [1], closest: () => null,
    focus() { doc.activeElement = this; },
  });
  const trigger = element(); trigger.focus();
  const first = element(); const last = element(); const disabled = element(true);
  const dialog = Object.assign(element(), {
    querySelectorAll: () => [first, disabled, last],
    contains: (node) => [dialog, first, disabled, last].includes(node),
  });
  const key = (keyName, shiftKey = false) => {
    const event = { key: keyName, shiftKey, preventDefault() { this.prevented = true; }, stopPropagation() {} };
    for (const run of [...(handlers.get('keydown') || [])]) run(event);
    return event;
  };
  return { doc, trigger, first, last, dialog, key, element };
}
await check('dialog focus traps Tab, handles Escape and restores the opener without hiding the whole app', () => {
  assert.equal(typeof focusModule.installDialogFocus, 'function', 'dialog focus management is missing');
  const fixture = dialogFixture(); let closed = 0;
  const cleanup = focusModule.installDialogFocus(fixture.dialog, () => { closed += 1; }, { document: fixture.doc });
  assert.equal(fixture.doc.activeElement, fixture.first);
  fixture.last.focus(); assert.equal(fixture.key('Tab').prevented, true);
  assert.equal(fixture.doc.activeElement, fixture.first);
  fixture.key('Tab', true); assert.equal(fixture.doc.activeElement, fixture.last);
  fixture.key('Escape'); assert.equal(closed, 1);
  cleanup(); assert.equal(fixture.doc.activeElement, fixture.trigger);
  fixture.key('Escape'); assert.equal(closed, 1);
});

await check('only the top nested dialog handles Escape and empty dialogs keep focus inside', () => {
  assert.equal(typeof focusModule.installDialogFocus, 'function', 'nested dialog focus management is missing');
  const fixture = dialogFixture(); let outerClosed = 0; let innerClosed = 0;
  const cleanupOuter = focusModule.installDialogFocus(fixture.dialog, () => { outerClosed += 1; }, { document: fixture.doc });
  const inner = Object.assign(fixture.element(), { querySelectorAll: () => [], contains(node) { return node === this; } });
  const cleanupInner = focusModule.installDialogFocus(inner, () => { innerClosed += 1; }, { document: fixture.doc });
  assert.equal(fixture.doc.activeElement, inner);
  assert.equal(fixture.key('Tab').prevented, true);
  fixture.key('Escape'); assert.equal(innerClosed, 1); assert.equal(outerClosed, 0);
  cleanupInner(); cleanupOuter();
});

if (failures) process.exitCode = 1;
else console.log('Navigation resilience checks passed. No live auth, account or database calls were made.');
