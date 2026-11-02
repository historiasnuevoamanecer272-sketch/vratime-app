export const nextContactFollowup = (exchanges, listingId) => (Array.isArray(exchanges) ? exchanges : [])
  .filter(exchange => exchange.listing_id === listingId && !exchange.my_outcome && Number.isFinite(Date.parse(exchange.feedback_due_at)))
  .sort((a, b) => Number(b.feedback_available === true) - Number(a.feedback_available === true) || Date.parse(a.feedback_due_at) - Date.parse(b.feedback_due_at))[0] || null;

export const formatContactCountdown = (due, now) => {
  if (!Number.isFinite(due) || !Number.isFinite(now)) return null;
  const seconds = Math.max(0, Math.ceil((due - now) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
};
