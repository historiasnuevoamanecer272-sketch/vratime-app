import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyDiscoveryFeed, markInboxItemRead } from '../lib/api';
import Icon from './Icon';

export default function DiscoveryInbox({ userId }) {
  const { t } = useTranslation();
  const [feed, setFeed] = useState({ saved_searches: [], favourites: [], matches: [], inbox: [] });
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!userId) return setLoading(false);
    setLoading(true);
    try { setFeed(await getMyDiscoveryFeed() || {}); } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(load, 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  const markRead = async (item) => {
    if (item.read_at) return;
    await markInboxItemRead(item.id);
    setFeed((current) => ({ ...current, inbox: (current.inbox || []).map((entry) => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry) }));
  };

  return <section className="card discovery-inbox mt-4 p-5">
    <div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('discovery.inbox')}</h2></div><Icon name="bell" size={23} /></div>
    {loading ? <p className="empty-copy mt-4">{t('common.loading')}</p> : <>
      <div className="discovery-summary mt-4"><span><Icon name="bookmark" size={16} />{t('discovery.savedCount', { count: feed.saved_searches?.length || 0 })}</span><span><Icon name="heart" size={16} />{t('discovery.favouriteCount', { count: feed.favourites?.length || 0 })}</span><span><Icon name="search" size={16} />{t('discovery.matchCount', { count: feed.matches?.length || 0 })}</span></div>
      {(feed.inbox || []).length ? <div className="discovery-messages mt-4">{feed.inbox.map((item) => <button key={item.id} type="button" className={item.read_at ? 'is-read' : 'is-unread'} onClick={() => markRead(item)}><span><strong>{item.title}</strong>{item.body ? <small>{item.body}</small> : null}</span>{item.read_at ? <Icon name="check" size={17} /> : <span className="unread-dot" aria-label={t('discovery.unread')} />}</button>)}</div> : <p className="empty-copy mt-4">{t('discovery.emptyInbox')}</p>}
    </>}
  </section>;
}
