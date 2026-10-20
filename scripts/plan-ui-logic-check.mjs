import assert from 'node:assert/strict';
import './address-autocomplete-check.mjs';
import './feedback-contact-check.mjs';
import './popup-viewport-check.mjs';
import './loan-item-check.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { matchesDiscoveryType } from '../src/lib/listingFilters.js';
import { getDeadlineProgress, getDeadlineState } from '../src/lib/deadlines.js';
import { LEVELS, getLevelProgress } from '../src/lib/levels.js';
import { calculateFundingTimeline } from '../src/lib/fundingTimeline.js';
import { hasVerifiedLocation } from '../src/lib/locationValidation.js';
import { remainingQuantity } from '../src/lib/quantity.js';
import { coarseCoordinates } from '../src/lib/locationPrivacy.js';
import { publicListingPosition } from '../src/lib/publicListings.js';

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
assert.equal(getDeadlineProgress('2026-09-22T10:00:00Z', '2026-09-22T12:00:00Z', new Date('2026-09-22T11:00:00Z')), 50);

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

assert.equal(hasVerifiedLocation({ address: 'Igalo, Herceg Novi', verified: true, position: [42.46, 18.51] }), true);
assert.equal(hasVerifiedLocation({ address: 'Igalo', verified: false, position: [42.46, 18.51] }), false);
assert.equal(hasVerifiedLocation({ address: 'Igalo', verified: true, position: [Number.NaN, 18.51] }), false);

assert.equal(remainingQuantity({ quantity: 8, available_quantity: 3 }), 3);
assert.deepEqual(
  coarseCoordinates(42.44123, 19.26387, 300),
  coarseCoordinates(42.44111, 19.26372, 300),
);
assert.deepEqual(publicListingPosition({ lat: 42.44123, lng: 19.26387, public_lat: 42.4401, public_lng: 19.2601 }), [42.4401, 19.2601]);
assert.notDeepEqual(publicListingPosition({ lat: 42.44123, lng: 19.26387, public_lat: 42.4401, public_lng: 19.2601 }), [42.44123, 19.26387]);

await import('./appointment-ui-check.mjs');
for (const script of ['release-location-check.mjs', 'release-listing-date-check.mjs', 'map-refresh-check.mjs', 'profile-feedback-identity-check.mjs', 'feedback-request-identity-check.mjs']) {
  execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], { stdio: 'inherit' });
}

for (const script of ['staff-moderation-ui-check.mjs', 'pwa-update-check.mjs', 'auth-ux-check.mjs', 'app-account-scope-check.mjs', 'navigation-resilience-check.mjs', 'reliability-ux-check.mjs', 'image-preparation-check.mjs', 'draft-check.mjs', 'form-task-check.mjs', 'listing-publication-check.mjs', 'map-ux-check.mjs', 'create-ux-check.mjs', 'feedback-submission-check.mjs', 'feedback-telegram-check.mjs']) {
  execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], { stdio: 'inherit' });
}

process.stdout.write('Plan UI logic passed: discovery, deadlines, five levels, privacy, quantities, daily funding and appointments.\n');
