import assert from 'node:assert/strict';
const subject=await import('../src/lib/listingDate.js').catch(()=>({}));
assert.equal(typeof subject.formatListingDate,'function','Card dates need a safe formatter');
for(const language of ['ru','me','en','fr','de']) {
  for(const value of [undefined,null,'','not-a-date','2026-13-01',Infinity]) assert.equal(subject.formatListingDate(value,language),'');
  assert.ok(subject.formatListingDate('2026-10-20T12:00:00Z',language));
}
console.log('Listing dates: 35 valid/invalid locale cases passed.');
