import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyDeals, getMyListingContacts, submitReview } from '../lib/api';
import { supabase } from '../supabaseClient';
import { getAppLanguage } from '../i18n';
import { contactHref } from '../lib/contacts';
import { listingCategoryLabel } from '../lib/categories';
import { createFormTaskScope } from '../lib/formTaskScope';
import { friendlyError } from '../lib/userErrors';
import { showToast } from '../lib/toast';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import Icon from '../components/Icon';
import CategoryIcon from '../components/CategoryIcon';
import ListingPhoto from '../components/ListingPhoto';
import ReportDialog from '../components/ReportDialog';
import ListingContactOutcome from '../components/ListingContactOutcome';
import { subscribeMapRefresh } from '../lib/mapRefresh';
import '../styles/map-simple-exchange.css';

const uniqueBy = (rows, key) => {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if (!row?.[key] || seen.has(row[key])) return false;
    seen.add(row[key]);
    return true;
  });
};

export default function SimpleDeals({ userId, active = true }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const taskScope = useMemo(() => {
    const scope = createFormTaskScope(userId);
    if (!active) scope.dispose();
    return scope;
  }, [userId, active]);
  const [snapshot, setSnapshot] = useState(null);
  const [rating, setRating] = useState(null);
  const [report, setReport] = useState(null);
  const [working, setWorking] = useState(null);
  const loadRequest = useRef(0);
  const actionInFlight = useRef(null);
  const ratingSession = useRef(null);
  const ratingRef = useRef(null);
  const visible = Boolean(active && userId && taskScope.capture().isCurrent());
  const data = visible && snapshot?.scope === taskScope ? snapshot : null;
  const ratingDeal = visible && rating?.scope === taskScope ? rating.deal : null;
  const reportDeal = visible && report?.scope === taskScope ? report.deal : null;
  const saving = working === taskScope;
  const closeRating = () => {
    if (actionInFlight.current?.scope === taskScope) return false;
    ratingSession.current = null;
    setRating(null);
    return true;
  };
  useAppOverlay(Boolean(ratingDeal), closeRating, 'deal-rating');
  const ratingFocus = useDialogFocus({ open: Boolean(ratingDeal), onClose: closeRating, dialogRef: ratingRef });

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
    const request = ++loadRequest.current;
    const isCurrent = () => task.isCurrent() && request === loadRequest.current;
    setSnapshot(previous => ({
      scope: taskScope,
      contacts: previous?.scope === taskScope ? previous.contacts : [],
      legacy: previous?.scope === taskScope ? previous.legacy : [],
      loading: background ? Boolean(previous?.loading) : !previous || previous.scope !== taskScope,
      error: '',
    }));
    const [contacts, legacy] = await Promise.allSettled([getMyListingContacts(), getMyDeals()]);
    if (!isCurrent()) return;
    setSnapshot({
      scope: taskScope,
      contacts: contacts.status === 'fulfilled' ? uniqueBy(contacts.value, 'exchange_id') : [],
      legacy: legacy.status === 'fulfilled' ? uniqueBy(legacy.value, 'transaction_id') : [],
      loading: false,
      error: contacts.status === 'rejected' || legacy.status === 'rejected' ? t('errors.load') : '',
    });
  }, [active, userId, taskScope, t]);

  useEffect(() => {
    if (!active || !userId) return undefined;
    const stop = subscribeMapRefresh({ host: window, document, refresh: load, interval: 60000 });
    window.addEventListener('deals-updated', load);
    return () => {
      loadRequest.current += 1;
      stop();
      window.removeEventListener('deals-updated', load);
    };
  }, [active, userId, load]);

  const outcomeChanged = useCallback(async result => {
    if (!active || !userId || !taskScope.capture().isCurrent()) return;
    if (result?.exchange_id) setSnapshot(previous => previous?.scope === taskScope ? { ...previous, contacts: previous.contacts.map(row => row.exchange_id === result.exchange_id ? result : row) } : previous);
    await load({ background: true });
  }, [active, userId, taskScope, load]);

  const rate = async value => {
    const task = taskScope.capture();
    if (!ratingDeal || rating.session !== ratingSession.current || !task.isCurrent() || actionInFlight.current?.scope === taskScope) return;
    const action = { scope: taskScope };
    actionInFlight.current = action;
    setWorking(taskScope);
    try {
      await task.mutate(() => submitReview(ratingDeal.transaction_id, value), () => supabase.auth.getUser());
      if (!task.isCurrent()) return;
      ratingSession.current = null;
      setRating(null);
      showToast(t('deals.ratingSent'), 'success');
      await load();
    } catch (error) {
      if (task.isCurrent()) showToast(friendlyError(error, t), 'error');
    } finally {
      if (actionInFlight.current === action) actionInFlight.current = null;
      if (task.isCurrent()) setWorking(null);
    }
  };

  const renderCard = (deal, legacy = false) => {
    const contacts = Array.isArray(deal.contacts) && deal.contacts.length ? deal.contacts : deal.contact_value ? [{ messenger_type: deal.messenger_type, contact_value: deal.contact_value }] : [];
    return <article key={`${legacy ? 'legacy' : 'exchange'}-${deal.transaction_id || deal.exchange_id}`} className={`deal-card ${!legacy && deal.interest_active ? 'is-interested' : ''}`}>
      <div className="flex gap-3">
        {deal.image_url ? <ListingPhoto src={deal.image_url} className="deal-thumb" active={active} /> : <span className="deal-thumb deal-thumb-empty"><CategoryIcon category={deal} size={30} /></span>}
        <div className="min-w-0 flex-1"><p className="text-xs font-extrabold uppercase tracking-wider text-sea">{deal.partner_name || t('common.partner')}</p><h2 className="mt-1 text-lg font-extrabold text-forest">{listingCategoryLabel(deal, language)}</h2></div>
      </div>
      {!legacy ? <><p className="mt-3 text-sm font-semibold">{t('simpleExchange.contactWithin24')}</p>{deal.listing_status === 'completed' ? <span className="status-pill status-completed">{t('simpleExchange.completed')}</span> : deal.listing_status && deal.listing_status !== 'active' ? <span className="status-pill">{t('simpleExchange.inactive')}</span> : deal.interest_active ? <span className="interest-badge" title={t('simpleExchange.interestCount', { count: deal.active_interest_count })}>{t('simpleExchange.interestStatus')} · {deal.active_interest_count}</span> : null}</> : null}
      <div className="contact-card mt-4"><span className="icon-tile"><Icon name="message" size={19} /></span><div className="min-w-0"><small>{t('deals.contact')}</small>{contacts.length ? <div className="contact-links">{contacts.map((contact, index) => {
        const href = contactHref(contact);
        const label = `${contact.messenger_type?.toUpperCase() || ''} · ${contact.contact_value}`;
        return href ? <a key={`${contact.messenger_type}-${index}`} href={href} target="_blank" rel="noreferrer">{label}</a> : <span key={`${contact.messenger_type}-${index}`}>{label}</span>;
      })}</div> : <p>{t('deals.contactMissing')}</p>}</div></div>
      {!legacy ? <ListingContactOutcome exchange={deal} userId={userId} active={active} onChanged={outcomeChanged} /> : null}
      {legacy && (deal.completed_at || deal.status === 'completed') && !deal.my_review_rating ? <button type="button" className="btn-secondary mt-4 w-full text-sm" onClick={() => { if (taskScope.capture().isCurrent()) { const session = {}; ratingSession.current = session; setRating({ scope: taskScope, session, deal }); } }}><Icon name="star" size={17} />{t('deals.rate')}</button> : null}
      {legacy && deal.my_review_rating ? <div className="mt-4 flex items-center gap-1 text-amber-500" aria-label={`${deal.my_review_rating}/5`}>{[1, 2, 3, 4, 5].map(value => <Icon key={value} name="star" size={17} filled={value <= deal.my_review_rating} />)}</div> : null}
      {legacy ? <button type="button" className="btn-link mt-4 text-xs" onClick={() => { if (taskScope.capture().isCurrent()) setReport({ scope: taskScope, deal }); }}><Icon name="flag" size={15} />{t('workflow.report')}</button> : null}
    </article>;
  };

  return <div className="app-screen min-h-screen pb-28 pt-safe"><main className="app-container px-4 py-5">
    <header className="page-heading"><p className="eyebrow text-sea"><Icon name="waves" size={14} />{t('deals.eyebrow')}</p><h1 className="font-display mt-1 text-4xl text-forest">{t('deals.title')}</h1><p className="mt-3 text-sm leading-6 text-muted">{t('simpleExchange.intro')}</p></header>
    {visible && (!data || data.loading) ? <div className="state-card mt-5"><span className="spinner" />{t('common.loading')}</div> : null}
    {data?.error ? <div className="state-card mt-5" role="alert"><strong>{data.error}</strong><button type="button" className="btn-secondary" onClick={load}>{t('common.retry')}</button></div> : null}
    {data && !data.loading && !data.error && !data.contacts.length && !data.legacy.length ? <div className="empty-panel mt-5"><Icon name="message" size={30} /><p>{t('simpleExchange.empty')}</p></div> : null}
    <div className="mt-5 space-y-4">{data?.contacts.map(deal => renderCard(deal))}</div>
    {data?.legacy.length ? <section className="mt-5 space-y-4" aria-label={t('simpleExchange.legacyHistory')}><h2 className="font-display text-2xl text-forest">{t('simpleExchange.legacyHistory')}</h2>{data.legacy.map(deal => renderCard(deal, true))}</section> : null}
  </main>
    {ratingDeal ? <div className="modal-backdrop grid place-items-end sm:place-items-center"><section ref={ratingRef} {...ratingFocus} className="rating-dialog" aria-label={t('deals.rate')}><button type="button" className="icon-button ml-auto" disabled={saving} onClick={closeRating} aria-label={t('common.close')}><Icon name="close" size={18} /></button><h2 className="font-display mt-2 text-center text-2xl text-forest">{t('deals.rate')}</h2><p className="mt-2 text-center text-sm text-muted">{ratingDeal.partner_name || t('common.partner')}</p><div className="mt-5 flex justify-center gap-2">{[1, 2, 3, 4, 5].map(value => <button key={value} type="button" className="rating-star" disabled={saving} onClick={() => rate(value)} aria-label={`${value}/5`}><Icon name="star" size={30} filled /></button>)}</div></section></div> : null}
    {reportDeal ? <ReportDialog key={`${userId}-${reportDeal.transaction_id}`} active={active} targetKind="deal" targetId={reportDeal.transaction_id} label={reportDeal.partner_name || t('common.partner')} onClose={() => { if (taskScope.capture().isCurrent()) setReport(null); }} /> : null}
  </div>;
}
