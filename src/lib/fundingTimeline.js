const daysInUtcMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

export function calculateFundingTimeline(date = new Date(), monthlyTargetCents = 5000, collectedCents = 0) {
  const now = new Date(date);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const daysInMonth = daysInUtcMonth(year, month);
  const remainingDays = Math.max(0, daysInMonth - day);
  const fullMonthsRemaining = Math.max(0, 11 - month);
  const remainingBudgetCents = Math.round((monthlyTargetCents * remainingDays) / daysInMonth) + (monthlyTargetCents * fullMonthsRemaining);
  const startOfYear = Date.UTC(year, 0, 1);
  const startOfToday = Date.UTC(year, month, day);
  const startOfNextYear = Date.UTC(year + 1, 0, 1);
  const elapsedPercent = Math.min(100, Math.max(0, Math.floor(((startOfToday - startOfYear) / (startOfNextYear - startOfYear)) * 100)));
  const safeCollected = Math.max(0, Number(collectedCents) || 0);

  return {
    year,
    remainingBudgetCents,
    elapsedPercent,
    collectedCents: safeCollected,
    remainingAfterCollectedCents: Math.max(0, remainingBudgetCents - safeCollected),
  };
}
