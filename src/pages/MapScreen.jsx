import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { supabase } from '../supabaseClient';
import { bookListing, getMyDeals, getPublicMapListings, refreshExpiredDeals } from '../lib/api';
import { categoryLabel, categorySearchText, listingCategoryLabel, normalizeSearch, rootPath } from '../lib/categories';
import { getAppLanguage } from '../i18n';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';
import CategoryIcon from '../components/CategoryIcon';
import emptyListings from '../assets/visuals/v1/empty-listings-v1.webp';
import { mapMarkerIcons } from '../lib/mapMarkers';
import { baseMap } from '../lib/basemap';
import { matchesDiscoveryType } from '../lib/listingFilters';
import ReportDialog from '../components/ReportDialog';
import { normalizePublicListing, publicListingPosition } from '../lib/publicListings';
const distances = ['all', '1', '5', '10'];
const listingImages = (listing) => [...new Set([
  ...(Array.isArray(listing.image_urls) ? listing.image_urls : []),
  listing.image_url,
].filter(Boolean))];

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
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [bookingId, setBookingId] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [type, setType] = useState('all');
  const [distance, setDistance] = useState('all');
  const [location, setLocation] = useState(null);
  const [locationMessage, setLocationMessage] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedListing, setSelectedListing] = useState(null);
  const [bookingListing, setBookingListing] = useState(null);
  const [reportListing, setReportListing] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setLoadError('');
    await refreshExpiredDeals().catch(() => null);
    const [listingsResult, categoriesResult, dealsResult] = await Promise.all([
      getPublicMapListings().then((data) => ({ data })).catch((error) => ({ error })),
      supabase.from('categories').select('*').order('id'),
      getMyDeals().then((data) => ({ data })).catch((error) => ({ error })),
    ]);
    if (listingsResult.error || categoriesResult.error) setLoadError(listingsResult.error?.message || categoriesResult.error?.message || t('errors.load'));
    setListings((listingsResult.data || []).map(normalizePublicListing));
    setCategories(categoriesResult.data || []);
    if (dealsResult.error) console.error('Could not load the current user listing requests:', dealsResult.error);
    else setDeals(dealsResult.data || []);
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
  const requestedListingIds = useMemo(() => new Set(deals
    .filter((deal) => !deal.is_listing_owner && !deal.completed_at && !deal.canceled_at)
    .map((deal) => deal.listing_id)), [deals]);
  const filtered = useMemo(() => listings.filter((item) => {
    if (item.user_id === userId) return false;
    if (category !== 'all' && rootPath(item) !== category) return false;
    if (!matchesDiscoveryType(item, { query, type })) return false;
    if (query.trim() && !categorySearchText(item, categories).includes(normalizeSearch(query))) return false;
    if (distance !== 'all' && location) {
      const itemDistance = kmBetween(location, publicListingPosition(item));
      if (itemDistance === null || itemDistance > Number(distance)) return false;
    }
    return Boolean(publicListingPosition(item));
  }), [categories, category, distance, listings, location, query, type, userId]);

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
    setBookingId(item.id);
    try {
      await bookListing(item.id);
      showToast(t(item.type === 'take' ? 'map.bookedTake' : 'map.bookedGive'), 'success', { prominent: true });
      setBookingListing(null);
      setSelectedListing(null);
      await fetchData();
      window.dispatchEvent(new Event('deals-updated'));
    } catch (error) {
      showToast(error.message || t('errors.save'), 'error');
    } finally {
      setBookingId(null);
    }
  };

  const distanceLabel = { all: t('map.anyDistance'), 1: t('map.km1'), 5: t('map.km5'), 10: t('map.km10') };
  const distanceText = (item) => {
    if (!location) return t('map.distanceUnknown');
    const value = kmBetween(location, publicListingPosition(item));
    return value === null ? t('map.distanceUnknown') : t('map.distance', { value: value.toFixed(1) });
  };
  const listingCard = (item, compact = false) => (
    <article key={`${compact ? 'sheet' : 'popup'}-${item.id}`} className={`listing-card ${compact ? 'listing-card-row' : ''} ${requestedListingIds.has(item.id) ? 'is-requested' : ''}`}>
      {listingImages(item)[0] ? <img src={listingImages(item)[0]} alt="" className="listing-image" /> : <span className="listing-placeholder"><CategoryIcon category={item} size={32} /></span>}
      <div className="min-w-0 flex-1">
        <div className={`listing-kind ${item.type === 'take' ? 'take' : ''}`}><Icon name={item.type === 'give' ? 'gift' : 'search'} size={13} />{t(item.type === 'give' ? 'map.give' : 'map.take')}</div>
        {requestedListingIds.has(item.id) ? <div className="listing-requested"><Icon name="check" size={13} />{t('map.requested')}</div> : null}
        <h3 className="mt-2 truncate font-extrabold text-forest">{listingCategoryLabel(item, language)}</h3>
        <p className="mt-1 text-xs font-semibold text-muted">{t('common.pieces', { count: item.quantity })} · {distanceText(item)}</p>
        {item.description ? <p className="listing-description">{item.description}</p> : null}
        <button type="button" className="btn-primary mt-3 w-full min-h-10 text-sm" onClick={() => setSelectedListing(item)}>{t('map.details')}</button>
      </div>
    </article>
  );

  const listingPreview = (item) => (
    <div className={`listing-preview ${requestedListingIds.has(item.id) ? 'is-requested' : ''}`}>
      {listingImages(item)[0] ? <img src={listingImages(item)[0]} alt="" /> : <span><CategoryIcon category={item} size={26} /></span>}
      <div className="min-w-0"><p className={`listing-kind ${item.type === 'take' ? 'take' : ''}`}><Icon name={item.type === 'give' ? 'gift' : 'search'} size={12} />{t(item.type === 'give' ? 'map.give' : 'map.take')}</p><strong>{listingCategoryLabel(item, language)}</strong><small>{requestedListingIds.has(item.id) ? t('map.requested') : item.description || `${t('common.pieces', { count: item.quantity })} · ${t('map.hoverHint')}`}</small></div>
    </div>
  );

  return (
    <div className="map-page relative h-[100svh] overflow-hidden">
      <MapContainer center={[42.441, 19.263]} zoom={12} zoomControl={false} className="h-full w-full" preferCanvas>
        <TileLayer attribution={baseMap.attribution} url={baseMap.url} maxZoom={baseMap.maxZoom} />
        <FlyToLocation location={location} />
        {filtered.map((item) => <Marker key={item.id} position={publicListingPosition(item)} icon={mapMarkerIcons[item.type === 'give' ? 'give' : 'take']} opacity={requestedListingIds.has(item.id) ? 0.45 : 1} title={listingCategoryLabel(item, language)} alt={listingCategoryLabel(item, language)}><Tooltip className="listing-tooltip" direction="top" offset={[0, -35]} opacity={1}>{listingPreview(item)}</Tooltip><Popup>{listingCard(item)}</Popup></Marker>)}
      </MapContainer>

      <header className={`map-toolbar glass-panel ${filtersOpen ? '' : 'is-collapsed'}`}>
        {filtersOpen ? <>
          <div className="flex items-center justify-between gap-3">
            <div><p className="eyebrow text-sea"><Icon name="waves" size={14} />{t('map.eyebrow')}</p><h1 className="font-display mt-1 text-2xl text-forest">{t('map.title')}</h1></div>
            <div className="flex items-center gap-2"><button type="button" className="count-badge" onClick={() => setSheetOpen(true)}><strong>{filtered.length}</strong><span>{t('map.offers', { count: filtered.length }).replace(String(filtered.length), '').trim()}</span></button><button type="button" className="map-toolbar-toggle" onClick={() => setFiltersOpen(false)} aria-label={t('map.filters')}><Icon name="chevronUp" size={19} /></button></div>
          </div>
          <div className="search-box mt-3"><Icon name="search" size={19} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('map.search')} aria-label={t('map.search')} />{query ? <button type="button" className="icon-button compact" onClick={() => setQuery('')} aria-label={t('map.resetFilters')}><Icon name="close" size={16} /></button> : null}<button type="button" className="icon-button compact" onClick={fetchData} aria-label={t('map.refresh')}><Icon name="refresh" size={17} /></button></div>
          {query.trim() ? <p className="search-scope-note"><Icon name="gift" size={14} />{t('map.searchGiveHint')}</p> : null}
          <div className="scroll-row mt-3 flex gap-2 overflow-x-auto pb-1">
            <button type="button" className={`chip ${category === 'all' ? 'chip-active' : ''}`} onClick={() => setCategory('all')}>{t('map.all')}</button>
            {roots.map((item) => <button key={item.id} type="button" className={`chip ${category === rootPath(item) ? 'chip-active' : ''}`} onClick={() => setCategory(rootPath(item))}><CategoryIcon category={item} size={17} />{categoryLabel(item, language)}</button>)}
          </div>
          <div className="scroll-row mt-2 flex gap-2 overflow-x-auto pb-1">
            {['all', 'give', 'take'].map((value) => <button key={value} type="button" disabled={Boolean(query.trim())} className={`chip chip-small ${(query.trim() ? value === 'give' : type === value) ? 'chip-active' : ''}`} onClick={() => setType(value)}>{value === 'all' ? null : <Icon name={value === 'give' ? 'gift' : 'search'} size={13} />}{value === 'all' ? t('map.all') : t(value === 'give' ? 'map.give' : 'map.take')}</button>)}
            {distances.map((value) => <button key={value} type="button" className={`chip chip-small ${distance === value ? 'chip-active' : ''}`} onClick={() => { setDistance(value); if (value !== 'all' && !location) locate(); }}>{distanceLabel[value]}</button>)}
            <button type="button" className="chip chip-small" onClick={locate}><Icon name="location" size={14} />{t('map.nearby')}</button>
          </div>
          {locationMessage ? <p className="mt-2 text-xs font-semibold text-muted">{locationMessage}</p> : null}
        </> : <button type="button" className="map-toolbar-restore" onClick={() => setFiltersOpen(true)} aria-expanded="false"><Icon name="sliders" size={18} /><span>{t('map.filters')}</span><strong>{filtered.length}</strong><Icon name="chevronDown" size={17} /></button>}
      </header>

      {loadError ? <div className="map-state card"><Icon name="close" size={24} /><p>{t('errors.load')}</p><button type="button" className="btn-secondary" onClick={fetchData}>{t('common.retry')}</button></div> : null}
      {!loading && !loadError && filtered.length === 0 ? <div className="map-state map-state-empty card"><img className="state-illustration" src={emptyListings} alt="" /><strong>{t('map.emptyTitle')}</strong><p>{t('map.emptyText')}</p><button type="button" className="btn-primary" onClick={hasFilters ? resetFilters : onCreate}>{t(hasFilters ? 'map.resetFilters' : 'nav.create')}</button></div> : null}

      <button type="button" className="list-sheet-peek" onClick={() => setSheetOpen((value) => !value)} aria-expanded={sheetOpen}><span className="sheet-handle" /><span><strong>{t('map.listTitle')}</strong><small>{t('map.offers', { count: filtered.length })}</small></span><Icon name={sheetOpen ? 'chevronDown' : 'chevronUp'} size={20} /></button>
      {sheetOpen ? <section className="listing-sheet open">
        <div className="listing-sheet-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('map.listTitle')}</h2></div><button type="button" className="icon-button" onClick={() => setSheetOpen(false)} aria-label={t('common.close')}><Icon name="close" size={18} /></button></div>
        <div className="listing-sheet-list space-y-3 px-4 pb-28">{filtered.map((item) => listingCard(item, true))}</div>
      </section> : null}

      {selectedListing ? <div className="listing-dialog-backdrop" role="presentation" onMouseDown={() => setSelectedListing(null)}>
        <section className="listing-dialog card" role="dialog" aria-modal="true" aria-label={t('map.details')} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="icon-button listing-dialog-close" onClick={() => setSelectedListing(null)} aria-label={t('common.close')}><Icon name="close" size={18} /></button>
          {listingImages(selectedListing).length ? <div className="listing-dialog-gallery">{listingImages(selectedListing).map((imageUrl) => <img key={imageUrl} src={imageUrl} alt="" className="listing-dialog-image" />)}</div> : <span className="listing-dialog-placeholder"><CategoryIcon category={selectedListing} size={42} /></span>}
          <div className={`listing-kind mt-4 ${selectedListing.type === 'take' ? 'take' : ''}`}><Icon name={selectedListing.type === 'give' ? 'gift' : 'search'} size={14} />{t(selectedListing.type === 'give' ? 'map.give' : 'map.take')}</div>
          <h2 className="font-display mt-3 text-3xl text-forest">{listingCategoryLabel(selectedListing, language)}</h2>
          <div className="listing-dialog-meta"><span><Icon name="box" size={13} />{t('common.pieces', { count: selectedListing.quantity })}</span><span><Icon name="location" size={13} />{distanceText(selectedListing)}</span><span><Icon name="calendar" size={13} />{new Intl.DateTimeFormat(language === 'me' ? 'sr-Latn-ME' : language, { day: 'numeric', month: 'short' }).format(new Date(selectedListing.created_at))}</span></div>
          <p className="listing-dialog-description">{selectedListing.description || t('map.noDescription')}</p>
          <p className="listing-dialog-note"><Icon name="message" size={16} />{requestedListingIds.has(selectedListing.id) ? t('map.requestedHint') : t('map.contactNote')}</p>
          <button type="button" className={requestedListingIds.has(selectedListing.id) ? 'btn-secondary mt-5 w-full' : 'btn-primary mt-5 w-full'} disabled={bookingId === selectedListing.id || requestedListingIds.has(selectedListing.id)} onClick={() => setBookingListing(selectedListing)}><Icon name={requestedListingIds.has(selectedListing.id) ? 'check' : selectedListing.type === 'take' ? 'handover' : 'gift'} size={18} />{requestedListingIds.has(selectedListing.id) ? t('map.requested') : bookingId === selectedListing.id ? t('map.booking') : t(selectedListing.type === 'take' ? 'map.bookTake' : 'map.bookGive')}</button>
          <button type="button" className="btn-link mt-4 text-xs" onClick={() => setReportListing(selectedListing)}><Icon name="flag" size={15} />{t('workflow.reportListing')}</button>
        </section>
      </div> : null}

      {bookingListing ? <div className="listing-dialog-backdrop" role="presentation" onMouseDown={() => !bookingId && setBookingListing(null)}>
        <section className="booking-confirm card" role="dialog" aria-modal="true" aria-label={t(bookingListing.type === 'take' ? 'map.confirmTakeTitle' : 'map.confirmGiveTitle')} onMouseDown={(event) => event.stopPropagation()}>
          <Icon name={bookingListing.type === 'take' ? 'handover' : 'gift'} size={30} /><h2 className="font-display mt-3 text-3xl text-forest">{t(bookingListing.type === 'take' ? 'map.confirmTakeTitle' : 'map.confirmGiveTitle')}</h2><p>{t(bookingListing.type === 'take' ? 'map.confirmTakeText' : 'map.confirmGiveText')}</p>
          <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" className="btn-secondary" disabled={Boolean(bookingId)} onClick={() => setBookingListing(null)}>{t('common.cancel')}</button><button type="button" className="btn-primary" disabled={Boolean(bookingId)} onClick={() => handleBook(bookingListing)}><Icon name={bookingListing.type === 'take' ? 'handover' : 'gift'} size={17} />{bookingId ? t('map.booking') : t(bookingListing.type === 'take' ? 'map.confirmTakeYes' : 'map.confirmGiveYes')}</button></div>
        </section>
      </div> : null}
      {reportListing ? <ReportDialog targetKind="listing" targetId={reportListing.id} label={listingCategoryLabel(reportListing, language)} onClose={() => setReportListing(null)} /> : null}
    </div>
  );
}
