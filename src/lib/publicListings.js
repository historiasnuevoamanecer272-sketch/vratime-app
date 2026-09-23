export const publicListingPosition = (listing) => {
  const lat = Number(listing?.public_lat ?? listing?.lat);
  const lng = Number(listing?.public_lng ?? listing?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
};

export const normalizePublicListing = (listing) => ({
  ...listing,
  lat: Number(listing.public_lat ?? listing.lat),
  lng: Number(listing.public_lng ?? listing.lng),
  quantity: Number(listing.available_quantity ?? listing.quantity ?? 0),
});
