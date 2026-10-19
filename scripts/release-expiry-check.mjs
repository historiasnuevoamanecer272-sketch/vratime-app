import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const subject = await import('./release-expiry-simulation.mjs').catch(() => ({}));
assert.equal(typeof subject.simulateRecordedFixtureExpiry, 'function', 'Release verification must exercise expired fixtures through the real lifecycle boundary');
const owner = '11111111-1111-4111-8111-111111111111', taker = '22222222-2222-4222-8222-222222222222', listingId = '33333333-3333-4333-8333-333333333333', id = '44444444-4444-4444-8444-444444444444';
const ledger = { users: [{ id: owner }, { id: taker }], records: { listings: [{ id: listingId }], transactions: [{ id }] } };
for (const accepted of [false, true]) {
  let transaction = { id, listing_id: listingId, giver_id: owner, taker_id: taker, booked_by: taker, created_at: '2026-10-19T10:00:00Z', accepted_at: accepted ? '2026-10-19T10:01:00Z' : null, reserved_quantity: accepted ? 2 : 0 }, updates = 0, refreshes = 0;
  let stock = { quantity: 4, available_quantity: accepted ? 2 : 4, reserved_quantity: accepted ? 2 : 0, status: 'active' };
  const listing = { id: listingId, user_id: owner, quantity: 4 };
  const adapter = {
    readTransaction: async () => ({ ...transaction }),
    updateDeadline: async (filters, expiresAt) => { updates += 1; assert.deepEqual(filters, { id, listing_id: listingId, giver_id: owner, taker_id: taker, booked_by: taker }); assert.equal(expiresAt, accepted ? '2026-10-19T10:00:00.000Z' : '2026-10-19T09:59:00.000Z'); transaction.expires_at = expiresAt; return [{ id }]; },
    refresh: async () => { refreshes += 1; if (!transaction.canceled_at) { stock.available_quantity += transaction.reserved_quantity; stock.reserved_quantity -= transaction.reserved_quantity; transaction.reserved_quantity = 0; transaction.canceled_at = '2026-10-19T11:00:00Z'; transaction.canceled_reason = 'expired'; } },
    readDeal: async () => ({ transaction_id: id, status: 'expired' }), readStock: async () => ({ ...stock }),
    attemptAccept: async () => ({ error: { code: 'P0001' }, status: 400 }),
  };
  const evidence = await subject.simulateRecordedFixtureExpiry({ ledger, listing, transactionId: id, accepted, adapter });
  assert.equal(updates, 1); assert.equal(refreshes, 2); assert.equal(evidence.simulation, 'owned_fixture_timestamp_shift'); assert.equal(evidence.stock.available_quantity, 4); assert.equal(evidence.stock.reserved_quantity, 0);
  await subject.simulateRecordedFixtureExpiry({ ledger, listing, transactionId: id, accepted, adapter }); assert.equal(updates, 1, 'Resuming an already expired fixture must not mutate another deadline');
  await assert.rejects(subject.simulateRecordedFixtureExpiry({ ledger, listing, transactionId: 'unrecorded', accepted, adapter }), { code: 'expiry_unrecorded_transaction' });
  await assert.rejects(subject.simulateRecordedFixtureExpiry({ ledger, listing: { ...listing, user_id: 'foreign' }, transactionId: id, accepted, adapter }), { code: 'expiry_foreign_fixture_owner' });
  await assert.rejects(subject.simulateRecordedFixtureExpiry({ ledger, listing, transactionId: id, accepted, adapter: { ...adapter, readTransaction: async () => ({ ...transaction, taker_id: 'foreign' }) } }), { code: 'expiry_foreign_fixture_participant' });
  await assert.rejects(subject.simulateRecordedFixtureExpiry({ ledger: { ...ledger, records: { ...ledger.records, listings: [] } }, listing, transactionId: id, accepted, adapter }), { code: 'expiry_unrecorded_listing' });
  await assert.rejects(subject.simulateRecordedFixtureExpiry({ ledger, listing, transactionId: id, accepted, adapter: { ...adapter, readTransaction: async () => ({ ...transaction, completed_at: '2026-10-19T11:00:00Z' }) } }), { code: 'expiry_fixture_lifecycle_changed' });
  assert.equal(updates, 1, 'Foreign, unrecorded or completed fixtures must never receive a deadline mutation');
  const open = { ...transaction, canceled_at: null, canceled_reason: null, reserved_quantity: accepted ? 2 : 0 };
  await assert.rejects(subject.simulateRecordedFixtureExpiry({ ledger, listing, transactionId: id, accepted, adapter: { ...adapter, readTransaction: async () => open, readStock: async () => ({ quantity: 4, available_quantity: accepted ? 2 : 4, reserved_quantity: accepted ? 2 : 0 }), updateDeadline: async () => [] } }), { code: 'expiry_exact_deadline_update_failed' });
  await assert.rejects(subject.simulateRecordedFixtureExpiry({ ledger, listing, transactionId: id, accepted, adapter: { ...adapter, attemptAccept: async () => ({ data: { accepted: true }, status: 200 }) } }), { code: 'expiry_accept_not_denied' });
  let reads = 0;
  await assert.rejects(subject.simulateRecordedFixtureExpiry({ ledger, listing, transactionId: id, accepted, adapter: { ...adapter, readStock: async () => ({ ...stock, available_quantity: ++reads === 1 ? 4 : 6 }) } }), { code: 'expiry_stock_not_exactly_restored' });
}
const help = execFileSync(process.execPath, [fileURLToPath(new URL('./supabase-e2e-check.mjs', import.meta.url)), '--help'], { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
assert.match(help, /Prepared only; no live verification has been performed/, 'db:e2e wrapper must actually call the guarded runner entrypoint');
console.log('Expiry simulation checks passed: exact recorded ownership, real-boundary orchestration,4/0 restoration, repeat safety and guarded E2E entrypoint.');
