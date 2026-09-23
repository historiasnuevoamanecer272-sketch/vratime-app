import assert from 'node:assert/strict';
import { remainingQuantity } from '../src/lib/quantity.js';
import { coarseCoordinates } from '../src/lib/locationPrivacy.js';
import { pointStatus } from '../src/lib/collectionPoints.js';
import { isDigestDue } from '../src/lib/digest.js';
import { collectionPointTypeKeys, collectionPointTypeLabel } from '../src/lib/collectionPointTypes.js';

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

process.stdout.write('Discovery-service contracts passed: privacy, quantities, point votes, daily digest and collection point types.\n');
