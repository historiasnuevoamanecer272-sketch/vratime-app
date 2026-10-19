import assert from 'node:assert/strict';
import { createAddressAutocomplete, searchAddressSuggestions } from '../src/lib/addressAutocomplete.js';

let now = 0, serial = 0;
const timers = new Map(), requests = [], results = [], statuses = [];
const schedule = (callback, delay) => { const id = ++serial; timers.set(id,{callback,at:now+delay}); return id; };
const unschedule = id => timers.delete(id);
const advance = async milliseconds => {
  const until = now + milliseconds;
  while (true) {
    const next = [...timers].filter(([,job])=>job.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
    if (!next) break;
    now = next[1].at; timers.delete(next[0]); next[1].callback();
    for(let count=0;count<5;count++) await Promise.resolve();
  }
  now = until;
};
const autocomplete = createAddressAutocomplete({
  schedule,unschedule,now:()=>now,
  search: (query,{signal}) => new Promise((resolve,reject)=>requests.push({query,signal,resolve,reject})),
  onResults:value=>results.push(value),onStatus:value=>statuses.push(value),
});
autocomplete.update('Ig'); await advance(2000); assert.equal(requests.length,0);
autocomplete.update('Iga'); await advance(200); autocomplete.update('Igalo');
await advance(449); assert.equal(requests.length,0);
await advance(1); assert.equal(requests[0].query,'Igalo');
autocomplete.update('Herceg Novi'); assert.equal(requests[0].signal.aborted,true);
requests[0].resolve([{display_name:'Stale Igalo'}]); await advance(450);
assert.ok(!results.flat().some(item=>item.display_name==='Stale Igalo'));
assert.equal(requests.length,1,'Requests must be throttled as well as debounced');
await advance(550); assert.equal(requests[1].query,'Herceg Novi');
requests[1].resolve([{display_name:'Herceg Novi',lat:42.45,lon:18.53}]); await advance(0);
assert.equal(results.at(-1)[0].display_name,'Herceg Novi');
autocomplete.update('Herceg Novi'); await advance(1000);
assert.equal(requests.length,2,'Repeated queries should use the bounded session cache');
autocomplete.update('Podgorica'); autocomplete.cancel(); await advance(2000);
assert.equal(requests.length,2,'Picking a pin or closing must cancel scheduled lookups');
autocomplete.update('Kotor'); await advance(450); requests[2].reject(new Error('offline')); await advance(0);
assert.equal(statuses.at(-1),'error');
autocomplete.update('Budva'); await advance(1000); await advance(8000);
assert.equal(requests[3].signal.aborted,true,'Slow requests must time out');
autocomplete.cancel();

let requested;
const parsed = await searchAddressSuggestions('Igalo',{language:'ru',fetcher:async(url,options)=>{
  requested={url:new URL(url),options};
  return {ok:true,json:async()=>({features:[
    {geometry:{coordinates:[18.52,42.45]},properties:{osm_type:'W',osm_id:1,name:'Topla',street:'Braće Grbića',housenumber:'22',city:'Herceg Novi',countrycode:'ME',country:'Crna Gora'}},
    {geometry:{coordinates:[19,43]},properties:{name:'Outside pilot',countrycode:'RS'}},
    {geometry:{coordinates:[null,42]},properties:{name:'Invalid point',countrycode:'ME'}},
  ]})};
}});
assert.equal(requested.url.hostname,'photon.komoot.io');
assert.equal(requested.url.searchParams.get('countrycode'),'ME');
assert.equal(requested.options.credentials,'omit');
assert.equal(parsed.length,1);
assert.match(parsed[0].display_name,/Braće Grbića 22/);
assert.deepEqual([parsed[0].lat,parsed[0].lon],[42.45,18.52]);
process.stdout.write('Address autocomplete passed: debounce, throttle, cancellation, stale results, cache, errors, timeout, country filter and coordinate parsing.\n');
