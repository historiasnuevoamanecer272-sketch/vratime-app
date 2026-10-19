import assert from 'node:assert/strict';
import { submitFeedback } from '../src/lib/feedbackSubmission.js';

const payload = { type: 'feature', message: 'A test idea' };
let saved = 0;
const save = async (input) => { assert.deepEqual(input, payload); saved += 1; return 'feedback-id'; };
const result = await submitFeedback(payload, { save, deliver: async (id) => {
  assert.equal(id, 'feedback-id'); throw new Error('Temporary transport failure');
} });
assert.equal(saved, 1);
assert.deepEqual(result, { feedbackId: 'feedback-id', delivery: 'queued' });
for (const delivery of ['delivered', 'queued', 'unconfigured', 'ambiguous']) {
  assert.equal((await submitFeedback(payload, { save, deliver: async () => ({ delivery }) })).delivery, delivery);
}
assert.equal((await submitFeedback(payload, { save, deliver: async () => ({ ok: true }) })).delivery, 'queued');
let deliveryCalls = 0;
await assert.rejects(submitFeedback(payload, { save: async () => { throw new Error('Not saved'); },
  deliver: async () => { deliveryCalls += 1; } }), /Not saved/);
assert.equal(deliveryCalls, 0);
console.log('Feedback submission passed: preserve one saved idea when delivery fails, truthful receipt states, no delivery before save.');
