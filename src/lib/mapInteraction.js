import { remainingQuantity } from './quantity.js';

export const availableRequestQuantity = (listing) => Math.floor(remainingQuantity(listing));

export const requestQuantity = (value, listing) => {
  const available = availableRequestQuantity(listing);
  if (available < 1) return 0;
  const number = Number(value);
  return Math.min(available, Math.max(1, Number.isFinite(number) ? Math.floor(number) : 1));
};

export const isOwnMapListing = (listing, userId) => Boolean(userId && listing?.user_id === userId);

export const isUpwardToolbarSwipe = (start, end) => Boolean(start && end
  && start.pointerId === end.pointerId
  && start.clientY - end.clientY >= 36
  && start.clientY - end.clientY > Math.abs(end.clientX - start.clientX));
