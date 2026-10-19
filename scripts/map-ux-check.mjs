import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'rolldown/utils';
import i18n from '../src/i18n/index.js';

// Render the actual map screen offline. Only browser-only Leaflet, initial data,
// and the network boundary are replaced; event handlers and JSX stay real.
const srcUrl = new URL('../src/', import.meta.url).href;
const reactUrl = import.meta.resolve('react');
const jsxUrl = import.meta.resolve('react/jsx-runtime');
const apiExports = ['getCollectionPoints', 'getMyDeals', 'getMyDiscoveryFeed', 'getPublicMapListings', 'refreshExpiredDeals', 'saveSearch', 'voteCollectionPoint', 'createReport', 'createCollectionPoint'];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/pages/MapScreen.jsx')) {
      if (specifier === 'react') return { url: 'map-test:state', shortCircuit: true };
      if (specifier === 'react/jsx-runtime') return { url: 'map-test:elements', shortCircuit: true };
    }
    if (context.parentURL?.startsWith(srcUrl)) {
      const substitutes = {
        'react-leaflet': 'map-test:leaflet', '../lib/api': 'map-test:api',
        '../supabaseClient': 'map-test:supabase', '../lib/mapMarkers': 'map-test:markers',
        '../lib/basemap': 'map-test:basemap',
      };
      if (substitutes[specifier]) return { url: substitutes[specifier], shortCircuit: true };
      if (specifier.startsWith('.')) {
        const base = new URL(specifier, context.parentURL);
        for (const extension of ['.js', '.jsx', '/index.js']) {
          const candidate = new URL(`${base.href}${extension}`);
          if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const sources = {
      'map-test:state': `
        import * as React from ${JSON.stringify(reactUrl)};
        export * from ${JSON.stringify(reactUrl)};
        export const values = new Map(), effects = [];
        let index = 0;
        export const begin = () => { index = 0; effects.length = 0; };
        export const useState = initial => {
          const key = index++;
          const [value] = React.useState(values.has(key) ? values.get(key) : initial);
          return [value, next => values.set(key, typeof next === 'function' ? next(value) : next)];
        };
        export const useEffect = (effect, dependencies) => { effects.push({ effect, dependencies }); React.useEffect(effect, dependencies); };
      `,
      'map-test:elements': `
        import { jsx as realJsx, jsxs as realJsxs } from ${JSON.stringify(jsxUrl)};
        export { Fragment } from ${JSON.stringify(jsxUrl)};
        export const elements = [];
        const capture = (render, type, props, key) => { elements.push({ type, props }); return render(type, props, key); };
        export const jsx = (...args) => capture(realJsx, ...args);
        export const jsxs = (...args) => capture(realJsxs, ...args);
      `,
      'map-test:leaflet': `
        import { createElement, Fragment } from ${JSON.stringify(reactUrl)};
        export const layers = [], mapCalls = [];
        export const map = {
          attributionControl: { setPrefix: value => mapCalls.push(['prefix', value]) },
          stop() { mapCalls.push(['stop']); return this; },
          setView: (...args) => mapCalls.push(['setView', ...args]),
          fitBounds: (...args) => mapCalls.push(['fitBounds', ...args]),
          flyTo: (...args) => mapCalls.push(['flyTo', ...args]),
        };
        const layer = name => props => { layers.push({ name, props }); return createElement(Fragment, null, props.children); };
        export const MapContainer = layer('MapContainer'), Marker = layer('Marker'), Popup = layer('Popup'),
          Tooltip = layer('Tooltip'), TileLayer = layer('TileLayer');
        export const useMap = () => map;
      `,
      'map-test:api': `
        export const calls = [];
        export const bookListing = async (...args) => { calls.push(args); throw new Error('Offline request boundary'); };
        export const toggleListingFavourite = async (...args) => { calls.push({ favourite: args }); return true; };
        const forbidden = () => { throw new Error('Offline test must not access API'); };
        export const ${apiExports.map(name => `${name} = forbidden`).join(', ')};
      `,
      'map-test:supabase': "export const supabase = new Proxy({}, { get() { throw new Error('Offline test must not access Supabase'); } });",
      'map-test:markers': 'export const mapMarkerIcons = { give: {}, take: {}, lend: {}, collection: {} };',
      'map-test:basemap': `export const baseMap = { url: 'offline://tiles', attribution: '&copy; OpenStreetMap contributors &copy; MapTiler', maxZoom: 20 };`,
    };
    if (sources[url]) return { format: 'module', source: sources[url], shortCircuit: true };
    if (url.startsWith(srcUrl) && /\.(webp|png)$/.test(url)) return { format: 'module', source: `export default ${JSON.stringify(url)};`, shortCircuit: true };
    if (url.startsWith(srcUrl) && url.endsWith('.jsx')) {
      const result = transformSync(fileURLToPath(url), readFileSync(new URL(url), 'utf8'), { jsx: { runtime: 'automatic' } });
      assert.equal(result.errors.length, 0);
      return { format: 'module', source: result.code, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

try {
  const { default: MapScreen } = await import('../src/pages/MapScreen.jsx');
  const { values, begin, effects } = await import('map-test:state');
  const { elements } = await import('map-test:elements');
  const { layers, map, mapCalls } = await import('map-test:leaflet');
  const { calls } = await import('map-test:api');
  await i18n.changeLanguage('en');
  const fixture = { id: 'other-listing', user_id: 'other', category: 'Glass jars', category_path: 'glass/jars', type: 'give', quantity: 4, public_lat: 42.441, public_lng: 19.263, created_at: '2026-10-01T10:00:00Z', description: 'Keep this E2E description intact.' };
  const render = (patch = {}) => {
    values.clear();
    for (const [key, value] of Object.entries({ 0: [fixture], 3: false, ...patch })) values.set(Number(key), value);
    return rerender();
  };
  const rerender = () => {
    begin(); elements.length = 0; layers.length = 0; mapCalls.length = 0; calls.length = 0;
    return renderToStaticMarkup(createElement(MapScreen, { userId: 'me', onCreate() {} }));
  };
  const elementWithClass = name => elements.find(({ props }) => props.className?.split(' ').includes(name));
  const failures = [];
  const check = async (name, action) => {
    try { await action(); process.stdout.write(`PASS ${name}\n`); }
    catch (error) { failures.push(name); process.stderr.write(`FAIL ${name}: ${error.message.split('\n')[0]}\n`); }
  };
  await check('the map has no persistent bottom-list overlay; the count still opens its list', () => {
    render();
    assert.equal(elementWithClass('list-sheet-peek'), undefined);
    elementWithClass('count-badge').props.onClick();
    assert.match(rerender(), /class="listing-sheet open"/);
  });
  await check('show-results gives filters an explicit completion action and fits only on that action', () => {
    render();
    const show = elementWithClass('map-show-results');
    assert.ok(show, 'Filters need a visible show-results button');
    assert.equal(show.props.disabled, false);
    assert.ok(render().includes('Show on map'));
    elementWithClass('map-show-results').props.onClick();
    assert.equal(values.get(12), false, 'Applying should collapse the filters');
    rerender();
    const viewport = elements.find(({ props }) => props.resultsViewport)?.props.resultsViewport;
    assert.deepEqual(viewport.positions, [[fixture.public_lat, fixture.public_lng]]);
    const fit = effects.find(({ dependencies }) => dependencies?.includes(viewport));
    assert.ok(fit); fit.effect(); fit.effect();
    assert.equal(mapCalls.filter(([name]) => name === 'fitBounds').length, 1, 'One explicit action should fit once');
    render({ 0: [] }); assert.equal(elementWithClass('map-show-results').props.disabled, true);
    render({ 3: true }); assert.equal(elementWithClass('map-show-results').props.disabled, true);
  });
  await check('empty collection points leave the map clear and offer one reachable add action', () => {
    render({ 18: 'points', 19: [] });
    assert.equal(elementWithClass('map-state-empty'), undefined);
    const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' ? value : value?.props ? text(value.props.children) : '';
    const addButtons = elements.filter(({ type, props }) => type === 'button' && text(props.children) === i18n.t('points.add'));
    const toolbar = elementWithClass('point-layer-actions');
    assert.ok(toolbar);
    const action = toolbar.props.children.find(child => child.type === 'button');
    assert.ok(action);
    assert.equal(addButtons.length, 1, 'Only one add action should remain');
    action.props.onClick();
    assert.equal(values.get(20), true);
  });
  await check('collection point counter uses points rather than unrelated listings', () => {
    const point = { id: 'point-a', name: 'Offline collection point', lat: 42.44, lng: 19.26, status: 'unverified', materials: [], exists_votes: 0, missing_votes: 0 };
    render({ 0: [fixture, { ...fixture, id: 'listing-b' }, { ...fixture, id: 'listing-c' }], 18: 'points', 19: [point, { ...point, id: 'point-b' }] });
    const badge = elementWithClass('count-badge');
    assert.equal(badge.props.children[0].props.children, 2);
    assert.equal(badge.props.children[1].props.children, i18n.t('map.pointsLayer'));
    assert.equal(badge.props.onClick, undefined, 'Point count must not trigger a hidden listings sheet');
  });
  await check('collapsed collection toolbar preserves the correct count and layer name', () => {
    render({ 0: [fixture, { ...fixture, id: 'listing-b' }], 12: false, 18: 'points', 19: [] });
    const restore = elementWithClass('map-toolbar-restore');
    assert.equal(restore.props.children.find(child => child.type === 'strong').props.children, 0);
    assert.equal(restore.props.children.find(child => child.type === 'span').props.children, i18n.t('map.pointsLayer'));
  });
  await check('own listings contribute to count and markers and expose owner state', () => {
    const html = render({ 0: [{ ...fixture, id: 'own-listing', user_id: 'me' }] });
    assert.equal(layers.filter(layer => layer.name === 'Marker').length, 1);
    assert.match(html, /<strong>1<\/strong>/);
    assert.ok(elementWithClass('listing-owner'));
  });
  await check('own details disable requests and an invoked handler cannot open self-booking', () => {
    render({ 14: { ...fixture, user_id: 'me' } });
    const button = elementWithClass('listing-request-action');
    assert.ok(button?.props.disabled);
    button.props.onClick?.();
    assert.equal(values.get(15), undefined);
    assert.equal(calls.length, 0);
  });
  await check('collapsed filters retain an independent recenter control', () => {
    render({ 12: false });
    assert.equal(elementWithClass('map-recenter')?.type, 'button');
    assert.ok(elementWithClass('map-toolbar-restore'));
  });
  await check('only a deliberate upward swipe on the separate header handle collapses filters', () => {
    render();
    const handle = elementWithClass('map-toolbar-handle');
    assert.ok(handle?.props.onPointerDown && handle?.props.onPointerUp);
    const point = (clientX, clientY) => ({ pointerId: 1, clientX, clientY, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} } });
    handle.props.onPointerDown(point(80, 90));
    handle.props.onPointerUp(point(84, 30));
    assert.equal(values.get(12), false);
    render();
    const fresh = elementWithClass('map-toolbar-handle');
    fresh.props.onPointerDown(point(80, 90));
    fresh.props.onPointerUp(point(140, 60));
    fresh.props.onClick({ detail: 1 });
    assert.equal(values.get(12), undefined);
    const search = elements.find(({ type, props }) => type === 'input' && props.type === 'search');
    assert.equal(search.props.onPointerDown, undefined);
    assert.equal(elementWithClass('map-toolbar').props.onPointerDown, undefined);
  });
  await check('listing popup does not pan the map and opening it closes the overlapping tooltip', () => {
    render();
    assert.equal(layers.find(layer => layer.name === 'Popup').props.autoPan, false);
    let closed = false;
    layers.find(layer => layer.name === 'Marker').props.eventHandlers.popupopen({ target: { closeTooltip: () => { closed = true; } } });
    assert.equal(closed, true);
  });
  await check('map recenter cancels animation and provider attribution survives removing the prefix', () => {
    render({ 10: [42.44, 19.26] });
    for (const item of effects.filter(item => item.dependencies?.includes(map))) item.effect();
    assert.deepEqual(mapCalls, [['prefix', false], ['stop'], ['setView', [42.44, 19.26], 14, { animate: false }]]);
    assert.match(layers.find(layer => layer.name === 'TileLayer').props.attribution, /OpenStreetMap.*MapTiler/);
  });
  await check('requesting the same geolocation again still recenters after the user pans away', () => {
    render({ 10: [42.44, 19.26] });
    const before = effects.find(item => item.dependencies?.includes(map) && item.dependencies.length > 1).dependencies;
    const previous = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success) { success({ coords: { latitude: 42.44, longitude: 19.26 } }); } } });
    try { elementWithClass('map-recenter').props.onClick(); }
    finally {
      if (previous) Object.defineProperty(navigator, 'geolocation', previous);
      else delete navigator.geolocation;
    }
    rerender();
    const after = effects.find(item => item.dependencies?.includes(map) && item.dependencies.length > 1).dependencies;
    assert.notDeepEqual(after, before);
  });
  await check('locate locks synchronously, exposes pending state and resets with the precise error', () => {
    render(); let fail; let calls = 0;
    const previous = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success, error) { calls += 1; fail = error; } } });
    try {
      const button = elementWithClass('map-recenter'); button.props.onClick(); button.props.onClick();
      assert.equal(calls, 1, 'Repeated clicks must not start competing permission requests');
      rerender(); assert.equal(elementWithClass('map-recenter').props.disabled, true);
      fail({ code: 1 }); const html = rerender();
      assert.equal(elementWithClass('map-recenter').props.disabled, false);
      assert.match(html, /Location access is blocked/);
      assert.match(html, /Move the map manually/);
      assert.ok(elementWithClass('map-location-retry'));
    } finally { if (previous) Object.defineProperty(navigator, 'geolocation', previous); else delete navigator.geolocation; }
  });
  await check('leaving the map invalidates pending geolocation callbacks before they update its state', () => {
    render(); let success; let fail; let calls = 0;
    const previousGeo = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    const previousWindow = globalThis.window;
    globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(ok, error) { calls += 1; success = ok; fail = error; } } });
    try {
      const cleanup = effects.find(item => item.dependencies?.[1] === 'me').effect();
      elementWithClass('map-recenter').props.onClick(); const before = [...values.entries()];
      cleanup(); success({ coords: { latitude: 42.44, longitude: 19.26 } }); fail({ code: 2 });
      assert.deepEqual([...values.entries()], before); assert.equal(calls, 1);
    } finally { globalThis.window = previousWindow; if (previousGeo) Object.defineProperty(navigator, 'geolocation', previousGeo); else delete navigator.geolocation; }
  });
  await check('opening a new request resets a previous quantity to one', () => {
    render({ 14: fixture, 16: 3 });
    elementWithClass('listing-request-action').props.onClick();
    assert.equal(values.get(16), 1);
    assert.equal(values.get(15).id, 'other-listing');
  });
  await check('map discovery keeps public coordinates and existing type, search and distance filters', () => {
    render({ 0: [fixture, { ...fixture, id: 'search-listing', type: 'take' }] });
    assert.equal(layers.filter(layer => layer.name === 'Marker').length, 2);
    assert.deepEqual(layers.find(layer => layer.name === 'Marker').props.position, [42.441, 19.263]);
    render({ 0: [fixture, { ...fixture, id: 'search-listing', type: 'take' }], 6: 'glass' });
    assert.equal(layers.filter(layer => layer.name === 'Marker').length, 1);
    render({ 9: '1', 10: [43, 20] });
    assert.equal(layers.filter(layer => layer.name === 'Marker').length, 0);
  });
  await check('detail dialog has a separate primary action area and preserves user descriptions', () => {
    const html = render({ 14: fixture });
    assert.ok(elementWithClass('listing-dialog-scroll'));
    assert.ok(elementWithClass('listing-dialog-actions'));
    assert.ok(elementWithClass('listing-dialog-backdrop-top'));
    assert.match(html, /Keep this E2E description intact\./);
  });
  await check('own listings hide favourite and report actions even when a legacy self-favourite was loaded', () => {
    render({ 14: { ...fixture, user_id: 'me' }, 21: new Set([fixture.id]) });
    assert.equal(elements.some(({ type, props }) => type === 'button' && Object.hasOwn(props, 'aria-pressed')), false);
    assert.equal(elements.some(({ type, props }) => type === 'button' && props.onClick?.toString().includes('setReportListing')), false);
  });
  await check('other users listings retain working favourite and report actions', async () => {
    render({ 14: fixture });
    const favourite = elements.find(({ type, props }) => type === 'button' && Object.hasOwn(props, 'aria-pressed'));
    assert.ok(favourite);
    await favourite.props.onClick();
    assert.deepEqual(calls, [{ favourite: [fixture.id] }]);
    assert.equal(values.get(21).has(fixture.id), true);
    const report = elements.find(({ type, props }) => type === 'button' && props.onClick?.toString().includes('setReportListing'));
    assert.ok(report); report.props.onClick();
    assert.equal(values.get(17).id, fixture.id);
  });
  await check('request quantity is explicitly labelled with availability and defaults to one', () => {
    const html = render({ 15: fixture });
    const input = elements.find(({ type, props }) => type === 'input' && props.type === 'number');
    assert.equal(Number(input.props.min), 1);
    assert.equal(Number(input.props.max), 4);
    assert.equal(input.props.value, 1);
    assert.match(html, /How many of the 4 available pieces/);
    const confirm = elements.find(({ type, props }) => type === 'button' && props.onClick?.toString().includes('handleBook'));
    assert.equal(typeof confirm.props.children, 'string');
  });
  await check('request quantity is an integer bounded by actual available quantity', async () => {
    render({ 15: { ...fixture, quantity: 9, available_quantity: 3 } });
    let input = elements.find(({ type, props }) => type === 'input' && props.type === 'number');
    assert.equal(Number(input.props.max), 3);
    input.props.onChange({ target: { value: '2.8' } });
    assert.equal(values.get(16), 2);
    rerender();
    input = elements.find(({ type, props }) => type === 'input' && props.type === 'number');
    input.props.onChange({ target: { value: '99' } });
    assert.equal(values.get(16), 3);
    rerender();
    await elements.find(({ type, props }) => type === 'button' && props.onClick?.toString().includes('handleBook')).props.onClick();
    assert.deepEqual(calls, [['other-listing', 3]]);
  });
  await check('two immediate taps on one confirmation submit only one request', async () => {
    render({ 15: fixture });
    const confirm = elements.find(({ type, props }) => type === 'button' && props.onClick?.toString().includes('handleBook'));
    await Promise.all([confirm.props.onClick(), confirm.props.onClick()]);
    assert.equal(calls.length, 1);
  });
  await check('an unavailable or own listing cannot submit even through an invoked confirmation', async () => {
    for (const patch of [{ quantity: 0 }, { user_id: 'me' }]) {
      render({ 15: { ...fixture, ...patch } });
      const button = elements.find(({ type, props }) => type === 'button' && props.onClick?.toString().includes('handleBook'));
      assert.equal(button.props.disabled, true);
      await button.props.onClick();
      assert.equal(calls.length, 0);
    }
  });
  if (failures.length) throw new Error(`${failures.length} map UX checks failed: ${failures.join('; ')}`);
  process.stdout.write('Map UX checks passed offline.\n');
} finally {
  hooks.deregister();
}
