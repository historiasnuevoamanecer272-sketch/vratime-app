import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { supabase } from '../supabaseClient';
import { bookListing, getCollectionPoints, getMyDeals, getMyDiscoveryFeed, getPublicMapListings, refreshExpiredDeals, saveSearch, toggleListingFavourite, voteCollectionPoint } from '../lib/api';
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
import CollectionPointLayer from '../components/CollectionPointLayer';
import CollectionPointDialog from '../components/CollectionPointDialog';
import { availableRequestQuantity, isOwnMapListing, isUpwardToolbarSwipe, requestQuantity } from '../lib/mapInteraction';
import { friendlyError } from '../lib/userErrors';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { requestBrowserLocation } from '../lib/geolocationRequest';
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

function MapView({ location, recenterRequest, active, resultsViewport }) {
  const map = useMap();
  const appliedResults = useRef(null);
  const latitude = location?.[0];
  const longitude = location?.[1];
  useEffect(() => { map.attributionControl?.setPrefix(false); }, [map]);
  useEffect(() => {
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      map.stop();
      map.setView([latitude, longitude], 14, { animate: false });
    }
  }, [latitude, longitude, map, recenterRequest]);
  useEffect(() => { if (active) map.invalidateSize?.({ pan: false }); }, [active, map]);
  useEffect(() => {
    if (!active || !resultsViewport?.positions.length || appliedResults.current === resultsViewport) return;
    appliedResults.current = resultsViewport;
    map.stop();
    map.closePopup?.();
    map.fitBounds(resultsViewport.positions, { paddingTopLeft: [24, 90], paddingBottomRight: [24, 120], maxZoom: 14, animate: false });
  }, [active, map, resultsViewport]);
  return null;
}

export default function MapScreen({ userId, onCreate, active = true }) {
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
  const [bookingQuantity, setBookingQuantity] = useState(1);
  const [reportListing, setReportListing] = useState(null);
  const [mapLayer, setMapLayer] = useState('listings');
  const [collectionPoints, setCollectionPoints] = useState([]);
  const [pointDialogOpen, setPointDialogOpen] = useState(false);
  const [favouriteIds, setFavouriteIds] = useState(new Set());
  const [recenterRequest, setRecenterRequest] = useState(0);
  const toolbarSwipeStart = useRef(null);
  const bookingInFlight = useRef(false);
  const fetchRequest = useRef(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [pointsError, setPointsError] = useState(false);
  const [locationPending, setLocationPending] = useState(false);
  const [locationIssue, setLocationIssue] = useState(false);
  const [resultsViewport, setResultsViewport] = useState(null);
  const locationInFlight = useRef(false);
  const cancelLocation = useRef(null);
  const detailRef = useRef(null);
  const bookingRef = useRef(null);
  useAppOverlay(active && Boolean(sheetOpen), () => setSheetOpen(false), 'map-list');
  useAppOverlay(active && Boolean(selectedListing), () => setSelectedListing(null), 'listing');
  const closeBooking = () => { if (bookingInFlight.current) return false; setBookingListing(null); return true; };
  useAppOverlay(active && Boolean(bookingListing), closeBooking, 'booking');
  const detailFocus = useDialogFocus({ open: active && Boolean(selectedListing) && !bookingListing && !reportListing, onClose: () => setSelectedListing(null), dialogRef: detailRef });
  const bookingFocus = useDialogFocus({ open: active && Boolean(bookingListing), onClose: closeBooking, dialogRef: bookingRef });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocationPending(false); setLocationIssue(false); setLocationMessage('');
      if (!active) { setSheetOpen(false); setSelectedListing(null); setBookingListing(null); setReportListing(null); setPointDialogOpen(false); }
    }, 0);
    return () => { window.clearTimeout(timer); cancelLocation.current?.(); locationInFlight.current = false; };
  }, [active, userId]);

  const fetchData = useCallback(async () => {
    const request = ++fetchRequest.current;
    setLoading(true); setLoadError('');
    await refreshExpiredDeals().catch(() => null);
    const [listingsResult, categoriesResult, dealsResult, pointsResult, discoveryResult] = await Promise.all([
      getPublicMapListings().then((data) => ({ data })).catch((error) => ({ error })),
      supabase.from('categories').select('*').order('id'),
      getMyDeals().then((data) => ({ data })).catch((error) => ({ error })),
      getCollectionPoints().then((data) => ({ data })).catch((error) => ({ error })),
      getMyDiscoveryFeed().then((data) => ({ data })).catch((error) => ({ error })),
    ]);
    if (request !== fetchRequest.current) return;
    if (listingsResult.error || categoriesResult.error) setLoadError(listingsResult.error?.message || categoriesResult.error?.message || t('errors.load'));
    else {
      setListings((listingsResult.data || []).map(normalizePublicListing));
      setCategories(categoriesResult.data || []);
      setLastUpdated(new Date());
    }
    if (dealsResult.error) console.error('Could not load the current user listing requests:', dealsResult.error);
    else setDeals(dealsResult.data || []);
    setPointsError(Boolean(pointsResult.error));
    if (!pointsResult.error) setCollectionPoints(pointsResult.data || []);
    if (!discoveryResult.error) setFavouriteIds(new Set((discoveryResult.data?.favourites || []).map((item) => item.listing_id)));
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
    if (category !== 'all' && rootPath(item) !== category) return false;
    if (!matchesDiscoveryType(item, { query, type })) return false;
    if (query.trim() && !categorySearchText(item, categories).includes(normalizeSearch(query))) return false;
    if (distance !== 'all' && location) {
      const itemDistance = kmBetween(location, publicListingPosition(item));
      if (itemDistance === null || itemDistance > Number(distance)) return false;
    }
    return Boolean(publicListingPosition(item));
  }), [categories, category, distance, listings, location, query, type]);

  const hasFilters = Boolean(query.trim() || category !== 'all' || type !== 'all' || distance !== 'all');
  const resetFilters = () => {
    setQuery(''); setCategory('all'); setType('all'); setDistance('all');
  };

  const locate = () => {
    if (!active || locationInFlight.current) return;
    locationInFlight.current = true;
    setLocationPending(true); setLocationIssue(false); setLocationMessage(t('map.locating'));
    cancelLocation.current = requestBrowserLocation({
      onSuccess: (coordinates) => {
        locationInFlight.current = false; setLocationPending(false); setLocationIssue(false);
        setLocation(coordinates); setRecenterRequest((request) => request + 1); setLocationMessage(t('map.located'));
      },
      onError: (reason) => {
        locationInFlight.current = false; setLocationPending(false); setLocationIssue(true);
        setLocationMessage(t(`mapExperience.${reason}`));
      },
    });
  };

  const startToolbarSwipe = (event) => {
    if (event.button > 0) return;
    toolbarSwipeStart.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const finishToolbarSwipe = (event) => {
    const start = toolbarSwipeStart.current;
    if (isUpwardToolbarSwipe(start, event)) setFiltersOpen(false);
    toolbarSwipeStart.current = start ? { ...start, moved: Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > 8 } : null;
  };

  const openBooking = (item) => {
    if (isOwnMapListing(item, userId) || requestedListingIds.has(item.id) || availableRequestQuantity(item) < 1) return;
    setBookingQuantity(1);
    setBookingListing(item);
  };

  const handleBook = async (item) => {
    if (bookingInFlight.current || bookingId || isOwnMapListing(item, userId) || requestedListingIds.has(item.id) || availableRequestQuantity(item) < 1) return;
    bookingInFlight.current = true;
    setBookingId(item.id);
    try {
      await bookListing(item.id, requestQuantity(bookingQuantity, item));
      showToast(t(item.type === 'take' ? 'map.bookedTake' : item.type === 'lend' ? 'map.bookedLend' : 'map.bookedGive'), 'success', { prominent: true });
      setBookingListing(null);
      setSelectedListing(null);
      await fetchData();
      window.dispatchEvent(new Event('deals-updated'));
    } catch (error) {
      showToast(friendlyError(error, t), 'error');
    } finally {
      bookingInFlight.current = false;
      setBookingId(null);
    }
  };

  const toggleFavourite = async (item) => {
    if (isOwnMapListing(item, userId)) return;
    try {
      const enabled = await toggleListingFavourite(item.id);
      setFavouriteIds((current) => { const next = new Set(current); if (enabled) next.add(item.id); else next.delete(item.id); return next; });
      showToast(t(enabled ? 'discovery.favouriteAdded' : 'discovery.favouriteRemoved'), 'success');
    } catch (error) { showToast(friendlyError(error, t), 'error'); }
  };

  const saveCurrentSearch = async () => {
    if (!query.trim()) return;
    try {
      await saveSearch(query.trim(), { category, distance, type: 'give', ...(distance !== 'all' && Array.isArray(location) && location.length === 2 && location.every(Number.isFinite) ? { origin: location } : {}) }, true);
      showToast(t('discovery.saved'), 'success', { prominent: true });
    } catch (error) { showToast(friendlyError(error, t), 'error'); }
  };

  const votePoint = async (point, value) => {
    try { await voteCollectionPoint(point.id, value); showToast(t('points.voteSaved'), 'success'); await fetchData(); }
    catch (error) { showToast(friendlyError(error, t), 'error'); }
  };

  const distanceLabel = { all: t('map.anyDistance'), 1: t('map.km1'), 5: t('map.km5'), 10: t('map.km10') };
  const typeIcon = (item) => item.type === 'give' ? 'gift' : item.type === 'take' ? 'search' : 'history';
  const typeLabel = (item) => item.type === 'give' ? 'map.give' : item.type === 'take' ? 'map.take' : 'map.lend';
  const distanceText = (item) => {
    if (!location) return t('map.distanceUnknown');
    const value = kmBetween(location, publicListingPosition(item));
    return value === null ? t('map.distanceUnknown') : t('map.distance', { value: value.toFixed(1) });
  };
  const listingCard = (item, compact = false) => (
    <article key={`${compact ? 'sheet' : 'popup'}-${item.id}`} className={`listing-card ${compact ? 'listing-card-row' : ''} ${isOwnMapListing(item, userId) ? 'is-owned' : ''} ${requestedListingIds.has(item.id) ? 'is-requested' : ''}`}>
      {listingImages(item)[0] ? <img src={listingImages(item)[0]} alt="" className="listing-image" /> : <span className="listing-placeholder"><CategoryIcon category={item} size={32} /></span>}
      <div className="min-w-0 flex-1">
        <div className={`listing-kind ${item.type}`}><Icon name={typeIcon(item)} size={13} />{t(typeLabel(item))}</div>
        {isOwnMapListing(item, userId) ? <div className="listing-owner">{t('mapExperience.myListing')}</div> : null}
        {requestedListingIds.has(item.id) ? <div className="listing-requested"><Icon name="check" size={13} />{t('map.requested')}</div> : null}
        <h3 className="mt-2 truncate font-extrabold text-forest">{listingCategoryLabel(item, language)}</h3>
        <p className="mt-1 text-xs font-semibold text-muted">{t('common.pieces', { count: item.quantity })} · {distanceText(item)}</p>
        {item.description ? <p className="listing-description">{item.description}</p> : null}
        <button type="button" className="btn-primary mt-3 w-full min-h-10 text-sm" onClick={() => setSelectedListing(item)}>{t('map.details')}</button>
      </div>
    </article>
  );

  const listingPreview = (item) => (
    <div className={`listing-preview ${isOwnMapListing(item, userId) ? 'is-owned' : ''} ${requestedListingIds.has(item.id) ? 'is-requested' : ''}`}>
      {listingImages(item)[0] ? <img src={listingImages(item)[0]} alt="" /> : <span><CategoryIcon category={item} size={26} /></span>}
      <div className="min-w-0"><p className={`listing-kind ${item.type}`}><Icon name={typeIcon(item)} size={12} />{t(typeLabel(item))}</p>{isOwnMapListing(item, userId) ? <span className="listing-owner">{t('mapExperience.myListing')}</span> : null}<strong>{listingCategoryLabel(item, language)}</strong><small>{requestedListingIds.has(item.id) ? t('map.requested') : item.description || `${t('common.pieces', { count: item.quantity })} · ${t('map.hoverHint')}`}</small></div>
    </div>
  );

  return (
    <div className="map-page relative h-[100svh] overflow-hidden">
      <MapContainer center={[42.441, 19.263]} zoom={12} zoomControl={false} className="h-full w-full" preferCanvas>
        <TileLayer attribution={baseMap.attribution} url={baseMap.url} maxZoom={baseMap.maxZoom} />
        <MapView location={location} recenterRequest={recenterRequest} active={active} resultsViewport={resultsViewport} />
        {mapLayer === 'listings' ? filtered.map((item) => <Marker key={item.id} position={publicListingPosition(item)} icon={mapMarkerIcons[item.type] || mapMarkerIcons.give} opacity={requestedListingIds.has(item.id) ? 0.45 : 1} title={listingCategoryLabel(item, language)} alt={listingCategoryLabel(item, language)} eventHandlers={{ popupopen: (event) => event.target.closeTooltip(), mouseover: (event) => { if (event.target.isPopupOpen()) event.target.closeTooltip(); } }}><Tooltip className="listing-tooltip" direction="top" offset={[0, -35]} opacity={1} interactive={false}>{listingPreview(item)}</Tooltip><Popup autoPan={false} keepInView={false}>{listingCard(item)}</Popup></Marker>) : <CollectionPointLayer points={collectionPoints} onVote={votePoint} />}
      </MapContainer>

      <header className={`map-toolbar glass-panel ${filtersOpen ? '' : 'is-collapsed'}`}>
        {filtersOpen ? <>
          <button type="button" className="map-toolbar-handle" aria-label={t('mapExperience.collapseFilters')} aria-expanded="true" onClick={(event) => { if (event.detail === 0 || !toolbarSwipeStart.current?.moved) setFiltersOpen(false); toolbarSwipeStart.current = null; }} onPointerDown={startToolbarSwipe} onPointerUp={finishToolbarSwipe} onPointerCancel={() => { toolbarSwipeStart.current = { moved: true }; }}><span aria-hidden="true" /></button>
          <div className="flex items-center justify-between gap-3">
            <div className="map-toolbar-heading"><p className="eyebrow text-sea"><Icon name="waves" size={14} />{t('map.eyebrow')}</p><h1 className="font-display mt-1 text-2xl text-forest">{t('map.title')}</h1></div>
            <div className="flex shrink-0 items-center gap-2">{mapLayer === 'listings' ? <button type="button" className="count-badge" onClick={() => setSheetOpen(true)}><strong>{filtered.length}</strong><span>{t('map.offers', { count: filtered.length }).replace(String(filtered.length), '').trim()}</span></button> : <div className="count-badge" role="status"><strong>{collectionPoints.length}</strong><span>{t('map.pointsLayer')}</span></div>}<button type="button" className="map-toolbar-toggle" onClick={() => setFiltersOpen(false)} aria-label={t('map.filters')}><Icon name="chevronUp" size={19} /></button></div>
          </div>
          <div className="map-layer-tabs mt-3" role="tablist" aria-label={t('map.layers')}><button type="button" role="tab" aria-selected={mapLayer === 'listings'} className={mapLayer === 'listings' ? 'active' : ''} onClick={() => setMapLayer('listings')}><Icon name="map" size={16} />{t('map.listingsLayer')}</button><button type="button" role="tab" aria-selected={mapLayer === 'points'} className={mapLayer === 'points' ? 'active' : ''} onClick={() => setMapLayer('points')}><Icon name="collection" size={16} />{t('map.pointsLayer')}</button></div>
          {mapLayer === 'listings' ? <>
          <div className="search-box mt-3"><Icon name="search" size={19} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('map.search')} aria-label={t('map.search')} />{query ? <button type="button" className="icon-button compact" onClick={() => setQuery('')} aria-label={t('map.resetFilters')}><Icon name="close" size={16} /></button> : null}<button type="button" className="icon-button compact" onClick={fetchData} aria-label={t('map.refresh')}><Icon name="refresh" size={17} /></button></div>
          {query.trim() ? <div className="search-scope-actions"><p className="search-scope-note"><Icon name="gift" size={14} />{t('map.searchGiveHint')}</p><button type="button" className="btn-link" onClick={saveCurrentSearch}><Icon name="bookmark" size={14} />{t('discovery.saveSearch')}</button></div> : null}
          <div className="scroll-row mt-3 flex gap-2 overflow-x-auto pb-1">
            <button type="button" className={`chip ${category === 'all' ? 'chip-active' : ''}`} onClick={() => setCategory('all')}>{t('map.all')}</button>
            {roots.map((item) => <button key={item.id} type="button" className={`chip ${category === rootPath(item) ? 'chip-active' : ''}`} onClick={() => setCategory(rootPath(item))}><CategoryIcon category={item} size={17} />{categoryLabel(item, language)}</button>)}
          </div>
          <div className="scroll-row mt-2 flex gap-2 overflow-x-auto pb-1">
            {['all', 'give', 'take', 'lend'].map((value) => <button key={value} type="button" disabled={Boolean(query.trim())} className={`chip chip-small ${(query.trim() ? value === 'give' : type === value) ? 'chip-active' : ''}`} onClick={() => setType(value)}>{value === 'all' ? null : <Icon name={value === 'give' ? 'gift' : value === 'take' ? 'search' : 'history'} size={13} />}{value === 'all' ? t('map.all') : t(value === 'give' ? 'map.give' : value === 'take' ? 'map.take' : 'map.lend')}</button>)}
            {distances.map((value) => <button key={value} type="button" className={`chip chip-small ${distance === value ? 'chip-active' : ''}`} onClick={() => { setDistance(value); if (value !== 'all' && !location) locate(); }}>{distanceLabel[value]}</button>)}
          </div>
          <button type="button" className="btn-primary map-show-results mt-3 w-full" disabled={loading || Boolean(loadError) || filtered.length === 0 || locationPending} onClick={() => { setFiltersOpen(false); setSheetOpen(false); setResultsViewport({ positions: filtered.map(publicListingPosition) }); }}>{loading ? t('common.loading') : t('mapExperience.showResults', { count: filtered.length })}</button>
          </> : <div className="point-layer-actions mt-3"><p role={pointsError ? 'status' : undefined}>{t(pointsError ? 'reliabilityExperience.pointsLoadFailed' : !loading && collectionPoints.length === 0 ? 'points.empty' : 'points.mapHint')}</p><button type="button" className="btn-primary" onClick={() => setPointDialogOpen(true)}><Icon name="plus" size={17} />{t('points.add')}</button></div>}
        </> : <button type="button" className="map-toolbar-restore" onClick={() => setFiltersOpen(true)} aria-expanded="false"><Icon name="sliders" size={18} /><span>{t(mapLayer === 'points' ? 'map.pointsLayer' : 'map.filters')}</span><strong>{mapLayer === 'points' ? collectionPoints.length : filtered.length}</strong><Icon name="chevronDown" size={17} /></button>}
      </header>
      <button type="button" className="map-recenter" onClick={locate} disabled={locationPending} aria-busy={locationPending} aria-label={t(locationPending ? 'map.locating' : 'mapExperience.recenter')} title={t(locationPending ? 'map.locating' : 'mapExperience.recenter')}><Icon name={locationPending ? 'clock' : 'location'} size={21} /></button>
      {locationMessage ? <div className="map-location-status"><p role="status">{locationMessage}</p>{locationIssue ? <><p className="map-location-hint">{t('mapExperience.positionManualHint')}</p><button type="button" className="btn-link map-location-retry" onClick={locate} disabled={locationPending}>{t('common.retry')}</button></> : null}</div> : null}
      {loading ? <p className="map-refresh-status" role="status">{t('common.loading')}</p> : lastUpdated && loadError ? <p className="map-refresh-status" role="status">{t('reliabilityExperience.lastUpdated', { time: lastUpdated.toLocaleTimeString(language === 'me' ? 'sr-Latn-ME' : language, {hour:'2-digit',minute:'2-digit'}) })}</p> : null}

      {loadError ? <div className="map-state card"><Icon name="close" size={24} /><p>{t('errors.load')}</p><button type="button" className="btn-secondary" onClick={fetchData}>{t('common.retry')}</button></div> : null}
      {!loading && !loadError && mapLayer === 'listings' && filtered.length === 0 ? <div className="map-state map-state-empty card"><img className="state-illustration" src={emptyListings} alt="" /><strong>{t('map.emptyTitle')}</strong><p>{t('map.emptyText')}</p><button type="button" className="btn-primary" onClick={hasFilters ? resetFilters : onCreate}>{t(hasFilters ? 'map.resetFilters' : 'nav.create')}</button></div> : null}

      {mapLayer === 'listings' && sheetOpen ? <section className="listing-sheet open">
        <div className="listing-sheet-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('map.listTitle')}</h2></div><button type="button" className="icon-button" onClick={() => setSheetOpen(false)} aria-label={t('common.close')}><Icon name="close" size={18} /></button></div>
        <div className="listing-sheet-list space-y-3 px-4 pb-28">{filtered.map((item) => listingCard(item, true))}</div>
      </section> : null}

      {selectedListing ? <div className="listing-dialog-backdrop listing-dialog-backdrop-top map-detail-backdrop" role="presentation" onMouseDown={() => setSelectedListing(null)}>
        <section ref={detailRef} {...detailFocus} inert={Boolean(bookingListing || reportListing) || undefined} className="listing-dialog listing-dialog-with-actions card" aria-label={t('map.details')} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="icon-button listing-dialog-close" onClick={() => setSelectedListing(null)} aria-label={t('common.close')}><Icon name="close" size={18} /></button>
          <div className="listing-dialog-scroll">
          {listingImages(selectedListing).length ? <div className="listing-dialog-gallery">{listingImages(selectedListing).map((imageUrl) => <img key={imageUrl} src={imageUrl} alt="" className="listing-dialog-image" />)}</div> : <span className="listing-dialog-placeholder"><CategoryIcon category={selectedListing} size={42} /></span>}
          <div className={`listing-kind mt-4 ${selectedListing.type}`}><Icon name={typeIcon(selectedListing)} size={14} />{t(typeLabel(selectedListing))}</div>
          {isOwnMapListing(selectedListing, userId) ? <p className="listing-owner">{t('mapExperience.myListing')}</p> : null}
          <h2 className="font-display mt-3 text-3xl text-forest">{listingCategoryLabel(selectedListing, language)}</h2>
          <div className="listing-dialog-meta"><span><Icon name="box" size={13} />{t('common.pieces', { count: selectedListing.quantity })}</span><span><Icon name="location" size={13} />{distanceText(selectedListing)}</span><span><Icon name="calendar" size={13} />{new Intl.DateTimeFormat(language === 'me' ? 'sr-Latn-ME' : language, { day: 'numeric', month: 'short' }).format(new Date(selectedListing.created_at))}</span></div>
          <p className="listing-dialog-description">{selectedListing.description || t('map.noDescription')}</p>
          <p className="listing-dialog-note"><Icon name="message" size={16} />{isOwnMapListing(selectedListing, userId) ? t('mapExperience.myListingHint') : requestedListingIds.has(selectedListing.id) ? t('map.requestedHint') : t('map.contactNote')}</p>
          {!isOwnMapListing(selectedListing, userId) ? <button type="button" className="btn-secondary mt-4 w-full" aria-pressed={favouriteIds.has(selectedListing.id)} onClick={() => toggleFavourite(selectedListing)}><Icon name="heart" filled={favouriteIds.has(selectedListing.id)} size={17} /><span>{favouriteIds.has(selectedListing.id) ? t('discovery.favourited') : t('discovery.favourite')}</span></button> : null}
          {!isOwnMapListing(selectedListing, userId) ? <button type="button" className="btn-link mt-4 text-xs" onClick={() => setReportListing(selectedListing)}><Icon name="flag" size={15} />{t('workflow.reportListing')}</button> : null}
          </div>
          <div className="listing-dialog-actions">
            <button type="button" className={`listing-request-action w-full ${isOwnMapListing(selectedListing, userId) || requestedListingIds.has(selectedListing.id) ? 'btn-secondary' : 'btn-primary'} ${isOwnMapListing(selectedListing, userId) ? 'is-owned' : ''}`} disabled={isOwnMapListing(selectedListing, userId) || bookingId === selectedListing.id || requestedListingIds.has(selectedListing.id) || availableRequestQuantity(selectedListing) < 1} onClick={() => openBooking(selectedListing)}>{isOwnMapListing(selectedListing, userId) ? null : <Icon name={requestedListingIds.has(selectedListing.id) ? 'check' : selectedListing.type === 'take' ? 'handover' : selectedListing.type === 'lend' ? 'history' : 'gift'} size={18} />}{isOwnMapListing(selectedListing, userId) ? t('mapExperience.myListing') : requestedListingIds.has(selectedListing.id) ? t('map.requested') : bookingId === selectedListing.id ? t('map.booking') : t(selectedListing.type === 'take' ? 'map.bookTake' : selectedListing.type === 'lend' ? 'map.bookLend' : 'map.bookGive')}</button>
          </div>
        </section>
      </div> : null}

      {bookingListing ? <div className="listing-dialog-backdrop listing-dialog-backdrop-top" role="presentation" onMouseDown={closeBooking}>
        <section ref={bookingRef} {...bookingFocus} className="booking-confirm card" aria-label={t(bookingListing.type === 'take' ? 'map.confirmTakeTitle' : bookingListing.type === 'lend' ? 'map.confirmLendTitle' : 'map.confirmGiveTitle')} onMouseDown={(event) => event.stopPropagation()}>
          <Icon name={bookingListing.type === 'take' ? 'handover' : bookingListing.type === 'lend' ? 'history' : 'gift'} size={30} /><h2 className="font-display mt-3 text-3xl text-forest">{t(bookingListing.type === 'take' ? 'map.confirmTakeTitle' : bookingListing.type === 'lend' ? 'map.confirmLendTitle' : 'map.confirmGiveTitle')}</h2><p>{t(bookingListing.type === 'take' ? 'map.confirmTakeText' : bookingListing.type === 'lend' ? 'map.confirmLendText' : 'map.confirmGiveText')}</p>
          <label className="mt-4 block text-left"><span className="field-label">{t('mapExperience.requestQuantity', { count: availableRequestQuantity(bookingListing) })}</span><input className="field" type="number" inputMode="numeric" step="1" min="1" max={availableRequestQuantity(bookingListing)} disabled={availableRequestQuantity(bookingListing) < 1} value={requestQuantity(bookingQuantity, bookingListing)} onChange={(event) => setBookingQuantity(requestQuantity(event.target.value, bookingListing))} /></label>
          <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" className="btn-secondary" disabled={Boolean(bookingId)} onClick={() => setBookingListing(null)}>{t('common.cancel')}</button><button type="button" className="btn-primary" disabled={Boolean(bookingId) || isOwnMapListing(bookingListing, userId) || requestedListingIds.has(bookingListing.id) || availableRequestQuantity(bookingListing) < 1} onClick={() => handleBook(bookingListing)}>{bookingId ? t('map.booking') : t(bookingListing.type === 'take' ? 'map.confirmTakeYes' : bookingListing.type === 'lend' ? 'map.confirmLendYes' : 'map.confirmGiveYes')}</button></div>
        </section>
      </div> : null}
      {reportListing ? <ReportDialog active={active} targetKind="listing" targetId={reportListing.id} label={listingCategoryLabel(reportListing, language)} onClose={() => setReportListing(null)} /> : null}
      {pointDialogOpen ? <CollectionPointDialog active={active} initialPosition={location || [42.441, 19.263]} onClose={() => setPointDialogOpen(false)} onCreated={fetchData} /> : null}
    </div>
  );
}
