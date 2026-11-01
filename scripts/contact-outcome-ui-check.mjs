import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'rolldown/utils';
import { simpleExchangeByLanguage } from '../src/i18n/uxSimpleExchange.js';

const src=new URL('../src/',import.meta.url).href;
const targets=['components/ListingContactOutcome.jsx','pages/SimpleDeals.jsx','pages/MapScreen.jsx','pages/Profile.jsx','components/DiscoveryInbox.jsx'].map(path=>new URL(path,src).href);
assert.ok(existsSync(new URL(targets[0])),'Missing ListingContactOutcome component');
const hook=registerHooks({
  resolve(specifier,context,next){
    if(targets.includes(context.parentURL)){
      const seams={react:'hooks','react/jsx-runtime':'jsx','react-i18next':'translation','../i18n':'translation','../lib/api':'api','../supabaseClient':'db','../lib/toast':'toast','../hooks/useAppNavigation':'overlay','../hooks/useDialogFocus':'focus','react-leaflet':'map','../lib/basemap':'base'};
      if(seams[specifier])return{url:`outcome-ui:${seams[specifier]}`,shortCircuit:true};
      if(specifier.includes('ListingContactOutcome')||specifier.includes('ListingStatusManager'))return{url:`outcome-ui:${specifier.includes('ListingContactOutcome')?'outcomeChild':'manager'}`,shortCircuit:true};
      if(specifier.startsWith('../components/')||(context.parentURL.endsWith('/DiscoveryInbox.jsx')&&specifier.startsWith('./'))||specifier==='./Icon'||specifier.endsWith('.png'))return{url:'outcome-ui:child',shortCircuit:true};
    }
    if(context.parentURL?.startsWith(src)){
      if(specifier==='leaflet')return{url:'outcome-ui:leaflet',shortCircuit:true};
      if(/supabaseClient(?:\.js)?$/.test(specifier))return{url:'outcome-ui:db',shortCircuit:true};
      if(specifier.startsWith('.'))for(const extension of ['','.js','.jsx','/index.js']){const url=new URL(specifier+extension,context.parentURL);if(existsSync(url)&&!url.pathname.endsWith('/i18n'))return{url:url.href,shortCircuit:true};}
    }
    return next(specifier,context);
  },
  load(url,context,next){
    const module=source=>({format:'module',source,shortCircuit:true});
    if(url==='outcome-ui:hooks')return module(`
      let slots=[],cursor=0,pending=[];export let writes=0;
      const changed=(a,b)=>!a||!b||a.length!==b.length||b.some((v,i)=>!Object.is(v,a[i]));
      export const unmount=()=>{for(const s of slots)s.cleanup?.();pending=[];};export const reset=()=>{unmount();slots=[];cursor=0;writes=0;};export const begin=()=>{cursor=0;};
      export const flush=()=>{const work=pending;pending=[];for(const {slot,effect} of work){slot.cleanup?.();slot.cleanup=effect();}};
      export const useState=initial=>{const i=cursor++,slot=slots[i]||(slots[i]={value:typeof initial==='function'?initial():initial});return[slot.value,next=>{writes++;slot.value=typeof next==='function'?next(slot.value):next;}];};
      export const useRef=initial=>{const i=cursor++;return(slots[i]||(slots[i]={value:{current:initial}})).value;};
      export const useMemo=(fn,deps)=>{const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={value:fn(),deps};return slots[i].value;};export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);
      export const useEffect=(effect,deps)=>{const i=cursor++,slot=slots[i]||(slots[i]={});if(changed(slot.deps,deps)){slot.deps=deps;pending.push({slot,effect});}};
    `);
    if(url==='outcome-ui:jsx')return module(`export const elements=[],Fragment=Symbol();export const jsx=(type,props,key)=>{const node={type,props:props||{},key};elements.push(node);return node;};export const jsxs=jsx;`);
    if(url==='outcome-ui:translation')return module(`const t=(key,options)=>options?.returnObjects?['Start','Helper','Keeper','Ambassador','Adriatic']:key;export const useTranslation=()=>({t});export const getAppLanguage=()=> 'en';export const setAppLanguage=()=>{};`);
    if(url==='outcome-ui:overlay')return module(`export let overlay;export const useAppOverlay=(open,close,key)=>{overlay={open,close,key};};`);
    if(url==='outcome-ui:focus')return module(`export let focus;export const useDialogFocus=options=>{focus=options;return{role:'dialog','aria-modal':true,tabIndex:-1};};`);
    if(url==='outcome-ui:child')return module('export default function Child(){};export function AvatarCrop(){};');
    if(url==='outcome-ui:outcomeChild')return module('export default function ListingContactOutcome(){};');
    if(url==='outcome-ui:manager')return module('export default function ListingStatusManager(){};');
    if(url==='outcome-ui:toast')return module('export const toasts=[];export const showToast=(...args)=>toasts.push(args);');
    if(url==='outcome-ui:base')return module("export const baseMap={url:'offline://',attribution:'',maxZoom:20};");
    if(url==='outcome-ui:map')return module(`export const MapContainer=()=>{},Marker=()=>{},Popup=()=>{},TileLayer=()=>{},Tooltip=()=>{};export const useMap=()=>({});`);
    if(url==='outcome-ui:leaflet')return module('export default {divIcon:options=>options};');
    if(url==='outcome-ui:api')return module(`
      export const loads=[],mutations=[],interestReads=[];export let counts=[];export const setCounts=value=>{counts=value;};
      const load=kind=>new Promise((resolve,reject)=>loads.push({kind,resolve,reject}));const mutate=kind=>(...args)=>new Promise((resolve,reject)=>mutations.push({kind,args,resolve,reject}));
      export const submitListingContactOutcome=mutate('outcome'),requestListingContacts=mutate('contact'),submitReview=mutate('review'),markInboxItemRead=mutate('read'),deleteSavedSearch=mutate('search');
      export const getMyListingContacts=()=>load('contacts'),getMyDeals=async()=>[],getMyDiscoveryFeed=()=>load('feed'),getPublicMapListings=()=>load('map'),getCollectionPoints=async()=>[];
      export const getMyListingInterestCounts=async()=>{interestReads.push('counts');return counts;};
      export const getEcoLeaderboard=async()=>[],getMyReliability=async()=>null,getImpactTotals=async()=>null;
      export const createFeedback=async()=>{},requestFeedbackTelegramDelivery=async()=>{},saveMyProfile=async()=>{},setMyAvatar=async()=>{},setRankingParticipation=async()=>{},saveSearch=async()=>{},toggleListingFavourite=async()=>{},voteCollectionPoint=async()=>{};
    `);
    if(url==='outcome-ui:db')return module(`
      export let user='a';export const listeners=new Set(),rows=[];export const changeAccount=id=>{user=id;for(const fn of [...listeners])fn('SIGNED_IN',{user:id?{id}:null});};
      export const supabase={auth:{getUser:async()=>({data:{user:user?{id:user}:null}}),onAuthStateChange(fn){listeners.add(fn);return{data:{subscription:{unsubscribe(){listeners.delete(fn);}}}};}},from(table){const result={data:table==='profiles'?{id:user,full_name:'Owner',eco_points:0}:table==='listings'?[...rows]:[],error:null};const chain=new Proxy({},{get(_target,key){if(key==='then')return Promise.resolve(result).then.bind(Promise.resolve(result));return()=>chain;}});return chain;}};
    `);
    if(url.startsWith(src)&&/\.(css|png|webp)$/.test(url))return module('export default "fixture";');
    if(targets.includes(url)){const result=transformSync(fileURLToPath(url),readFileSync(new URL(url),'utf8'),{jsx:{runtime:'automatic'}});assert.equal(result.errors.length,0);return module(result.code);}
    return next(url,context);
  }
});
const originals={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,now:Date.now};
let now=Date.parse('2026-11-01T00:00:00Z'),serial=0;Date.now=()=>now;
const timers=new Map(),intervals=new Map(),listeners=new Map(),docListeners=new Map(),events=[];
const add=(map,key,fn)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(fn);};const remove=(map,key,fn)=>{map.get(key)?.delete(fn);if(!map.get(key)?.size)map.delete(key);};
const emit=name=>{for(const fn of [...(listeners.get(name)||[])])fn({type:name});};
globalThis.window={navigator:{onLine:true},localStorage:{getItem:()=>null,setItem(){}},setTimeout:(fn,delay=0)=>{timers.set(++serial,{fn,due:now+delay});return serial;},clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>{intervals.set(++serial,{fn,delay});return serial;},clearInterval:id=>intervals.delete(id),addEventListener:(key,fn)=>add(listeners,key,fn),removeEventListener:(key,fn)=>remove(listeners,key,fn),dispatchEvent:event=>{events.push(event.type);emit(event.type);},confirm:()=>true};
globalThis.document={visibilityState:'visible',addEventListener:(key,fn)=>add(docListeners,key,fn),removeEventListener:(key,fn)=>remove(docListeners,key,fn)};globalThis.fetch=()=>{throw Error('Offline only');};
try{
  const [{default:Outcome},{default:Deals},{default:Map},{default:Profile},{default:Inbox},state,jsx,api,db,overlay,focus,markers]=await Promise.all([...targets.map(url=>import(url)),import('outcome-ui:hooks'),import('outcome-ui:jsx'),import('outcome-ui:api'),import('outcome-ui:db'),import('outcome-ui:overlay'),import('outcome-ui:focus'),import('../src/lib/mapMarkers.js')]);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const runTimers=()=>{for(const [id,timer] of [...timers])if(timer.due<=now){timers.delete(id);timer.fn();}};
  const reset=()=>{state.reset();timers.clear();intervals.clear();listeners.clear();docListeners.clear();api.loads.length=0;api.mutations.length=0;api.interestReads.length=0;api.setCounts([]);db.rows.length=0;db.changeAccount('a');events.length=0;now=Date.parse('2026-11-01T00:00:00Z');};
  const render=(Component=Outcome,props=currentProps)=>{state.begin();jsx.elements.length=0;const tree=Component(props);state.flush();return tree;};
  const text=node=>Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):typeof node==='string'?node:'';
  const button=key=>jsx.elements.find(node=>node.type==='button'&&text(node)===key)?.props;
  const exchange=patch=>({exchange_id:'exchange-a',listing_id:'listing-a',listing_status:'active',is_listing_owner:false,remaining_quantity:8,feedback_due_at:'2026-10-31T23:59:59Z',feedback_available:true,my_outcome:null,partner_outcome:null,interest_active:true,active_interest_count:3,contacts:[{messenger_type:'tg',contact_value:'@other'}],...patch});
  let changes=[],currentProps;
  const start=patch=>{reset();changes=[];currentProps={exchange:exchange(patch),userId:'a',onChanged:async result=>{changes.push(result);}};render();};
  const open=()=>{button('simpleExchange.outcomeQuestion').onClick();render();};
  const settleMutation=async(pending,patch={})=>{await tick();assert.ok(api.mutations[0]);api.mutations[0].resolve(exchange({my_outcome:'success',...patch}));await pending;render();};
  const failures=[];const check=async(name,test)=>{try{await test();console.log(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.message}`);console.error(`FAIL ${name}: ${error.message}`);}};

  await check('Russian exact messages and five-language outcome fields exist',async()=>{
    assert.equal(simpleExchangeByLanguage.ru.contactWithin24,'Свяжитесь по указанным контактам в течение 24 ч.');assert.equal(simpleExchangeByLanguage.ru.interestStatus,'Проявлен интерес');assert.equal(simpleExchangeByLanguage.ru.contactGive,'Заберу');assert.equal(simpleExchangeByLanguage.ru.contactTake,'Отдам');
    for(const lang of ['ru','me','en','fr','de'])for(const key of ['outcomeQuestion','outcomeSuccess','outcomeFailure','outcomeTime','outcomeRecipientDeclined','outcomeOwnerChangedMind','outcomeOther','outcomeComplete','outcomeRemaining','outcomeKeep','outcomeDueTitle','outcomeDueBody','myOutcome','partnerOutcome'])assert.ok(simpleExchangeByLanguage[lang][key],`${lang}:${key}`);
  });
  await check('authoritative due availability unlocks despite a slow device clock',async()=>{start({feedback_due_at:'2026-11-02T00:00:00Z',feedback_available:true});assert.ok(button('simpleExchange.outcomeQuestion'));});
  await check('fast device cannot unlock before server eligibility',async()=>{start({feedback_due_at:'2026-10-30T00:00:00Z',feedback_available:false});assert.equal(button('simpleExchange.outcomeQuestion'),undefined);});
  await check('24h live timer refreshes server availability and then unlocks',async()=>{start({feedback_due_at:'2026-11-02T00:00:00Z',feedback_available:false});assert.equal(button('simpleExchange.outcomeQuestion'),undefined);now+=86400000;runTimers();await tick();assert.equal(changes.length,1);assert.equal(button('simpleExchange.outcomeQuestion'),undefined);currentProps={...currentProps,exchange:{...currentProps.exchange,feedback_available:true}};render();assert.ok(button('simpleExchange.outcomeQuestion'));});
  await check('answered participant cannot answer again and independent partner result remains visible',async()=>{start({my_outcome:'success',partner_outcome:'failure',partner_reason:'time'});assert.equal(button('simpleExchange.outcomeQuestion'),undefined);const value=text(render());assert.ok(value.includes('simpleExchange.myOutcome'));assert.ok(value.includes('simpleExchange.partnerOutcome'));assert.ok(value.includes('simpleExchange.outcomeTime'));});
  await check('recipient success records outcome only, duplicate click submits once',async()=>{start();open();assert.equal(focus.focus.open,true);assert.equal(overlay.overlay.open,true);const save=button('simpleExchange.outcomeSuccess');const one=save.onClick(),two=save.onClick();await tick();assert.equal(api.mutations.length,1);assert.deepEqual(api.mutations[0].args,['exchange-a',{outcome:'success',failureReason:null,details:null,ownerAction:null,remaining:null}]);assert.equal(overlay.overlay.close(),false);await settleMutation(one);await two;assert.equal(changes.length,1);assert.ok(events.includes('listings-updated'));assert.ok(events.includes('profile-updated'));});
  for(const action of ['complete','keep','remaining'])await check(`author success sends one atomic ${action} action`,async()=>{start({is_listing_owner:true});open();button('simpleExchange.outcomeSuccess').onClick();render();assert.equal(api.mutations.length,0);button(`simpleExchange.outcome${action[0].toUpperCase()+action.slice(1)}`).onClick();render();if(action==='remaining'){const input=jsx.elements.find(node=>node.type==='input'&&node.props.type==='number').props;input.onChange({target:{value:'3'}});render();}const pending=button('simpleExchange.outcomeSubmit').onClick();await tick();assert.equal(api.mutations.length,1);assert.equal(api.mutations[0].args[1].ownerAction,action);assert.equal(api.mutations[0].args[1].remaining,action==='remaining'?3:null);await settleMutation(pending);});
  await check('partial author remaining rejects zero fraction negative blank and greater-than-current',async()=>{for(const value of ['0','-1','1.5','','9']){start({is_listing_owner:true});open();button('simpleExchange.outcomeSuccess').onClick();render();button('simpleExchange.outcomeRemaining').onClick();render();jsx.elements.find(node=>node.type==='input').props.onChange({target:{value}});render();await button('simpleExchange.outcomeSubmit').onClick();assert.equal(api.mutations.length,0,value);assert.ok(text(render()).includes('simpleExchange.outcomeInvalidRemaining'));}});
  for(const reason of ['time','recipient_declined','owner_changed_mind','other'])await check(`failure records reason ${reason} and trimmed optional details`,async()=>{start();open();button('simpleExchange.outcomeFailure').onClick();render();jsx.elements.find(node=>node.type==='select').props.onChange({target:{value:reason}});jsx.elements.find(node=>node.type==='textarea').props.onChange({target:{value:'  private note  '}});render();const pending=button('simpleExchange.outcomeSubmit').onClick();await tick();assert.deepEqual(api.mutations[0].args[1],{outcome:'failure',failureReason:reason,details:'private note',ownerAction:null,remaining:null});await settleMutation(pending,{my_outcome:'failure',my_reason:reason});});
  await check('failure requires reason and rejects details over 500',async()=>{start();open();button('simpleExchange.outcomeFailure').onClick();render();await button('simpleExchange.outcomeSubmit').onClick();assert.equal(api.mutations.length,0);jsx.elements.find(node=>node.type==='select').props.onChange({target:{value:'other'}});jsx.elements.find(node=>node.type==='textarea').props.onChange({target:{value:'x'.repeat(501)}});render();await button('simpleExchange.outcomeSubmit').onClick();assert.equal(api.mutations.length,0);});
  await check('network error remains retryable with busy released',async()=>{start();open();const pending=button('simpleExchange.outcomeSuccess').onClick();await tick();api.mutations[0].reject(Error('offline'));await pending;render();assert.ok(text(render()).includes('reliabilityExperience.errors.network'));const next=button('simpleExchange.outcomeSuccess').onClick();await tick();assert.equal(api.mutations.length,2);api.mutations[1].resolve(exchange({my_outcome:'success'}));await next;});
  await check('Back and close invalidate captured submit callbacks',async()=>{start();open();const stale=button('simpleExchange.outcomeSuccess');assert.equal(overlay.overlay.close(),true);render();const pending=stale.onClick();await tick();assert.equal(api.mutations.length,0);await pending;});
  for(const retirement of ['account','auth','inactive','unmount'])await check(`${retirement} retires outcome submission and side effects`,async()=>{start();open();const pending=button('simpleExchange.outcomeSuccess').onClick();await tick();if(retirement==='account')render(Outcome,{...currentProps,userId:'b'});else if(retirement==='auth')db.changeAccount('b');else if(retirement==='inactive')render(Outcome,{...currentProps,active:false});else state.unmount();const writes=state.writes;api.mutations[0].resolve(exchange({my_outcome:'success'}));await pending;assert.equal(state.writes,writes);assert.equal(changes.length,0);assert.equal(events.length,0);});
  await check('deals refresh on focus, show completed retained contacts and preserve latest response',async()=>{reset();render(Deals,{userId:'a'});runTimers();await tick();api.loads.find(x=>x.kind==='contacts').resolve([exchange({listing_status:'completed',interest_active:false,remaining_quantity:0})]);await tick();let tree=render(Deals,{userId:'a'});assert.ok(text(tree).includes('simpleExchange.contactWithin24'));assert.ok(text(tree).includes('simpleExchange.completed'));assert.ok(jsx.elements.some(node=>node.type==='a'&&node.props.href==='https://t.me/other'));emit('focus');await tick();const second=api.loads.filter(x=>x.kind==='contacts')[1];assert.ok(second);emit('deals-updated');await tick();const third=api.loads.filter(x=>x.kind==='contacts')[2];third.resolve([exchange({partner_name:'latest'})]);await tick();second.resolve([exchange({partner_name:'stale'})]);await tick();tree=render(Deals,{userId:'a'});assert.ok(text(tree).includes('latest'));assert.ok(!text(tree).includes('stale'));});
  const publicListing=patch=>({id:'public-a',user_id:'other',type:'give',status:'active',category:'box',quantity:8,available_quantity:8,public_lat:42.44,public_lng:19.26,active_interest_count:5,...patch});
  const startMap=async rows=>{reset();render(Map,{userId:'a'});runTimers();await tick();for(const request of api.loads){request.resolve(request.kind==='map'?rows:request.kind==='feed'?{}:[]);}await tick();render(Map,{userId:'a'});};
  const details=()=>{jsx.elements.find(node=>node.type==='button'&&node.props['data-map-listing-id']).props.onClick();render(Map,{userId:'a'});};
  for(const [type,key] of [['give','contactGive'],['take','contactTake'],['lend','connect']])await check(`${type} CTA stays enabled while other participants are interested`,async()=>{await startMap([publicListing({type})]);details();const cta=button(`simpleExchange.${key}`);assert.ok(cta);assert.equal(cta.disabled,false);assert.ok(text(render(Map,{userId:'a'})).includes('simpleExchange.interestStatus'));});
  await check('single/group amber markers retain original glyph and group count',async()=>{for(const type of ['give','take','lend']){assert.ok(markers.mapMarkerIcons[`${type}Interest`].html.includes(`vratime-marker-${type}`));assert.ok(markers.mapMarkerIcons[`${type}Interest`].html.includes('is-interested'));assert.ok(markers.mapMarkerIcons[`${type}Interest`].html.includes('<svg'));}const group=markers.groupedMapMarkerIcon(4,true,'take');assert.ok(group.html.includes('is-interested'));assert.ok(group.html.includes('>4<'));assert.ok(group.html.includes('<svg'));await startMap([publicListing({active_interest_count:0}),publicListing({id:'public-b'})]);const marker=jsx.elements.find(node=>typeof node.type==='function'&&node.type.name==='Marker');assert.ok(marker.props.icon.html.includes('is-interested'));});
  await check('confirmed contact shows 24h message and safely reloads public interest count',async()=>{await startMap([publicListing({active_interest_count:0})]);details();button('simpleExchange.contactGive').onClick();render(Map,{userId:'a'});const pending=button('simpleExchange.shareContacts').onClick();await tick();api.mutations[0].resolve(exchange({listing_id:'public-a'}));await tick();assert.ok(api.loads.filter(x=>x.kind==='map').length>=2);for(const load of api.loads.slice(3))load.resolve(load.kind==='map'?[publicListing()]:load.kind==='contacts'?[exchange({listing_id:'public-a'})]:{});await pending;const tree=render(Map,{userId:'a'});assert.ok(text(tree).includes('simpleExchange.contactWithin24'));assert.ok(text(tree).includes('simpleExchange.interestStatus'));});
  await check('return to retained map during old submit unlocks new contact without stale completion unlocking it',async()=>{
    const rows=[publicListing({id:'first'}),publicListing({id:'second'})];await startMap(rows);details();button('simpleExchange.contactGive').onClick();render(Map,{userId:'a'});
    const oldPending=button('simpleExchange.shareContacts').onClick();await tick();assert.equal(api.mutations.length,1);
    render(Map,{userId:'a',active:false});runTimers();await tick();render(Map,{userId:'a'});runTimers();await tick();
    for(const request of api.loads)request.resolve(request.kind==='map'?rows:request.kind==='feed'?{}:[]);await tick();render(Map,{userId:'a'});
    jsx.elements.find(node=>node.type==='button'&&node.props['data-map-listing-id']==='second').props.onClick();render(Map,{userId:'a'});button('simpleExchange.contactGive').onClick();render(Map,{userId:'a'});
    const next=button('simpleExchange.shareContacts');assert.equal(next.disabled,false);const newPending=next.onClick();await tick();assert.equal(api.mutations.length,2);
    api.mutations[0].resolve(exchange({listing_id:'first'}));await oldPending;render(Map,{userId:'a'});assert.equal(button('simpleExchange.connecting').disabled,true);
    await next.onClick();assert.equal(api.mutations.length,2,'old completion cannot remove current submit lock');
    api.mutations[1].reject(Error('offline'));await newPending;render(Map,{userId:'a'});assert.equal(button('simpleExchange.shareContacts').disabled,false);
  });
  await check('own profile interest counts come from dedicated aggregate not limited contacts',async()=>{reset();db.rows.push(publicListing({id:'own',user_id:'a'}));api.setCounts([{listing_id:'own',active_interest_count:347}]);render(Profile,{userId:'a'});runTimers();await tick();render(Profile,{userId:'a'});assert.ok(api.interestReads.length>=1);const badge=jsx.elements.find(node=>node.props['data-interest-count']===347);assert.ok(badge);assert.ok(text(badge).includes('simpleExchange.interestStatus'));api.setCounts([{listing_id:'own',active_interest_count:348}]);emit('focus');await tick();render(Profile,{userId:'a'});assert.ok(jsx.elements.some(node=>node.props['data-interest-count']===348),'Retained owner card must refresh its authoritative count');});
  await check('private inbox notices render valid partner links and navigate to Deals',async()=>{reset();let opened=0;const p={userId:'a',onOpenDeals:()=>{opened++;}};render(Inbox,p);runTimers();await tick();api.loads.find(x=>x.kind==='feed').resolve({inbox:[{id:'contact',payload:{kind:'listing_contact',partner_contacts:[{messenger_type:'tg',contact_value:'@partner'},{messenger_type:'wa'}]}},{id:'due',payload:{kind:'listing_contact_outcome_due'}}]});await tick();const tree=render(Inbox,p);assert.ok(text(tree).includes('simpleExchange.contactWithin24'));assert.ok(text(tree).includes('simpleExchange.outcomeDueTitle'));assert.ok(!text(tree).includes('undefined'));assert.ok(jsx.elements.some(node=>node.type==='a'&&node.props.href==='https://t.me/partner'));button('simpleExchange.openContacts').onClick();assert.equal(opened,1);});
  reset();assert.deepEqual(failures,[],'Contact outcome UI regressions');console.log('Contact outcome UI checks passed: real JSX/handlers with controlled hooks/network; no browser claim.');
}finally{hook.deregister();Object.assign(globalThis,{window:originals.window,document:originals.document,fetch:originals.fetch});Date.now=originals.now;}
