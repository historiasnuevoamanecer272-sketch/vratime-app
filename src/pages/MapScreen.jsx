import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { supabase } from '../supabaseClient';
import { bookListing } from '../lib/api';
import { categoryLabel, categorySearchText, listingCategoryLabel, normalizeSearch, rootPath } from '../lib/categories';
import { getAppLanguage } from '../i18n';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';
import CategoryIcon from '../components/CategoryIcon';

const pin = (file) => new L.Icon({ iconUrl: new URL(`../assets/pins/${file}`, import.meta.url).href, iconSize: [38, 46], iconAnchor: [19, 46], popupAnchor: [0, -42] });
const giveIcon = pin('pin-give.png');
const takeIcon = pin('pin-take.png');
const distances = ['all', '1', '5', '10'];

const kmBetween = (from, to) => {
  if (!from || !to) return null;
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(to[0] - from[0]);
  const dLng = rad(to[1] - from[1]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from[0])) * Math.cos(rad(to[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

function FlyToLocation({ location }) {
  const map = useMap();
  useEffect(() => { if (location) map.flyTo(location, 14, { duration: 0.8 }); }, [location, map]);
  return null;
}

export default function MapScreen({ userId, onCreate }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const [listings, setListings] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [bookingId, setBookingId] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [type, setType] = useState('all');
  const [distance, setDistance] = useState('all');
  const [location, setLocation] = useState(null);
  const [locationMessage, setLocationMessage] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setLoadError('');
    const [listingsResult, categoriesResult] = await Promise.all([
      supabase.from('listings').select('*').eq('status', 'active').order('created_at', { ascending: false }),
      supabase.from('categories').select('*').order('id'),
    ]);
    if (listingsResult.error || categoriesResult.error) setLoadError(listingsResult.error?.message || categoriesResult.error?.message || t('errors.load'));
    setListings(listingsResult.data || []);
    setCategories(categoriesResult.data || []);
    setLoading(false);
  }, [t]);

  useEffect(() => {
    const initialLoad = window.setTimeout(fetchData, 0);
    const refresh = () => fetchData();
    window.addEventListener('listings-updated', refresh);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener('listings-updated', refresh);
    };
  }, [fetchData]);

  const roots = useMemo(() => categories.filter((item) => item.parent_id === null), [categories]);
  const filtered = useMemo(() => listings.filter((item) => {
    if (category !== 'all' && rootPath(item) !== category) return false;
    if (type !== 'all' && item.type !== type) return false;
    if (query.trim() && !categorySearchText(item, categories).includes(normalizeSearch(query))) return false;
    if (distance !== 'all' && location) {
      const itemDistance = kmBetween(location, [Number(item.lat), Number(item.lng)]);
      if (itemDistance === null || itemDistance > Number(distance)) return false;
    }
    return Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng));
  }), [categories, category, distance, listings, location, query, type]);

  const hasFilters = Boolean(query.trim() || category !== 'all' || type !== 'all' || distance !== 'all');
  const resetFilters = () => {
    setQuery(''); setCategory('all'); setType('all'); setDistance('all');
  };

  const locate = () => {
    if (!navigator.geolocation) return setLocationMessage(t('map.locationMissing'));
    setLocationMessage(t('map.locating'));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setLocation([coords.latitude, coords.longitude]); setLocationMessage(t('map.located')); },
      () => setLocationMessage(t('map.locationDenied')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const handleBook = async (item) => {
    if (item.user_id === userId) return showToast(t('map.own'), 'error');
    setBookingId(item.id);
    try {
      await bookListing(item.id);
      showToast(t('map.booked'), 'success');
      await fetchData();
      window.dispatchEvent(new Event('deals-updated'));
    } catch (error) {
      showToast(error.message || t('errors.save'), 'error');
    } finally {
      setBookingId(null);
    }
  };

  const distanceLabel = { all: t('map.anyDistance'), 1: t('map.km1'), 5: t('map.km5'), 10: t('map.km10') };
  const listingCard = (item, compact = false) => (
    <article key={`${compact ? 'sheet' : 'popup'}-${item.id}`} className={`listing-card ${compact ? 'listing-card-row' : ''}`}>
      {item.image_url ? <img src={item.image_url} alt="" className="listing-image" /> : <span className="listing-placeholder"><CategoryIcon category={item} size={32} /></span>}
      <div className="min-w-0 flex-1">
        <div className={`listing-kind ${item.type === 'take' ? 'take' : ''}`}><Icon name={item.type === 'give' ? 'gift' : 'truck'} size={13} />{t(item.type === 'give' ? 'map.give' : 'map.take')}</div>
        <h3 className="mt-2 truncate font-extrabold text-forest">{listingCategoryLabel(item, language)}</h3>
        <p className="mt-1 text-xs font-semibold text-muted">{t('common.pieces', { count: item.quantity })}{location ? ` · ${kmBetween(location, [Number(item.lat), Number(item.lng)]).toFixed(1)} km` : ''}</p>
        <button type="button" className="btn-primary mt-3 w-full min-h-10 text-sm" disabled={bookingId === item.id || item.user_id === userId} onClick={() => handleBook(item)}>{bookingId === item.id ? t('map.booking') : item.user_id === userId ? t('map.ownLabel') : t('map.book')}</button>
      </div>
    </article>
  );

  return (
    <div className="map-page relative h-[100svh] overflow-hidden">
      <MapContainer center={[42.441, 19.263]} zoom={12} zoomControl={false} className="h-full w-full" preferCanvas>
        <TileLayer attribution="&copy; OpenStreetMap &copy; CARTO" url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
        <FlyToLocation location={location} />
        {filtered.map((item) => <Marker key={item.id} position={[Number(item.lat), Number(item.lng)]} icon={item.type === 'give' ? giveIcon : takeIcon}><Popup>{listingCard(item)}</Popup></Marker>)}
      </MapContainer>

      <header className="map-toolbar glass-panel">
        <div className="flex items-center justify-between gap-3">
          <div><p className="eyebrow text-sea">{t('map.eyebrow')}</p><h1 className="font-display mt-1 text-2xl text-forest">{t('map.title')}</h1></div>
          <button type="button" className="count-badge" onClick={() => setSheetOpen(true)}><strong>{filtered.length}</strong><span>{t('map.offers', { count: filtered.length }).replace(String(filtered.length), '').trim()}</span></button>
        </div>
        <div className="search-box mt-3"><Icon name="search" size={19} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('map.search')} aria-label={t('map.search')} /><button type="button" className="icon-button compact" onClick={fetchData} aria-label={t('map.refresh')}><Icon name="refresh" size={17} /></button></div>
        <div className="scroll-row mt-3 flex gap-2 overflow-x-auto pb-1">
          <button type="button" className={`chip ${category === 'all' ? 'chip-active' : ''}`} onClick={() => setCategory('all')}>{t('map.all')}</button>
          {roots.map((item) => <button key={item.id} type="button" className={`chip ${category === rootPath(item) ? 'chip-active' : ''}`} onClick={() => setCategory(rootPath(item))}><CategoryIcon category={item} size={17} />{categoryLabel(item, language)}</button>)}
        </div>
        <div className="scroll-row mt-2 flex gap-2 overflow-x-auto pb-1">
          {['all', 'give', 'take'].map((value) => <button key={value} type="button" className={`chip chip-small ${type === value ? 'chip-active' : ''}`} onClick={() => setType(value)}>{value === 'all' ? t('map.all') : t(value === 'give' ? 'map.give' : 'map.take')}</button>)}
          {distances.map((value) => <button key={value} type="button" className={`chip chip-small ${distance === value ? 'chip-active' : ''}`} onClick={() => { setDistance(value); if (value !== 'all' && !location) locate(); }}>{distanceLabel[value]}</button>)}
          <button type="button" className="chip chip-small" onClick={locate}><Icon name="location" size={14} />{t('map.nearby')}</button>
        </div>
        {locationMessage ? <p className="mt-2 text-xs font-semibold text-muted">{locationMessage}</p> : null}
      </header>

      {loadError ? <div className="map-state card"><Icon name="close" size={24} /><p>{t('errors.load')}</p><button type="button" className="btn-secondary" onClick={fetchData}>{t('common.retry')}</button></div> : null}
      {!loading && !loadError && filtered.length === 0 ? <div className="map-state card"><Icon name="empty" size={28} /><strong>{t('map.emptyTitle')}</strong><p>{t('map.emptyText')}</p><button type="button" className="btn-primary" onClick={hasFilters ? resetFilters : onCreate}>{t(hasFilters ? 'map.resetFilters' : 'nav.create')}</button></div> : null}

      <button type="button" className="list-sheet-peek" onClick={() => setSheetOpen((value) => !value)} aria-expanded={sheetOpen}><span className="sheet-handle" /><span><strong>{t('map.listTitle')}</strong><small>{t('map.offers', { count: filtered.length })}</small></span><Icon name={sheetOpen ? 'chevronDown' : 'chevronUp'} size={20} /></button>
      {sheetOpen ? <section className="listing-sheet open">
        <div className="listing-sheet-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('map.listTitle')}</h2></div><button type="button" className="icon-button" onClick={() => setSheetOpen(false)} aria-label={t('common.close')}><Icon name="close" size={18} /></button></div>
        <div className="listing-sheet-list space-y-3 px-4 pb-28">{filtered.map((item) => listingCard(item, true))}</div>
      </section> : null}
    </div>
  );
}
