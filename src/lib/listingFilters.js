export function matchesDiscoveryType(listing, { query = '', type = 'all' } = {}) {
  if (query.trim()) return listing.type === 'give';
  return type === 'all' || listing.type === type;
}
