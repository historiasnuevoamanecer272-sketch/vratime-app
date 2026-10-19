export const localAppointmentInput = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const nextDefaultAppointmentInput = (now = Date.now()) => {
  const date = new Date(Number(now) + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return localAppointmentInput(date);
};

export const appointmentTimeForSave = (localValue, savedTime) => {
  // Keep seconds and the original offset during the repeated DST hour when unchanged.
  if (savedTime && localAppointmentInput(savedTime) === localValue) return new Date(savedTime).toISOString();
  return new Date(localValue).toISOString();
};

export const isAwaitingHandover = (deal) => Boolean(
  deal && !deal.handed_over_at && !deal.returned_at && !deal.completed_at && !deal.canceled_at
  && !['handed_over', 'return_due', 'returned', 'completed', 'canceled', 'expired'].includes(deal.status),
);

export const isOpenAppointment = (appointment) => ['scheduled', 'reschedule_requested', 'no_show_reported'].includes(appointment?.state);

export const appointmentForDeal = (appointments, transactionId) => appointments
  .filter((appointment) => appointment.transaction_id === transactionId)
  .reduce((selected, appointment) => {
    if (!selected) return appointment;
    if (isOpenAppointment(selected) !== isOpenAppointment(appointment)) return isOpenAppointment(appointment) ? appointment : selected;
    return new Date(appointment.scheduled_for) > new Date(selected.scheduled_for) ? appointment : selected;
  }, null);
