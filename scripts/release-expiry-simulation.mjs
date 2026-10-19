import { ensure } from './release-ten-users-support.mjs';

// The injected boundary performs actual REST/RPC calls in the release runner.
// Only the deadline of a recorded, participant-owned fixture is shifted. The
// normal refresh RPC is global maintenance, just as it is in the application.
export async function simulateRecordedFixtureExpiry({ ledger, listing, transactionId, accepted, adapter }) {
  const owned = new Set(ledger.users.map((user) => user.id));
  ensure(ledger.records?.transactions?.some((row) => row.id === transactionId), 'expiry_unrecorded_transaction');
  ensure(ledger.records?.listings?.some((row) => row.id === listing.id), 'expiry_unrecorded_listing');
  ensure(owned.has(listing.user_id), 'expiry_foreign_fixture_owner');
  ensure(listing.quantity === 4, 'expiry_fixture_quantity_changed');
  const transaction = await adapter.readTransaction();
  ensure(transaction.id === transactionId && transaction.listing_id === listing.id, 'expiry_fixture_identity_mismatch');
  ensure(transaction.giver_id === listing.user_id && owned.has(transaction.taker_id)
    && transaction.booked_by === transaction.taker_id && transaction.taker_id !== transaction.giver_id, 'expiry_foreign_fixture_participant');
  ensure(!transaction.handed_over_at && !transaction.returned_at && !transaction.completed_at, 'expiry_fixture_lifecycle_changed');
  ensure(Boolean(transaction.accepted_at) === accepted, 'expiry_fixture_acceptance_changed');
  const alreadyExpired = transaction.canceled_reason === 'expired' && Boolean(transaction.canceled_at);
  ensure(!transaction.canceled_at || alreadyExpired, 'expiry_fixture_canceled_otherwise');
  if (!alreadyExpired) {
    const initial = await adapter.readStock();
    const expectedReserved = accepted ? 2 : 0;
    ensure(transaction.reserved_quantity === expectedReserved && initial.quantity === 4
      && initial.available_quantity === 4 - expectedReserved && initial.reserved_quantity === expectedReserved, 'expiry_initial_stock_inexact');
    const serverStart = Date.parse(accepted ? transaction.accepted_at : transaction.created_at);
    ensure(Number.isFinite(serverStart), 'expiry_fixture_timestamp_invalid');
    const expiresAt = new Date(serverStart - 60000).toISOString();
    const filters = { id: transactionId, listing_id: listing.id, giver_id: transaction.giver_id, taker_id: transaction.taker_id, booked_by: transaction.booked_by };
    const updated = await adapter.updateDeadline(filters, expiresAt);
    ensure(updated?.length === 1 && updated[0].id === transactionId, 'expiry_exact_deadline_update_failed');
  }
  await adapter.refresh();
  const deal = await adapter.readDeal();
  ensure(deal?.transaction_id === transactionId && deal.status === 'expired', 'expiry_deal_status_incorrect');
  const expired = await adapter.readTransaction();
  ensure(expired.canceled_at && expired.canceled_reason === 'expired' && expired.reserved_quantity === 0, 'expiry_transaction_not_released');
  const assertRestored = (stock) => ensure(stock.quantity === 4 && stock.available_quantity === 4 && stock.reserved_quantity === 0 && stock.status === 'active', 'expiry_stock_not_exactly_restored');
  assertRestored(await adapter.readStock());
  const accept = await adapter.attemptAccept();
  ensure(accept?.error?.code === 'P0001' && Number(accept.status || accept.error.status) === 400, 'expiry_accept_not_denied');
  await adapter.refresh();
  const stock = await adapter.readStock();
  assertRestored(stock);
  return { simulation: 'owned_fixture_timestamp_shift', kind: accepted ? 'accepted' : 'pending', transactionId, stock };
}
