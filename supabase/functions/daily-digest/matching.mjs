const normalize = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function findDigestMatches(searches, candidates) {
  const byId = new Map(searches.map((search) => [search.id, search]));
  const matches = [], seen = new Set();
  for (const listing of candidates) {
    const search = byId.get(listing.saved_search_id);
    if (!search || !normalize(search.query)) continue;
    const type = search.filters?.type || 'give';
    if (type !== 'all' && listing.type !== type) continue;
    if (listing.status && listing.status !== 'active') continue;
    const haystack = normalize([listing.category_text, listing.category, listing.category_path, listing.description].join(' '));
    if (!haystack.includes(normalize(search.query))) continue;
    const key = `${search.id}:${listing.id}`;
    if (!seen.has(key)) { matches.push({ search_id: search.id, listing_id: listing.id }); seen.add(key); }
  }
  return matches;
}
