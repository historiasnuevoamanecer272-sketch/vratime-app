import assert from 'node:assert/strict';
import * as location from '../src/lib/locationValidation.js';
import { searchAddressSuggestions } from '../src/lib/addressAutocomplete.js';

const outcomes = [];
async function check(name, action) { try { await action(); outcomes.push({name,pass:true}); } catch (error) { outcomes.push({name,pass:false,error:error.message}); } }
const verified = (position) => location.hasVerifiedLocation({ address:'Igalo, Herceg Novi', verified:true, position });
for (const position of [[null,null],['',''],[' ',true],[91,19],[42,181],[Infinity,0],undefined]) {
  await check(`reject invalid point ${JSON.stringify(position)}`, () => assert.equal(verified(position), false));
}
await check('valid zero coordinate is preserved', () => assert.equal(verified([0,0]),true));
await check('numeric geocoder strings accepted', () => assert.equal(verified(['42.45','18.52']),true));
await check('invalid manual geocoder siblings are discarded', () => {
  assert.equal(typeof location.validAddressResults,'function');
  const rows = location.validAddressResults([null,{}, {display_name:'Bad',lat:null,lon:null}, {place_id:12,display_name:'Igalo',lat:'42.45',lon:'18.52'}]);
  assert.equal(rows.length,1); assert.equal(rows[0].display_name,'Igalo');
});
await check('map world wrap longitude is normalized without accepting invalid latitude', () => {
  assert.equal(typeof location.normalizeMapPosition,'function');
  assert.deepEqual(location.normalizeMapPosition([42,378]),[42,18]);
  assert.deepEqual(location.normalizeMapPosition([42,-342]),[42,18]);
  assert.equal(location.normalizeMapPosition([95,18]),null);
});
await check('malformed Photon feature preserves valid siblings', async () => {
  const good = {properties:{countrycode:'ME',name:'Igalo',osm_type:'N',osm_id:1},geometry:{coordinates:[18.52,42.45]}};
  const malformed = [null,{geometry:{coordinates:5}},{properties:{countrycode:42},geometry:{coordinates:[18,42]}},{properties:{countrycode:'ME',street:{toString:null}},geometry:{coordinates:[18,42]}}];
  const rows = await searchAddressSuggestions('Igalo',{fetcher:async()=>({ok:true,json:async()=>({features:[...malformed,good]})})});
  assert.equal(rows.length,1); assert.equal(rows[0].display_name,'Igalo');
});
console.log(JSON.stringify(outcomes,null,2));
assert.equal(outcomes.filter((x)=>!x.pass).length,0,'Location regressions must pass');
