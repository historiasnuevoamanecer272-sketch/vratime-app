import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatContactCountdown } from '../lib/contactFollowup';
import Icon from './Icon';

export default function ContactCountdown({ exchange, active = true, onDue, onOpenDeals }) {
  const { t } = useTranslation();
  const [clock, setClock] = useState(Date.now);
  const refreshKey = useRef(null);
  const due = Date.parse(exchange?.feedback_due_at);
  const ready = exchange?.feedback_available === true;
  const visible = Boolean(active && exchange?.exchange_id && !exchange.my_outcome && Number.isFinite(due));
  const key = `${exchange?.exchange_id}:${due}`;

  useEffect(() => {
    if (!visible || ready) return undefined;
    let stopped = false;
    const update = () => {
      if (stopped || document.visibilityState === 'hidden') return;
      const now = Date.now();
      setClock(now);
      if (now >= due && onDue && refreshKey.current !== key) {
        refreshKey.current = key;
        Promise.resolve().then(() => { if (!stopped) return onDue(); }).catch(() => {});
      }
    };
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      stopped = true;
      window.clearTimeout(initial); window.clearInterval(timer);
      window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update);
    };
  }, [visible, ready, due, key, onDue]);

  if (!visible) return null;
  return <aside className="contact-countdown" data-followup-state={ready ? 'ready' : clock < due ? 'waiting' : 'checking'}>
    <div className="contact-countdown-heading"><Icon name="clock" size={20} /><span>{t(ready ? 'simpleExchange.followupReady' : clock < due ? 'simpleExchange.followupIn' : 'simpleExchange.followupWaiting')}</span></div>
    {!ready && clock < due ? <output role="timer" aria-live="off" className="contact-countdown-time">{formatContactCountdown(due, clock)}</output> : null}
    <small>{t('simpleExchange.followupHint')}</small>
    {ready && onOpenDeals ? <button type="button" className="btn-secondary mt-3 w-full" onClick={onOpenDeals}>{t('simpleExchange.outcomeQuestion')}</button> : null}
  </aside>;
}
