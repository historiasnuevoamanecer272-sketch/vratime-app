import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { supabase } from '../supabaseClient';
import { getCollectionPoints, getMyListingContacts, getMyDiscoveryFeed, getPublicMapListings, requestListingContacts, saveSearch, toggleListingFavourite, voteCollectionPoint } from '../lib/api';
import { categoryLabel, categorySearchText, listingCategoryLabel, normalizeSearch, rootPath } from '../lib/categories';
import { getAppLanguage } from '../i18n';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';
import ListingPhoto from '../components/ListingPhoto';
import ContactCountdown from '../components/ContactCountdown';
import { nextContactFollowup } from '../lib/contactFollowup';
import CategoryIcon from '../components/CategoryIcon';
import { groupedMapMarkerIcon, mapMarkerIcons } from '../lib/mapMarkers';
import { groupPublicMapListings } from '../lib/mapListingGroups';
import { contactChannels, contactHref } from '../lib/contacts';
import { baseMap } from '../lib/basemap';
import { matchesDiscoveryType } from '../lib/listingFilters';
import ReportDialog from '../components/ReportDialog';
import { normalizePublicListing, publicListingPosition } from '../lib/publicListings';
import CollectionPointLayer from '../components/CollectionPointLayer';
import CollectionPointDialog from '../components/CollectionPointDialog';
import { availableRequestQuantity, isOwnMapListing, isUpwardToolbarSwipe } from '../lib/mapInteraction';
import { friendlyError } from '../lib/userErrors';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { requestBrowserLocation } from '../lib/geolocationRequest';
import { bindMapPopupReveal } from '../lib/popupViewport';
import { formatListingDate } from '../lib/listingDate';
import { subscribeMapRefresh } from '../lib/mapRefresh';
import { subscribeConnection } from '../lib/connectionState';
import { normalizeCollectionPoints } from '../lib/collectionPoints';
import { createFormTaskScope } from '../lib/formTaskScope';
import '../styles/map-simple-exchange.css';
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

function MapView({ location, recenterRequest, active, resultsViewport, closeLabel }) {
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
  useEffect(() => bindMapPopupReveal(map, closeLabel), [map, closeLabel]);
  return null;
}

export default function MapScreen({ userId, active = true, focusListingId = null, onFocusHandled, onOpenContacts }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const [listings, setListings] = useState([]);
  const [categories, setCategories] = useState([]);
  const [contactExchanges, setContactExchanges] = useState([]);
  const [loading, setLoading] = useState(() => globalThis.navigator?.onLine !== false);
  const [loadError, setLoadError] = useState(() => globalThis.navigator?.onLine === false ? t('reliabilityExperience.offline') : '');
  const [contactPending, setContactPending] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [type, setType] = useState('all');
  const [distance, setDistance] = useState('all');
  const [location, setLocation] = useState(null);
  const [locationMessage, setLocationMessage] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedListing, setSelectedListing] = useState(null);
  const [contactListing, setContactListing] = useState(null);
  const [contactError, setContactError] = useState('');
  const [reportListing, setReportListing] = useState(null);
  const [mapLayer, setMapLayer] = useState('listings');
  const [collectionPoints, setCollectionPoints] = useState([]);
  const [pointDialogOpen, setPointDialogOpen] = useState(false);
  const [favouriteIds, setFavouriteIds] = useState(new Set());
  const [recenterRequest, setRecenterRequest] = useState(0);
  const toolbarSwipeStart = useRef(null);
  const contactInFlight = useRef(false);
  const fetchRequest = useRef(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [pointsError, setPointsError] = useState(false);
  const [locationPending, setLocationPending] = useState(false);
  const [locationIssue, setLocationIssue] = useState(false);
  const [resultsViewport, setResultsViewport] = useState(null);
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine !== false);
  const locationInFlight = useRef(false);
  const cancelLocation = useRef(null);
  const detailRef = useRef(null);
  const contactRef = useRef(null);
  const taskScope = useMemo(() => {
    const scope = createFormTaskScope(userId);
    if (!active) scope.dispose();
    return scope;
  }, [userId, active]);
  const contactId = contactPending?.scope === taskScope ? contactPending.id : null;
  useEffect(() => {
    taskScope.activate();
    const subscription = supabase.auth?.onAuthStateChange?.((_event, session) => { if (session?.user?.id !== userId) taskScope.dispose(); })?.data?.subscription;
    return () => { taskScope.dispose(); subscription?.unsubscribe(); };
  }, [taskScope, userId]);
  useAppOverlay(active && Boolean(sheetOpen), () => setSheetOpen(false), 'map-list');
  useAppOverlay(active && Boolean(selectedListing), () => setSelectedListing(null), 'listing');
  const closeContacts = () => { if (contactInFlight.current?.scope === taskScope) return false; setContactListing(null); return true; };
  useAppOverlay(active && Boolean(contactListing), closeContacts, 'listing-contacts');
  const detailFocus = useDialogFocus({ open: active && Boolean(selectedListing) && !contactListing && !reportListing, onClose: () => setSelectedListing(null), dialogRef: detailRef });
  const contactFocus = useDialogFocus({ open: active && Boolean(contactListing), onClose: closeContacts, dialogRef: contactRef });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocationPending(false); setLocationIssue(false); setLocationMessage('');
      if (!active) { setSheetOpen(false); setSelectedListing(null); setContactListing(null); setReportListing(null); setPointDialogOpen(false); }
    }, 0);
    return () => { window.clearTimeout(timer); cancelLocation.current?.(); locationInFlight.current = false; };
  }, [active, userId]);

  useEffect(() => subscribeConnection(window, setOnline), []);

  const fetchData = useCallback(async ({ background = false } = {}) => {
    const task = taskScope.capture();
    if (!active || !task.isCurrent()) return;
    const request = ++fetchRequest.current;
    if (!background) { setLoading(true); setLoadError(''); }
    const [listingsResult, categoriesResult, contactsResult, pointsResult, discoveryResult] = await Promise.all([
      getPublicMapListings().then((data) => ({ data })).catch((error) => ({ error })),
      supabase.from('categories').select('*').order('id'),
      getMyListingContacts().then((data) => ({ data })).catch((error) => ({ error })),
      getCollectionPoints().then((data) => ({ data })).catch((error) => ({ error })),
      getMyDiscoveryFeed().then((data) => ({ data })).catch((error) => ({ error })),
    ]);
    if (!task.isCurrent() || request !== fetchRequest.current) return;
    if (listingsResult.error || categoriesResult.error) setLoadError(listingsResult.error?.message || categoriesResult.error?.message || t('errors.load'));
    else {
      const latest = (listingsResult.data || []).map(normalizePublicListing);
      setListings(latest);
      setSelectedListing((current) => current ? latest.find((item) => item.id === current.id) || null : null);
      setCategories(categoriesResult.data || []);
      setLastUpdated(new Date());
      setLoadError('');
    }
    if (!contactsResult.error) setContactExchanges(contactsResult.data || []);
    setPointsError(Boolean(pointsResult.error));
    if (!pointsResult.error) setCollectionPoints(normalizeCollectionPoints(pointsResult.data));
    if (!discoveryResult.error) setFavouriteIds(new Set((discoveryResult.data?.favourites || []).map((item) => item.listing_id)));
    setLoading(false);
  }, [t, taskScope, active]);

  useEffect(() => {
    if (!active) return;
    const stop = subscribeMapRefresh({ host: window, document, refresh: fetchData });
    return () => {
      stop();
      fetchRequest.current += 1;
    };
  }, [fetchData, active, userId]);

  const roots = useMemo(() => categories.filter((item) => item.parent_id === null), [categories]);
  const exchangeFor = (listingId) => contactExchanges.find((exchange) => exchange.listing_id === listingId);
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
  const markerGroups = useMemo(() => groupPublicMapListings(filtered), [filtered]);

  useEffect(() => {
    if (!active || !focusListingId) return;
    const timer = window.setTimeout(() => {
      setQuery(''); setCategory('all'); setType('all'); setDistance('all');
      setMapLayer('listings'); setFiltersOpen(false); setSheetOpen(false);
      const listing = listings.find((item) => item.id === focusListingId);
      const position = publicListingPosition(listing);
      if (!position) return;
      setSelectedListing(listing);
      setResultsViewport({ positions: [position] });
      onFocusHandled?.(focusListingId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, focusListingId, listings, onFocusHandled]);

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
        setLocation(coordinates); setRecenterRequest((request) => request + 1); setLocationMessage('');
      },
      onError: (reason) => {
        locationInFlight.current = false; setLocationPending(false); setLocationIssue(true);
        if (!location) setDistance('all');
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

  const openContacts = (item) => {
    if (isOwnMapListing(item, userId) || (!exchangeFor(item.id) && availableRequestQuantity(item) < 1)) return;
    setContactError('');
    setContactListing(item);
  };

  const shareContacts = async (item) => {
    const task = taskScope.capture();
    if (!task.isCurrent() || !active || !online || contactInFlight.current?.scope === taskScope || contactId || isOwnMapListing(item, userId) || exchangeFor(item.id) || availableRequestQuantity(item) < 1) return;
    const action = { scope: taskScope, id: item.id };
    contactInFlight.current = action;
    setContactPending(action); setContactError('');
    try {
      const exchange = await task.mutate(() => requestListingContacts(item.id));
      if (!task.isCurrent()) return;
      if (!Array.isArray(exchange?.contacts) || !exchange.contacts.length) throw new Error('contact_details_required');
      setContactExchanges((current) => [...current.filter((entry) => entry.listing_id !== item.id), exchange]);
      setListings(current => current.map(listing => listing.id === item.id ? { ...listing, active_interest_count: Number(exchange.active_interest_count) || Math.max(1, Number(listing.active_interest_count) || 0) } : listing));
      await fetchData({ background: true });
    } catch (error) {
      if (task.isCurrent()) setContactError(t(String(error?.message).includes('contact_details_required') ? 'simpleExchange.missingContacts' : 'simpleExchange.contactError'));
    } finally {
      if (contactInFlight.current === action) contactInFlight.current = null;
      if (task.isCurrent()) setContactPending(null);
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
    const hasOrigin = Array.isArray(location) && location.length === 2 && location.every(Number.isFinite)
      && Math.abs(location[0]) <= 90 && Math.abs(location[1]) <= 180;
    const savedDistance = hasOrigin ? distance : 'all';
    try {
      await saveSearch(query.trim(), { category, distance: savedDistance, type: type === 'lend' ? 'lend' : 'give', ...(savedDistance !== 'all' ? { origin: location } : {}) }, true);
      showToast(t('discovery.saved'), 'success', { prominent: true });
    } catch (error) { showToast(friendlyError(error, t), 'error'); }
  };

  const votePoint = async (point, value) => {
    try { await voteCollectionPoint(point.id, value); showToast(t('points.voteSaved'), 'success'); await fetchData(); }
    catch (error) { showToast(friendlyError(error, t), 'error'); }
  };

  const distanceLabel = { all: t('map.anyDistance'), 1: t('map.km1'), 5: t('map.km5'), 10: t('map.km10') };
  const typeIcon = (item) => item.type === 'give' ? 'gift' : item.type === 'take' ? 'search' : 'clock';
  const typeLabel = (item) => item.type === 'give' ? 'map.give' : item.type === 'take' ? 'map.take' : 'map.lend';
  const distanceText = (item) => {
    if (!location) return t('map.distanceUnknown');
    const value = kmBetween(location, publicListingPosition(item));
    return value === null ? t('map.distanceUnknown') : t('map.distance', { value: value.toFixed(1) });
  };
  const listingCard = (item, compact = false) => (
    <article key={`${compact ? 'sheet' : 'popup'}-${item.id}`} className={`listing-card ${compact ? 'listing-card-row' : ''} ${isOwnMapListing(item, userId) ? 'is-owned' : ''} ${item.active_interest_count > 0 ? 'is-interested' : ''}`}>
      {listingImages(item)[0] ? <ListingPhoto src={listingImages(item)[0]} alt={listingCategoryLabel(item,language)} className="listing-image" active={active} /> : <span className="listing-placeholder"><CategoryIcon category={item} size={32} /></span>}
      <div className="min-w-0 flex-1">
        <div className={`listing-kind ${item.type}`}><Icon name={typeIcon(item)} size={13} />{t(typeLabel(item))}</div>
        {item.active_interest_count > 0 ? <span className="interest-badge" title={t('simpleExchange.interestCount', { count: item.active_interest_count })}>{t('simpleExchange.interestStatus')} · {item.active_interest_count}</span> : null}
        {isOwnMapListing(item, userId) ? <div className="listing-owner">{t('mapExperience.myListing')}</div> : null}
        <h3 className="mt-2 truncate font-extrabold text-forest">{listingCategoryLabel(item, language)}</h3>
        <p className="mt-1 text-xs font-semibold text-muted">{t('common.pieces', { count: item.quantity })} · {distanceText(item)}</p>
        {item.type === 'lend' && item.loan_duration_days ? <p className="mt-1 text-xs font-semibold text-muted">{t('loanExperience.durationSummary', {days:item.loan_duration_days})}</p> : null}
        {item.description ? <p className="listing-description">{item.description}</p> : null}
        <button type="button" data-map-listing-id={item.id} className="btn-primary mt-3 w-full min-h-10 text-sm" onClick={() => setSelectedListing(item)}>{t('map.details')}</button>
      </div>
    </article>
  );

  const listingPreview = (item) => (
    <div className={`listing-preview ${isOwnMapListing(item, userId) ? 'is-owned' : ''}`}>
      {listingImages(item)[0] ? <img src={listingImages(item)[0]} alt="" /> : <span><CategoryIcon category={item} size={26} /></span>}
      <div className="min-w-0"><p className={`listing-kind ${item.type}`}><Icon name={typeIcon(item)} size={12} />{t(typeLabel(item))}</p>{isOwnMapListing(item, userId) ? <span className="listing-owner">{t('mapExperience.myListing')}</span> : null}<strong>{listingCategoryLabel(item, language)}</strong><small>{item.description || `${t('common.pieces', { count: item.quantity })} · ${t('map.hoverHint')}`}</small></div>
    </div>
  );

  return (
    <div className="map-page relative h-[100svh] overflow-hidden">
      <MapContainer center={[42.441, 19.263]} zoom={12} zoomControl={false} className="h-full w-full" preferCanvas>
        <TileLayer attribution={baseMap.attribution} url={baseMap.url} maxZoom={baseMap.maxZoom} />
        <MapView location={location} recenterRequest={recenterRequest} active={active} resultsViewport={resultsViewport} closeLabel={t('common.close')} />
        {mapLayer === 'listings' ? markerGroups.map((group) => {
          const item = group.listings[0];
          const grouped = group.listings.length > 1;
          const interested = group.listings.some(listing => listing.active_interest_count > 0);
          const label = `${grouped ? t('map.offers', { count: group.listings.length }) : listingCategoryLabel(item, language)}${interested ? ` · ${t('simpleExchange.interestStatus')}` : ''}`;
          return <Marker key={group.key} position={group.position} icon={grouped ? groupedMapMarkerIcon(group.listings.length, interested, item.type) : mapMarkerIcons[`${item.type}${interested ? 'Interest' : ''}`] || mapMarkerIcons[item.type] || mapMarkerIcons.give} opacity={1} title={label} alt={label} eventHandlers={{ popupopen: (event) => event.target.closeTooltip(), mouseover: (event) => { if (event.target.isPopupOpen()) event.target.closeTooltip(); } }}><Tooltip className="listing-tooltip" direction="top" offset={[0, -35]} opacity={1} interactive={false}>{grouped ? <strong>{label}</strong> : listingPreview(item)}</Tooltip><Popup autoPan={false} keepInView={false}>{grouped ? <div className="map-overlap-options" aria-label={label}><strong className="map-overlap-count">{label}</strong>{group.listings.map((listing) => listingCard(listing))}</div> : listingCard(item)}</Popup></Marker>;
        }) : <CollectionPointLayer points={collectionPoints} onVote={votePoint} />}
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
          <div className="search-box mt-3"><Icon name="search" size={19} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(type === 'lend' ? 'loanExperience.search' : 'map.search')} aria-label={t(type === 'lend' ? 'loanExperience.search' : 'map.search')} />{query ? <button type="button" className="icon-button compact" onClick={() => setQuery('')} aria-label={t('map.resetFilters')}><Icon name="close" size={16} /></button> : null}<button type="button" className="icon-button compact" onClick={fetchData} aria-label={t('map.refresh')}><Icon name="refresh" size={17} /></button></div>
          {query.trim() ? <div className="search-scope-actions"><p className="search-scope-note"><Icon name={type === 'lend' ? 'clock' : 'gift'} size={14} />{t(type === 'lend' ? 'loanExperience.searchHint' : 'map.searchGiveHint')}</p><button type="button" className="btn-link" onClick={saveCurrentSearch}><Icon name="bookmark" size={14} />{t('discovery.saveSearch')}</button></div> : null}
          {type !== 'lend' ? <div className="scroll-row mt-3 flex gap-2 overflow-x-auto pb-1">
            <button type="button" className={`chip ${category === 'all' ? 'chip-active' : ''}`} onClick={() => setCategory('all')}>{t('map.all')}</button>
            {roots.map((item) => <button key={item.id} type="button" className={`chip ${category === rootPath(item) ? 'chip-active' : ''}`} onClick={() => setCategory(rootPath(item))}><CategoryIcon category={item} size={17} />{categoryLabel(item, language)}</button>)}
          </div> : null}
          <div className="scroll-row mt-2 flex gap-2 overflow-x-auto pb-1">
            {['all', 'give', 'take', 'lend'].map((value) => <button key={value} type="button" disabled={Boolean(query.trim())} className={`chip chip-small ${(query.trim() ? value === (type === 'lend' ? 'lend' : 'give') : type === value) ? 'chip-active' : ''}`} onClick={() => {setType(value);if(value === 'lend')setCategory('all');}}>{value === 'all' ? null : <Icon name={value === 'give' ? 'gift' : value === 'take' ? 'search' : 'clock'} size={13} />}{value === 'all' ? t('map.all') : t(value === 'give' ? 'map.give' : value === 'take' ? 'map.take' : 'map.lend')}</button>)}
            {distances.map((value) => <button key={value} type="button" className={`chip chip-small ${distance === value ? 'chip-active' : ''}`} onClick={() => { setDistance(value); if (value !== 'all' && !location) locate(); }}>{distanceLabel[value]}</button>)}
          </div>
          {!loading && !loadError && hasFilters && filtered.length === 0 ? <div className="map-empty-results" role="status"><p>{t('mapExperience.noResults')}</p><button type="button" className="btn-link" onClick={resetFilters}>{t('map.resetFilters')}</button></div> : null}
          <button type="button" className="btn-primary map-show-results mt-3 w-full" disabled={loading || Boolean(loadError) || locationPending} onClick={() => { setFiltersOpen(false); setSheetOpen(false); setResultsViewport({ positions: filtered.map(publicListingPosition) }); }}>{loading ? t('common.loading') : t('mapExperience.showResults', { count: filtered.length })}</button>
          </> : <div className="point-layer-actions mt-3"><p role={pointsError ? 'status' : undefined}>{t(pointsError ? 'reliabilityExperience.pointsLoadFailed' : !loading && collectionPoints.length === 0 ? 'points.empty' : 'points.mapHint')}</p><button type="button" className="btn-primary" onClick={() => setPointDialogOpen(true)}><Icon name="plus" size={17} />{t('points.add')}</button></div>}
        </> : <button type="button" className="map-toolbar-restore" onClick={() => setFiltersOpen(true)} aria-expanded="false"><Icon name="sliders" size={18} /><span>{t(mapLayer === 'points' ? 'map.pointsLayer' : 'map.filters')}</span><strong>{mapLayer === 'points' ? collectionPoints.length : filtered.length}</strong><Icon name="chevronDown" size={17} /></button>}
      </header>
      <button type="button" className="map-recenter" onClick={locate} disabled={locationPending} aria-busy={locationPending} aria-label={t(locationPending ? 'map.locating' : 'mapExperience.recenter')} title={t(locationPending ? 'map.locating' : 'mapExperience.recenter')}><Icon name={locationPending ? 'clock' : 'location'} size={21} /></button>
      {locationMessage ? <div className="map-location-status"><p role="status">{locationMessage}</p>{locationIssue ? <><p className="map-location-hint">{t('mapExperience.positionManualHint')}</p><button type="button" className="btn-link map-location-retry" onClick={locate} disabled={locationPending}>{t('common.retry')}</button></> : null}</div> : null}
      {loading ? <p className="map-refresh-status" role="status">{t('common.loading')}</p> : lastUpdated && (loadError || !online) ? <p className="map-refresh-status" role="status">{t('reliabilityExperience.lastUpdated', { time: lastUpdated.toLocaleTimeString(language === 'me' ? 'sr-Latn-ME' : language, {hour:'2-digit',minute:'2-digit'}) })}</p> : null}

      {loadError && !lastUpdated ? <div className="map-state card"><Icon name="close" size={24} /><p>{t('errors.load')}</p><button type="button" className="btn-secondary" onClick={fetchData}>{t('common.retry')}</button></div> : null}

      {mapLayer === 'listings' && sheetOpen ? <section className="listing-sheet open">
        <div className="listing-sheet-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('map.listTitle')}</h2></div><button type="button" className="icon-button" onClick={() => setSheetOpen(false)} aria-label={t('common.close')}><Icon name="close" size={18} /></button></div>
        <div className="listing-sheet-list space-y-3 px-4 pb-28">{filtered.map((item) => listingCard(item, true))}</div>
      </section> : null}

      {selectedListing ? <div className="listing-dialog-backdrop listing-dialog-backdrop-top map-detail-backdrop" role="presentation" onMouseDown={() => setSelectedListing(null)}>
        <section ref={detailRef} {...detailFocus} inert={Boolean(contactListing || reportListing) || undefined} className="listing-dialog listing-dialog-with-actions card" aria-label={t('map.details')} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="icon-button listing-dialog-close" onClick={() => setSelectedListing(null)} aria-label={t('common.close')}><Icon name="close" size={18} /></button>
          <div className="listing-dialog-scroll">
          {listingImages(selectedListing).length ? <div className="listing-dialog-gallery">{listingImages(selectedListing).map((imageUrl) => <ListingPhoto key={imageUrl} src={imageUrl} alt={listingCategoryLabel(selectedListing,language)} className="listing-dialog-image" active={active} />)}</div> : <span className="listing-dialog-placeholder"><CategoryIcon category={selectedListing} size={42} /></span>}
          <div className={`listing-kind mt-4 ${selectedListing.type}`}><Icon name={typeIcon(selectedListing)} size={14} />{t(typeLabel(selectedListing))}</div>
          {selectedListing.active_interest_count > 0 ? <span className="interest-badge" title={t('simpleExchange.interestCount', { count: selectedListing.active_interest_count })}>{t(isOwnMapListing(selectedListing, userId) ? 'simpleExchange.ownerInterest' : exchangeFor(selectedListing.id) ? 'simpleExchange.yourInterest' : 'simpleExchange.interestStatus')}{!isOwnMapListing(selectedListing, userId) && exchangeFor(selectedListing.id) ? null : ` · ${selectedListing.active_interest_count}`}</span> : null}
          {isOwnMapListing(selectedListing, userId) ? <p className="listing-owner">{t('mapExperience.myListing')}</p> : null}
          <h2 className="font-display mt-3 text-3xl text-forest">{listingCategoryLabel(selectedListing, language)}</h2>
          <div className="listing-dialog-meta"><span><Icon name="box" size={13} />{t('common.pieces', { count: selectedListing.quantity })}</span><span><Icon name="location" size={13} />{distanceText(selectedListing)}</span>{formatListingDate(selectedListing.created_at, language) ? <span><Icon name="calendar" size={13} />{formatListingDate(selectedListing.created_at, language)}</span> : null}</div>
          <p className="listing-dialog-description">{selectedListing.description || t('map.noDescription')}</p>
          <ContactCountdown exchange={nextContactFollowup(contactExchanges, selectedListing.id)} active={active && !contactListing && !reportListing} onDue={fetchData} onOpenDeals={onOpenContacts ? () => { setSelectedListing(null); onOpenContacts(); } : undefined} />
          {selectedListing.type === 'lend' && selectedListing.loan_duration_days ? <p className="mt-3 text-sm font-semibold text-forest"><Icon name="clock" size={16} /> {t('loanExperience.durationSummary', {days:selectedListing.loan_duration_days})}</p> : null}
          <p className="listing-dialog-note"><Icon name="message" size={16} />{t('simpleExchange.intro')}</p>
          {!isOwnMapListing(selectedListing, userId) ? <button type="button" className="btn-secondary mt-4 w-full" aria-pressed={favouriteIds.has(selectedListing.id)} onClick={() => toggleFavourite(selectedListing)}><Icon name="heart" filled={favouriteIds.has(selectedListing.id)} size={17} /><span>{favouriteIds.has(selectedListing.id) ? t('discovery.favourited') : t('discovery.favourite')}</span></button> : null}
          {!isOwnMapListing(selectedListing, userId) ? <button type="button" className="btn-link mt-4 text-xs" onClick={() => setReportListing(selectedListing)}><Icon name="flag" size={15} />{t('workflow.reportListing')}</button> : null}
          </div>
          <div className="listing-dialog-actions">
            <button type="button" className={`listing-request-action w-full ${isOwnMapListing(selectedListing, userId) ? 'btn-secondary is-owned' : 'btn-primary'}`} disabled={isOwnMapListing(selectedListing, userId) || contactId === selectedListing.id || (!exchangeFor(selectedListing.id) && availableRequestQuantity(selectedListing) < 1)} onClick={() => openContacts(selectedListing)}>{isOwnMapListing(selectedListing, userId) ? null : <Icon name="message" size={18} />}{isOwnMapListing(selectedListing, userId) ? t('mapExperience.myListing') : t(exchangeFor(selectedListing.id) ? 'simpleExchange.openContacts' : selectedListing.type === 'give' ? 'simpleExchange.contactGive' : selectedListing.type === 'take' ? 'simpleExchange.contactTake' : 'simpleExchange.connect')}</button>
          </div>
        </section>
      </div> : null}

      {contactListing ? <div className="listing-dialog-backdrop listing-dialog-backdrop-top" role="presentation" onMouseDown={closeContacts}>
        <section ref={contactRef} {...contactFocus} className="map-contact-dialog card" aria-label={t(exchangeFor(contactListing.id) ? 'simpleExchange.contactsReady' : 'simpleExchange.consentTitle')} onMouseDown={(event) => event.stopPropagation()}>
          <Icon name="message" size={30} /><h2 className="font-display mt-3 text-3xl text-forest">{t(exchangeFor(contactListing.id) ? 'simpleExchange.contactsReady' : 'simpleExchange.consentTitle')}</h2>
          {exchangeFor(contactListing.id) ? <p className="mt-3 font-semibold">{t('simpleExchange.contactWithin24')}</p> : null}
          <ContactCountdown exchange={nextContactFollowup(contactExchanges, contactListing.id)} active={active} onDue={fetchData} />
          {exchangeFor(contactListing.id) ? <><p className="mt-3 font-bold">{exchangeFor(contactListing.id).partner_name}</p><div className="contact-links map-private-contact-links">{exchangeFor(contactListing.id).contacts?.map((contact) => {
            const href = contactHref(contact);
            const channel = contactChannels.find(item => item.id === contact.messenger_type)?.label || contact.messenger_type?.toUpperCase();
            return href ? <a className="btn-primary contact-action" key={`${contact.messenger_type}-${contact.contact_value}`} href={href} target="_blank" rel="noreferrer"><Icon name="message" size={22} /><span className="contact-action-text"><strong>{t('simpleExchange.writeVia', { channel })}</strong><small>{contact.contact_value}</small></span><Icon name="arrowRight" size={20} /></a> : <span key={`${contact.messenger_type}-${contact.contact_value}`}>{contact.contact_value}</span>;
          })}</div>{onOpenContacts ? <button type="button" className="btn-link map-open-contacts" onClick={() => { closeContacts(); onOpenContacts(); }}>{t('simpleExchange.openContacts')}</button> : null}</> : <><p className="mt-3">{t('simpleExchange.consentBody')}</p>{!online ? <p role="status" className="field-error">{t('reliabilityExperience.offline')}</p> : null}{contactError ? <p role="alert" className="field-error">{contactError}</p> : null}<button type="button" className="btn-primary map-contact-confirm mt-5 w-full" disabled={!online || Boolean(contactId) || isOwnMapListing(contactListing, userId) || availableRequestQuantity(contactListing) < 1} onClick={() => shareContacts(contactListing)}>{t(contactId ? 'simpleExchange.connecting' : 'simpleExchange.shareContacts')}</button></>}
          <button type="button" className="btn-secondary mt-3 w-full" disabled={Boolean(contactId)} onClick={closeContacts}>{t('common.close')}</button>
        </section>
      </div> : null}
      {reportListing ? <ReportDialog active={active} targetKind="listing" targetId={reportListing.id} label={listingCategoryLabel(reportListing, language)} onClose={() => setReportListing(null)} /> : null}
      {pointDialogOpen ? <CollectionPointDialog active={active} initialPosition={location || [42.441, 19.263]} onClose={() => setPointDialogOpen(false)} onCreated={fetchData} /> : null}
    </div>
  );
}
