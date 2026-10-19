import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'rolldown/utils';
import i18n from '../src/i18n/index.js';
import { subscribeToasts } from '../src/lib/toast.js';
import { createExperienceTranslations } from '../src/i18n/uxCreate.js';

// Exercise the real form and its event handlers offline. Replace only browser map,
// React scheduling (there is no DOM), and network/storage boundaries.
const srcUrl = new URL('../src/', import.meta.url).href;
const reactUrl = import.meta.resolve('react');
const runtimeUrl = import.meta.resolve('react/jsx-runtime');
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(srcUrl) && /^\.\.\/supabaseClient(?:\.js)?$/.test(specifier)) return {url:'create-ux-test:supabase',shortCircuit:true};
    if (context.parentURL?.endsWith('/pages/CreateListing.jsx')) {
      const seams = { react: 'hooks', 'react/jsx-runtime': 'capture', 'react-leaflet': 'map', '../lib/basemap': 'basemap', '../lib/mapMarkers': 'markers', '../supabaseClient': 'supabase', '../lib/api': 'api' };
      if (seams[specifier]) return { url: `create-ux-test:${seams[specifier]}`, shortCircuit: true };
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
    const module = (source) => ({ format: 'module', source, shortCircuit: true });
    if (url.startsWith(srcUrl) && url.endsWith('.css')) return module('export default {};');
    if (url === 'create-ux-test:hooks') return module(`
      export * from ${JSON.stringify(reactUrl)};
      let values = [], cursor = 0, pending = [];
      export const reset = () => { values = []; cursor = 0; pending = []; };
      export const begin = () => { cursor = 0; pending = []; };
      export const flush = async () => { for (const effect of pending) effect(); await Promise.resolve(); };
      export const useState = (initial) => {
        const slot = cursor++;
        if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
        return [values[slot], (next) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
      };
      export const useRef = (initial) => { const [value] = useState(() => ({ current: initial })); return value; };
      export const useMemo = (compute, deps) => {
        const slot = cursor++;
        if (!values[slot] || !deps || deps.some((value,index)=>value!==values[slot].deps[index])) values[slot] = {deps,value:compute()};
        return values[slot].value;
      };
      export const useEffect = (effect, deps) => {
        const slot = cursor++;
        if (!values[slot] || deps.some((value, index) => value !== values[slot][index])) pending.push(effect);
        values[slot] = deps;
      };
    `);
    if (url === 'create-ux-test:capture') return module(`
      import { jsx as realJsx, jsxs as realJsxs } from ${JSON.stringify(runtimeUrl)};
      export { Fragment } from ${JSON.stringify(runtimeUrl)};
      export const elements = [];
      const capture = (render, type, props, key) => { elements.push({ type, props }); return render(type, props, key); };
      export const jsx = (...args) => capture(realJsx, ...args);
      export const jsxs = (...args) => capture(realJsxs, ...args);
    `);
    if (url === 'create-ux-test:map') return module(`
      export const moves = [];
      export const map = { getZoom: () => 17, panTo: (...args) => moves.push({ method: 'panTo', args }), flyTo: (...args) => moves.push({ method: 'flyTo', args }) };
      export let mapEvents = {}, markerProps = {};
      export const MapContainer = ({ children }) => children;
      export const TileLayer = () => null;
      export const Marker = (props) => { markerProps = props; return null; };
      export const useMap = () => map;
      export const useMapEvents = (events) => { mapEvents = events; return map; };
    `);
    if (url === 'create-ux-test:markers') return module('export const mapMarkerIcons = {};');
    if (url === 'create-ux-test:basemap') return module('export const baseMap = { attribution: "Offline map", url: "", maxZoom: 20 };');
    if (url === 'create-ux-test:supabase') return module(`
      export const writes = [];
      const categories = [{ id: 1, parent_id: null, category_path: 'pallet/egg-crates', slug: 'egg-crates', name: 'Egg cartons' }];
      export const supabase = {
        auth: { getUser: async () => ({data:{user:{id:'user-fixture'}},error:null}), onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}) },
        from: (table) => ({ select: () => ({ order: async () => ({ data: categories, error: null }) }), insert: (payload) => { writes.push({ table, payload }); const result = Promise.resolve({ error:null }); result.abortSignal = () => result; return result; } }),
        storage: { from: () => ({ upload: async () => { throw new Error('Test must not upload'); }, remove: async () => ({ error: null }) }) },
      };
    `);
    if (url === 'create-ux-test:api') return module('export const updates = []; export const updateMyListing = async (payload) => { updates.push(payload); };');
    if (url.startsWith(srcUrl) && /\.(webp|png)$/.test(url)) return module(`export default ${JSON.stringify(url)};`);
    if (url.startsWith(srcUrl) && url.endsWith('.jsx')) {
      const result = transformSync(fileURLToPath(url), readFileSync(new URL(url), 'utf8'), { jsx: { runtime: 'automatic' } });
      assert.equal(result.errors.length, 0);
      return module(result.code);
    }
    return nextLoad(url, context);
  },
});

try {
  const { default: CreateListing } = await import('../src/pages/CreateListing.jsx');
  const state = await import('create-ux-test:hooks');
  const capture = await import('create-ux-test:capture');
  const map = await import('create-ux-test:map');
  const { writes } = await import('create-ux-test:supabase');
  const { updates } = await import('create-ux-test:api');
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout: () => 0, dispatchEvent: () => {} };
  const toasts = [];
  const unsubscribe = subscribeToasts((toast) => toasts.push(toast));
  const fixture = {
    id: 'listing-fixture', user_id: 'user-fixture', type: 'give', category_id: 1,
    category_path: 'pallet/egg-crates', category: 'Яичные ячейки', quantity: 4,
    lat: 42.46, lng: 18.51, location_label: 'Igalo, Herceg Novi', pickup_mode: 'entrance',
    pickup_windows: ['Monday 18:00', { label: 'Tuesday 19:00', note: 'legacy metadata' }, 'Friday 17:00'],
  };
  let props;
  const render = () => {
    state.begin();
    capture.elements.length = 0;
    return renderToStaticMarkup(createElement(CreateListing, props));
  };
  const start = async (editingListing = fixture) => {
    state.reset(); writes.length = 0; updates.length = 0; toasts.length = 0;
    props = { userId: 'user-fixture', editingListing, onBack: () => {}, onSuccess: () => {} };
    render(); await state.flush(); return render();
  };
  const elements = (type) => capture.elements.filter((element) => element.type === type).map(({ props: elementProps }) => elementProps);
  const text = (value) => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' ? value : '';
  const button = (label) => elements('button').find((item) => text(item.children) === label);
  const input = (name) => elements('input').find((item) => item.name === name);
  const publishButton = () => elements('button').find((item) => item.className === 'btn-primary w-full');
  const change = (field, value) => { assert.ok(field, 'Expected form field'); field.onChange({ target: { value } }); return render(); };
  const failures = [];
  const check = async (name, action) => { try { await action(); } catch (error) { failures.push(`${name}: ${error.message.split('\n')[0]}`); } };
  for (const [language, translations] of Object.entries(createExperienceTranslations)) i18n.addResourceBundle(language, 'translation', { createExperience: translations }, true, true);
  await i18n.changeLanguage('en');

  await check('new quantity starts empty and clearing does not restore 1', async () => {
    await start(null);
    elements('button').find((item) => item.className === 'choice-card give').onClick();
    render(); elements('button').find((item) => item.className.includes('category-card')).onClick();
    let html = render();
    assert.equal(input('quantity')?.value, '');
    assert.ok(publishButton().disabled);
    assert.match(html, /quantity/i);
    html = change(input('quantity'), '3');
    assert.equal(input('quantity').value, '3');
    html = change(input('quantity'), '');
    assert.equal(input('quantity').value, '');
    assert.ok(publishButton().disabled);
    assert.match(html, /whole number from 1 to 10,000/i);
  });
  await check('optional fields and mandatory markers are visible; material has no condition or handover selector', async () => {
    const html = await start();
    assert.equal(elements('select').length, 0);
    assert.match(html, /Quantity.*?\*/);
    assert.match(html, /Description.*?optional/i);
    assert.match(html, /Weight, kg.*?optional/i);
    assert.match(html, /Address or pickup point.*?\*/);
    assert.equal(elements('input').filter((item) => item.name === 'pickup_time').length, 1);
  });
  await check('a new listing requires a deliberate location and publishes immediately after selection', async () => {
    await start(null);
    elements('button').find((item) => item.className === 'choice-card give').onClick();
    render(); elements('button').find((item) => item.className.includes('category-card')).onClick(); render();
    change(input('quantity'), '2');
    assert.ok(publishButton().disabled, 'Default map center must not count as a chosen point');
    globalThis.fetch = async () => { throw new Error('offline'); };
    map.mapEvents.click({ latlng: { lat: 42.47, lng: 18.52 } });
    await Promise.resolve(); render();
    assert.equal(publishButton().disabled, false);
    await publishButton().onClick();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].table, 'listings');
    assert.equal(writes[0].payload.quantity, 2);
    assert.equal(writes[0].payload.moderation_status, 'approved');
    assert.equal(writes[0].payload.pickup_mode, 'public_place');
    assert.deepEqual(writes[0].payload.pickup_windows, []);
    assert.equal(toasts.at(-1).message, 'Listing published.');
  });
  await check('unchanged pickup times and backend handover are preserved when editing', async () => {
    await start();
    assert.equal(input('pickup_time')?.value, 'Monday 18:00 · Tuesday 19:00 · Friday 17:00');
    await publishButton().onClick();
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].pickup_windows, fixture.pickup_windows);
    assert.equal(updates[0].pickup_mode, 'entrance');
    assert.equal(updates[0].moderation_status, 'approved');
  });
  await check('edited pickup time becomes one text entry', async () => {
    await start(); change(input('pickup_time'), 'Every evening after 18:00');
    await publishButton().onClick();
    assert.deepEqual(updates[0].pickup_windows, ['Every evening after 18:00']);
  });
  await check('invalid quantities explain their blocker and never save', async () => {
    for (const value of ['', '0', '-1', '1.5', '10001']) {
      await start(); const html = change(input('quantity'), value);
      assert.ok(publishButton().disabled);
      assert.match(html, /whole number from 1 to 10,000/i);
      await publishButton().onClick();
      assert.equal(updates.length, 0);
    }
  });
  await check('both quantity range edges can be saved', async () => {
    for (const value of ['1', '10000']) {
      await start(); change(input('quantity'), value);
      assert.equal(publishButton().disabled, false);
      await publishButton().onClick(); assert.equal(updates[0].quantity, Number(value));
    }
  });
  await check('loan duration and photo blockers remain explicit', async () => {
    let html = await start({ ...fixture, type: 'lend' });
    assert.match(html, /photo.*?\*/i);
    assert.match(html, /Loan duration, days.*?\*/);
    assert.equal(elements('select').length, 1);
    assert.ok(publishButton().disabled);
    html = change(input('loan_duration_days'), '');
    assert.match(html, /whole number from 1 to 365/i);
    assert.match(html, /condition photo/i);
    await publishButton().onClick(); assert.equal(updates.length, 0);
  });
  await check('loan with a condition photo and valid duration can save', async () => {
    await start({ ...fixture, type: 'lend', loan_duration_days: 3, image_urls: ['https://example.test/condition.webp'] });
    assert.equal(publishButton().disabled, false);
    await publishButton().onClick();
    assert.equal(updates[0].loan_duration_days, 3);
    assert.deepEqual(updates[0].image_urls, ['https://example.test/condition.webp']);
    await start({ ...fixture, category_path: 'cloth/clothing/kids-cloth' });
    assert.equal(elements('select').length, 1);
  });
  await check('typing 3 address characters removes short hint and requires selection', async () => {
    await start(); let html = change(input('address'), 'Ig');
    assert.match(html, /at least 3 characters/i);
    html = change(input('address'), 'Igalo');
    assert.doesNotMatch(html, /at least 3 characters/i);
    assert.match(html, /choose a search result or mark/i);
    assert.ok(publishButton().disabled);
  });
  await check('pin is usable after failed reverse lookup and latest position wins', async () => {
    await start();
    globalThis.fetch = async () => { throw new Error('offline'); };
    map.mapEvents.click({ latlng: { lat: 42.47, lng: 18.52 } });
    await Promise.resolve(); const html = render();
    assert.equal(publishButton().disabled, false);
    assert.equal(input('address').value, 'Selected map point');
    assert.ok(input('address').value.trim().length >= 3);
    assert.match(html, /Coordinates: 42\.47000, 18\.52000/);
    await publishButton().onClick();
    assert.equal(updates[0].lat, 42.47);
    assert.equal(updates[0].lng, 18.52);
    assert.equal(updates[0].location_label, 'Selected map point');
    assert.doesNotMatch(updates[0].location_label, /\d/);
  });
  await check('dragged marker keeps its position and map zoom', async () => {
    await start(); map.moves.length = 0;
    globalThis.fetch = async () => { throw new Error('offline'); };
    map.markerProps.eventHandlers.dragend({ target: { getLatLng: () => ({ lat: 42.49, lng: 18.54 }) } });
    render(); await state.flush();
    assert.deepEqual(map.markerProps.position, [42.49, 18.54]);
    assert.deepEqual(map.moves, [{ method: 'panTo', args: [[42.49, 18.54], { animate: true, duration: 0.7 }] }]);
  });
  await check('stale reverse address cannot replace later typed text', async () => {
    await start(); let finish;
    globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
    map.mapEvents.click({ latlng: { lat: 42.47, lng: 18.52 } }); render();
    change(input('address'), 'New typed address');
    finish({ ok: true, json: async () => ({ display_name: 'Old reverse result' }) });
    await Promise.resolve(); await Promise.resolve(); render();
    assert.equal(input('address').value, 'New typed address');
    assert.ok(publishButton().disabled);
  });
  await check('older reverse lookup cannot move a more recently dragged pin', async () => {
    await start(); let finish;
    globalThis.fetch = (url) => String(url).includes('lat=42.47&')
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve({ ok: true, json: async () => ({ display_name: 'Newest dragged point' }) });
    map.mapEvents.click({ latlng: { lat: 42.47, lng: 18.52 } }); render();
    map.markerProps.eventHandlers.dragend({ target: { getLatLng: () => ({ lat: 42.49, lng: 18.54 }) } });
    await Promise.resolve(); await Promise.resolve();
    finish({ ok: true, json: async () => ({ display_name: 'Older clicked point' }) });
    await Promise.resolve(); await Promise.resolve(); render();
    assert.equal(input('address').value, 'Newest dragged point');
    assert.deepEqual(map.markerProps.position, [42.49, 18.54]);
  });
  await check('pending geolocation cannot replace a later selected point', async () => {
    await start(); let locate;
    const originalGeolocation = globalThis.navigator.geolocation;
    Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (success) => { locate = success; } } });
    globalThis.fetch = async () => { throw new Error('offline'); };
    try {
      button(i18n.t('create.useLocation')).onClick(); render();
      map.mapEvents.click({ latlng: { lat: 42.49, lng: 18.54 } });
      locate({ coords: { latitude: 42.1, longitude: 18.1 } });
      await Promise.resolve(); render();
      assert.deepEqual(map.markerProps.position, [42.49, 18.54]);
      assert.equal(publishButton().disabled, false);
    } finally {
      Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: originalGeolocation });
    }
  });
  await check('stale search results cannot overwrite a chosen pin', async () => {
    await start(); let finish;
    globalThis.fetch = (url) => String(url).includes('/search?')
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve({ ok: true, json: async () => ({ display_name: 'Newest pin address' }) });
    change(input('address'), 'Igalo');
    const search = button(i18n.t('create.findAddress')).onClick();
    map.mapEvents.click({ latlng: { lat: 42.48, lng: 18.53 } });
    finish({ ok: true, json: async () => [{ place_id: 123, lat: '42.1', lon: '18.1', display_name: 'Stale result' }] });
    await search; await Promise.resolve(); render();
    assert.equal(input('address').value, 'Newest pin address');
    assert.ok(!elements('button').some((item) => text(item.children).includes('Stale result')));
  });
  await check('publish action has no icon', async () => {
    await start(); assert.equal(typeof publishButton().children, 'string');
  });
  await check('every new instruction and blocker is translated in all five languages', async () => {
    const keys = Object.keys(createExperienceTranslations.en).filter((key) => key !== 'blockers');
    for (const language of ['ru', 'me', 'en', 'fr', 'de']) {
      await i18n.changeLanguage(language);
      for (const key of [...keys, ...Object.keys(createExperienceTranslations.en.blockers).map((key) => `blockers.${key}`)]) {
        const path = `createExperience.${key}`;
        assert.equal(i18n.exists(path, { lng: language, fallbackLng: false }), true, `${language}: ${path}`);
        assert.notEqual(i18n.t(path), path);
      }
    }
    await i18n.changeLanguage('en');
  });
  await check('fallback labels in all five languages contain no exact coordinates', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    for (const language of ['ru', 'me', 'en', 'fr', 'de']) {
      await i18n.changeLanguage(language);
      await start();
      map.mapEvents.click({ latlng: { lat: 42.47, lng: 18.52 } });
      await Promise.resolve(); render();
      await publishButton().onClick();
      assert.equal(updates[0].location_label, createExperienceTranslations[language].pinLabel);
      assert.ok(updates[0].location_label.trim().length >= 3);
      assert.doesNotMatch(updates[0].location_label, /\d|\{\{/);
      assert.equal(updates[0].lat, 42.47);
      assert.equal(updates[0].lng, 18.52);
    }
    await i18n.changeLanguage('en');
  });

  await check('restoring a saved draft requires renewed quantity and pickup confirmation', async () => {
    const originalStorage = globalThis.localStorage;
    const memory = new Map();
    globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key,value) => memory.set(key,value), removeItem: key => memory.delete(key) };
    try {
      const { createListingDraftStore } = await import('../src/lib/listingDraft.js');
      const store = createListingDraftStore();
      await store.save('user-fixture', fixture.id, {form: {...fixture, quantity:'4'}, selected:{id:'1', category_path:'pallet/egg-crates', name_en:'Egg cartons'}, position:[42.46,18.51], address:fixture.location_label, addressVerified:true, locationKind:'address', step:3},[]);
      await start(fixture);
      for(let i=0;i<5;i++){await Promise.resolve();render();}
      const restore = button('Continue'); assert.ok(restore,'Saved draft must be offered');
      restore.onClick(); render();
      assert.equal(input('address')['aria-invalid'], true, 'Saved point needs fresh confirmation');
      assert.equal(input('quantity').value, '4');
      const confirmation=elements('input').find(item=>item.name==='draft_review');
      assert.ok(confirmation,'Explicit quantity and point confirmation is required');
      assert.equal(publishButton().disabled,true);
      confirmation.onChange({target:{checked:true}});render();
      assert.equal(input('address')['aria-invalid'],false);
    } finally { globalThis.localStorage=originalStorage; }
  });
  const { shouldShowCondition, pickupTimeForSave } = await import('../src/lib/listingForm.js');
  await check('condition is narrow to clothing and loans, never material or packaging paths', () => {
    for (const path of ['pallet/egg-crates', 'pallet/pallets', 'box/cardboard', 'cloth/rags', 'glass/jars/clear-jar', '', 'tools/drill', 'cloth/clothing-fabric']) assert.equal(shouldShowCondition('give', path), false, path);
    assert.equal(shouldShowCondition('give', 'cloth/clothing/men-cloth'), true);
    assert.equal(shouldShowCondition('take', 'cloth/clothing/kids-cloth'), true);
    assert.equal(shouldShowCondition('lend', 'pallet/egg-crates'), true);
  });
  await check('pickup helper does not lose legacy objects or split punctuation in new text', () => {
    assert.deepEqual(pickupTimeForSave('Monday · Tuesday', ['Monday', { label: 'Tuesday' }]), ['Monday', { label: 'Tuesday' }]);
    assert.deepEqual(pickupTimeForSave('Today · tomorrow', ['Monday']), ['Today · tomorrow']);
    assert.deepEqual(pickupTimeForSave('', ['Monday']), []);
  });
  if (failures.length) throw new Error(failures.join('\n'));
  unsubscribe(); globalThis.fetch = originalFetch; globalThis.window = originalWindow;
  process.stdout.write('Create UX passed: real form validation/actions, optional/required fields, pickup preservation, material/loan condition, pin fallback, and stale geocoding.\n');
} finally {
  hooks.deregister();
}
