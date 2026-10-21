import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { acceptDeal, cancelBooking, confirmHandover, confirmLoanHandover, confirmLoanReturn, getMyDeals, submitReview } from '../lib/api';
import { supabase } from '../supabaseClient';
import { listingCategoryLabel } from '../lib/categories';
import { getAppLanguage } from '../i18n';
import { contactHref } from '../lib/contacts';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';
import CategoryIcon from '../components/CategoryIcon';
import emptyListings from '../assets/visuals/v1/empty-listings-v1.webp';
import completedHandover from '../assets/visuals/v1/deal-complete-v1.webp';
import DeadlineCountdown from '../components/DeadlineCountdown';
import ReportDialog from '../components/ReportDialog';
import AppointmentCard from '../components/AppointmentCard';
import { loanPhase } from '../lib/lending';
import { appointmentForDeal, isAwaitingHandover, isOpenAppointment } from '../lib/appointments';
import { nextDealStep } from '../lib/dealNextStep';
import { friendlyError } from '../lib/userErrors';
import { markInstallMilestone } from '../lib/installExperience';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import ListingPhoto from '../components/ListingPhoto';
import { createFormTaskScope } from '../lib/formTaskScope';

const statusIcons = {
  pending: 'clock',
  reserved: 'calendar',
  confirming: 'handshake',
  completed: 'check',
  canceled: 'close',
  expired: 'history',
  handed_over: 'handover',
  return_due: 'clock',
  returned: 'check',
};

export default function MyDeals({ active = true, userId }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const [deals, setDeals] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [role, setRole] = useState('giver');
  const [view, setView] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState(null);
  const [ratingDeal, setRatingDeal] = useState(null);
  const [reportDeal, setReportDeal] = useState(null);
  const didChooseInitialRole = useRef(false);
  const actionInFlight = useRef(false);
  const loadRequest = useRef(0);
  const taskScope = useMemo(() => createFormTaskScope(userId), [userId]);
  const ratingRef = useRef(null);
  const [appointmentError, setAppointmentError] = useState(false);
  const closeRating = () => { if (actionInFlight.current) return false; setRatingDeal(null); return true; };
  useAppOverlay(active && Boolean(ratingDeal), closeRating, 'deal-rating');
  const ratingFocus = useDialogFocus({open:active && Boolean(ratingDeal),onClose:closeRating,dialogRef:ratingRef});

  useEffect(() => {
    taskScope.activate();
    const subscription = supabase.auth?.onAuthStateChange?.((_event, session) => { if (session?.user?.id !== userId) taskScope.dispose(); })?.data?.subscription;
    return () => { taskScope.dispose(); subscription?.unsubscribe(); };
  }, [taskScope, userId]);

  const loadDeals = useCallback(async () => {
    const task = taskScope.capture();
    if (!task.isCurrent()) return;
    const request = ++loadRequest.current;
    const isCurrent = () => task.isCurrent() && request === loadRequest.current;
    setLoading(true); setError('');
    try {
      const nextDeals = await getMyDeals() || [];
      if (!isCurrent()) return;
      const appointmentResult = await supabase.from('handover_appointments').select('*').order('scheduled_for', { ascending: true });
      if (!isCurrent()) return;
      setDeals(nextDeals);
      setAppointmentError(Boolean(appointmentResult.error));
      if (!appointmentResult.error) setAppointments(appointmentResult.data || []);
      if (!didChooseInitialRole.current) {
        const hasGiverDeals = nextDeals.some((deal) => deal.role === 'giver');
        const hasTakerDeals = nextDeals.some((deal) => deal.role === 'taker');
        if (!hasGiverDeals && hasTakerDeals) setRole('taker');
        didChooseInitialRole.current = true;
      }
    }
    catch (loadError) { if (isCurrent()) setError(friendlyError(loadError, t)); }
    finally { if (isCurrent()) setLoading(false); }
  }, [t, taskScope]);

  useEffect(() => {
    const initialLoad = window.setTimeout(loadDeals, 0);
    const refresh = () => loadDeals();
    window.addEventListener('deals-updated', refresh);
    return () => {
      loadRequest.current += 1;
      window.clearTimeout(initialLoad);
      window.removeEventListener('deals-updated', refresh);
    };
  }, [loadDeals]);

  const shownDeals = useMemo(() => deals.filter((deal) => {
    const matchesRole = deal.role === role;
    const isHistory = Boolean(deal.completed_at || deal.canceled_at || ['completed','canceled','expired'].includes(deal.status));
    return matchesRole && (view === 'history' ? isHistory : !isHistory);
  }), [deals, role, view]);

  const runAction = async (deal, action) => {
    const task = taskScope.capture();
    if (actionInFlight.current || !task.isCurrent()) return;
    if (action === 'cancel' && !window.confirm(t('deals.cancelConfirm'))) return;
    actionInFlight.current = true;
    setWorkingId(deal.transaction_id);
    try {
      if (action === 'cancel') { await cancelBooking(deal.transaction_id); if (!task.isCurrent()) return; showToast(t('deals.canceled'), 'success', { prominent: true }); }
      else if (action === 'accept') { await acceptDeal(deal.transaction_id); if (!task.isCurrent()) return; showToast(t('deals.accepted'), 'success', { prominent: true }); }
      else if (action === 'loan-handover') {
        const result = await confirmLoanHandover(deal.transaction_id);
        if (!task.isCurrent()) return;
        showToast(t(result?.handed_over ? 'lending.handedOver' : 'lending.waitingHandover'), 'success', { prominent: true });
      }
      else if (action === 'loan-return') {
        const result = await confirmLoanReturn(deal.transaction_id);
        if (!task.isCurrent()) return;
        showToast(t(result?.returned ? 'lending.returned' : 'lending.waitingReturn'), 'success', { prominent: true });
      }
      else {
        const result = await confirmHandover(deal.transaction_id);
        if (!task.isCurrent()) return;
        showToast(t(result?.completed ? 'deals.completed' : 'deals.confirmedWaiting'), 'success', { prominent: true });
      }
      markInstallMilestone('transaction');
      await loadDeals();
      if (!task.isCurrent()) return;
      window.dispatchEvent(new Event('listings-updated'));
      window.dispatchEvent(new Event('profile-updated'));
    } catch (actionError) { if (task.isCurrent()) showToast(friendlyError(actionError, t), 'error'); }
    finally { actionInFlight.current = false; if (task.isCurrent()) setWorkingId(null); }
  };

  const rate = async (value) => {
    const task = taskScope.capture();
    if (actionInFlight.current || !ratingDeal || !task.isCurrent()) return;
    actionInFlight.current = true;
    setWorkingId(ratingDeal.transaction_id);
    try {
      await submitReview(ratingDeal.transaction_id, value);
      if (!task.isCurrent()) return;
      showToast(t('deals.ratingSent'), 'success');
      setRatingDeal(null); await loadDeals();
    } catch (ratingError) { if (task.isCurrent()) showToast(friendlyError(ratingError, t), 'error'); }
    finally { actionInFlight.current = false; if (task.isCurrent()) setWorkingId(null); }
  };

  const statusOf = (deal) => loanPhase(deal) || (deal.canceled_at ? 'canceled' : deal.completed_at ? 'completed' : deal.status || 'reserved');
  const contactsOf = (deal) => Array.isArray(deal.contacts) && deal.contacts.length ? deal.contacts : deal.contact_value ? [{ messenger_type: deal.messenger_type, contact_value: deal.contact_value, contact_href: deal.contact_href }] : [];
  const hasConfirmed = (deal) => deal.role === 'giver' ? Boolean(deal.giver_confirmed_at) : Boolean(deal.taker_confirmed_at);

  return (
    <div className="app-screen min-h-screen pb-28 pt-safe">
      <main className="app-container px-4 py-5">
        <header className="page-heading"><p className="eyebrow text-sea"><Icon name="waves" size={14} />{t('deals.eyebrow')}</p><h1 className="font-display mt-1 text-4xl text-forest">{t('deals.title')}</h1></header>
        <div className="segmented mt-5">{[['giver', 'deals.giving', 'gift'], ['taker', 'deals.taking', 'search']].map(([value, label, icon]) => <button key={value} type="button" className={role === value ? 'active' : ''} onClick={() => setRole(value)}><Icon name={icon} size={17} />{t(label)}</button>)}</div>
        <div className="subtabs mt-3">{[['active', 'deals.active', 'activity'], ['history', 'deals.history', 'history']].map(([value, label, icon]) => <button key={value} type="button" className={view === value ? 'active' : ''} onClick={() => setView(value)}><Icon name={icon} size={14} />{t(label)}</button>)}</div>

        {loading ? <div className="state-card mt-5"><span className="spinner" />{t('common.loading')}</div> : null}
        {error ? <div className="state-card mt-5"><Icon name="close" size={26} /><strong>{t('errors.load')}</strong><button type="button" className="btn-secondary" onClick={loadDeals}>{t('common.retry')}</button></div> : null}
        {!loading && !error && shownDeals.length === 0 ? <div className="empty-panel mt-5"><img className="state-illustration" src={emptyListings} alt="" /><h2 className="font-display text-2xl text-forest">{t('deals.emptyTitle')}</h2><p className="text-sm leading-6 text-muted">{t('deals.emptyText')}</p></div> : null}

        <div className="mt-5 space-y-4">
          {shownDeals.map((deal) => {
            const status = statusOf(deal);
            const working = Boolean(workingId);
            const partnerContacts = contactsOf(deal);
            const isLoan = deal.listing_type === 'lend';
            const loanState = loanPhase(deal);
            const appointment = appointmentForDeal(appointments, deal.transaction_id);
            const nextStep = nextDealStep(deal, appointmentError ? undefined : appointment || null);
            const returnConfirmed = deal.role === 'giver' ? Boolean(deal.lender_return_confirmed_at) : Boolean(deal.borrower_return_confirmed_at);
            return <article key={deal.transaction_id} className={`deal-card deal-card-${status}`}>
              <div className="flex gap-3">
                {deal.image_url ? <ListingPhoto src={deal.image_url} className="deal-thumb" active={active} /> : <span className="deal-thumb deal-thumb-empty"><CategoryIcon category={deal} size={30} /></span>}
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-extrabold uppercase tracking-wider text-sea">{deal.partner_name || t('common.partner')}</p><h2 className="mt-1 truncate text-lg font-extrabold text-forest">{listingCategoryLabel(deal, language)}</h2></div><span className={`status-pill status-${status}`}><Icon name={statusIcons[status] || 'clock'} size={12} />{t(`status.${status}`)}</span></div><p className="mt-2 flex items-center gap-1 text-xs font-semibold text-muted"><Icon name="box" size={13} />{t('common.pieces', { count: deal.quantity })}<span aria-hidden="true">·</span><Icon name="calendar" size={13} />{new Date(deal.created_at).toLocaleDateString(language === 'me' ? 'sr-ME' : language)}</p></div>
              </div>

              <section className="deal-next-step"><strong>{t(`reliabilityExperience.next.${nextStep}.title`)}</strong><p>{t(`reliabilityExperience.next.${nextStep}.body`)}</p>{nextStep === 'checkMeeting' ? <button type="button" className="btn-secondary" onClick={loadDeals}>{t('common.retry')}</button> : null}</section>
              {!deal.canceled_at ? <div className="contact-card mt-4"><span className="icon-tile"><Icon name="message" size={19} /></span><div className="min-w-0"><small>{t('deals.contact')}</small>{partnerContacts.length ? <div className="contact-links">{partnerContacts.map((contact) => contactHref(contact) ? <a key={`${contact.messenger_type}-${contact.contact_value}`} href={contactHref(contact)} target="_blank" rel="noreferrer">{contact.messenger_type?.toUpperCase()} · {contact.contact_value}</a> : <span key={`${contact.messenger_type}-${contact.contact_value}`}>{contact.contact_value}</span>)}</div> : <p>{t('deals.contactMissing')}</p>}</div></div> : null}

              {deal.expires_at && isAwaitingHandover(deal) ? <><p className="deal-deadline-label">{t(deal.accepted_at ? 'dealExperience.reservationDeadline' : 'dealExperience.responseDeadline')}</p><DeadlineCountdown startedAt={deal.accepted_at || deal.created_at} expiresAt={deal.expires_at} /><details className="deal-help"><summary>{t('dealExperience.helpTitle')}</summary><p>{t(deal.accepted_at ? 'dealExperience.reservedHelp' : 'dealExperience.pendingHelp')}</p><p>{t('dealExperience.limits')}</p>{isLoan ? <p>{t('dealExperience.loanLimits')}</p> : null}</details></> : null}

              {!deal.canceled_at ? <ol className="deal-flow" aria-label={t('deals.flowLabel')}><li className="done"><span><Icon name="message" size={12} /></span>{t('deals.flowRequested')}</li><li className={deal.accepted_at ? 'done reserved' : ''}><span><Icon name="clock" size={12} /></span>{t('deals.flowAccepted')}</li><li className={deal.handed_over_at || (!isLoan && deal.completed_at) ? 'done completed' : ''}><span><Icon name="handshake" size={12} /></span>{t('deals.flowHandover')}</li>{isLoan ? <li className={deal.returned_at ? 'done completed' : ''}><span><Icon name="history" size={12} /></span>{t('lending.return')}</li> : null}</ol> : null}
              {isLoan && deal.return_due_at ? <p className="mt-3 text-sm font-semibold text-muted"><Icon name="calendar" size={15} /> {t('lending.returnDue')}: {new Date(deal.return_due_at).toLocaleString(language === 'me' ? 'sr-ME' : language)}</p> : null}
              {!appointmentError && nextStep !== 'expired' ? <AppointmentCard key={`${appointment?.id || 'new'}:${appointment?.scheduled_for || ''}:${isOpenAppointment(appointment) ? 'open' : 'closed'}`} deal={deal} appointment={appointment} onChanged={loadDeals} /> : null}

              {!deal.completed_at && !deal.canceled_at && nextStep !== 'expired' ? <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {!deal.accepted_at && deal.is_listing_owner ? <button type="button" className="btn-primary w-full text-sm" disabled={working} onClick={() => runAction(deal, 'accept')}><Icon name="check" size={17} />{working ? t('deals.accepting') : t('deals.accept')}</button> : null}
                {deal.accepted_at && !isLoan ? <button type="button" className="btn-primary w-full text-sm" disabled={working || hasConfirmed(deal)} onClick={() => runAction(deal, 'confirm')}><Icon name="check" size={17} />{working ? t('deals.completing') : hasConfirmed(deal) ? t('deals.confirmed') : t('deals.complete')}</button> : null}
                {isLoan && deal.accepted_at && !deal.handed_over_at ? <button type="button" className="btn-primary w-full text-sm" disabled={working || hasConfirmed(deal)} onClick={() => runAction(deal, 'loan-handover')}><Icon name="handover" size={17} />{hasConfirmed(deal) ? t('lending.confirmed') : t('lending.confirmHandover')}</button> : null}
                {isLoan && deal.handed_over_at && !deal.returned_at ? <button type="button" className="btn-primary w-full text-sm" disabled={working || returnConfirmed} onClick={() => runAction(deal, 'loan-return')}><Icon name="history" size={17} />{returnConfirmed ? t('lending.confirmed') : t('lending.confirmReturn')}</button> : null}
                {!(isLoan && ['handed_over', 'return_due'].includes(loanState)) ? <button type="button" className="btn-ghost w-full text-sm" disabled={working} onClick={() => runAction(deal, 'cancel')}><Icon name="close" size={17} />{working ? t('deals.canceling') : t('deals.cancel')}</button> : null}
              </div> : null}
              {deal.completed_at && !deal.my_review_rating ? <button type="button" className="btn-secondary mt-4 w-full text-sm" onClick={() => setRatingDeal(deal)}><Icon name="star" size={17} />{t('deals.rate')}</button> : null}
              {deal.my_review_rating ? <div className="mt-4 flex items-center gap-1 text-amber-500">{[1, 2, 3, 4, 5].map((value) => <Icon key={value} name="star" size={17} filled={value <= deal.my_review_rating} />)}</div> : null}
              <button type="button" className="btn-link mt-4 text-xs" onClick={() => setReportDeal(deal)}><Icon name="flag" size={15} />{t('workflow.report')}</button>
            </article>;
          })}
        </div>
      </main>

      {ratingDeal ? <div className="modal-backdrop grid place-items-end sm:place-items-center"><section ref={ratingRef} {...ratingFocus} className="rating-dialog" aria-label={t('deals.rate')}><button type="button" className="icon-button ml-auto" disabled={Boolean(workingId)} onClick={closeRating} aria-label={t('common.close')}><Icon name="close" size={18} /></button><img className="rating-illustration" src={completedHandover} alt="" /><h2 className="font-display mt-2 text-center text-2xl text-forest">{t('deals.rate')}</h2><p className="mt-2 text-center text-sm text-muted">{ratingDeal.partner_name || t('common.partner')}</p><div className="mt-5 flex justify-center gap-2">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" className="rating-star" disabled={workingId === ratingDeal.transaction_id} onClick={() => rate(value)} aria-label={`${value}/5`}><Icon name="star" size={30} filled /></button>)}</div></section></div> : null}
      {reportDeal ? <ReportDialog active={active} targetKind="deal" targetId={reportDeal.transaction_id} label={reportDeal.partner_name || t('common.partner')} onClose={() => setReportDeal(null)} /> : null}
    </div>
  );
}
