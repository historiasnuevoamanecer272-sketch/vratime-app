import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteSavedSearch, getMyDiscoveryFeed, markInboxItemRead } from '../lib/api';
import { showToast } from '../lib/toast';
import Icon from './Icon';
import PushPreferences from './PushPreferences';

export default function DiscoveryInbox({ userId }) {
  const { t } = useTranslation();
  const [feed, setFeed] = useState({ saved_searches: [], favourites: [], matches: [], inbox: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [working, setWorking] = useState('');
  const load = useCallback(async () => {
    if (!userId) return setLoading(false);
    setLoading(true);
    setError(false);
    try { setFeed(await getMyDiscoveryFeed() || {}); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(load, 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  const markRead = async (item) => {
    if (item.read_at) return;
    try {
      await markInboxItemRead(item.id);
      setFeed((current) => ({ ...current, inbox: (current.inbox || []).map((entry) => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry) }));
    } catch { showToast(t('errors.save'), 'error'); }
  };

  const removeSearch = async (search) => {
    if (!window.confirm(t('discovery.removeSearchConfirm', { query: search.query }))) return;
    setWorking(search.id);
    try {
      await deleteSavedSearch(search.id, userId);
      setFeed((current) => ({ ...current, saved_searches: (current.saved_searches || []).filter((entry) => entry.id !== search.id), matches: (current.matches || []).filter((entry) => entry.saved_search_id !== search.id) }));
      showToast(t('discovery.searchRemoved'), 'success');
    } catch { showToast(t('errors.save'), 'error'); }
    finally { setWorking(''); }
  };

  return <section className="card discovery-inbox mt-4 p-5">
    <div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('discovery.inbox')}</h2></div><Icon name="bell" size={23} /></div>
    {loading ? <p className="empty-copy mt-4">{t('common.loading')}</p> : error ? <div className="state-card mt-4"><strong>{t('errors.load')}</strong><button type="button" className="btn-secondary" onClick={load}>{t('common.retry')}</button></div> : <>
      <div className="discovery-summary mt-4"><span><Icon name="bookmark" size={16} />{t('discovery.savedCount', { count: feed.saved_searches?.length || 0 })}</span><span><Icon name="heart" size={16} />{t('discovery.favouriteCount', { count: feed.favourites?.length || 0 })}</span><span><Icon name="search" size={16} />{t('discovery.matchCount', { count: feed.matches?.length || 0 })}</span></div>
      {(feed.saved_searches || []).length ? <div className="mt-4"><h3 className="font-bold text-forest">{t('discovery.savedSearches')}</h3><ul className="mt-2 space-y-2">{feed.saved_searches.map((search) => <li key={search.id} className="flex items-center justify-between gap-3"><span className="min-w-0 break-words text-sm">{search.query}</span><button type="button" className="icon-button danger" disabled={working === search.id} onClick={() => removeSearch(search)} aria-label={t('discovery.removeSearch', { query: search.query })}><Icon name="close" size={17} /></button></li>)}</ul></div> : null}
      {(feed.inbox || []).length ? <div className="discovery-messages mt-4">{feed.inbox.map((item) => <button key={item.id} type="button" className={item.read_at ? 'is-read' : 'is-unread'} onClick={() => markRead(item)}><span><strong>{item.title}</strong>{item.body ? <small>{item.body}</small> : null}</span>{item.read_at ? <Icon name="check" size={17} /> : <span className="unread-dot" aria-label={t('discovery.unread')} />}</button>)}</div> : <p className="empty-copy mt-4">{t('discovery.emptyInbox')}</p>}
    </>}
    <PushPreferences userId={userId} />
  </section>;
}
