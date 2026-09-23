export const loanPhase = (deal, now = new Date()) => {
  if (deal?.listing_type !== 'lend') return null;
  if (deal.canceled_at) return 'canceled';
  if (deal.returned_at) return 'returned';
  if (deal.handed_over_at) {
    return deal.return_due_at && new Date(deal.return_due_at) <= new Date(now) ? 'return_due' : 'handed_over';
  }
  if (deal.accepted_at) return 'accepted';
  return 'requested';
};

export const impactTotals = (events = []) => events.reduce((totals, event) => {
  const itemCount = Math.max(0, Number(event?.item_count) || 0);
  const weight = Math.max(0, Number(event?.weight_kg) || 0);
  const category = String(event?.category_snapshot || '').trim();
  totals.events += 1;
  totals.items += itemCount;
  totals.declaredWeightKg += weight;
  if (category) totals.categories[category] = (totals.categories[category] || 0) + itemCount;
  return totals;
}, { events: 0, items: 0, declaredWeightKg: 0, categories: {} });
