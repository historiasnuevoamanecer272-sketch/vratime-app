import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'rolldown/utils';
import { normalizePublicListing, publicListingPosition } from '../src/lib/publicListings.js';

const failures = [];
const check = async (name, action) => {
  try { await action(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
};

await check('missing, empty, boolean and out-of-range coordinates never become listing markers', () => {
  for (const [lat, lng] of [[null, null], ['', ''], [' ', '19'], [true, 19], [91, 19], [42, 181], [Infinity, 19]]) {
    assert.equal(publicListingPosition({ lat, lng }), null, JSON.stringify([lat, lng]));
  }
  assert.deepEqual(publicListingPosition({ lat: 0, lng: 0 }), [0, 0]);
  assert.deepEqual(publicListingPosition({ lat: '42.44', lng: '19.26' }), [42.44, 19.26]);
});

await check('an invalid or incomplete public coordinate pair never exposes private coordinates', () => {
  for (const publicFields of [{ public_lat: null, public_lng: null }, { public_lat: 42.4 }, { public_lng: 19.2 }, { public_lat: '', public_lng: 19.2 }, { public_lat: 95, public_lng: 19.2 }]) {
    const listing = { id: 'private', lat: 42.44123, lng: 19.26387, ...publicFields };
    assert.equal(publicListingPosition(listing), null);
    assert.equal(publicListingPosition(normalizePublicListing(listing)), null);
  }
  const publicListing = normalizePublicListing({ lat: 42.44123, lng: 19.26387, public_lat: '42.44', public_lng: '19.26', available_quantity: '3' });
  assert.deepEqual(publicListingPosition(publicListing), [42.44, 19.26]);
  assert.equal(publicListing.quantity, 3);
  assert.equal(publicListingPosition(normalizePublicListing(null)), null);
});

// Run the real dialog event handlers and layer JSX offline. Substitute React
// scheduling, Leaflet and browser/network boundaries; keep validation real.
const srcUrl = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(srcUrl)) {
      const seams = {
        react: 'state', 'react/jsx-runtime': 'elements', 'react-leaflet': 'leaflet',
        'react-i18next': 'translation', '../i18n': 'translation', '../lib/api': 'api',
        '../lib/mapMarkers': 'markers', '../lib/toast': 'toast',
        '../hooks/useAppNavigation': 'navigation', '../hooks/useDialogFocus': 'navigation',
      };
      if (seams[specifier]) return { url: `map-data-test:${seams[specifier]}`, shortCircuit: true };
      if (specifier.startsWith('.')) {
        const base = new URL(specifier, context.parentURL);
        for (const extension of ['', '.js', '.jsx']) {
          const candidate = new URL(`${base.href}${extension}`);
          if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const sources = {
      'map-data-test:state': `
        let values = [], cursor = 0;
        export const reset = () => { values = []; cursor = 0; };
        export const begin = () => { cursor = 0; };
        export const useState = initial => {
          const slot = cursor++;
          if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
          return [values[slot], next => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
        };
        export const useRef = initial => { const [value] = useState(() => ({ current: initial })); return value; };
      `,
      'map-data-test:elements': 'export const Fragment = Symbol.for("react.fragment"), elements = []; export const jsx = (type, props, key) => { const element = {type,props,key}; elements.push(element); return element; }; export const jsxs = jsx;',
      'map-data-test:leaflet': "export const Marker = 'Marker', Tooltip = 'Tooltip', Popup = 'Popup';",
      'map-data-test:translation': "export const getAppLanguage = () => 'en'; export const useTranslation = () => ({ t: key => key });",
      'map-data-test:api': 'export const writes = []; export const createCollectionPoint = async point => { writes.push(point); };',
      'map-data-test:markers': 'export const mapMarkerIcons = { collection: {} };',
      'map-data-test:toast': 'export const messages = []; export const showToast = (...args) => messages.push(args);',
      'map-data-test:navigation': 'export const useAppOverlay = () => {}; export const useDialogFocus = () => ({});',
    };
    if (sources[url]) return { format: 'module', source: sources[url], shortCircuit: true };
    if (url.startsWith(srcUrl) && url.endsWith('.jsx')) {
      const result = transformSync(fileURLToPath(url), readFileSync(new URL(url), 'utf8'), { jsx: { runtime: 'automatic' } });
      assert.equal(result.errors.length, 0);
      return { format: 'module', source: result.code, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

try {
  const { default: Layer } = await import('../src/components/CollectionPointLayer.jsx');
  const { default: Dialog } = await import('../src/components/CollectionPointDialog.jsx');
  const state = await import('map-data-test:state');
  const { elements } = await import('map-data-test:elements');
  const { writes } = await import('map-data-test:api');
  const { messages } = await import('map-data-test:toast');
  const point = { id: 'point-1', name: 'Glass collection', location_label: 'Main square', description: null, lat: '42.44', lng: '19.26', materials: ['glass'], status: 'verified', exists_votes: 3, missing_votes: 0 };

  await check('collection layer skips invalid coordinates and malformed rows while preserving valid siblings', () => {
    elements.length = 0;
    Layer({ points: [null, {}, { ...point, id: 'empty', lat: '' }, { ...point, id: 'outside', lng: 181 }, point], onVote() {} });
    const markers = elements.filter(element => element.type === 'Marker');
    assert.equal(markers.length, 1);
    assert.deepEqual(markers[0].props.position, [42.44, 19.26]);
    assert.doesNotThrow(() => Layer({ points: null }));
    assert.doesNotThrow(() => Layer({ points: {} }));
  });

  await check('legacy scalar materials and invalid material entries cannot crash collection markers', () => {
    elements.length = 0;
    assert.doesNotThrow(() => Layer({ points: [{ ...point, materials: 'glass' }, { ...point, id: 'point-2', materials: ['glass', null, { key: 'metal' }] }] }));
    assert.equal(elements.filter(element => element.type === 'Marker').length, 2);
  });

  let props;
  const render = () => { state.begin(); elements.length = 0; return Dialog(props); };
  const inputs = () => elements.filter(element => element.type === 'input' && element.props.type !== 'checkbox').map(element => element.props);
  const begin = initialPosition => { state.reset(); writes.length = 0; messages.length = 0; props = { initialPosition, onClose() {} }; render(); };
  const change = (index, value) => { inputs()[index].onChange({ target: { value } }); render(); };
  const submit = () => elements.find(element => element.type === 'button' && element.props.className === 'btn-primary').props.onClick();

  await check('collection dialog preserves a valid initial zero latitude and longitude', () => {
    begin([0, 0]);
    assert.equal(inputs()[2].value, 0);
    assert.equal(inputs()[3].value, 0);
  });

  await check('collection dialog blocks blank and out-of-range coordinates before its API boundary', async () => {
    begin([42.44, 19.26]);
    change(0, 'Glass collection'); change(1, 'Main square');
    elements.find(element => element.type === 'input' && element.props.type === 'checkbox').props.onChange(); render();
    for (const [lat, lng] of [['', '19'], ['42', ''], ['91', '19'], ['42', '181']]) {
      change(2, lat); change(3, lng); await submit(); render();
      assert.equal(writes.length, 0, `invalid ${lat},${lng} must not reach createCollectionPoint`);
    }
    assert.equal(messages.at(-1)[1], 'error');
    change(2, '0'); change(3, '0'); await submit();
    assert.equal(writes.length, 1);
  });
} finally { hooks.deregister(); }

assert.equal(failures.length, 0, failures.join('; '));
console.log('Map data boundary passed: coordinate privacy, collection marker resilience and collection form validation.');
