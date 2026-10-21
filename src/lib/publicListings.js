import { validPosition } from './locationValidation.js';

export const publicListingPosition = (listing) => {
  const hasPublicPosition = listing != null && (Object.hasOwn(listing, 'public_lat') || Object.hasOwn(listing, 'public_lng'));
  const position = hasPublicPosition ? [listing.public_lat, listing.public_lng] : [listing?.lat, listing?.lng];
  return validPosition(position) ? position.map(Number) : null;
};

export const normalizePublicListing = (listing) => {
  const position = publicListingPosition(listing);
  return {
    ...listing,
    lat: position?.[0] ?? null,
    lng: position?.[1] ?? null,
    quantity: Number(listing?.available_quantity ?? listing?.quantity ?? 0),
  };
};
