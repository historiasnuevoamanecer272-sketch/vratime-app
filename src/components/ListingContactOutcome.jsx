import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { submitListingContactOutcome } from '../lib/api';
import { supabase } from '../supabaseClient';
import { createFormTaskScope } from '../lib/formTaskScope';
import { friendlyError } from '../lib/userErrors';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import Icon from './Icon';

const reasons = { time: 'outcomeTime', recipient_declined: 'outcomeRecipientDeclined', owner_changed_mind: 'outcomeOwnerChangedMind', other: 'outcomeOther' };

export default function ListingContactOutcome({ exchange, userId, active = true, onChanged }) {
  const { t } = useTranslation();
  const taskScope = useMemo(() => {
    const scope = createFormTaskScope(userId);
    if (!active || !exchange.exchange_id) scope.dispose();
    return scope;
  }, [userId, active, exchange.exchange_id]);
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(null);
  const [submitted, setSubmitted] = useState(null);
  const busy = useRef(null);
  const refreshBusy = useRef(null);
  const dialogSession = useRef(null);
  const dialogRef = useRef(null);
  const current = Boolean(active && userId && exchange?.exchange_id && taskScope.capture().isCurrent());
  const ownResult = exchange.my_outcome || (submitted?.scope === taskScope ? submitted.outcome : null);
  const ownReason = exchange.my_reason || (submitted?.scope === taskScope ? submitted.reason : null);
  const due = Date.parse(exchange.feedback_due_at);
  const canAnswer = current && !ownResult && exchange.feedback_available === true && Number.isFinite(due);
  const currentDialog = canAnswer && dialog?.scope === taskScope ? dialog : null;
  const saving = working === taskScope;
  const errorText = error?.scope === taskScope ? error.message : '';
  const remaining = Number(exchange.remaining_quantity) || 0;
  const close = () => {
    if (busy.current?.scope === taskScope) return false;
    dialogSession.current = null;
    setDialog(null);
    return true;
  };
  useAppOverlay(Boolean(currentDialog), close, `contact-outcome-${exchange.exchange_id}`);
  const focus = useDialogFocus({ open: Boolean(currentDialog), onClose: close, dialogRef });

  useEffect(() => {
    taskScope.activate();
    const subscription = supabase.auth?.onAuthStateChange?.((_event, session) => {
      if (session?.user?.id !== userId) taskScope.dispose();
    })?.data?.subscription;
    return () => { taskScope.dispose(); subscription?.unsubscribe(); };
  }, [taskScope, userId]);

  useEffect(() => {
    if (!active || !userId || ownResult || !Number.isFinite(due)) return undefined;
    const task = taskScope.capture();
    const update = async () => {
      if (!task.isCurrent()) return;
      const now = Date.now();
      if (now < due || exchange.feedback_available || refreshBusy.current?.scope === taskScope) return;
      const refresh = { scope: taskScope };
      refreshBusy.current = refresh;
      try { await onChanged?.(); } catch { /* The parent retains its ordinary retry UI. */ }
      finally { if (refreshBusy.current === refresh) refreshBusy.current = null; }
    };
    const timer = window.setTimeout(update, Math.min(Math.max(0, due - Date.now()), 2147483647));
    window.addEventListener('focus', update);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', update); };
  }, [active, userId, ownResult, due, exchange.feedback_available, onChanged, taskScope]);

  const open = () => {
    if (!canAnswer || !taskScope.capture().isCurrent() || busy.current?.scope === taskScope) return;
    const session = {};
    dialogSession.current = session;
    setError(null);
    setDialog({ scope: taskScope, session, outcome: null, ownerAction: null, amount: String(remaining), reason: '', details: '' });
  };

  const change = patch => {
    if (!currentDialog || currentDialog.session !== dialogSession.current || !taskScope.capture().isCurrent() || busy.current?.scope === taskScope) return;
    setDialog(previous => previous?.session === currentDialog.session ? { ...previous, ...patch } : previous);
    setError(null);
  };

  const submit = async (outcome = currentDialog?.outcome) => {
    const task = taskScope.capture();
    if (!canAnswer || !currentDialog || currentDialog.session !== dialogSession.current || !task.isCurrent() || busy.current?.scope === taskScope) return;
    const payload = { outcome, failureReason: null, details: null, ownerAction: null, remaining: null };
    const invalid = key => setError({ scope: taskScope, message: t(`simpleExchange.${key}`) });
    if (outcome === 'failure') {
      if (!reasons[currentDialog.reason]) { invalid('outcomeReasonRequired'); return; }
      if (currentDialog.details.length > 500) { invalid('outcomeDetailsLong'); return; }
      payload.failureReason = currentDialog.reason;
      payload.details = currentDialog.details.trim() || null;
    } else if (outcome === 'success') {
      if (exchange.is_listing_owner) {
        if (!['complete', 'remaining', 'keep'].includes(currentDialog.ownerAction)) { invalid('outcomeActionRequired'); return; }
        payload.ownerAction = currentDialog.ownerAction;
        if (payload.ownerAction === 'remaining') {
          const raw = currentDialog.amount.trim(), value = Number(raw);
          if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < 1 || value > remaining) { invalid('outcomeInvalidRemaining'); return; }
          payload.remaining = value;
        }
      }
    } else return;
    const action = { scope: taskScope };
    busy.current = action;
    setWorking(taskScope);
    setError(null);
    try {
      const result = await task.mutate(() => submitListingContactOutcome(exchange.exchange_id, payload), () => supabase.auth.getUser());
      if (!task.isCurrent()) return;
      setSubmitted({ scope: taskScope, outcome, reason: payload.failureReason });
      dialogSession.current = null;
      setDialog(null);
      await onChanged?.(result);
      if (!task.isCurrent()) return;
      window.dispatchEvent(new Event('listings-updated'));
      window.dispatchEvent(new Event('profile-updated'));
    } catch (failure) {
      if (task.isCurrent()) setError({ scope: taskScope, message: friendlyError(failure, t) });
    } finally {
      if (busy.current === action) busy.current = null;
      if (task.isCurrent()) setWorking(null);
    }
  };

  const resultLabel = (outcome, reason) => <><span>{t(`simpleExchange.${outcome === 'success' ? 'outcomeSuccess' : 'outcomeFailure'}`)}</span>{outcome === 'failure' && reasons[reason] ? <small> · {t(`simpleExchange.${reasons[reason]}`)}</small> : null}</>;
  if (!current) return null;
  return <section className="contact-outcomes mt-4">
    {ownResult ? <p><strong>{t('simpleExchange.myOutcome')}: </strong>{resultLabel(ownResult, ownReason)}</p> : null}
    {exchange.partner_outcome ? <p><strong>{t('simpleExchange.partnerOutcome')}: </strong>{resultLabel(exchange.partner_outcome, exchange.partner_reason)}</p> : null}
    {canAnswer ? <button type="button" className="btn-secondary mt-3 w-full" disabled={saving} onClick={open}>{t('simpleExchange.outcomeQuestion')}</button> : null}
    {errorText && !currentDialog ? <p role="alert" className="field-error">{errorText}</p> : null}
    {currentDialog ? <div className="modal-backdrop grid place-items-end sm:place-items-center p-0 sm:p-5"><section ref={dialogRef} {...focus} className="report-dialog card" aria-label={t('simpleExchange.outcomeQuestion')}><div className="section-head"><h2 className="font-display text-2xl text-forest">{t('simpleExchange.outcomeQuestion')}</h2><button type="button" className="icon-button" disabled={saving} onClick={close} aria-label={t('common.close')}><Icon name="close" size={18} /></button></div>
      {!currentDialog.outcome ? <div className="mt-5 grid gap-2"><button type="button" className="btn-primary" disabled={saving} onClick={() => exchange.is_listing_owner ? change({ outcome: 'success' }) : submit('success')}>{t('simpleExchange.outcomeSuccess')}</button><button type="button" className="btn-secondary" disabled={saving} onClick={() => change({ outcome: 'failure' })}>{t('simpleExchange.outcomeFailure')}</button></div> : null}
      {currentDialog.outcome === 'success' ? <><p className="mt-3 text-sm text-muted">{t('simpleExchange.outcomeOwnerChoice')}</p><div className="mt-4 grid gap-2">{['complete', 'remaining', 'keep'].map(action => <button key={action} type="button" className={currentDialog.ownerAction === action ? 'btn-primary' : 'btn-secondary'} aria-pressed={currentDialog.ownerAction === action} disabled={saving || (action === 'remaining' && remaining < 1)} onClick={() => change({ ownerAction: action })}>{t(`simpleExchange.outcome${action[0].toUpperCase()}${action.slice(1)}`)}</button>)}</div>{currentDialog.ownerAction === 'remaining' ? <label className="mt-4 block"><span className="field-label">{t('simpleExchange.outcomeRemaining')}</span><input type="number" inputMode="numeric" min="1" max={remaining} step="1" className="field" value={currentDialog.amount} disabled={saving} onChange={event => change({ amount: event.target.value })} /></label> : null}</> : null}
      {currentDialog.outcome === 'failure' ? <><label className="mt-4 block"><span className="field-label">{t('simpleExchange.outcomeReason')}</span><select className="field" required disabled={saving} value={currentDialog.reason} onChange={event => change({ reason: event.target.value })}><option value="">{t('common.choose')}</option>{Object.entries(reasons).map(([value, key]) => <option key={value} value={value}>{t(`simpleExchange.${key}`)}</option>)}</select></label><label className="mt-4 block"><span className="field-label">{t('simpleExchange.outcomeDetails')}</span><textarea className="field min-h-28 resize-y py-3" maxLength={500} disabled={saving} value={currentDialog.details} onChange={event => change({ details: event.target.value })} /></label></> : null}
      {errorText ? <p role="alert" className="field-error mt-3">{errorText}</p> : null}{currentDialog.outcome ? <button type="button" className="btn-primary mt-5 w-full" disabled={saving} onClick={() => submit()}>{saving ? t('onboarding.saving') : t('simpleExchange.outcomeSubmit')}</button> : null}<button type="button" className="btn-ghost mt-3 w-full" disabled={saving} onClick={close}>{t('common.cancel')}</button>
    </section></div> : null}
  </section>;
}
