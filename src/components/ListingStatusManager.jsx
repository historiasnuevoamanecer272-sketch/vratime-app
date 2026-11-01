import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmMyListingCurrent, setMyListingRemaining } from '../lib/api';
import { supabase } from '../supabaseClient';
import { createFormTaskScope } from '../lib/formTaskScope';
import { friendlyError } from '../lib/userErrors';
import { showToast } from '../lib/toast';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import Icon from './Icon';

export default function ListingStatusManager({ listing, userId, active = true, onChanged }) {
  const { t } = useTranslation();
  const eligible = Boolean(active && userId && listing?.id && listing.user_id === userId && listing.status === 'active' && (!listing.moderation_status || listing.moderation_status === 'approved'));
  const taskScope = useMemo(() => {
    const scope = createFormTaskScope(userId);
    if (!eligible || !listing?.id) scope.dispose();
    return scope;
  }, [userId, listing?.id, eligible]);
  const [dialog, setDialog] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [working, setWorking] = useState(null);
  const [clock, setClock] = useState(Date.now);
  const busy = useRef(null);
  const dialogSession = useRef(null);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const currentDialog = eligible && dialog?.scope === taskScope ? dialog : null;
  const saving = working === taskScope;
  const error = feedback?.scope === taskScope ? feedback.message : '';
  const requestClose = () => {
    if (busy.current?.scope === taskScope) return false;
    dialogSession.current = null;
    setDialog(null);
    return true;
  };
  useAppOverlay(Boolean(currentDialog), requestClose, `listing-status-${listing?.id}`);
  const focus = useDialogFocus({ open: Boolean(currentDialog), onClose: requestClose, dialogRef, initialFocusRef: currentDialog?.mode === 'remaining' ? inputRef : undefined });

  useEffect(() => {
    taskScope.activate();
    const subscription = supabase.auth?.onAuthStateChange?.((_event, session) => {
      if (session?.user?.id !== userId) taskScope.dispose();
    })?.data?.subscription;
    return () => { taskScope.dispose(); subscription?.unsubscribe(); };
  }, [taskScope, userId]);

  useEffect(() => {
    if (!eligible) return undefined;
    const task = taskScope.capture();
    const updateClock = () => { if (task.isCurrent()) setClock(Date.now()); };
    const due = Date.parse(listing.owner_check_due_at);
    const timer = Number.isFinite(due) ? window.setTimeout(updateClock, Math.min(Math.max(0, due - Date.now()), 2147483647)) : null;
    window.addEventListener('focus', updateClock);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', updateClock); };
  }, [eligible, listing?.owner_check_due_at, taskScope]);

  const open = mode => {
    if (!eligible || !taskScope.capture().isCurrent() || busy.current?.scope === taskScope) return;
    setFeedback(null);
    const session = {};
    dialogSession.current = session;
    setDialog({ scope: taskScope, session, mode, amount: String(listing.available_quantity ?? listing.quantity ?? 0) });
  };

  const run = async (kind, remaining, reason = null) => {
    const task = taskScope.capture();
    if (!eligible || !task.isCurrent() || busy.current?.scope === taskScope) return;
    const action = { scope: taskScope };
    busy.current = action;
    setWorking(taskScope);
    setFeedback(null);
    try {
      const result = await task.mutate(() => kind === 'current' ? confirmMyListingCurrent(listing.id) : setMyListingRemaining(listing.id, remaining, reason), () => supabase.auth.getUser());
      if (!task.isCurrent()) return;
      dialogSession.current = null;
      setDialog(null);
      await onChanged?.(result);
      if (!task.isCurrent()) return;
      window.dispatchEvent(new Event('listings-updated'));
      window.dispatchEvent(new Event('profile-updated'));
      showToast(t('simpleExchange.saved'), 'success');
    } catch (failure) {
      if (task.isCurrent()) setFeedback({ scope: taskScope, message: friendlyError(failure, t) });
    } finally {
      if (busy.current === action) busy.current = null;
      if (task.isCurrent()) setWorking(null);
    }
  };

  const saveRemaining = () => {
    if (!eligible || !currentDialog || currentDialog.session !== dialogSession.current || !taskScope.capture().isCurrent() || busy.current?.scope === taskScope) return;
    const raw = currentDialog.amount.trim();
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < 0 || value > 10000) {
      setFeedback({ scope: taskScope, message: t('simpleExchange.invalidRemaining') });
      return;
    }
    if (value === 0) {
      setFeedback(null);
      setDialog({ ...currentDialog, mode: 'close' });
      return;
    }
    return run('remaining', value, null);
  };

  const closeWithReason = reason => {
    if (!currentDialog || currentDialog.session !== dialogSession.current) return;
    return run('remaining', 0, reason);
  };

  if (!eligible || !taskScope.capture().isCurrent()) return null;
  const checkDue = listing.owner_check_due_at && Number.isFinite(Date.parse(listing.owner_check_due_at)) && Date.parse(listing.owner_check_due_at) <= clock;
  return <div className="mt-3" aria-label={t('simpleExchange.ownerActions')}>
    {checkDue ? <p className="mb-3 text-sm font-semibold text-forest">{t('simpleExchange.checkDue')}</p> : null}
    <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary text-sm" disabled={saving} onClick={() => run('current')}><Icon name="check" size={16} />{t('simpleExchange.stillCurrent')}</button><button type="button" className="btn-secondary text-sm" disabled={saving} onClick={() => open('remaining')}>{t('simpleExchange.remaining')}</button><button type="button" className="btn-ghost text-sm" disabled={saving} onClick={() => open('close')}>{t('simpleExchange.close')}</button></div>
    {error && !currentDialog ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    {currentDialog ? <div className="modal-backdrop grid place-items-end sm:place-items-center p-0 sm:p-5"><section ref={dialogRef} {...focus} className="report-dialog card" aria-label={t(currentDialog.mode === 'remaining' ? 'simpleExchange.remaining' : 'simpleExchange.closeTitle')}><div className="section-head"><h2 className="font-display text-2xl text-forest">{t(currentDialog.mode === 'remaining' ? 'simpleExchange.remaining' : 'simpleExchange.closeTitle')}</h2><button type="button" className="icon-button" disabled={saving} onClick={requestClose} aria-label={t('common.close')}><Icon name="close" size={18} /></button></div>
      {currentDialog.mode === 'remaining' ? <><label className="mt-4 block"><span className="field-label">{t('simpleExchange.remaining')}</span><input ref={inputRef} type="number" inputMode="numeric" min="0" max="10000" step="1" className="field" value={currentDialog.amount} disabled={saving} onChange={event => { if (busy.current?.scope !== taskScope && currentDialog.session === dialogSession.current && taskScope.capture().isCurrent()) { setDialog({ ...currentDialog, amount: event.target.value }); setFeedback(null); } }} /></label><button type="button" className="btn-primary mt-5 w-full" disabled={saving} onClick={saveRemaining}>{saving ? t('onboarding.saving') : t('simpleExchange.saveRemaining')}</button></> : <><p className="mt-3 text-sm leading-6 text-muted">{t('simpleExchange.closeBody')}</p><div className="mt-5 grid gap-2"><button type="button" className="btn-primary" disabled={saving} onClick={() => closeWithReason('completed')}>{t('simpleExchange.allDone')}</button><button type="button" className="btn-secondary" disabled={saving} onClick={() => closeWithReason('not_relevant')}>{t('simpleExchange.noLongerRelevant')}</button></div></>}
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}<button type="button" className="btn-ghost mt-3 w-full" disabled={saving} onClick={requestClose}>{t('common.cancel')}</button>
    </section></div> : null}
  </div>;
}
