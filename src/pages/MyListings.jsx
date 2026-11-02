import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import { getMyListingInterestCounts } from '../lib/api';
import { getAppLanguage } from '../i18n';
import { listingCategoryLabel } from '../lib/categories';
import { createFormTaskScope } from '../lib/formTaskScope';
import { subscribeMapRefresh } from '../lib/mapRefresh';
import Icon from '../components/Icon';
import CategoryIcon from '../components/CategoryIcon';
import ListingPhoto from '../components/ListingPhoto';
import ListingStatusManager from '../components/ListingStatusManager';
import '../styles/map-simple-exchange.css';

export default function MyListings({ userId, active = true, onEditListing }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const scope = useMemo(() => {
    const next = createFormTaskScope(userId);
    if (!active) next.dispose();
    return next;
  }, [userId, active]);
  const [snapshot, setSnapshot] = useState(null);
  const requestId = useRef(0);
  const visible = Boolean(active && userId && scope.capture().isCurrent());
  const data = visible && snapshot?.scope === scope ? snapshot : null;

  useEffect(() => {
    scope.activate();
    const subscription = supabase.auth?.onAuthStateChange?.((_event, session) => {
      if (session?.user?.id !== userId) scope.dispose();
    })?.data?.subscription;
    return () => { scope.dispose(); subscription?.unsubscribe(); };
  }, [scope, userId]);

  const load = useCallback(async () => {
    const task = scope.capture();
    if (!active || !userId || !task.isCurrent()) return;
    const revision = ++requestId.current;
    const [listings, interests] = await Promise.allSettled([
      supabase.from('listings').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      getMyListingInterestCounts(),
    ]);
    if (!task.isCurrent() || revision !== requestId.current) return;
    const error = listings.status === 'rejected' || listings.value?.error || interests.status === 'rejected';
    const counts = new Map((interests.status === 'fulfilled' ? interests.value || [] : []).map(row => [row.listing_id, Number(row.active_interest_count) || 0]));
    setSnapshot(previous => ({
      scope,
      listings: listings.status === 'fulfilled' && !listings.value?.error
        ? (listings.value.data || []).filter(row => row.user_id === userId).map(row => ({ ...row, active_interest_count: counts.get(row.id) || 0 }))
        : previous?.scope === scope ? previous.listings : [],
      error: error ? t('errors.load') : '',
    }));
  }, [active, userId, scope, t]);

  useEffect(() => {
    if (!active || !userId) return undefined;
    const stop = subscribeMapRefresh({ host: window, document, refresh: load, interval: 60000 });
    return () => { stop(); requestId.current += 1; };
  }, [active, userId, load]);

  const offline = window.navigator?.onLine === false;
  return <div className="app-screen min-h-screen pb-28 pt-safe"><main className="app-container px-4 py-5">
    <header className="page-heading"><div className="section-head"><h1 className="font-display text-4xl text-forest">{t('profile.listings')}</h1>{data ? <span className="count-pill">{data.listings.length}</span> : null}</div></header>
    {visible && !data && !offline ? <div className="state-card mt-5" role="status"><span className="spinner" />{t('common.loading')}</div> : null}
    {visible && (data?.error || (!data && offline)) ? <div className="state-card mt-5" role="alert"><strong>{data?.error || t('reliabilityExperience.offline')}</strong><button type="button" className="btn-secondary" onClick={load}>{t('common.retry')}</button></div> : null}
    {data?.listings.length ? <section className="card mt-4 p-5" aria-label={t('profile.listings')}><div className="space-y-4">{data.listings.map(listing => <div key={listing.id} id={`my-listing-${listing.id}`}>
      <article className={`profile-listing ${listing.status === 'active' && listing.active_interest_count > 0 ? 'is-interested' : ''}`}>
        {listing.image_url ? <ListingPhoto src={listing.image_url} alt={listingCategoryLabel(listing, language)} active={active} /> : <span><CategoryIcon category={listing} size={24} /></span>}
        <div className="min-w-0 flex-1"><strong>{listingCategoryLabel(listing, language)}</strong><small>{t('profile.available')}: {listing.available_quantity ?? listing.quantity} · {t(`status.${listing.status}`)}</small>{listing.status === 'active' && listing.active_interest_count > 0 ? <span className="interest-badge" data-interest-count={listing.active_interest_count} title={t('simpleExchange.interestCount', { count: listing.active_interest_count })}>{t('simpleExchange.ownerInterest')} · {listing.active_interest_count}</span> : null}</div>
        <button type="button" className="icon-button" onClick={() => { if (active && scope.capture().isCurrent()) onEditListing?.(listing); }} aria-label={t('profile.editListing')}><Icon name="edit" size={17} /></button>
      </article>
      <ListingStatusManager listing={listing} userId={userId} active={active} onChanged={load} />
    </div>)}</div></section> : data && !data.error ? <div className="state-card mt-5"><Icon name="file" size={28} /><p>{t('profile.noListings')}</p></div> : null}
  </main></div>;
}
