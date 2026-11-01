import { publicListingPosition } from './publicListings';

// Group only by the public marker position; never use an owner's private pin.
export function groupPublicMapListings(listings) {
  const groups = new Map();
  for (const listing of listings) {
    const position = publicListingPosition(listing);
    if (!position) continue;
    const key = JSON.stringify(position);
    if (!groups.has(key)) groups.set(key, { key, position, listings: [] });
    groups.get(key).listings.push(listing);
  }
  return [...groups.values()];
}
