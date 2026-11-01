import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'rolldown/utils';

// Real JSX and handlers; only network, scheduling, and host overlay boundaries
// are controlled. Persistent slots preserve state, effects, and cleanup.
const srcUrl = new URL('../src/', import.meta.url).href;
const targets = ['pages/SimpleDeals.jsx', 'components/ListingStatusManager.jsx'].map(path => new URL(path, srcUrl).href);
for (const target of targets) assert.ok(existsSync(new URL(target)), `Missing requested component: ${target}`);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (targets.includes(context.parentURL)) {
      const seams = { react:'hooks', 'react/jsx-runtime':'elements', 'react-i18next':'translation', '../i18n':'translation', '../lib/api':'api', '../supabaseClient':'database', '../hooks/useAppNavigation':'navigation', '../hooks/useDialogFocus':'focus' };
      if (seams[specifier]) return { url:`simple-ui:${seams[specifier]}`, shortCircuit:true };
    }
    if (context.parentURL?.startsWith(srcUrl) && specifier.startsWith('.')) {
      if (specifier === '../lib/api') return { url:'simple-ui:api', shortCircuit:true };
      if (specifier === '../supabaseClient') return { url:'simple-ui:database', shortCircuit:true };
      for (const extension of ['', '.js', '.jsx', '/index.js']) {
        const candidate = new URL(`${specifier}${extension}`, context.parentURL);
        if (existsSync(candidate) && !candidate.pathname.endsWith('/i18n')) return {url:candidate.href,shortCircuit:true};
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const module = source => ({ format:'module', source, shortCircuit:true });
    if (url === 'simple-ui:hooks') return module(`
      let slots=[], cursor=0, pending=[]; export let writes=0;
      const changed=(a,b)=>!a||!b||a.length!==b.length||b.some((v,i)=>!Object.is(v,a[i]));
      export const unmount=()=>{for(const s of slots)s.cleanup?.();pending=[];};
      export const reset=()=>{unmount();slots=[];cursor=0;writes=0;};
      export const begin=()=>{cursor=0;};
      export const flush=()=>{const work=pending;pending=[];for(const {slot,effect} of work){slot.cleanup?.();slot.cleanup=effect();}};
      export const useState=initial=>{const i=cursor++;const s=slots[i]||(slots[i]={value:typeof initial==='function'?initial():initial});return[s.value,next=>{writes++;s.value=typeof next==='function'?next(s.value):next;}];};
      export const useRef=initial=>{const i=cursor++;return(slots[i]||(slots[i]={value:{current:initial}})).value;};
      export const useMemo=(fn,deps)=>{const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={value:fn(),deps};return slots[i].value;};
      export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);
      export const useEffect=(effect,deps)=>{const i=cursor++;const slot=slots[i]||(slots[i]={});if(changed(slot.deps,deps)){slot.deps=deps;pending.push({slot,effect});}};
    `);
    if (url === 'simple-ui:elements') return module(`export const elements=[];export const Fragment=Symbol('fragment');export const jsx=(type,props,key)=>{const node={type,props:props||{},key};elements.push(node);return node;};export const jsxs=jsx;`);
    if (url === 'simple-ui:translation') return module(`const t=key=>key;export const useTranslation=()=>({t});export const getAppLanguage=()=> 'en';`);
    if (url === 'simple-ui:navigation') return module(`export let overlay; export const useAppOverlay=(open,close,key)=>{overlay={open,close,key};};`);
    if (url === 'simple-ui:focus') return module(`export let focus;export const useDialogFocus=options=>{focus=options;return {role:'dialog','aria-modal':true,tabIndex:-1};};`);
    if (url === 'simple-ui:api') return module(`
      export const loads=[],mutations=[];
      const load=kind=>new Promise((resolve,reject)=>loads.push({kind,resolve,reject}));
      const mutate=kind=>(...args)=>new Promise((resolve,reject)=>mutations.push({kind,args,resolve,reject}));
      export const getMyDeals=()=>load('legacy'),getMyListingContacts=()=>load('contacts');export const submitListingContactOutcome=mutate('outcome');
      export const setMyListingRemaining=mutate('remaining'),confirmMyListingCurrent=mutate('current'),submitReview=mutate('review'),createReport=mutate('report');
    `);
    if (url === 'simple-ui:database') return module(`
      let callback,currentUser='a';export const setSession=id=>{currentUser=id;};export const changeAccount=id=>{currentUser=id;callback?.('SIGNED_IN',{user:id?{id}:null});};
      export const supabase={auth:{getUser:async()=>({data:{user:currentUser?{id:currentUser}:null}}),onAuthStateChange:fn=>{callback=fn;return{data:{subscription:{unsubscribe(){if(callback===fn)callback=undefined;}}}};}}};
    `);
    if (url.startsWith(srcUrl) && /\.(webp|png|css)$/.test(url)) return module(`export default ${JSON.stringify(url)};`);
    if (url.startsWith(srcUrl) && url.endsWith('.jsx')) {
      const result=transformSync(fileURLToPath(url),readFileSync(new URL(url),'utf8'),{jsx:{runtime:'automatic'}});
      assert.equal(result.errors.length,0);return module(result.code);
    }
    return next(url,context);
  },
});
const originalWindow=globalThis.window, originalFetch=globalThis.fetch, originalDocument=globalThis.document;
const timers=new Map(), listeners=new Map(), events=[];let timerId=0;
globalThis.window={setTimeout:run=>{timers.set(++timerId,run);return timerId;},clearTimeout:id=>timers.delete(id),setInterval:()=>++timerId,clearInterval:()=>{},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);},dispatchEvent:event=>{events.push(event.type);listeners.get(event.type)?.();}};
globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
globalThis.fetch=()=>{throw Error('Offline test must not access network');};
try {
  const [{default:SimpleDeals},{default:Manager},state,capture,api,db,nav,focus,{subscribeToasts}]=await Promise.all([
    import('../src/pages/SimpleDeals.jsx'),import('../src/components/ListingStatusManager.jsx'),import('simple-ui:hooks'),import('simple-ui:elements'),import('simple-ui:api'),import('simple-ui:database'),import('simple-ui:navigation'),import('simple-ui:focus'),import('../src/lib/toast.js'),
  ]);
  const toasts=[],stop=subscribeToasts(value=>toasts.push(value));
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const runTimers=async()=>{const work=[...timers.values()];timers.clear();for(const run of work)run();await tick();};
  const reset=()=>{state.reset();timers.clear();listeners.clear();events.length=0;api.loads.length=0;api.mutations.length=0;toasts.length=0;db.changeAccount('a');};
  const render=(Component=SimpleDeals,props={userId:'a'})=>{state.begin();capture.elements.length=0;const result=Component(props);state.flush();return result;};
  const text=node=>Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):typeof node==='string'?node:'';
  const button=key=>capture.elements.find(node=>node.type==='button' && text(node)===key)?.props;
  const input=()=>capture.elements.find(node=>node.type==='input' && node.props.type==='number')?.props;
  const contact=(id,patch={})=>({exchange_id:id,listing_id:'same-listing',partner_name:id,contacts:[{messenger_type:'tg',contact_value:`@${id}`}],created_at:'2026-11-01T10:00:00Z',...patch});
  const legacy=(id,patch={})=>({transaction_id:id,listing_id:'same-listing',partner_name:id,contact_value:'+38267123456',messenger_type:'wa',status:'pending',...patch});
  const settle=async(contacts=[],history=[])=>{api.loads.findLast(x=>x.kind==='contacts').resolve(contacts);api.loads.findLast(x=>x.kind==='legacy').resolve(history);await tick();render();};
  const listing={id:'listing-a',user_id:'a',status:'active',moderation_status:'approved',available_quantity:8,owner_check_due_at:'2020-01-01T00:00:00Z'};
  let changed=0;const props=()=>({listing,userId:'a',onChanged:()=>{changed++;}});
  const startManager=()=>{reset();changed=0;render(Manager,props());};
  const openRemaining=()=>{button('simpleExchange.remaining').onClick();render(Manager,props());};
  const amount=value=>{input().onChange({target:{value}});render(Manager,props());};
  const failures=[];const check=async(name,test)=>{try{await test();console.log(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.stack}`);}};

  await check('contacts and legacy pending requests show working links without booking controls',async()=>{
    reset();render();await runTimers();await settle([contact('person1'),contact('person2'),contact('person1')],[legacy('old-pending')]);
    const links=capture.elements.filter(x=>x.type==='a').map(x=>x.props.href);
    assert.deepEqual(links.sort(),['https://t.me/person1','https://t.me/person2','https://wa.me/38267123456'].sort());
    assert.ok(text(render()).includes('deals.title'));assert.ok(button('workflow.report'));
    for(const forbidden of ['deals.accept','deals.cancel','deals.complete','appointment.schedule','lending.confirmHandover'])assert.equal(button(forbidden),undefined);
    button('workflow.report').onClick();render();const report=capture.elements.find(x=>typeof x.type==='function'&&x.type.name==='ReportDialog');assert.equal(report.props.targetId,'old-pending');assert.equal(report.props.targetKind,'deal');
  });
  await check('new exchanges never invent legacy report or review targets',async()=>{
    reset();render();await runTimers();await settle([contact('only-new')]);assert.equal(button('workflow.report'),undefined);assert.equal(button('deals.rate'),undefined);
  });
  await check('retired report close callback cannot write page state',async()=>{
    reset();render();await runTimers();await settle([],[legacy('reportable')]);button('workflow.report').onClick();render();const report=capture.elements.find(x=>typeof x.type==='function'&&x.type.name==='ReportDialog').props;state.unmount();const writes=state.writes;report.onClose();assert.equal(state.writes,writes);
  });
  await check('all messenger links and distinct legacy IDs remain available',async()=>{
    reset();render();await runTimers();await settle([contact('all',{contacts:[{messenger_type:'tg',contact_value:'@alice'},{messenger_type:'wa',contact_value:'+38267123456'},{messenger_type:'viber',contact_value:'+38267123456'}]})],[legacy('one'),legacy('two'),legacy('one')]);
    const links=capture.elements.filter(x=>x.type==='a').map(x=>x.props.href);assert.ok(links.includes('viber://chat?number=+38267123456'));assert.equal(links.length,5);
  });
  await check('completed legacy review remains available and is double-tap safe',async()=>{
    reset();render();await runTimers();await settle([],[legacy('complete',{completed_at:'2026-11-01T10:00:00Z',status:'completed'})]);
    button('deals.rate').onClick();render();const rate=capture.elements.find(x=>x.type==='button'&&x.props['aria-label']==='5/5').props;
    const one=rate.onClick(),two=rate.onClick();await tick();assert.equal(api.mutations.length,1);assert.deepEqual(api.mutations[0].args,['complete',5]);api.mutations[0].resolve({});await tick();
    for(const load of api.loads.slice(2))load.resolve([]);await Promise.all([one,two]);
  });
  await check('dismissed legacy rating callback cannot submit later',async()=>{
    reset();render();await runTimers();await settle([],[legacy('complete',{status:'completed'})]);button('deals.rate').onClick();render();const old=capture.elements.find(x=>x.type==='button'&&x.props['aria-label']==='5/5').props;nav.overlay.close();render();const pending=old.onClick();await tick();assert.equal(api.mutations.length,0);await pending;
  });
  for(const retirement of ['unmount','auth'])await check(`${retirement} suppresses late legacy review results`,async()=>{
    reset();render();await runTimers();await settle([],[legacy('complete',{status:'completed'})]);button('deals.rate').onClick();render();const old=capture.elements.find(x=>x.type==='button'&&x.props['aria-label']==='5/5').props;const pending=old.onClick();await tick();if(retirement==='unmount')state.unmount();else db.changeAccount('b');const writes=state.writes;api.mutations[0].resolve({});await pending;assert.equal(state.writes,writes);assert.equal(api.loads.length,2);assert.equal(toasts.length,0);
  });
  await check('partial load failure preserves contacts and offers retry',async()=>{
    reset();render();await runTimers();api.loads.find(x=>x.kind==='contacts').resolve([contact('kept')]);api.loads.find(x=>x.kind==='legacy').reject(Error('offline'));await tick();render();assert.ok(button('common.retry'));assert.ok(text(render()).includes('kept'));button('common.retry').onClick();assert.equal(api.loads.length,4);
  });
  await check('empty page and newest refresh wins',async()=>{
    reset();render();await runTimers();const old=[...api.loads];listeners.get('deals-updated')();await settle([contact('newest')]);old.forEach(x=>x.resolve([x.kind==='contacts'?contact('stale'):legacy('stale')]));await tick();assert.ok(!text(render()).includes('stale'));
    listeners.get('deals-updated')();await settle();assert.ok(text(render()).includes('simpleExchange.empty'));
  });
  for(const retirement of ['unmount','auth','props','inactive'])await check(`${retirement} suppresses late private contacts`,async()=>{
    reset();render();await runTimers();if(retirement==='unmount')state.unmount();else if(retirement==='auth')db.changeAccount('b');else render(SimpleDeals,retirement==='props'?{userId:'b'}:{userId:'a',active:false});
    const writes=state.writes;api.loads.slice(0,2).forEach(x=>x.resolve([x.kind==='contacts'?contact('private-old'):legacy('private-old')]));await tick();assert.equal(state.writes,writes);
    if(retirement!=='unmount')assert.ok(!text(render(SimpleDeals,retirement==='props'?{userId:'b'}:{userId:'a',active:false})).includes('private-old'));
  });
  await check('owner partial remaining saves null reason once and awaits refresh',async()=>{
    startManager();assert.ok(text(render(Manager,props())).includes('simpleExchange.checkDue'));openRemaining();assert.equal(nav.overlay.open,true);assert.equal(focus.focus.open,true);assert.equal(input().value,'8');amount('3');
    const save=button('simpleExchange.saveRemaining');const one=save.onClick(),two=save.onClick();await tick();assert.equal(api.mutations.length,1);assert.deepEqual(api.mutations[0].args,['listing-a',3,null]);assert.equal(nav.overlay.close(),false);api.mutations[0].resolve({id:'listing-a'});await Promise.all([one,two]);assert.equal(changed,1);
  });
  await check('remaining validation rejects blank fraction negative overflow and non-numbers',async()=>{
    for(const value of ['', '1.5','-1','10001','abc']){startManager();openRemaining();amount(value);await button('simpleExchange.saveRemaining').onClick();assert.equal(api.mutations.length,0,value);assert.ok(text(render(Manager,props())).includes('simpleExchange.invalidRemaining'));}
  });
  for(const [key,reason] of [['simpleExchange.allDone','completed'],['simpleExchange.noLongerRelevant','not_relevant']])await check(`zero asks close reason: ${reason}`,async()=>{
    startManager();openRemaining();amount('0');await button('simpleExchange.saveRemaining').onClick();render(Manager,props());assert.equal(api.mutations.length,0);assert.ok(button(key));const pending=button(key).onClick();await tick();assert.deepEqual(api.mutations[0].args,['listing-a',0,reason]);api.mutations[0].resolve({});await pending;
  });
  await check('close cancellation and Back never mutate',async()=>{
    startManager();button('simpleExchange.close').onClick();render(Manager,props());assert.equal(nav.overlay.close(),true);render(Manager,props());assert.equal(nav.overlay.open,false);assert.equal(api.mutations.length,0);
    openRemaining();button('common.cancel').onClick();render(Manager,props());assert.equal(nav.overlay.open,false);assert.equal(api.mutations.length,0);
  });
  await check('still current acknowledges without quantity mutation',async()=>{
    startManager();const tap=button('simpleExchange.stillCurrent');const one=tap.onClick(),two=tap.onClick();await tick();assert.equal(api.mutations.length,1);assert.equal(api.mutations[0].kind,'current');api.mutations[0].resolve({});await Promise.all([one,two]);assert.equal(changed,1);
  });
  await check('positive upper bound and mutation failure allow an honest retry',async()=>{
    startManager();openRemaining();amount('10000');const first=button('simpleExchange.saveRemaining').onClick();await tick();assert.deepEqual(api.mutations[0].args,['listing-a',10000,null]);api.mutations[0].reject(Error('offline'));await first;render(Manager,props());assert.ok(text(render(Manager,props())).includes('reliabilityExperience.errors.network'));
    const next=button('simpleExchange.saveRemaining').onClick();await tick();assert.equal(api.mutations.length,2);api.mutations[1].resolve({});await next;assert.equal(changed,1);
  });
  await check('owner action stays locked until asynchronous onChanged finishes',async()=>{
    startManager();let finish;const refreshed=new Promise(resolve=>{finish=resolve;});const p={...props(),onChanged:()=>refreshed};render(Manager,p);const tap=button('simpleExchange.stillCurrent');const one=tap.onClick();await tick();api.mutations[0].resolve({});await tick();render(Manager,p);assert.equal(button('simpleExchange.stillCurrent').disabled,true);await tap.onClick();assert.equal(api.mutations.length,1);finish();await one;render(Manager,p);assert.equal(button('simpleExchange.stillCurrent').disabled,false);
  });
  await check('cancelled remaining and close callbacks cannot submit later',async()=>{
    startManager();openRemaining();amount('4');const staleSave=button('simpleExchange.saveRemaining');button('common.cancel').onClick();render(Manager,props());const lateSave=staleSave.onClick();await tick();assert.equal(api.mutations.length,0);await lateSave;
    button('simpleExchange.close').onClick();render(Manager,props());const staleClose=button('simpleExchange.allDone');nav.overlay.close();render(Manager,props());const lateClose=staleClose.onClick();await tick();assert.equal(api.mutations.length,0);await lateClose;
  });
  await check('a retired account mutation does not block the next owner input',async()=>{
    startManager();const old=button('simpleExchange.stillCurrent').onClick();await tick();db.changeAccount('b');const p={listing:{...listing,id:'listing-b',user_id:'b'},userId:'b'};render(Manager,p);button('simpleExchange.remaining').onClick();render(Manager,p);input().onChange({target:{value:'6'}});render(Manager,p);assert.equal(input().value,'6');api.mutations[0].resolve({});await old;
  });
  await check('future due question appears on resume at its timestamp',async()=>{
    const realNow=Date.now;let now=Date.parse('2026-11-01T00:00:00Z');Date.now=()=>now;
    try{startManager();const p={...props(),listing:{...listing,owner_check_due_at:'2026-11-02T00:00:00Z'}};assert.ok(!text(render(Manager,p)).includes('simpleExchange.checkDue'));now=Date.parse('2026-11-02T00:00:00Z');listeners.get('focus')();assert.ok(text(render(Manager,p)).includes('simpleExchange.checkDue'));}finally{Date.now=realNow;}
  });
  await check('hidden and signed-out page never requests contacts',async()=>{
    for(const p of [{userId:'a',active:false},{userId:null}]){reset();render(SimpleDeals,p);await runTimers();assert.equal(api.loads.length,0);}
  });
  for(const retirement of ['unmount','auth','props','inactive'])await check(`${retirement} retires owner callbacks and late mutation effects`,async()=>{
    startManager();const old=button('simpleExchange.stillCurrent');const pending=old.onClick();await tick();assert.equal(api.mutations.length,1);
    if(retirement==='unmount')state.unmount();else if(retirement==='auth')db.changeAccount('b');else render(Manager,{...props(),...(retirement==='props'?{userId:'b'}:{active:false})});
    const writes=state.writes;api.mutations[0].resolve({});await pending;assert.equal(changed,0);assert.equal(toasts.length,0);assert.equal(state.writes,writes);await old.onClick();assert.equal(api.mutations.length,1);
  });
  await check('unauthorized inactive and closed listing never start mutations',async()=>{
    for(const patch of [{userId:'b'},{userId:null},{active:false},{listing:{...listing,status:'completed'}},{listing:{...listing,moderation_status:'rejected'}}]){reset();const tree=render(Manager,{...props(),...patch});assert.equal(tree,null);assert.equal(api.mutations.length,0);}
    startManager();const old=button('simpleExchange.stillCurrent');db.setSession('b');await old.onClick();assert.equal(api.mutations.length,0);
  });
  reset();stop();assert.deepEqual(failures,[],'Simple exchange UI regressions');console.log('Simple exchange UI checks passed; real JSX handlers, persistent hook scheduling; no physical browser claim.');
} finally {hooks.deregister();globalThis.window=originalWindow;globalThis.fetch=originalFetch;globalThis.document=originalDocument;}
