import assert from 'node:assert/strict';
import { matchesDiscoveryType } from '../src/lib/listingFilters.js';
import { getDeadlineState } from '../src/lib/deadlines.js';
import { LEVELS, getLevelProgress } from '../src/lib/levels.js';
import { calculateFundingTimeline } from '../src/lib/fundingTimeline.js';

assert.equal(matchesDiscoveryType({ type: 'give' }, { query: 'стекло', type: 'take' }), true);
assert.equal(matchesDiscoveryType({ type: 'take' }, { query: 'стекло', type: 'all' }), false);
assert.equal(matchesDiscoveryType({ type: 'take' }, { query: '', type: 'take' }), true);
assert.equal(matchesDiscoveryType({ type: 'give' }, { query: '', type: 'take' }), false);

const now = new Date('2026-09-22T10:00:00Z');
assert.deepEqual(getDeadlineState('2026-09-22T11:30:00Z', now), {
  expired: false,
  urgent: true,
  totalSeconds: 5400,
  days: 0,
  hours: 1,
  minutes: 30,
});
assert.equal(getDeadlineState('2026-09-22T09:59:59Z', now).expired, true);

assert.equal(LEVELS.length, 5);
assert.deepEqual(LEVELS.map((level) => level.threshold), [0, 50, 225, 500, 950]);
assert.deepEqual(getLevelProgress(200), { currentIndex: 1, nextThreshold: 225, remaining: 25, percent: 86 });
assert.deepEqual(getLevelProgress(1200), { currentIndex: 4, nextThreshold: null, remaining: 0, percent: 100 });

const september = calculateFundingTimeline(new Date('2026-09-22T10:00:00Z'), 5000, 1234);
assert.equal(september.year, 2026);
assert.equal(september.remainingBudgetCents, 16333);
assert.equal(september.elapsedPercent, 72);
assert.equal(september.collectedCents, 1234);
assert.equal(september.remainingAfterCollectedCents, 15099);

process.stdout.write('Plan UI logic passed: discovery, deadlines, five levels and daily funding.\n');
