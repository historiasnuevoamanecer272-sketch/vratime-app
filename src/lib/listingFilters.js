export function matchesDiscoveryType(listing, { query = '', type = 'all' } = {}) {
  if (query.trim()) return listing.type === (type === 'lend' ? 'lend' : 'give');
  return type === 'all' || listing.type === type;
}
