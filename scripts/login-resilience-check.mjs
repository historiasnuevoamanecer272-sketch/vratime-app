import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'rolldown/utils';
import i18n from '../src/i18n/index.js';
const root=new URL('../src/',import.meta.url).href, react=import.meta.resolve('react'),jsx=import.meta.resolve('react/jsx-runtime');
const hooks=registerHooks({
  resolve(s,c,next){
    if(c.parentURL?.endsWith('/pages/Login.jsx')) {
      if(s==='react')return {url:'login-check:state',shortCircuit:true};
      if(s==='react/jsx-runtime')return {url:'login-check:jsx',shortCircuit:true};
      if(s==='react-i18next')return {url:'login-check:i18n',shortCircuit:true};
      if(s==='../i18n')return {url:new URL('../src/i18n/index.js',import.meta.url).href,shortCircuit:true};
      if(s==='../supabaseClient')return {url:'login-check:api',shortCircuit:true};
      if(s==='../lib/toast')return {url:'login-check:toast',shortCircuit:true};
      if(s==='../components/Icon'||s==='../components/LanguageMenu')return {url:'login-check:empty',shortCircuit:true};
    }
    if(c.parentURL?.startsWith(root)&&s.startsWith('.')){const u=new URL(s,c.parentURL);if(!u.pathname.endsWith('.js')&&existsSync(fileURLToPath(u)+'.js'))return {url:u.href+'.js',shortCircuit:true};}
    return next(s,c);
  },
  load(u,c,next){
    const sources={
      'login-check:state':`export const values=[];export const effects=[];let cursor=0;export const begin=()=>{cursor=0;effects.length=0};export const reset=()=>{values.length=0;begin()};export const useState=(v)=>{const i=cursor++;if(!(i in values))values[i]=typeof v==='function'?v():v;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]};export const useRef=(v)=>{const i=cursor++;if(!(i in values))values[i]={current:v};return values[i]};export const useEffect=(fn)=>effects.push(fn);`,
      'login-check:jsx':`import{jsx as real,jsxs as many}from ${JSON.stringify(jsx)};export{Fragment}from ${JSON.stringify(jsx)};export const elements=[];export const jsx=(t,p,k)=>{elements.push({type:t,props:p});return real(t,p,k)};export const jsxs=(t,p,k)=>{elements.push({type:t,props:p});return many(t,p,k)};`,
      'login-check:i18n':`import i18n from ${JSON.stringify(new URL('../src/i18n/index.js',import.meta.url).href)};export const useTranslation=()=>({t:i18n.getFixedT('en')});`,
      'login-check:api':`export const calls=[];let respond;export const configure=fn=>{respond=fn;calls.length=0};export const supabase={auth:{signInWithOAuth:async (...args)=>{calls.push(args);return respond()}}};`,
      'login-check:toast':`export const messages=[];export const showToast=(...args)=>messages.push(args);`,
      'login-check:empty':`export default()=>null;`,
    };
    if(sources[u])return {format:'module',source:sources[u],shortCircuit:true};
    if(u.startsWith(root)&&/\.(png|webp)$/.test(u))return {format:'module',source:'export default "fixture.png"',shortCircuit:true};
    if(u.endsWith('/pages/Login.jsx'))return {format:'module',source:transformSync(fileURLToPath(u),readFileSync(new URL(u),'utf8').replaceAll('import.meta.env.BASE_URL','"/"'),{jsx:{runtime:'automatic'}}).code,shortCircuit:true};
    return next(u,c);
  }
});
const previous=globalThis.window;const listeners=new Map();globalThis.window={location:{origin:'https://app.example'},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
try {
  await i18n.changeLanguage('en');
  const {default:Login}=await import('../src/pages/Login.jsx');
  const state=await import('login-check:state'),capture=await import('login-check:jsx'),api=await import('login-check:api'),toast=await import('login-check:toast');
  const render=()=>{state.begin();capture.elements.length=0;renderToStaticMarkup(createElement(Login));return capture.elements.find(x=>x.type==='button'&&x.props.className==='btn-google w-full').props;};
  const start=()=>{state.reset();toast.messages.length=0;listeners.clear();const button=render();const dispose=state.effects.map(fn=>fn()).filter(Boolean);return {button,dispose};};
  const failed=[];const check=async(name,fn)=>{try{await fn();console.log('PASS '+name)}catch(e){failed.push(name);console.error('FAIL '+name+': '+e.message)}};
  await check('rejected OAuth promise restores the Google button and explains failure',async()=>{api.configure(async()=>{throw Error('Network unavailable')});const {button}=start();await assert.doesNotReject(button.onClick());assert.equal(render().disabled,false);assert.equal(toast.messages.length,1);});
  await check('two immediate Google taps launch only one authorization',async()=>{let done;api.configure(()=>new Promise(resolve=>{done=resolve}));const {button}=start();const first=button.onClick();const second=button.onClick();assert.equal(api.calls.length,1);done({error:{message:'Try again'}});await Promise.all([first,second]);assert.equal(render().disabled,false);});
  await check('returning from browser history restores an actionable sign-in button',async()=>{api.configure(async()=>({error:null}));const {button}=start();await button.onClick();assert.equal(render().disabled,true);assert.ok(listeners.has('pageshow'));listeners.get('pageshow')({persisted:true});assert.equal(render().disabled,false);});
  assert.deepEqual(failed,[]);
}finally{hooks.deregister();globalThis.window=previous;}
