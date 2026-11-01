import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteSavedSearch, getMyDiscoveryFeed, markInboxItemRead } from '../lib/api';
import { showToast } from '../lib/toast';
import { supabase } from '../supabaseClient';
import { createFormTaskScope } from '../lib/formTaskScope';
import { subscribeMapRefresh } from '../lib/mapRefresh';
import { contactHref } from '../lib/contacts';
import Icon from './Icon';
import PushPreferences from './PushPreferences';
import ListingStatusManager from './ListingStatusManager';

const emptyFeed = { saved_searches: [], favourites: [], matches: [], inbox: [] };

export default function DiscoveryInbox({ userId, listings = [], onListingChanged, onOpenDeals, active = true }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState(null);
  const [working, setWorking] = useState(null);
  const request = useRef(0);
  const taskScope = useMemo(() => {
    const scope = createFormTaskScope(userId);
    if (!active) scope.dispose();
    return scope;
  }, [userId, active]);
  const visible = Boolean(active && userId && taskScope.capture().isCurrent());
  const current = visible && snapshot?.userId === userId ? snapshot : null;
  const feed = current?.feed || emptyFeed;
  const loading = visible && (!current || current.loading);
  const error = current?.error;
  const workingId = working?.scope === taskScope ? working.id : '';

  useEffect(() => {
    taskScope.activate();
    const subscription = supabase.auth?.onAuthStateChange?.((_event, session) => {
      if (session?.user?.id !== userId) taskScope.dispose();
    })?.data?.subscription;
    return () => { taskScope.dispose(); subscription?.unsubscribe(); };
  }, [taskScope, userId]);

  const load = useCallback(async ({ background = false } = {}) => {
    const task = taskScope.capture();
    if (!active || !userId || !task.isCurrent()) return;
    const revision = ++request.current;
    const isCurrent = () => task.isCurrent() && request.current === revision;
    if (!background) setSnapshot(previous => ({
      userId,
      feed: previous?.userId === userId ? previous.feed : emptyFeed,
      loaded: previous?.userId === userId && previous.loaded,
      loading: previous?.userId !== userId || !previous.loaded,
      error: false,
    }));
    try {
      const nextFeed = await getMyDiscoveryFeed();
      if (isCurrent()) setSnapshot({ userId, feed: nextFeed || emptyFeed, loaded: true, loading: false, error: false });
    } catch {
      if (isCurrent()) setSnapshot(previous => ({
        userId,
        feed: previous?.userId === userId ? previous.feed : emptyFeed,
        loaded: previous?.userId === userId && previous.loaded,
        loading: false,
        error: true,
      }));
    }
  }, [userId, active, taskScope]);

  useEffect(() => {
    if (!active || !userId) return undefined;
    return subscribeMapRefresh({ host: window, document, refresh: load, interval: 60000 });
  }, [active, userId, load]);

  const markRead = async (item) => {
    const task = taskScope.capture();
    if (!visible || item.read_at || !task.isCurrent()) return;
    try {
      await task.mutate(() => markInboxItemRead(item.id));
      if (!task.isCurrent()) return;
      setSnapshot(previous => previous?.userId === userId ? { ...previous, feed: { ...previous.feed, inbox: (previous.feed.inbox || []).map(entry => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry) } } : previous);
    } catch { if (task.isCurrent()) showToast(t('errors.save'), 'error'); }
  };

  const removeSearch = async (search) => {
    const task = taskScope.capture();
    if (!visible || !task.isCurrent()) return;
    if (!window.confirm(t('discovery.removeSearchConfirm', { query: search.query }))) return;
    setWorking({ scope: taskScope, id: search.id });
    try {
      await task.mutate(() => deleteSavedSearch(search.id, userId));
      if (!task.isCurrent()) return;
      setSnapshot(previous => previous?.userId === userId ? { ...previous, feed: { ...previous.feed, saved_searches: (previous.feed.saved_searches || []).filter(entry => entry.id !== search.id), matches: (previous.feed.matches || []).filter(entry => entry.saved_search_id !== search.id) } } : previous);
      showToast(t('discovery.searchRemoved'), 'success');
    } catch { if (task.isCurrent()) showToast(t('errors.save'), 'error'); }
    finally { if (task.isCurrent()) setWorking(null); }
  };

  const listingChanged = async () => {
    const task = taskScope.capture();
    if (!visible || !task.isCurrent()) return;
    await onListingChanged?.();
    if (task.isCurrent()) await load();
  };

  const messageText = (item, field) => {
    if (item.payload?.kind === 'listing_check') return t(`simpleExchange.reminder${field === 'title' ? 'Title' : 'Body'}`, { section: t('nav.deals') });
    if (item.payload?.kind === 'listing_contact') return t(field === 'title' ? 'simpleExchange.contactNoticeTitle' : 'simpleExchange.contactWithin24');
    if (item.payload?.kind === 'listing_contact_outcome_due') return t(`simpleExchange.outcomeDue${field === 'title' ? 'Title' : 'Body'}`);
    return item[field];
  };

  const noticeActions = item => {
    if (!['listing_contact', 'listing_contact_outcome_due'].includes(item.payload?.kind)) return null;
    const contacts = Array.isArray(item.payload.partner_contacts) ? item.payload.partner_contacts.filter(contact => ['tg', 'wa', 'viber'].includes(contact?.messenger_type) && typeof contact.contact_value === 'string' && contact.contact_value.trim()) : [];
    return <div className="mt-3"><div className="contact-links">{contacts.map((contact, index) => {
      const href = contactHref(contact);
      return href ? <a key={index} href={href} target="_blank" rel="noreferrer">{contact.messenger_type.toUpperCase()} · {contact.contact_value}</a> : <span key={index}>{contact.contact_value}</span>;
    })}</div>{onOpenDeals ? <button type="button" className="btn-secondary mt-3" onClick={() => { if (visible && taskScope.capture().isCurrent()) onOpenDeals(); }}>{t('simpleExchange.openContacts')}</button> : null}</div>;
  };

  return <section className="card discovery-inbox mt-4 p-5">
    <div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('discovery.inbox')}</h2></div><Icon name="bell" size={23} /></div>
    {loading ? <p className="empty-copy mt-4">{t('common.loading')}</p> : error ? <div className="state-card mt-4"><strong>{t('errors.load')}</strong><button type="button" className="btn-secondary" onClick={load}>{t('common.retry')}</button></div> : <>
      <div className="discovery-summary mt-4"><span><Icon name="bookmark" size={16} />{t('discovery.savedCount', { count: feed.saved_searches?.length || 0 })}</span><span><Icon name="heart" size={16} />{t('discovery.favouriteCount', { count: feed.favourites?.length || 0 })}</span><span><Icon name="search" size={16} />{t('discovery.matchCount', { count: feed.matches?.length || 0 })}</span></div>
      {(feed.saved_searches || []).length ? <div className="mt-4"><h3 className="font-bold text-forest">{t('discovery.savedSearches')}</h3><ul className="mt-2 space-y-2">{feed.saved_searches.map((search) => <li key={search.id} className="flex items-center justify-between gap-3"><span className="min-w-0 break-words text-sm">{search.query}</span><button type="button" className="icon-button danger" disabled={workingId === search.id} onClick={() => removeSearch(search)} aria-label={t('discovery.removeSearch', { query: search.query })}><Icon name="close" size={17} /></button></li>)}</ul></div> : null}
      {(feed.inbox || []).length ? <div className="discovery-messages mt-4">{feed.inbox.map((item) => <article key={item.id}><button type="button" className={item.read_at ? 'is-read' : 'is-unread'} onClick={() => markRead(item)}><span><strong>{messageText(item, 'title')}</strong>{messageText(item, 'body') ? <small>{messageText(item, 'body')}</small> : null}</span>{item.read_at ? <Icon name="check" size={17} /> : <span className="unread-dot" aria-label={t('discovery.unread')} />}</button>{noticeActions(item)}{item.payload?.kind === 'listing_check' && listings.find((listing) => listing.id === item.payload.listing_id) ? <ListingStatusManager listing={listings.find((listing) => listing.id === item.payload.listing_id)} userId={userId} active={active} onChanged={listingChanged} /> : null}</article>)}</div> : <p className="empty-copy mt-4">{t('discovery.emptyInbox')}</p>}
    </>}
    <PushPreferences userId={userId} />
  </section>;
}
