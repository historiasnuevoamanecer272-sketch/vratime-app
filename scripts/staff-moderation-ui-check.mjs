import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'rolldown/utils';
import i18n from '../src/i18n/index.js';
import { subscribeToasts } from '../src/lib/toast.js';

const src = new URL('../src/', import.meta.url).href, realReact = import.meta.resolve('react'), runtime = import.meta.resolve('react/jsx-runtime');
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/components/StaffPanel.jsx')) {
      const seams = { react: 'hooks', 'react/jsx-runtime': 'capture', '../supabaseClient': 'server', '../lib/api': 'actions' };
      if (seams[specifier]) return { url: `staff-ui:${seams[specifier]}`, shortCircuit: true };
    }
    if (context.parentURL?.startsWith(src) && /^\.\.\/supabaseClient/.test(specifier)) return { url: 'staff-ui:server', shortCircuit: true };
    if (context.parentURL?.startsWith(src) && specifier.startsWith('.')) {
      for (const extension of ['', '.js', '.jsx', '/index.js']) { const url = new URL(`${specifier}${extension}`, context.parentURL); if (existsSync(url)) return { url: url.href, shortCircuit: true }; }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const module = (source) => ({ format: 'module', source, shortCircuit: true });
    if (url === 'staff-ui:hooks') return module(`export * from ${JSON.stringify(realReact)};
      let slots=[],cursor=0,effects=[];
      export const begin=()=>{cursor=0;effects=[]}; export const reset=()=>{slots=[];begin()};
      export const flush=async()=>{for(const fn of effects)fn();await Promise.resolve();await Promise.resolve()};
      export const useState=(initial)=>{const n=cursor++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return[slots[n],value=>{slots[n]=typeof value==='function'?value(slots[n]):value}]};
      export const useRef=(initial)=>{const [value]=useState(()=>({current:initial}));return value};
      export const useCallback=(fn)=>fn;
      export const useEffect=(fn)=>{cursor++;effects.push(fn)};`);
    if (url === 'staff-ui:capture') return module(`import {jsx as actual,jsxs as actuals} from ${JSON.stringify(runtime)};export {Fragment} from ${JSON.stringify(runtime)};export const elements=[];export const jsx=(type,props,key)=>{elements.push({type,props});return actual(type,props,key)};export const jsxs=(type,props,key)=>{elements.push({type,props});return actuals(type,props,key)};`);
    if (url === 'staff-ui:server') return module(`export const queries=[];
      export const fixtures={listings:[{id:'approved',category:'Published fixture',description:'Already published',moderation_status:'approved',status:'active'},{id:'pending',category:'Pending fixture',description:'Review requested',moderation_status:'pending',status:'active'},{id:'rejected',category:'Rejected fixture',moderation_status:'rejected',status:'active'},{id:'closed',category:'Closed fixture',moderation_status:'approved',status:'completed'}],reports:[],user_feedback:[],profiles:[]};
      export const supabase={from:(table)=>{const filters=[];const query={select:()=>query,eq:(key,value)=>{filters.push(row=>row[key]===value);return query},in:(key,values)=>{filters.push(row=>values.includes(row[key]));return query},neq:(key,value)=>{filters.push(row=>row[key]!==value);return query},order:async()=>{queries.push({table});return{data:(fixtures[table]||[]).filter(row=>filters.every(fn=>fn(row))),error:null}}};return query}};`);
    if (url === 'staff-ui:actions') return module(`import{fixtures}from'staff-ui:server';export const calls=[];let fail=false,hold=false,release;
      export const failNext=()=>{fail=true};export const holdNext=()=>{hold=true};export const finish=()=>release?.();
      export const moderateListing=async(id,decision,reason)=>{calls.push({id,decision,reason});if(fail){fail=false;throw Object.assign(new Error('RAW SQL SECRET DETAIL'),{code:'42501'})}if(hold){hold=false;await new Promise(resolve=>{release=resolve})}const listing=fixtures.listings.find(row=>row.id===id);if(listing)listing.moderation_status=decision};
      export const resolveReport=async()=>{};export const setFeedbackStatus=async()=>{};export const setUserRole=async()=>{};`);
    if (url.startsWith(src) && url.endsWith('.css')) return module('export default {};');
    if (url.startsWith(src) && /\.(png|webp)$/.test(url)) return module(`export default ${JSON.stringify(url)};`);
    if (url.startsWith(src) && url.endsWith('.jsx')) { const output = transformSync(fileURLToPath(url), readFileSync(new URL(url), 'utf8'), { jsx: { runtime: 'automatic' } }); assert.equal(output.errors.length, 0); return module(output.code); }
    return next(url, context);
  },
});

try {
  const { default: StaffPanel } = await import('../src/components/StaffPanel.jsx'), state = await import('staff-ui:hooks'), capture = await import('staff-ui:capture'), actions = await import('staff-ui:actions');
  const translations = await import('../src/i18n/uxStaff.js').catch(() => ({}));
  if (translations.staffExperienceTranslations) for (const [language, value] of Object.entries(translations.staffExperienceTranslations)) i18n.addResourceBundle(language, 'translation', { staffExperience: value }, true, true);
  await i18n.changeLanguage('en');
  const previousWindow = globalThis.window, events = [], toasts = [], stop = subscribeToasts((toast) => toasts.push(toast));
  globalThis.window = { setTimeout: (callback) => { callback(); return 0; }, clearTimeout() {}, dispatchEvent: (event) => events.push(event.type) };
  let role = 'moderator';
  const render = () => { state.begin(); capture.elements.length = 0; return renderToStaticMarkup(createElement(StaffPanel, { role })); };
  const text = (value) => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' ? value : '';
  const element = (type, predicate) => capture.elements.find((entry) => entry.type === type && predicate(entry.props))?.props;
  const article = (title) => element('article', (props) => text(props.children).includes(title));
  const nested = (value, type) => { const result = []; const visit = (node) => { if (Array.isArray(node)) node.forEach(visit); else if (node?.props) { if (node.type === type) result.push(node.props); visit(node.props.children); } }; visit(value); return result; };
  const findButton = (title, label) => nested(article(title)?.children, 'button').find((props) => text(props.children) === label);
  const setReason = (title, value) => { const field = nested(article(title)?.children, 'textarea')[0]; assert.ok(field); field.onChange({ target: { value } }); return render(); };
  state.reset(); render(); await state.flush(); let html = render();
  assert.match(html, /Published fixture/, 'Auto-approved active listings must be reachable by staff');
  assert.match(html, /Pending fixture/); assert.doesNotMatch(html, /Rejected fixture|Closed fixture/);
  assert.equal(findButton('Published fixture', 'Approve'), undefined, 'An approved listing must not offer Approve again');
  assert.ok(findButton('Pending fixture', 'Approve'));
  let withdraw = findButton('Published fixture', 'Withdraw listing'); assert.ok(withdraw); assert.equal(withdraw.disabled, true);
  await withdraw.onClick(); assert.equal(actions.calls.length, 0, 'The handler itself must reject an empty reason');
  setReason('Published fixture', ' x '); withdraw = findButton('Published fixture', 'Withdraw listing'); await withdraw.onClick(); assert.equal(actions.calls.length, 0);
  setReason('Published fixture', '  Unsafe listing  '); actions.holdNext(); withdraw = findButton('Published fixture', 'Withdraw listing');
  const first = withdraw.onClick(), duplicate = withdraw.onClick(); assert.equal(actions.calls.length, 1, 'Two synchronous clicks must issue only one moderation mutation'); actions.finish(); await Promise.all([first, duplicate]);
  assert.deepEqual(actions.calls[0], { id: 'approved', decision: 'rejected', reason: 'Unsafe listing' }); html = render(); assert.doesNotMatch(html, /Published fixture/); assert.ok(events.includes('listings-updated'));
  setReason('Pending fixture', 'Rejected fixture reason'); actions.failNext(); await findButton('Pending fixture', 'Reject').onClick(); assert.ok(!JSON.stringify(toasts).includes('RAW SQL SECRET DETAIL'));
  role = 'user'; html = render(); assert.equal(html, '', 'Non-staff callers must not see staff actions');
  stop(); globalThis.window = previousWindow;
  console.log('Staff moderation UI passed: actual query includes published ads, reason guard, one mutation, removal refresh, safe errors and role gate.');
} finally { loader.deregister(); }
