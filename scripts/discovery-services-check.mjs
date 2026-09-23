import assert from 'node:assert/strict';
import { remainingQuantity } from '../src/lib/quantity.js';
import { coarseCoordinates } from '../src/lib/locationPrivacy.js';
import { pointStatus } from '../src/lib/collectionPoints.js';
import { isDigestDue } from '../src/lib/digest.js';
import { collectionPointTypeKeys, collectionPointTypeLabel } from '../src/lib/collectionPointTypes.js';
import { impactTotals, loanPhase } from '../src/lib/lending.js';

const firstPrivatePoint = coarseCoordinates(42.44123, 19.26387, 300);
const secondPrivatePoint = coarseCoordinates(42.44111, 19.26372, 300);
assert.deepEqual(firstPrivatePoint, secondPrivatePoint, 'nearby homes should share the same coarse public point');
assert.notDeepEqual(firstPrivatePoint, [42.44123, 19.26387], 'coarse point must not reveal the exact coordinates');

assert.equal(remainingQuantity({ quantity: 20, available_quantity: 14 }), 14);
assert.equal(remainingQuantity({ quantity: 20 }), 20);
assert.equal(remainingQuantity({ quantity: 20, available_quantity: -2 }), 0);

const now = new Date('2026-09-23T12:00:00Z');
assert.equal(pointStatus([
  { value: 'exists', created_at: '2026-09-22T12:00:00Z' },
  { value: 'exists', created_at: '2026-09-21T12:00:00Z' },
  { value: 'exists', created_at: '2026-09-20T12:00:00Z' },
], now), 'verified');
assert.equal(pointStatus([
  { value: 'exists', created_at: '2026-09-22T12:00:00Z' },
  { value: 'exists', created_at: '2026-09-21T12:00:00Z' },
  { value: 'exists', created_at: '2026-01-01T12:00:00Z' },
], now), 'unverified', 'votes older than 180 days must expire');
assert.equal(pointStatus([
  { value: 'exists', created_at: '2026-09-22T12:00:00Z' },
  { value: 'exists', created_at: '2026-09-21T12:00:00Z' },
  { value: 'exists', created_at: '2026-09-20T12:00:00Z' },
  { value: 'missing', created_at: '2026-09-23T10:00:00Z' },
  { value: 'missing', created_at: '2026-09-23T11:00:00Z' },
], now), 'unverified', 'two current missing votes must override positive confirmation');

assert.equal(isDigestDue({ last_digest_at: null }, '2026-09-23T10:00:00Z'), true);
assert.equal(isDigestDue({ last_digest_at: '2026-09-22T23:59:00Z' }, '2026-09-23T00:01:00Z'), true);
assert.equal(isDigestDue({ last_digest_at: '2026-09-23T00:01:00Z' }, '2026-09-23T23:59:00Z'), false);

assert.deepEqual(collectionPointTypeKeys, ['glass', 'paper', 'textile', 'packaging', 'plastic', 'metal', 'electronics', 'batteries', 'mixed']);
assert.equal(collectionPointTypeLabel('glass', 'en'), 'Glass');
assert.equal(collectionPointTypeLabel('unknown', 'ru'), 'unknown');

assert.equal(loanPhase({ listing_type: 'lend', accepted_at: '2026-09-23T10:00:00Z' }), 'accepted');
assert.equal(loanPhase({ listing_type: 'lend', handed_over_at: '2026-09-23T12:00:00Z', return_due_at: '2026-09-30T12:00:00Z' }), 'handed_over');
assert.equal(loanPhase({ listing_type: 'lend', handed_over_at: '2026-09-23T12:00:00Z', return_due_at: '2026-09-22T12:00:00Z' }, now), 'return_due');
assert.equal(loanPhase({ listing_type: 'lend', returned_at: '2026-09-24T12:00:00Z' }), 'returned');
assert.deepEqual(impactTotals([
  { event_kind: 'give_completed', item_count: 2, weight_kg: 1.5, category_snapshot: 'glass' },
  { event_kind: 'loan_returned', item_count: 1, weight_kg: null, category_snapshot: 'tools' },
]), { events: 2, items: 3, declaredWeightKg: 1.5, categories: { glass: 2, tools: 1 } });

process.stdout.write('Discovery-service contracts passed: privacy, quantities, point votes, daily digest, lending and impact.\n');
