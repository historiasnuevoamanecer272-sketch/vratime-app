import { useState } from 'react';
import Icon from './Icon';
import { scheduleHandover, setHandoverOutcome } from '../lib/api';
import { showToast } from '../lib/toast';

const nextDefaultTime = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return date.toISOString().slice(0, 16);
};

export default function AppointmentCard({ deal, appointment, onChanged }) {
  const [scheduledFor, setScheduledFor] = useState(appointment?.scheduled_for?.slice(0, 16) || nextDefaultTime());
  const [working, setWorking] = useState(false);
  const canSchedule = deal?.accepted_at && !deal.completed_at && !deal.canceled_at;

  const run = async (action) => {
    setWorking(true);
    try {
      await action();
      onChanged?.();
    } catch (error) {
      showToast(error.message || 'Не удалось сохранить встречу', 'error');
    } finally {
      setWorking(false);
    }
  };

  if (!canSchedule) return null;

  return <section className="appointment-card mt-3 rounded-lg border border-line bg-white/70 p-3">
    <div className="flex items-center gap-2 text-sm font-extrabold text-forest"><Icon name="calendar" size={16} />Встреча</div>
    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
      <input className="field min-h-10" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />
      <button type="button" className="btn-secondary min-h-10 px-3 text-sm" disabled={working} onClick={() => run(() => scheduleHandover(deal.transaction_id, new Date(scheduledFor).toISOString()))}>{appointment ? 'Перенести' : 'Назначить'}</button>
    </div>
    {appointment ? <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className="btn-link text-xs" disabled={working} onClick={() => run(() => setHandoverOutcome(appointment.id, 'completed'))}>Встреча прошла</button>
      <button type="button" className="btn-link text-xs" disabled={working} onClick={() => run(() => setHandoverOutcome(appointment.id, 'reschedule'))}>Нужно перенести</button>
      <button type="button" className="btn-link text-xs" disabled={working} onClick={() => run(() => setHandoverOutcome(appointment.id, 'no_show'))}>Не состоялась</button>
    </div> : null}
    {appointment?.state ? <p className="mt-2 text-xs font-semibold text-muted">Статус встречи: {appointment.state}</p> : null}
  </section>;
}
