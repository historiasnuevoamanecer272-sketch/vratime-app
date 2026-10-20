import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const micro = async () => { for (let i=0;i<8;i++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
const waitFor = async predicate => { for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('Expected asynchronous boundary was not reached'); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve=yes; }); return { promise, resolve }; };
let failures=0;
const check=async(name,run)=>{try{await run();console.log(`PASS ${name}`);}catch(error){failures++;console.error(`FAIL ${name}: ${error.message}`);}};
// Exercise the real Profile event handlers with the same hook/JSX interception
// pattern already used by scripts/app-account-scope-check.mjs. Child components
// are never mounted. The API fixture models stable request IDs; no actual RPC.

const requireRoot=createRequire(new URL('package.json',root));
const { transformSync }=requireRoot('rolldown/utils');
const profileUrl=new URL('src/pages/Profile.jsx',root).href;
const srcUrl=new URL('src/',root).href;
const hookSource=`
  let slots=[],cursor=0,pending=[]; export let dirty=false;
  const changed=(a,b)=>!a||!b||a.length!==b.length||b.some((v,i)=>!Object.is(v,a[i]));
  export function reset(){for(const s of slots)s.cleanup?.();slots=[];cursor=0;pending=[];dirty=false;}
  export function begin(){cursor=0;dirty=false;}
  export function flushEffects(){const work=pending;pending=[];for(const {slot,effect} of work){slot.cleanup?.();slot.cleanup=effect();}}
  export function useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};const s=slots[i];return[s.value,next=>{const value=typeof next==='function'?next(s.value):next;if(!Object.is(value,s.value)){s.value=value;dirty=true;}}];}
  export function useRef(initial){const i=cursor++;if(!slots[i])slots[i]={value:{current:initial}};return slots[i].value;}
  export function useMemo(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={value:fn(),deps};return slots[i].value;}
  export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);
  export function useEffect(effect,deps){const i=cursor++,slot=slots[i]||(slots[i]={});if(changed(slot.deps,deps)){slot.deps=deps;pending.push({slot,effect});}}
  export const useLayoutEffect=useEffect;
`;
const moduleValue=source=>({format:'module',source,shortCircuit:true});
const profileHooks=registerHooks({
  resolve(specifier,context,next){
    if(context.parentURL===profileUrl){
      const seams={react:'hooks','react/jsx-runtime':'elements','react-i18next':'translation','../supabaseClient':'supabase','../lib/api':'api','../i18n':'translation','../lib/toast':'toast','../hooks/useAppNavigation':'navigation','../hooks/useDialogFocus':'navigation','../lib/imagePreparation':'media','../lib/mediaUploads':'media'};
      if(seams[specifier])return{url:`state-profile:${seams[specifier]}`,shortCircuit:true};
      if(specifier.startsWith('../components/')||specifier.endsWith('.png'))return{url:'state-profile:child',shortCircuit:true};
    }
    if(context.parentURL?.startsWith(srcUrl)&&specifier.startsWith('.')){for(const extension of ['','.js','.jsx']){const url=new URL(specifier+extension,context.parentURL);if(existsSync(url))return{url:url.href,shortCircuit:true};}}
    return next(specifier,context);
  },
  load(url,context,next){
    if(url==='state-profile:hooks')return moduleValue(hookSource);
    if(url==='state-profile:elements')return moduleValue(`export const elements=[];export const Fragment=Symbol();export const jsx=(type,props,key)=>{const value={type,props:props||{},key};elements.push(value);return value;};export const jsxs=jsx;`);
    if(url==='state-profile:child')return moduleValue('export default function Child(){};export function AvatarCrop(){};');
    if(url==='state-profile:translation')return moduleValue(`export const useTranslation=()=>({t:(key,options)=>options?.returnObjects?['Fixture level']:key});export const getAppLanguage=()=> 'en';export const setAppLanguage=()=>{};`);
    if(url==='state-profile:navigation')return moduleValue('export const useAppOverlay=()=>{};export const useDialogFocus=()=>{};');
    if(url==='state-profile:toast')return moduleValue(`export const showToast=(...args)=>globalThis.__stateProfileFixture.toasts.push(args);`);
    if(url==='state-profile:media')return moduleValue(`export const prepareImage=async file=>file;export const uploadUserMedia=async({operationId})=>({url:'media:'+operationId});export const imageErrorKey=error=>error.code||error.message;`);
    if(url==='state-profile:api')return moduleValue(`
      export const createFeedback=data=>globalThis.__stateProfileFixture.save(data);
      export const requestFeedbackTelegramDelivery=id=>globalThis.__stateProfileFixture.deliver(id);
      export const getMyDeals=async()=>[];export const getEcoLeaderboard=async()=>[];export const getMyReliability=async()=>null;export const getImpactTotals=async()=>null;
      export const deactivateListing=async()=>{};export const saveMyProfile=async()=>{};export const setMyAvatar=async()=>{};export const setRankingParticipation=async()=>{};
    `);
    if(url==='state-profile:supabase')return moduleValue(`
      export const supabase={
        auth:{getUser:async()=>({data:{user:{id:globalThis.__stateProfileFixture.user}}}),onAuthStateChange(fn){const fixture=globalThis.__stateProfileFixture;fixture.authListeners.add(fn);return{data:{subscription:{unsubscribe(){fixture.authListeners.delete(fn);}}}};}},
        from(table){const result={data:table==='profiles'?{id:'account-a',full_name:'Fixture User',language:'en'}:[],error:null};const chain=new Proxy({}, {get(_target,key){if(key==='then')return Promise.resolve(result).then.bind(Promise.resolve(result));return()=>chain;}});return chain;}
      };
    `);
    if(url===profileUrl){const transformed=transformSync(fileURLToPath(url),readFileSync(new URL(url),'utf8'),{jsx:{runtime:'automatic'}});assert.equal(transformed.errors.length,0);return moduleValue(transformed.code);}
    return next(url,context);
  }
});
const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
const profileEvidence=[];
try{
  const timers=new Map(), stored=new Map(); let timer=0; const storage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
  globalThis.window={localStorage:storage,setTimeout(run){timers.set(++timer,run);return timer;},clearTimeout(id){timers.delete(id);},addEventListener(){},removeEventListener(){},confirm(){return true;},dispatchEvent(){}};
  globalThis.fetch=()=>{throw new Error('Network forbidden in fixture');};
  const [{default:Profile},hooks,elements]=await Promise.all([import(profileUrl),import('state-profile:hooks'),import('state-profile:elements')]);
  const render=()=>{hooks.begin();elements.elements.length=0;Profile({userId:'account-a',onEditListing(){}});};
  const settle=async()=>{render();for(let i=0;i<20;i++){hooks.flushEffects();const tasks=[...timers.values()];timers.clear();for(const run of tasks)run();await micro();if(!hooks.dirty&&!timers.size)return;render();}throw new Error('Profile fixture did not settle');};
  const fixture=()=>{stored.clear();return ({user:'account-a',authListeners:new Set(),toasts:[],calls:[],database:new Map(),save:async()=>assert.fail('Unconfigured save'),deliver:async()=>({delivery:'queued'})});};
  const messageInput=()=>elements.elements.find(value=>value.type==='textarea'&&value.props.minLength===5);
  const send=()=>elements.elements.find(value=>value.type==='button'&&['feedbackExperience.send','onboarding.saving'].includes(value.props.children)&&value.props.onClick?.name==='sendFeedback');
  const typeMessage=async(message='Fixture lost acknowledgment report')=>{messageInput().props.onChange({target:{value:message}});await settle();};
  await check('actual Profile synchronous duplicate submit invokes save once',async()=>{
    hooks.reset();timers.clear();const f=globalThis.__stateProfileFixture=fixture(),hold=deferred();f.save=async data=>{f.calls.push(structuredClone(data));await hold.promise;return 'saved-id';};await settle();await typeMessage();const click=send().props.onClick;const a=click(),b=click();await waitFor(()=>f.calls.length===1);assert.equal(f.calls.length,1);hold.resolve();await Promise.all([a,b]);await settle();assert.equal(f.calls.length,1);hooks.reset();assert.equal(f.authListeners.size,0);
  });
  await check('actual Profile same-mount lost-ack retry preserves request UUID',async()=>{
    hooks.reset();timers.clear();const f=globalThis.__stateProfileFixture=fixture();f.save=async data=>{f.calls.push(structuredClone(data));if(!f.database.has(data.requestId)){f.database.set(data.requestId,'saved-id');throw new Error('Lost acknowledgment');}return f.database.get(data.requestId);};await settle();await typeMessage();await send().props.onClick();await settle();await send().props.onClick();await settle();assert.equal(f.database.size,1);assert.equal(f.calls.length,2);assert.equal(f.calls[0].requestId,f.calls[1].requestId);hooks.reset();
  });
  await check('actual Profile account change during save prevents delivery and toast',async()=>{
    hooks.reset();timers.clear();const f=globalThis.__stateProfileFixture=fixture(),hold=deferred();let deliveries=0;f.save=async data=>{f.calls.push(data);return hold.promise;};f.deliver=async()=>{deliveries++;return{delivery:'queued'};};await settle();await typeMessage();const pending=send().props.onClick();await waitFor(()=>f.calls.length===1);f.user='account-b';for(const fn of f.authListeners)fn('SIGNED_IN',{user:{id:'account-b'}});hold.resolve('saved-old-account-id');await pending;await settle();assert.equal(deliveries,0);assert.equal(f.toasts.length,0);hooks.reset();assert.equal(f.authListeners.size,0);
  });
  await check('actual Profile remount after lost acknowledgment preserves one logical submission',async()=>{
    hooks.reset();timers.clear();const f=globalThis.__stateProfileFixture=fixture();let lose=true;f.save=async data=>{f.calls.push(structuredClone(data));if(!f.database.has(data.requestId))f.database.set(data.requestId,`saved-id-${f.database.size+1}`);if(lose){lose=false;throw new Error('Lost acknowledgment');}return f.database.get(data.requestId);};await settle();await typeMessage();await send().props.onClick();await settle();hooks.reset();await settle();await typeMessage();await send().props.onClick();await settle();profileEvidence.push({scenario:'lost-ack-remount',requestIds:f.calls.map(value=>value.requestId),storedRows:f.database.size});assert.equal(f.database.size,1,'The same logical retry after remount must reuse its durable request ID');hooks.reset();
  });
  await check('pending identities contain no report, contact, screenshot bytes or credentials', async()=>{
    hooks.reset();timers.clear();const f=globalThis.__stateProfileFixture=fixture();
    f.save=async data=>{f.calls.push(data);throw new Error('Lost acknowledgment');};
    await settle();await typeMessage('PRIVATE_REPORT_SENTINEL');
    elements.elements.find(value=>value.type==='input'&&value.props.maxLength===140).props.onChange({target:{value:'PRIVATE_CONTACT_SENTINEL'}});
    await settle();await send().props.onClick();await settle();
    assert.ok(stored.size,'Pending identity must survive a remount');
    const contents=JSON.stringify([...stored]);
    assert.ok(!contents.includes('PRIVATE_REPORT_SENTINEL')&&!contents.includes('PRIVATE_CONTACT_SENTINEL'));
    assert.ok(contents.includes(f.calls[0].requestId));hooks.reset();
  });
  await check('confirmed result retires identity so an intentional later report is new', async()=>{
    hooks.reset();timers.clear();const f=globalThis.__stateProfileFixture=fixture();
    f.save=async data=>{f.calls.push(data);return 'saved-id';};
    await settle();await typeMessage();await send().props.onClick();await settle();
    assert.equal(stored.size,0);hooks.reset();await settle();await typeMessage();await send().props.onClick();await settle();
    assert.notEqual(f.calls[0].requestId,f.calls[1].requestId);hooks.reset();
  });
  await check('same screenshot retry after editing text and remount keeps the immutable RPC payload', async()=>{
    hooks.reset();timers.clear();const f=globalThis.__stateProfileFixture=fixture();
    f.save=async data=>{f.calls.push(structuredClone(data));throw new Error('Lost acknowledgment');};
    const attach=async()=>{
      const label=elements.elements.find(value=>value.type==='label'&&value.props.children?.includes?.('workflow.addScreenshot'));
      const input=label.props.children.find(value=>value?.type==='input');
      input.props.onChange({target:{files:[new File(['PRIVATE_SCREENSHOT_BYTES'],'private.png',{type:'image/png'})],value:'private.png'}});await settle();
    };
    await settle();await typeMessage('Original screenshot report');await attach();await send().props.onClick();await settle();
    await typeMessage('Edited screenshot report');await send().props.onClick();await settle();
    hooks.reset();await settle();await typeMessage('Edited screenshot report');await attach();await send().props.onClick();await settle();
    assert.notEqual(f.calls[0].requestId,f.calls[1].requestId);
    assert.deepEqual(f.calls[2],f.calls[1],'Lost-ack retry must retain screenshot URL as well as request ID');
    assert.ok(!JSON.stringify([...stored]).includes('PRIVATE_SCREENSHOT_BYTES'));hooks.reset();
  });
  hooks.reset();
}finally{profileHooks.deregister();globalThis.window=previousWindow;globalThis.fetch=previousFetch;delete globalThis.__stateProfileFixture;}

if(failures) process.exitCode=1;
