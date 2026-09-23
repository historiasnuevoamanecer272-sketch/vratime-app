import { useState } from 'react';
import Icon from './Icon';
import { scheduleHandover, setHandoverOutcome } from '../lib/api';
import { showToast } from '../lib/toast';
import { useTranslation } from 'react-i18next';

const nextDefaultTime = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return date.toISOString().slice(0, 16);
};

export default function AppointmentCard({ deal, appointment, onChanged }) {
  const { t } = useTranslation();
  const [scheduledFor, setScheduledFor] = useState(appointment?.scheduled_for?.slice(0, 16) || nextDefaultTime());
  const [working, setWorking] = useState(false);
  const canSchedule = deal?.accepted_at && !deal.completed_at && !deal.canceled_at;

  const run = async (action) => {
    setWorking(true);
    try {
      await action();
      onChanged?.();
    } catch (error) {
      showToast(error.message || t('appointment.saveError'), 'error');
    } finally {
      setWorking(false);
    }
  };

  if (!canSchedule) return null;

  return <section className="appointment-card mt-3 rounded-lg border border-line bg-white/70 p-3">
    <div className="flex items-center gap-2 text-sm font-extrabold text-forest"><Icon name="calendar" size={16} />{t('appointment.title')}</div>
    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
      <input className="field min-h-10" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />
      <button type="button" className="btn-secondary min-h-10 px-3 text-sm" disabled={working} onClick={() => run(() => scheduleHandover(deal.transaction_id, new Date(scheduledFor).toISOString()))}>{t(appointment ? 'appointment.reschedule' : 'appointment.schedule')}</button>
    </div>
    {appointment ? <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className="btn-link text-xs" disabled={working} onClick={() => run(() => setHandoverOutcome(appointment.id, 'completed'))}>{t('appointment.completed')}</button>
      <button type="button" className="btn-link text-xs" disabled={working} onClick={() => run(() => setHandoverOutcome(appointment.id, 'reschedule'))}>{t('appointment.needsReschedule')}</button>
      <button type="button" className="btn-link text-xs" disabled={working} onClick={() => run(() => setHandoverOutcome(appointment.id, 'no_show'))}>{t('appointment.noShow')}</button>
    </div> : null}
    {appointment?.state ? <p className="mt-2 text-xs font-semibold text-muted">{t('appointment.state', { state: appointment.state })}</p> : null}
  </section>;
}
