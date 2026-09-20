import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { acceptDeal, cancelBooking, confirmHandover, getMyDeals, submitReview } from '../lib/api';
import { listingCategoryLabel } from '../lib/categories';
import { getAppLanguage } from '../i18n';
import { contactHref } from '../lib/contacts';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';
import CategoryIcon from '../components/CategoryIcon';
import emptyListings from '../assets/visuals/v1/empty-listings-v1.webp';
import completedHandover from '../assets/visuals/v1/deal-complete-v1.webp';

export default function MyDeals() {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const [deals, setDeals] = useState([]);
  const [role, setRole] = useState('giver');
  const [view, setView] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState(null);
  const [ratingDeal, setRatingDeal] = useState(null);
  const didChooseInitialRole = useRef(false);

  const loadDeals = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const nextDeals = await getMyDeals() || [];
      setDeals(nextDeals);
      if (!didChooseInitialRole.current) {
        const hasGiverDeals = nextDeals.some((deal) => deal.role === 'giver');
        const hasTakerDeals = nextDeals.some((deal) => deal.role === 'taker');
        if (!hasGiverDeals && hasTakerDeals) setRole('taker');
        didChooseInitialRole.current = true;
      }
    }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(loadDeals, 0);
    const refresh = () => loadDeals();
    window.addEventListener('deals-updated', refresh);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener('deals-updated', refresh);
    };
  }, [loadDeals]);

  const shownDeals = useMemo(() => deals.filter((deal) => {
    const matchesRole = deal.role === role;
    const isHistory = Boolean(deal.completed_at || deal.canceled_at || deal.status === 'completed' || deal.status === 'canceled');
    return matchesRole && (view === 'history' ? isHistory : !isHistory);
  }), [deals, role, view]);

  const runAction = async (deal, action) => {
    if (action === 'cancel' && !window.confirm(t('deals.cancelConfirm'))) return;
    setWorkingId(deal.transaction_id);
    try {
      if (action === 'cancel') { await cancelBooking(deal.transaction_id); showToast(t('deals.canceled'), 'success'); }
      else if (action === 'accept') { await acceptDeal(deal.transaction_id); showToast(t('deals.accepted'), 'success'); }
      else {
        const result = await confirmHandover(deal.transaction_id);
        showToast(t(result?.completed ? 'deals.completed' : 'deals.confirmedWaiting'), 'success');
      }
      await loadDeals();
      window.dispatchEvent(new Event('listings-updated'));
      window.dispatchEvent(new Event('profile-updated'));
    } catch (actionError) { showToast(actionError.message || t('errors.save'), 'error'); }
    finally { setWorkingId(null); }
  };

  const rate = async (value) => {
    setWorkingId(ratingDeal.transaction_id);
    try {
      await submitReview(ratingDeal.transaction_id, value);
      showToast(t('deals.ratingSent'), 'success');
      setRatingDeal(null); await loadDeals();
    } catch (ratingError) { showToast(ratingError.message || t('errors.save'), 'error'); }
    finally { setWorkingId(null); }
  };

  const statusOf = (deal) => deal.canceled_at ? 'canceled' : deal.completed_at ? 'completed' : deal.status || 'reserved';
  const contactsOf = (deal) => Array.isArray(deal.contacts) && deal.contacts.length ? deal.contacts : deal.contact_value ? [{ messenger_type: deal.messenger_type, contact_value: deal.contact_value, contact_href: deal.contact_href }] : [];
  const hasConfirmed = (deal) => deal.role === 'giver' ? Boolean(deal.giver_confirmed_at) : Boolean(deal.taker_confirmed_at);
  const deadlineText = (deal) => deal.expires_at ? new Intl.DateTimeFormat(language === 'me' ? 'sr-Latn-ME' : language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(deal.expires_at)) : '';

  return (
    <div className="app-screen min-h-screen pb-28 pt-safe">
      <main className="app-container px-4 py-5">
        <header className="page-heading"><p className="eyebrow text-sea">{t('deals.eyebrow')}</p><h1 className="font-display mt-1 text-4xl text-forest">{t('deals.title')}</h1></header>
        <div className="segmented mt-5">{[['giver', 'deals.giving', 'gift'], ['taker', 'deals.taking', 'truck']].map(([value, label, icon]) => <button key={value} type="button" className={role === value ? 'active' : ''} onClick={() => setRole(value)}><Icon name={icon} size={17} />{t(label)}</button>)}</div>
        <div className="subtabs mt-3">{[['active', 'deals.active'], ['history', 'deals.history']].map(([value, label]) => <button key={value} type="button" className={view === value ? 'active' : ''} onClick={() => setView(value)}>{t(label)}</button>)}</div>

        {loading ? <div className="state-card mt-5"><span className="spinner" />{t('common.loading')}</div> : null}
        {error ? <div className="state-card mt-5"><Icon name="close" size={26} /><strong>{t('errors.load')}</strong><button type="button" className="btn-secondary" onClick={loadDeals}>{t('common.retry')}</button></div> : null}
        {!loading && !error && shownDeals.length === 0 ? <div className="empty-panel mt-5"><img className="state-illustration" src={emptyListings} alt="" /><h2 className="font-display text-2xl text-forest">{t('deals.emptyTitle')}</h2><p className="text-sm leading-6 text-muted">{t('deals.emptyText')}</p></div> : null}

        <div className="mt-5 space-y-4">
          {shownDeals.map((deal) => {
            const status = statusOf(deal);
            const working = workingId === deal.transaction_id;
            const partnerContacts = contactsOf(deal);
            return <article key={deal.transaction_id} className="deal-card">
              <div className="flex gap-3">
                {deal.image_url ? <img src={deal.image_url} alt="" className="deal-thumb" /> : <span className="deal-thumb deal-thumb-empty"><CategoryIcon category={deal} size={30} /></span>}
                <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-extrabold uppercase tracking-wider text-sea">{deal.partner_name || t('common.partner')}</p><h2 className="mt-1 truncate text-lg font-extrabold text-forest">{listingCategoryLabel(deal, language)}</h2></div><span className={`status-pill status-${status}`}>{t(`status.${status}`)}</span></div><p className="mt-2 text-xs font-semibold text-muted">{t('common.pieces', { count: deal.quantity })} · {new Date(deal.created_at).toLocaleDateString(language === 'me' ? 'sr-ME' : language)}</p></div>
              </div>

              {!deal.canceled_at ? <div className="contact-card mt-4"><span className="icon-tile"><Icon name="message" size={19} /></span><div className="min-w-0"><small>{t('deals.contact')}</small>{partnerContacts.length ? <div className="contact-links">{partnerContacts.map((contact) => <a key={`${contact.messenger_type}-${contact.contact_value}`} href={contactHref(contact) || contact.contact_href} target="_blank" rel="noreferrer">{contact.messenger_type?.toUpperCase()} · {contact.contact_value}</a>)}</div> : <p>{t(deal.accepted_at ? 'deals.contactMissing' : 'deals.contactPending')}</p>}</div></div> : null}

              {deal.accepted_at && !deal.completed_at && !deal.canceled_at ? <p className="deal-deadline"><Icon name="clock" size={16} />{t('deals.deadline', { date: deadlineText(deal) })}</p> : null}

              {!deal.canceled_at ? <ol className="deal-flow" aria-label={t('deals.flowLabel')}><li className="done"><span><Icon name="check" size={12} /></span>{t('deals.flowRequested')}</li><li className={deal.accepted_at ? 'done' : ''}><span>{deal.accepted_at ? <Icon name="check" size={12} /> : 2}</span>{t('deals.flowAccepted')}</li><li className={deal.completed_at ? 'done' : ''}><span>{deal.completed_at ? <Icon name="check" size={12} /> : 3}</span>{t('deals.flowHandover')}</li></ol> : null}

              {!deal.completed_at && !deal.canceled_at ? <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {!deal.accepted_at && deal.is_listing_owner ? <button type="button" className="btn-primary w-full text-sm" disabled={working} onClick={() => runAction(deal, 'accept')}><Icon name="check" size={17} />{working ? t('deals.accepting') : t('deals.accept')}</button> : null}
                {deal.accepted_at ? <button type="button" className="btn-primary w-full text-sm" disabled={working || hasConfirmed(deal)} onClick={() => runAction(deal, 'confirm')}><Icon name="check" size={17} />{working ? t('deals.completing') : hasConfirmed(deal) ? t('deals.confirmed') : t('deals.complete')}</button> : null}
                <button type="button" className="btn-ghost w-full text-sm" disabled={working} onClick={() => runAction(deal, 'cancel')}><Icon name="close" size={17} />{working ? t('deals.canceling') : t('deals.cancel')}</button>
              </div> : null}
              {deal.completed_at && !deal.my_review_rating ? <button type="button" className="btn-secondary mt-4 w-full text-sm" onClick={() => setRatingDeal(deal)}><Icon name="star" size={17} />{t('deals.rate')}</button> : null}
              {deal.my_review_rating ? <div className="mt-4 flex items-center gap-1 text-amber-500">{[1, 2, 3, 4, 5].map((value) => <Icon key={value} name="star" size={17} filled={value <= deal.my_review_rating} />)}</div> : null}
            </article>;
          })}
        </div>
      </main>

      {ratingDeal ? <div className="modal-backdrop grid place-items-end sm:place-items-center"><section className="rating-dialog" role="dialog" aria-modal="true" aria-label={t('deals.rate')}><button type="button" className="icon-button ml-auto" onClick={() => setRatingDeal(null)} aria-label={t('common.close')}><Icon name="close" size={18} /></button><img className="rating-illustration" src={completedHandover} alt="" /><h2 className="font-display mt-2 text-center text-2xl text-forest">{t('deals.rate')}</h2><p className="mt-2 text-center text-sm text-muted">{ratingDeal.partner_name || t('common.partner')}</p><div className="mt-5 flex justify-center gap-2">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" className="rating-star" disabled={workingId === ratingDeal.transaction_id} onClick={() => rate(value)} aria-label={`${value}/5`}><Icon name="star" size={30} filled /></button>)}</div></section></div> : null}
    </div>
  );
}
