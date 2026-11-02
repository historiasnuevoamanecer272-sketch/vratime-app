import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'rolldown/utils';

// Real Profile load/query chain and real inbox JSX, effects and event handlers.
// Network, React scheduling and nested children are the only controlled seams.
const src = new URL('../src/', import.meta.url).href;
const profileUrl = new URL('pages/Profile.jsx', src).href;
const listingsUrl = new URL('pages/MyListings.jsx', src).href;
const inboxUrl = new URL('components/DiscoveryInbox.jsx', src).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if ([profileUrl, inboxUrl, listingsUrl].includes(context.parentURL)) {
      const seams = { react:'hooks', 'react/jsx-runtime':'jsx', 'react-i18next':'translation', '../i18n':'translation', '../supabaseClient':'database', '../lib/api':'api', '../lib/toast':'toast', '../hooks/useAppNavigation':'navigation', '../hooks/useDialogFocus':'navigation' };
      if (seams[specifier]) return {url:`profile-inbox:${seams[specifier]}`,shortCircuit:true};
      if (/ListingStatusManager$/.test(specifier)) return {url:'profile-inbox:manager',shortCircuit:true};
      if (([profileUrl, listingsUrl].includes(context.parentURL) && specifier.startsWith('../components/')) || (context.parentURL === inboxUrl && specifier.startsWith('./')) || specifier.endsWith('.png')) return {url:'profile-inbox:child',shortCircuit:true};
    }
    if (context.parentURL?.startsWith(src) && specifier.startsWith('.')) {
      if (/supabaseClient(?:\.js)?$/.test(specifier)) return {url:'profile-inbox:database',shortCircuit:true};
      for (const extension of ['', '.js', '.jsx']) {
        const candidate = new URL(`${specifier}${extension}`, context.parentURL);
        if (existsSync(candidate)) return {url:candidate.href,shortCircuit:true};
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const module = source => ({format:'module',source,shortCircuit:true});
    if (url === 'profile-inbox:hooks') return module(`
      let slots=[],cursor=0,pending=[];export let writes=0;
      const changed=(a,b)=>!a||!b||a.length!==b.length||b.some((v,i)=>!Object.is(v,a[i]));
      export const unmount=()=>{for(const slot of slots)slot.cleanup?.();pending=[];};
      export const reset=()=>{unmount();slots=[];cursor=0;writes=0;};
      export const begin=()=>{cursor=0;};
      export const flush=()=>{const work=pending;pending=[];for(const {slot,effect} of work){slot.cleanup?.();slot.cleanup=effect();}};
      export const useState=initial=>{const i=cursor++,slot=slots[i]||(slots[i]={value:typeof initial==='function'?initial():initial});return[slot.value,next=>{writes++;slot.value=typeof next==='function'?next(slot.value):next;}];};
      export const useRef=initial=>{const i=cursor++;return(slots[i]||(slots[i]={value:{current:initial}})).value;};
      export const useMemo=(compute,deps)=>{const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={value:compute(),deps};return slots[i].value;};
      export const useCallback=(callback,deps)=>useMemo(()=>callback,deps);
      export const useEffect=(effect,deps)=>{const i=cursor++,slot=slots[i]||(slots[i]={});if(changed(slot.deps,deps)){slot.deps=deps;pending.push({slot,effect});}};
    `);
    if (url === 'profile-inbox:jsx') return module(`export const elements=[],Fragment=Symbol();export const jsx=(type,props,key)=>{const node={type,props:props||{},key};elements.push(node);return node;};export const jsxs=jsx;`);
    if (url === 'profile-inbox:translation') return module(`const t=(key,options)=>options?.returnObjects?['Start','Helper','Keeper','Ambassador','Adriatic']:key;export const useTranslation=()=>({t});export const getAppLanguage=()=> 'en';export const setAppLanguage=()=>{};`);
    if (url === 'profile-inbox:navigation') return module('export const useAppOverlay=()=>{};export const useDialogFocus=()=>{};');
    if (url === 'profile-inbox:toast') return module('export const messages=[];export const showToast=(...args)=>messages.push(args);');
    if (url === 'profile-inbox:child') return module('export default function Child(){};export function AvatarCrop(){};');
    if (url === 'profile-inbox:manager') return module('export default function ListingStatusManager(){};');
    if (url === 'profile-inbox:api') return module(`
      export const requests=[],mutations=[];export const getMyListingInterestCounts=async()=>[];
      export const getMyDiscoveryFeed=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));
      const mutate=(...args)=>new Promise((resolve,reject)=>mutations.push({resolve,reject,args}));
      export const markInboxItemRead=mutate,deleteSavedSearch=mutate;
      export const getMyDeals=async()=>[{transaction_id:'completed-legacy',completed_at:'2026-11-01T01:00:00Z',quantity:50,partner_name:'legacy',created_at:'2026-11-01T00:00:00Z'}];
      export const getEcoLeaderboard=async()=>[{user_id:'peer',full_name:'ranked-fixture',rank:1,eco_points:500}],getMyReliability=async()=>({completed_count:5}),getImpactTotals=async()=>({personal:{items:50},community:{items:100}});
      export const createFeedback=async()=>{},requestFeedbackTelegramDelivery=async()=>{},saveMyProfile=async()=>{},setMyAvatar=async()=>{},setRankingParticipation=async()=>{};
    `);
    if (url === 'profile-inbox:database') return module(`
      export let user='a';export const queries=[],authListeners=new Set();export const rows=[];
      export const changeAccount=id=>{user=id;for(const callback of [...authListeners])callback('SIGNED_IN',{user:id?{id}:null});};
      export const supabase={auth:{getUser:async()=>({data:{user:{id:user}}}),onAuthStateChange(callback){authListeners.add(callback);return{data:{subscription:{unsubscribe(){authListeners.delete(callback);}}}};}},from(table){
        const filters=[];const query={table,filters};queries.push(query);
        const chain=new Proxy({}, {get(_target,key){
          if(key==='then'){
            let data=table==='profiles'?{id:user,full_name:'fixture-owner',eco_points:250,rating:4.9,language:'en'}:table==='listings'?[...rows]:table==='reviews'?[{id:'rating',to_user_id:user,rating:5,created_at:'2026-11-01T00:00:00Z',from_user:{full_name:'review-fixture'}}]:[];
            for(const {op,field,value} of filters)if(Array.isArray(data))data=data.filter(row=>op==='eq'?row[field]===value:row[field]!==value);
            const promise=Promise.resolve({data,error:null});return promise.then.bind(promise);
          }
          if(key==='eq'||key==='neq')return(field,value)=>{filters.push({op:key,field,value});return chain;};
          return()=>chain;
        }});return chain;
      }};
    `);
    if ([profileUrl, inboxUrl, listingsUrl].includes(url)) {
      const transformed = transformSync(fileURLToPath(url), readFileSync(new URL(url),'utf8'), {jsx:{runtime:'automatic'}});
      assert.equal(transformed.errors.length,0);return module(transformed.code);
    }
    if (url.endsWith('.css')) return module('export default {};');
    return next(url,context);
  },
});
const originalWindow=globalThis.window,originalDocument=globalThis.document,originalFetch=globalThis.fetch;
const timeouts=new Map(),intervals=new Map(),listeners=new Map(),docListeners=new Map(),stored=new Map();let serial=0;
const add=(map,key,fn)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(fn);};
const remove=(map,key,fn)=>{map.get(key)?.delete(fn);if(!map.get(key)?.size)map.delete(key);};
const emit=(name,event={})=>{for(const fn of [...(listeners.get(name)||[])])fn(event);};
const emitDocument=name=>{for(const fn of [...(docListeners.get(name)||[])])fn();};
globalThis.window={navigator:{onLine:true},localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},setTimeout:(fn,delay=0)=>{timeouts.set(++serial,{fn,delay});return serial;},clearTimeout:id=>timeouts.delete(id),setInterval:(fn,delay)=>{intervals.set(++serial,{fn,delay});return serial;},clearInterval:id=>intervals.delete(id),addEventListener:(key,fn)=>add(listeners,key,fn),removeEventListener:(key,fn)=>remove(listeners,key,fn),dispatchEvent:event=>emit(event.type,event),confirm:()=>true};
globalThis.document={visibilityState:'visible',addEventListener:(key,fn)=>add(docListeners,key,fn),removeEventListener:(key,fn)=>remove(docListeners,key,fn)};
globalThis.fetch=()=>{throw Error('Offline lifecycle fixture forbids network');};
try {
  const [{default:Profile},{default:Inbox},{default:MyListings},state,capture,api,db,toasts]=await Promise.all([import(profileUrl),import(inboxUrl),import(listingsUrl),import('profile-inbox:hooks'),import('profile-inbox:jsx'),import('profile-inbox:api'),import('profile-inbox:database'),import('profile-inbox:toast')]);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const runInitial=()=>{for(const [id,{fn,delay}] of [...timeouts])if(delay===0){timeouts.delete(id);fn();}};
  const poll=()=>{for(const {fn} of [...intervals.values()])fn();};
  const render=(Component=Inbox,props={userId:'a',active:true})=>{state.begin();capture.elements.length=0;const tree=Component(props);state.flush();return tree;};
  const reset=()=>{state.reset();timeouts.clear();intervals.clear();listeners.clear();docListeners.clear();stored.clear();api.requests.length=0;api.mutations.length=0;db.queries.length=0;db.rows.length=0;db.changeAccount('a');toasts.messages.length=0;document.visibilityState='visible';window.navigator.onLine=true;};
  const text=node=>Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):typeof node==='string'?node:'';
  const feed=name=>({saved_searches:[],favourites:[],matches:[],inbox:name?[{id:name,title:name,body:'fixture-body'}]:[]});
  const button=key=>capture.elements.find(node=>node.type==='button'&&text(node)===key)?.props;
  const start=async(props={userId:'a',active:true})=>{reset();render(Inbox,props);runInitial();await tick();};
  const resolve=async(name,index=api.requests.length-1)=>{assert.ok(api.requests[index],`missing request ${index}`);api.requests[index].resolve(feed(name));await tick();return render();};
  const failures=[];const check=async(name,test)=>{try{await test();console.log(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.stack}`);console.error(`FAIL ${name}: ${error.message}`);}};

  await check('My listings retains closed history while Profile retains rewards and reviews',async()=>{
    reset();db.changeAccount('history-owner');db.rows.push(...['active','completed','canceled'].map((status,index)=>({id:`listing-${status}`,user_id:'history-owner',status,type:'give',category:'box',quantity:index+1,available_quantity:index+1,created_at:'2026-11-01T00:00:00Z'})));
    const p={userId:'history-owner',active:true};render(MyListings,p);runInitial();await tick();render(MyListings,p);
    const managers=()=>capture.elements.filter(node=>typeof node.type==='function'&&node.type.name==='ListingStatusManager');
    assert.deepEqual(managers().map(node=>node.props.listing.status).sort(),['active','canceled','completed']);
    const refresh=managers().find(node=>node.props.listing.id==='listing-active').props.onChanged;db.rows[0]={...db.rows[0],status:'canceled',available_quantity:0};await refresh();render(MyListings,p);assert.equal(managers().length,3);assert.equal(managers().find(node=>node.props.listing.id==='listing-active').props.listing.status,'canceled');
    state.reset();render(Profile,p);runInitial();await tick();const tree=render(Profile,p);assert.equal(managers().length,0);
    for(const key of ['profile.allLevels','profile.achievements','profile.leaderboard','profile.reviews','reliability.title'])assert.ok(text(tree).includes(key),`Preserve ${key}`);
    assert.ok(text(tree).includes('ranked-fixture'));assert.ok(text(tree).includes('review-fixture'));assert.ok(db.queries.some(query=>query.table==='listings'&&query.filters.some(filter=>filter.op==='eq'&&filter.field==='user_id'&&filter.value==='history-owner')));
  });
  await check('inactive retained inbox does not fetch until activation',async()=>{
    await start({userId:'a',active:false});assert.equal(api.requests.length,0);emit('focus');poll();await tick();assert.equal(api.requests.length,0);render(Inbox,{userId:'a',active:true});runInitial();await tick();assert.equal(api.requests.length,1);await resolve('activated-notice');assert.ok(text(render()).includes('activated-notice'));
  });
  await check('returning to retained profile refreshes new notices without initial loading flicker',async()=>{
    await start();await resolve('existing');render(Inbox,{userId:'a',active:false});render();runInitial();await tick();assert.equal(api.requests.length,2);const tree=render();assert.ok(text(tree).includes('existing'));assert.ok(!text(tree).includes('common.loading'));await resolve('new-contact-notice');assert.ok(text(render()).includes('new-contact-notice'));
  });
  for(const event of ['focus','online','visibilitychange'])await check(`${event} refreshes inbox without replacing successful feed with spinner`,async()=>{
    await start();await resolve('existing');if(event==='visibilitychange')emitDocument(event);else emit(event);await tick();assert.equal(api.requests.length,2);assert.ok(text(render()).includes('existing'));assert.ok(!text(render()).includes('common.loading'));await resolve(`new-${event}`);assert.ok(text(render()).includes(`new-${event}`));
  });
  await check('visible 60-second freshness polling finds scheduled reminders',async()=>{
    await start();await resolve('existing');assert.equal(intervals.size,1);assert.equal([...intervals.values()][0].delay,60000);poll();await tick();assert.equal(api.requests.length,2);await resolve('new-scheduled-reminder');assert.ok(text(render()).includes('new-scheduled-reminder'));
  });
  await check('focus and online bursts coalesce until current request settles',async()=>{
    await start();await resolve('existing');emit('focus');await tick();assert.equal(api.requests.length,2);emit('focus');emit('online');emitDocument('visibilitychange');await tick();assert.equal(api.requests.length,2);await resolve('intermediate',1);assert.equal(api.requests.length,3);await resolve('coalesced',2);assert.equal(api.requests.length,3);
  });
  await check('browser-hidden and offline inbox skip polling and resume when visible online',async()=>{
    await start();await resolve('existing');document.visibilityState='hidden';poll();emit('focus');await tick();assert.equal(api.requests.length,1);document.visibilityState='visible';window.navigator.onLine=false;poll();emitDocument('visibilitychange');await tick();assert.equal(api.requests.length,1);window.navigator.onLine=true;emit('online');await tick();assert.equal(api.requests.length,2);
  });
  for(const retirement of ['inactive','account','auth','unmount'])await check(`${retirement} suppresses late inbox responses and cleans refresh subscriptions`,async()=>{
    await start();if(retirement==='inactive')render(Inbox,{userId:'a',active:false});else if(retirement==='account')render(Inbox,{userId:'b',active:true});else if(retirement==='auth')db.changeAccount('b');else state.unmount();const writes=state.writes;api.requests[0].resolve(feed('private-stale'));await tick();assert.equal(state.writes,writes);
    if(retirement==='inactive'||retirement==='unmount'){emit('focus');poll();runInitial();await tick();assert.equal(api.requests.length,1);assert.equal(intervals.size,0);assert.equal(listeners.size,0);assert.equal(docListeners.size,0);}
    if(retirement==='account')assert.ok(!text(render(Inbox,{userId:'b',active:true})).includes('private-stale'));
  });
  await check('different account never renders the previous successful private feed',async()=>{
    await start();await resolve('private-account-a');db.changeAccount('b');const tree=render(Inbox,{userId:'b',active:true});assert.ok(!text(tree).includes('private-account-a'));runInitial();await tick();assert.equal(api.requests.length,2);
  });
  await check('newest manual owner refresh wins over an older in-flight refresh',async()=>{
    const props={userId:'a',active:true,listings:[{id:'own-listing',user_id:'a',status:'active'}],onListingChanged:async()=>{}};await start(props);api.requests[0].resolve({...feed('due'),inbox:[{id:'due',title:'due',payload:{kind:'listing_check',listing_id:'own-listing'}}]});await tick();render(Inbox,props);const manager=capture.elements.find(node=>typeof node.type==='function'&&node.type.name==='ListingStatusManager');assert.ok(manager);const first=manager.props.onChanged(),second=manager.props.onChanged();await tick();assert.equal(api.requests.length,3);api.requests[2].resolve(feed('newest'));await second;api.requests[1].resolve(feed('obsolete'));await first;const tree=render(Inbox,props);assert.ok(text(tree).includes('newest'));assert.ok(!text(tree).includes('obsolete'));
  });
  await check('initial inbox error offers retry and succeeds',async()=>{
    await start();api.requests[0].reject(Error('offline'));await tick();render();assert.ok(button('common.retry'));button('common.retry').onClick();await tick();assert.equal(api.requests.length,2);await resolve('retried');assert.ok(text(render()).includes('retried'));
  });
  reset();assert.deepEqual(failures,[],'Profile/inbox lifecycle regressions');console.log('Profile/inbox lifecycle checks passed; actual owner query and inbox handlers, controlled host/network, no browser claim.');
} finally {hooks.deregister();globalThis.window=originalWindow;globalThis.document=originalDocument;globalThis.fetch=originalFetch;}
