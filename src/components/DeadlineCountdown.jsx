import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDeadlineProgress, getDeadlineState } from '../lib/deadlines';
import Icon from './Icon';

export default function DeadlineCountdown({ startedAt, expiresAt, compact = false }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const state = useMemo(() => getDeadlineState(expiresAt, now), [expiresAt, now]);
  const progress = getDeadlineProgress(startedAt, expiresAt, now);
  const text = state.expired
    ? t('workflow.timeExpired')
    : t('workflow.timeRemaining', { days: state.days, hours: state.hours, minutes: state.minutes });

  return <div className={`deadline-countdown ${state.urgent ? 'is-urgent' : ''} ${compact ? 'is-compact' : ''}`}><p><Icon name="clock" size={15} />{text}</p><div role="progressbar" aria-label={text} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div></div>;
}
