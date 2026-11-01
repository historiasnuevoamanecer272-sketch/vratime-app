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
const apiExports = ['getCollectionPoints', 'getMyDeals', 'getMyDiscoveryFeed', 'getPublicMapListings', 'refreshExpiredDeals', 'voteCollectionPoint', 'createReport', 'createCollectionPoint'];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/components/ListingPhoto.jsx') && specifier === 'react') return {url:'map-test:state',shortCircuit:true};
    if (['/components/ListingPhoto.jsx','/components/MediaPreview.jsx'].some(path=>context.parentURL?.endsWith(path)) && specifier === 'react/jsx-runtime') return {url:'map-test:elements',shortCircuit:true};
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
    if (url.startsWith(srcUrl) && url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true};
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
          on() {}, off() {},
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
        export const saveSearch = async (...args) => { calls.push({ saveSearch: args }); };
        let contactFailure = null;
        export const failContacts = value => { contactFailure = value; };
        export const getMyListingContacts = async () => [];
        export const requestListingContacts = async id => {
          calls.push({ contacts: [id] });
          if (contactFailure) throw new Error(contactFailure);
          return { exchange_id: 'exchange-a', listing_id: id, partner_name: 'Neighbour', contacts: [{ messenger_type: 'tg', contact_value: '@neighbour' }, { messenger_type: 'wa', contact_value: '+38267123456' }, { messenger_type: 'viber', contact_value: '+38267123456' }] };
        };
        const forbidden = () => { throw new Error('Offline test must not access API'); };
        export const ${apiExports.map(name => `${name} = forbidden`).join(', ')};
      `,
      'map-test:supabase': "export const supabase = new Proxy({}, { get() { throw new Error('Offline test must not access Supabase'); } });",
      'map-test:markers': 'export const mapMarkerIcons = { give: {}, take: {}, lend: {}, collection: {} }; export const groupedMapMarkerIcon = count => ({ count });',
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
  const { calls, failContacts } = await import('map-test:api');
  await i18n.changeLanguage('en');
  const fixture = { id: 'other-listing', user_id: 'other', category: 'Glass jars', category_path: 'glass/jars', type: 'give', quantity: 4, public_lat: 42.441, public_lng: 19.263, created_at: '2026-10-01T10:00:00Z', description: 'Keep this E2E description intact.' };
  let screenProps = {};
  const render = (patch = {}, props = {}) => {
    screenProps = props;
    failContacts(null);
    values.clear();
    for (const [key, value] of Object.entries({ 0: [fixture], 3: false, 12: true, ...patch })) values.set(Number(key), value);
    return rerender();
  };
  const rerender = () => {
    begin(); elements.length = 0; layers.length = 0; mapCalls.length = 0; calls.length = 0;
    return renderToStaticMarkup(createElement(MapScreen, { userId: 'me', onCreate() {}, ...screenProps }));
  };
  const elementWithClass = name => elements.find(({ props }) => props.className?.split(' ').includes(name));
  const runFocusEffect = effect => {
    const previous = globalThis.window;
    globalThis.window = { ...previous, setTimeout(run) { run(); return 1; }, clearTimeout() {} };
    try { effect(); } finally { globalThis.window = previous; }
  };
  const failures = [];
  const check = async (name, action) => {
    try { await action(); process.stdout.write(`PASS ${name}\n`); }
    catch (error) { failures.push(name); process.stderr.write(`FAIL ${name}: ${error.message.split('\n')[0]}\n`); }
  };
  await check('first visit is a clear map even when no listings exist', () => {
    values.clear(); values.set(0, []); values.set(3, false);
    const html = rerender();
    assert.ok(elementWithClass('map-toolbar-restore'), 'Filters must open only when requested');
    assert.equal(elementWithClass('map-state-empty'), undefined);
    assert.equal(elementWithClass('list-sheet-peek'), undefined);
    assert.equal(elementWithClass('map-empty-results'), undefined);
    assert.doesNotMatch(html, /create your first listing|Create your first listing/);
  });
  await check('zero search results are explained only inside explicitly opened filters', () => {
    render({0:[],6:'nonexistent item'});
    assert.equal(elementWithClass('map-state-empty'), undefined);
    assert.ok(elementWithClass('map-empty-results'));
    assert.equal(elementWithClass('map-show-results').props.disabled, false, 'Zero results must not prevent closing filters');
    elementWithClass('map-show-results').props.onClick();
    rerender();
    assert.equal(elementWithClass('map-empty-results'), undefined);
    assert.equal(elementWithClass('map-state-empty'), undefined);
  });
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
    render({ 0: [] }); assert.equal(elementWithClass('map-show-results').props.disabled, false);
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
  await check('own details disable contact exchange and an invoked handler cannot request self contacts', () => {
    render({ 14: { ...fixture, user_id: 'me' } });
    const button = elementWithClass('listing-request-action');
    assert.ok(button?.props.disabled);
    button.props.onClick?.();
    assert.equal(values.get(15), undefined);
    assert.equal(calls.length, 0);
  });
  await check('own and other listing photos expose an action to open the complete image', () => {
    for (const user_id of ['me','other']) {
      const photoListing = {...fixture,user_id,image_url:'https://example.test/photo.jpg',image_urls:['https://example.test/photo.jpg','https://example.test/portrait.jpg']};
      const html = render({0:[photoListing],14:photoListing});
      assert.match(html,/class="listing-photo-button/,'Published listing photos need a full-image action');
      assert.ok((html.match(/aria-label="Open photo"/g)||[]).length>=2,'Every detail photo must be independently openable');
      const portraitButton = elements.find(({type,props})=>type==='button' && props.className?.includes('listing-photo-button') && props.children?.props?.src==='https://example.test/portrait.jpg');
      assert.ok(portraitButton);
      portraitButton.props.onClick({stopPropagation(){}});
      const expanded = rerender();
      assert.match(expanded,/media-preview-dialog/);
      assert.equal(elementWithClass('media-preview-dialog').props.tabIndex,-1,'Media dialog must remain a focus target when controls are unavailable');
      const completePhoto = elementWithClass('media-full-preview');
      assert.equal(completePhoto.props.src,'https://example.test/portrait.jpg');
      elementWithClass('media-preview-close').props.onClick();
      assert.doesNotMatch(rerender(),/media-preview-dialog/);
    }
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
    assert.equal(values.get(12), true);
    const search = elements.find(({ type, props }) => type === 'input' && props.type === 'search');
    assert.equal(search.props.onPointerDown, undefined);
    assert.equal(elementWithClass('map-toolbar').props.onPointerDown, undefined);
  });
  await check('listing popup disables continuous auto-pan and opening it closes the overlapping tooltip', () => {
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
  for (const radius of ['1', '5', '10']) {
    for (const code of [1, 2, 3]) {
      await check(`${radius} km resets to any distance after location error ${code} without an origin`, () => {
        const previous = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
        let fail;
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(ok, error) { fail = error; } } });
        try {
          render({ 0: [fixture, { ...fixture, id: 'distant', public_lat: 48.85, public_lng: 2.35 }] });
          elements.find(({ type, props }) => type === 'button' && props.children === i18n.t(`map.km${radius}`)).props.onClick();
          rerender();
          assert.equal(elementWithClass('map-show-results').props.disabled, true, 'Results cannot be applied before location resolves');
          fail({ code });
          if (code !== 1) fail({ code }); // The provider retries with coarse location once.
          rerender();
          assert.equal(values.get(9), 'all', 'A failed location must reset the unavailable radius');
          for (const value of ['1', '5', '10']) {
            const chip = elements.find(({ type, props }) => type === 'button' && props.children === i18n.t(`map.km${value}`));
            assert.equal(chip.props.className.includes('chip-active'), false);
          }
          const anyDistance = elements.find(({ type, props }) => type === 'button' && props.children === i18n.t('map.anyDistance'));
          assert.ok(anyDistance.props.className.includes('chip-active'));
          assert.deepEqual(layers.filter(layer => layer.name === 'Marker').map(layer => layer.props.position), [[42.441, 19.263], [48.85, 2.35]]);
          assert.equal(elementWithClass('map-show-results').props.disabled, false);
          elementWithClass('map-show-results').props.onClick();
          rerender();
          assert.deepEqual(elements.find(({ props }) => props.resultsViewport)?.props.resultsViewport.positions, [[42.441, 19.263], [48.85, 2.35]]);
        } finally { if (previous) Object.defineProperty(navigator, 'geolocation', previous); else delete navigator.geolocation; }
      });
    }
  }
  for (const moment of ['while locating', 'after failure']) {
    await check(`a saved-search callback captured while locating and invoked ${moment} cannot save a radius without an origin`, async () => {
      const previous = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
      let fail;
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(ok, error) { fail = error; } } });
      try {
        render({ 6: 'glass' });
        elements.find(({ type, props }) => type === 'button' && props.children === i18n.t('map.km1')).props.onClick();
        rerender();
        const save = elements.find(({ type, props }) => type === 'button' && Array.isArray(props.children) && props.children.includes(i18n.t('discovery.saveSearch'))).props.onClick;
        if (moment === 'after failure') { fail({ code: 1 }); rerender(); }
        await save();
        assert.deepEqual(calls, [{ saveSearch: ['glass', { category: 'all', distance: 'all', type: 'give' }, true] }]);
        if (moment === 'while locating') fail({ code: 1 });
      } finally { fail?.({ code: 1 }); if (previous) Object.defineProperty(navigator, 'geolocation', previous); else delete navigator.geolocation; }
    });
  }
  for (const [reason, origin] of [['missing', null], ['non-finite', [NaN, 19]], ['incomplete', [42]], ['invalid latitude', [91, 19]], ['invalid longitude', [42, 181]]]) {
    await check(`${reason} origin cannot produce a bounded saved search`, async () => {
      render({ 6: 'glass', 9: '5', 10: origin });
      await elements.find(({ type, props }) => type === 'button' && Array.isArray(props.children) && props.children.includes(i18n.t('discovery.saveSearch'))).props.onClick();
      assert.deepEqual(calls, [{ saveSearch: ['glass', { category: 'all', distance: 'all', type: 'give' }, true] }]);
    });
  }
  await check('successful location keeps the selected radius and saves its matching origin', async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    let success;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(ok) { success = ok; } } });
    try {
      render({ 0: [fixture, { ...fixture, id: 'distant', public_lat: 48.85, public_lng: 2.35 }], 6: 'glass', 8: 'lend' });
      elements.find(({ type, props }) => type === 'button' && props.children === i18n.t('map.km5')).props.onClick();
      success({ coords: { latitude: 42.441, longitude: 19.263 } });
      rerender();
      assert.equal(values.get(9), '5');
      assert.deepEqual(values.get(10), [42.441, 19.263]);
      await elements.find(({ type, props }) => type === 'button' && Array.isArray(props.children) && props.children.includes(i18n.t('discovery.saveSearch'))).props.onClick();
      assert.deepEqual(calls, [{ saveSearch: ['glass', { category: 'all', distance: '5', type: 'lend', origin: [42.441, 19.263] }, true] }]);
      render({ 0: [fixture, { ...fixture, id: 'distant', public_lat: 48.85, public_lng: 2.35 }], 9: '5', 10: [42.441, 19.263] });
      assert.deepEqual(layers.filter(layer => layer.name === 'Marker').map(layer => layer.props.position), [[42.441, 19.263]]);
    } finally { if (previous) Object.defineProperty(navigator, 'geolocation', previous); else delete navigator.geolocation; }
  });
  await check('failed recenter preserves a radius when the previous origin is still valid', () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(ok, fail) { fail({ code: 1 }); } } });
    try {
      render({ 0: [fixture, { ...fixture, id: 'distant', public_lat: 48.85, public_lng: 2.35 }], 9: '10', 10: [42.441, 19.263] });
      elementWithClass('map-recenter').props.onClick();
      rerender();
      assert.equal(values.get(9), '10');
      assert.deepEqual(values.get(10), [42.441, 19.263]);
      assert.deepEqual(layers.filter(layer => layer.name === 'Marker').map(layer => layer.props.position), [[42.441, 19.263]]);
    } finally { if (previous) Object.defineProperty(navigator, 'geolocation', previous); else delete navigator.geolocation; }
  });
  await check('opening contact consent resets an earlier contact error without requesting stock', () => {
    render({ 14: fixture, 16: 'previous error' });
    elementWithClass('listing-request-action').props.onClick();
    assert.equal(values.get(16), '');
    assert.equal(values.get(15).id, 'other-listing');
    assert.equal(calls.length, 0, 'Opening consent cannot call a reservation or contact API');
  });
  await check('map discovery keeps public coordinates and existing type, search and distance filters', () => {
    render({ 0: [fixture, { ...fixture, id: 'search-listing', type: 'take' }] });
    assert.equal(layers.filter(layer => layer.name === 'Marker').length, 1, 'Equal public positions are grouped');
    assert.equal(layers.find(layer => layer.name === 'Marker').props.icon.count, 2);
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
  await check('all listing types explain private contact sharing before requesting contacts without quantity or timers', () => {
    for (const type of ['give', 'take', 'lend']) {
      render({ 14: { ...fixture, type } });
      assert.equal(elementWithClass('listing-request-action').props.children.at(-1), i18n.t('simpleExchange.connect'));
      assert.equal(elementWithClass('map-contact-dialog'), undefined);
      elementWithClass('listing-request-action').props.onClick();
      const html = rerender();
      assert.ok(elementWithClass('map-contact-dialog'));
      assert.ok(html.includes(i18n.t('simpleExchange.consentBody')));
      assert.equal(elements.some(({ type, props }) => type === 'input' && props.type === 'number'), false);
      assert.equal(calls.length, 0);
      assert.equal(elements.some(({ type }) => type === 'a'), false, 'No partner contacts before consent');
    }
  });
  await check('consent requests contacts only and immediately exposes actionable private messenger links without changing stock', async () => {
    render({ 15: fixture });
    const confirm = elementWithClass('map-contact-confirm'); assert.ok(confirm);
    await confirm.props.onClick();
    assert.deepEqual(calls, [{ contacts: [fixture.id] }], 'No booking or quantity API may be called');
    assert.deepEqual(values.get(0), [fixture], 'Contact sharing cannot remove or mutate the public listing');
    rerender();
    const links = elements.filter(({ type }) => type === 'a').map(({ props }) => props.href);
    assert.deepEqual(links, ['https://t.me/neighbour', 'https://wa.me/38267123456', 'viber://chat?number=+38267123456']);
    assert.equal(layers.find(layer => layer.name === 'Marker').props.opacity, 1);
  });
  await check('two immediate contact confirmations submit one idempotent exchange request', async () => {
    render({ 15: fixture });
    const confirm = elementWithClass('map-contact-confirm'); assert.ok(confirm);
    await Promise.all([confirm.props.onClick(), confirm.props.onClick()]);
    assert.deepEqual(calls, [{ contacts: [fixture.id] }]);
  });
  await check('unavailable or own listings cannot create a new contact exchange through captured confirmation', async () => {
    for (const patch of [{ quantity: 0 }, { user_id: 'me' }]) {
      render({ 15: { ...fixture, ...patch } });
      const button = elementWithClass('map-contact-confirm'); assert.ok(button);
      assert.equal(button.props.disabled, true);
      await button.props.onClick();
      assert.equal(calls.length, 0);
    }
  });
  await check('offline contact sharing explains connection and disables its submission', async () => {
    render({15:fixture,28:false});
    const button=elementWithClass('map-contact-confirm'); assert.ok(button);
    assert.equal(button.props.disabled,true);
    await button.props.onClick();
    assert.equal(calls.length,0);
  });
  await check('missing saved contacts are explained and a retry can show contacts without a reservation', async () => {
    render({ 15: fixture }); failContacts('contact_details_required');
    const confirm = elementWithClass('map-contact-confirm'); assert.ok(confirm);
    await confirm.props.onClick();
    const html = rerender();
    assert.ok(html.includes(i18n.t('simpleExchange.missingContacts')));
    assert.equal(elementWithClass('map-contact-confirm').props.disabled, false);
    failContacts(null);
    await elementWithClass('map-contact-confirm').props.onClick();
    assert.deepEqual(calls, [{ contacts: [fixture.id] }]);
    assert.ok(rerender().includes('https://t.me/neighbour'));
  });
  await check('an existing exchange is readable after closure and remains available in the contacts tab', () => {
    let opened = 0;
    render({ 2: [{ listing_id: fixture.id, contacts: [{ messenger_type: 'tg', contact_value: '@neighbour' }] }], 14: { ...fixture, quantity: 0, status: 'completed' } }, { onOpenContacts() { opened += 1; } });
    const action = elementWithClass('listing-request-action');
    assert.equal(action.props.disabled, false);
    action.props.onClick(); rerender();
    assert.ok(elements.some(({ type, props }) => type === 'a' && props.href === 'https://t.me/neighbour'));
    assert.equal(elementWithClass('map-contact-confirm'), undefined);
    elementWithClass('map-open-contacts').props.onClick();
    assert.equal(opened, 1);
    assert.equal(calls.length, 0);
  });
  await check('equal public coordinates show a count and every own or other listing is selectable', () => {
    const own = { ...fixture, id: 'own-a', user_id: 'me', category: 'Pallets', category_path: 'wood/pallets' };
    render({ 0: [fixture, own] });
    const markers = layers.filter(layer => layer.name === 'Marker');
    assert.equal(markers.length, 1); assert.equal(markers[0].props.icon.count, 2);
    const choices = elements.filter(({ type, props }) => type === 'button' && props['data-map-listing-id']);
    assert.deepEqual(choices.map(({ props }) => props['data-map-listing-id']), [fixture.id, own.id]);
    choices[1].props.onClick(); assert.equal(values.get(14).id, own.id);
    choices[0].props.onClick(); assert.equal(values.get(14).id, fixture.id);
    render({ 0: [fixture, own], 6: 'glass' });
    assert.equal(layers.filter(layer => layer.name === 'Marker').length, 1);
    assert.equal(layers.find(layer => layer.name === 'Marker').props.icon.count, undefined);
  });
  await check('publication clears incompatible filters and focuses the published public listing', () => {
    const published = { ...fixture, id: 'new-public', user_id: 'me', lat: 40, lng: 20 };
    let handled;
    render({ 0: [published], 6: 'unmatched', 7: 'metal', 8: 'take', 9: '1', 10: [48, 2], 18: 'points' }, { focusListingId: published.id, onFocusHandled(id) { handled = id; } });
    const focusEffect = effects.find(({ dependencies }) => dependencies?.includes(published.id)); assert.ok(focusEffect);
    runFocusEffect(focusEffect.effect); rerender();
    assert.equal(values.get(6), ''); assert.equal(values.get(7), 'all'); assert.equal(values.get(8), 'all'); assert.equal(values.get(9), 'all');
    assert.equal(values.get(18), 'listings'); assert.equal(values.get(14).id, published.id); assert.equal(handled, published.id);
    const viewport = elements.find(({ props }) => props.resultsViewport)?.props.resultsViewport;
    assert.deepEqual(viewport.positions, [[42.441, 19.263]], 'Never focus private coordinates');
    assert.equal(layers.filter(layer => layer.name === 'Marker').length, 1);
  });
  await check('publication focus waits for its listing in refreshed public data and ignores invalid or inactive focus', () => {
    let handled = false;
    render({ 0: [] }, { focusListingId: 'waiting', onFocusHandled() { handled = true; } });
    const pending = effects.find(({ dependencies }) => dependencies?.includes('waiting')); assert.ok(pending);
    runFocusEffect(pending.effect); assert.equal(handled, false); assert.equal(values.get(14), undefined);
    render({ 0: [{ ...fixture, id: 'waiting', public_lat: null, public_lng: null }] }, { focusListingId: 'waiting' });
    runFocusEffect(effects.find(({ dependencies }) => dependencies?.includes('waiting')).effect); assert.equal(values.get(14), undefined);
    render({}, { active: false, focusListingId: fixture.id });
    runFocusEffect(effects.find(({ dependencies }) => dependencies?.includes(fixture.id)).effect); assert.equal(values.get(14), undefined);
  });
  await check('first launch offline shows an explanation instead of perpetual loading', () => {
    const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
    try {
      Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});
      values.clear();
      const html=rerender();
      assert.ok(elementWithClass('map-state'),'First offline launch needs a retry/explanation');
      assert.doesNotMatch(html,/class="map-refresh-status"[^>]*>Loading/);
    } finally { if(previous) Object.defineProperty(globalThis,'navigator',previous); else delete globalThis.navigator; }
  });
  await check('invalid listing date does not prevent opening its details', () => {
    const html=render({14:{...fixture,created_at:'not-a-date'}});
    assert.ok(elementWithClass('listing-dialog-actions'));
    assert.doesNotMatch(html,/Invalid Date/);
  });
  if (failures.length) throw new Error(`${failures.length} map UX checks failed: ${failures.join('; ')}`);
  process.stdout.write('Map UX checks passed offline.\n');
} finally {
  hooks.deregister();
}
