const fields = ['id', 'user_id', 'type', 'status', 'category_id', 'category', 'category_path', 'description', 'image_url', 'image_urls', 'quantity', 'condition', 'pickup_mode', 'pickup_windows', 'weight_kg', 'loan_duration_days', 'lat', 'lng', 'location_label', 'moderation_status'];
const numeric = new Set(['category_id', 'quantity', 'weight_kg', 'loan_duration_days', 'lat', 'lng']);
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const comparable = (listing) => fields.map((field) => {
  const value = listing[field] ?? null;
  return numeric.has(field) && value !== null ? Number(value) : canonical(value);
});

export function listingPublicationMatches(stored, payload) {
  return Boolean(stored && stored.id === payload.id && stored.user_id === payload.user_id && JSON.stringify(comparable(stored)) === JSON.stringify(comparable(payload)));
}

// A network error may mean INSERT succeeded. Reuse the ID; only a duplicate key
// plus an exact owned publication is success. Never upsert/overwrite a listing.
export async function publishListingOnce(payload, { insert, readOwn, authorize = async () => {}, task }) {
  await authorize(); task?.assertCurrent();
  const result = await insert(payload);
  task?.assertCurrent();
  if (!result?.error) return { alreadyCreated: false };
  if (result.error.code !== '23505') throw result.error;
  await authorize(); task?.assertCurrent();
  const existing = await readOwn(payload.id, payload.user_id);
  task?.assertCurrent();
  if (existing?.error) throw existing.error;
  if (!listingPublicationMatches(existing?.data, payload)) throw Object.assign(new Error('listing_publication_conflict'), { code: 'listing_publication_conflict' });
  return { alreadyCreated: true };
}
