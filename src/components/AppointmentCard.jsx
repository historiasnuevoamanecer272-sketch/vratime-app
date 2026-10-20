import { useRef, useState } from 'react';
import Icon from './Icon';
import { scheduleHandover, setHandoverOutcome } from '../lib/api';
import { showToast } from '../lib/toast';
import { friendlyError } from '../lib/userErrors';
import { useTranslation } from 'react-i18next';
import { appointmentTimeForSave, isAwaitingHandover, isOpenAppointment, localAppointmentInput, nextDefaultAppointmentInput } from '../lib/appointments';

export default function AppointmentCard({ deal, appointment, onChanged }) {
  const { t } = useTranslation();
  const activeAppointment = isOpenAppointment(appointment) ? appointment : null;
  const [scheduledFor, setScheduledFor] = useState(() => localAppointmentInput(activeAppointment?.scheduled_for) || nextDefaultAppointmentInput());
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const canSchedule = deal?.accepted_at && isAwaitingHandover(deal);

  const run = async (action) => {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    try {
      await action();
      onChanged?.();
    } catch (error) {
      showToast(error?.code === 'appointment_invalid_time' ? t('appointment.invalidTime') : friendlyError(error, t), 'error');
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  };

  if (!canSchedule) return null;

  return <section className="appointment-card mt-3 rounded-lg border border-line bg-white/70 p-3">
    <div className="flex items-center gap-2 text-sm font-extrabold text-forest"><Icon name="calendar" size={16} />{t('appointment.title')}</div>
    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
      <input className="field min-h-10" type="datetime-local" aria-label={t('appointment.title')} value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />
      <button type="button" className="btn-secondary min-h-10 px-3 text-sm" disabled={working} onClick={() => run(() => scheduleHandover(deal.transaction_id, appointmentTimeForSave(scheduledFor, activeAppointment?.scheduled_for)))}>{t(activeAppointment ? 'appointment.reschedule' : 'appointment.schedule')}</button>
    </div>
    {activeAppointment ? <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className="btn-link text-xs" disabled={working} onClick={() => run(() => setHandoverOutcome(activeAppointment.id, 'completed'))}>{t('appointment.completed')}</button>
      <button type="button" className="btn-link text-xs" disabled={working} onClick={() => run(() => setHandoverOutcome(activeAppointment.id, 'reschedule'))}>{t('appointment.needsReschedule')}</button>
      <button type="button" className="btn-link text-xs" disabled={working} onClick={() => run(() => setHandoverOutcome(activeAppointment.id, 'no_show'))}>{t('appointment.noShow')}</button>
      <button type="button" className="btn-link text-xs" disabled={working} onClick={() => run(() => setHandoverOutcome(activeAppointment.id, 'canceled'))}>{t('appointment.cancel')}</button>
    </div> : null}
    {appointment?.state ? <p className="mt-2 text-xs font-semibold text-muted">{t('appointment.state', { state: t(`appointment.states.${appointment.state}`) })}</p> : null}
  </section>;
}
