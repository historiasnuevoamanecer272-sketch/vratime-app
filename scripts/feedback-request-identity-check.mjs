import assert from 'node:assert/strict';
import { createFeedbackRequestStore } from '../src/lib/feedbackRequestIdentity.js';

const values = new Map();
const storage = {
  getItem: key => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};
const payload = { type: 'feature', message: 'Private feedback fixture', screenshot: new Blob(['Private screenshot fixture'], { type: 'image/png' }) };
const first = await createFeedbackRequestStore({ storage }).reserve('account-a', payload);
const restored = await createFeedbackRequestStore({ storage }).reserve('account-a', payload);
assert.deepEqual(restored, first, 'Fresh store must recover the same pending logical request');
const otherAccount = await createFeedbackRequestStore({ storage }).reserve('account-b', payload);
assert.notEqual(otherAccount.requestId, first.requestId, 'Accounts must never share a logical request identity');
for (const change of [
  { type: 'problem' }, { message: 'Different feedback fixture' }, { screenshot: null },
  { screenshot: new Blob(['Different screenshot fixture'], { type: 'image/png' }) },
]) {
  const changed = await createFeedbackRequestStore({ storage }).reserve('account-a', { ...payload, ...change });
  assert.notEqual(changed.requestId, first.requestId, 'Changed payload must get its own identity');
}
const serialized = JSON.stringify([...values]);
assert.ok(!serialized.includes('Private feedback fixture') && !serialized.includes('Private screenshot fixture'));
assert.ok(!serialized.includes('image/png'), 'Persist hashes and UUIDs, not file metadata');
const store = createFeedbackRequestStore({ storage });
store.confirm({ ...first, requestId: otherAccount.requestId });
assert.equal(values.get(first.key), first.requestId, 'Confirmation cannot delete another request');
store.confirm(first);
assert.ok(!values.has(first.key));
assert.equal(values.get(otherAccount.key), otherAccount.requestId, 'Confirmation is account scoped');
assert.notEqual((await createFeedbackRequestStore({ storage }).reserve('account-a', payload)).requestId, first.requestId);
values.set(first.key, 'malformed-persisted-uuid');
const recovered = await createFeedbackRequestStore({ storage }).reserve('account-a', payload);
assert.match(recovered.requestId, /^[0-9a-f-]{36}$/);
assert.notEqual(recovered.requestId, 'malformed-persisted-uuid');
for (const inaccessible of [null, { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } }]) {
  const fallback = createFeedbackRequestStore({ storage: inaccessible });
  const a = await fallback.reserve('account-a', payload);
  assert.deepEqual(await fallback.reserve('account-a', payload), a, 'Same-mounted retry survives inaccessible storage');
  fallback.confirm(a);
  assert.notEqual((await fallback.reserve('account-a', payload)).requestId, a.requestId);
}
await assert.rejects(createFeedbackRequestStore({ storage }).reserve('', payload), /form_auth_changed/);
console.log('Feedback request identity checks passed: remount recovery, account/payload isolation, metadata privacy, confirmed cleanup, malformed and unavailable storage.');
