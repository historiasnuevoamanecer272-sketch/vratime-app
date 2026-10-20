// Photon explicitly supports search-as-you-type. Public Nominatim does not.
export async function searchAddressSuggestions(query, { signal, language = 'en', fetcher = fetch } = {}) {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q',query.trim());
  url.searchParams.set('countrycode','ME');
  url.searchParams.set('limit','5');
  if (['en','de','fr'].includes(language)) url.searchParams.set('lang',language);
  const response = await fetcher(url.href,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
  if (!response.ok) throw new Error('address_search_unavailable');
  const data = await response.json();
  const seen = new Set();
  return (Array.isArray(data?.features) ? data.features : []).flatMap((feature) => {
    const properties = feature?.properties || {};
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2 || typeof properties.countrycode !== 'string') return [];
    const [lon,lat] = coordinates;
    if (properties.countrycode.toUpperCase() !== 'ME' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return [];
    const street = [properties.street,properties.housenumber].filter((value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))).join(' ');
    const display_name = [...new Set([properties.name,street,properties.district,properties.city || properties.town || properties.village,properties.postcode,properties.country].filter((value) => typeof value === 'string' && value.trim()))].join(', ');
    const key = `${display_name}|${lat}|${lon}`;
    if (!display_name || seen.has(key)) return [];
    seen.add(key);
    const osmType = typeof properties.osm_type === 'string' ? properties.osm_type : 'point';
    const osmId = typeof properties.osm_id === 'string' || (typeof properties.osm_id === 'number' && Number.isFinite(properties.osm_id)) ? properties.osm_id : `${lat}-${lon}`;
    return [{place_id:`${osmType}-${osmId}`,display_name,lat,lon}];
  }).slice(0,5);
}

export function createAddressAutocomplete({ search, onResults, onStatus, delay = 450, minimumInterval = 1000, schedule = setTimeout, unschedule = clearTimeout, now = Date.now }) {
  let revision = 0, timer, timeout, request, lastStarted = -Infinity;
  const cache = new Map();
  const cancel = () => {
    revision += 1;
    unschedule(timer); unschedule(timeout);
    request?.abort(); request = null;
  };
  const update = (value) => {
    cancel();
    onResults([]);
    const query = value.trim();
    if (query.length < 3) return onStatus('idle');
    const cached = cache.get(query);
    if (cached && now() - cached.at < 5*60*1000) {
      onResults(cached.results); onStatus(cached.results.length ? 'ready' : 'empty'); return;
    }
    const current = revision;
    onStatus('loading');
    timer = schedule(async () => {
      if (current !== revision) return;
      lastStarted = now();
      const controller = new AbortController(); request = controller;
      timeout = schedule(() => {
        if (current === revision) { controller.abort(); onStatus('error'); }
      },8000);
      try {
        const results = await search(query,{signal:controller.signal});
        if (current !== revision || controller.signal.aborted) return;
        cache.set(query,{results,at:now()});
        if (cache.size > 20) cache.delete(cache.keys().next().value);
        onResults(results); onStatus(results.length ? 'ready' : 'empty');
      } catch {
        if (current === revision) onStatus('error');
      } finally {
        if (current === revision) { unschedule(timeout); request = null; }
      }
    },Math.max(delay,minimumInterval-(now()-lastStarted)));
  };
  return {update,cancel};
}
