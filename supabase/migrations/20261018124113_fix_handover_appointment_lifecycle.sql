begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A reservation deadline belongs to the request/pickup, never to an issued loan.
create or replace function public.refresh_expired_deals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare expired_record record;
declare expired_count integer := 0;
begin
  for expired_record in
    update public.transactions
    set canceled_at = now(), canceled_reason = 'expired'
    where expires_at <= now()
      and handed_over_at is null
      and returned_at is null
      and completed_at is null
      and canceled_at is null
    returning id
  loop
    perform public.restore_or_consume_reservation(expired_record.id, 'restore');
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

-- Keep the existing meeting history, but retire open pickup appointments when
-- their parent deal is canceled or its physical handover has happened.
create or replace function public.sync_handover_appointment_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.handover_appointments
  set state = case when new.canceled_at is not null then 'canceled' else 'completed' end,
      proposed_for = null,
      proposed_by = null,
      updated_at = now()
  where transaction_id = new.id
    and state in ('scheduled', 'reschedule_requested');
  return new;
end;
$$;

revoke execute on function public.sync_handover_appointment_state() from public, anon, authenticated;

drop trigger if exists transactions_sync_handover_appointment on public.transactions;
create trigger transactions_sync_handover_appointment
  after update of canceled_at, completed_at, handed_over_at on public.transactions
  for each row
  when (
    (new.canceled_at is not null and old.canceled_at is distinct from new.canceled_at)
    or (new.completed_at is not null and old.completed_at is distinct from new.completed_at)
    or (new.handed_over_at is not null and old.handed_over_at is distinct from new.handed_over_at)
  )
  execute function public.sync_handover_appointment_state();

create or replace function public.schedule_handover(target_transaction_id uuid, scheduled_for timestamptz, note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
declare appointment_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  -- All lifecycle operations acquire transaction -> appointment locks in this order.
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found or auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Transaction not found'; end if;
  if selected_transaction.accepted_at is null or selected_transaction.completed_at is not null or selected_transaction.canceled_at is not null
    or selected_transaction.handed_over_at is not null or selected_transaction.returned_at is not null then
    raise exception 'Only an active accepted deal awaiting handover can be scheduled';
  end if;
  if scheduled_for is null or scheduled_for <= now() then raise exception 'Appointment must be in the future'; end if;

  insert into public.handover_appointments (transaction_id, scheduled_for, note, created_by)
  values (target_transaction_id, scheduled_for, nullif(btrim(coalesce(note, '')), ''), auth.uid())
  on conflict (transaction_id) where state in ('scheduled', 'reschedule_requested', 'no_show_reported')
  do update set scheduled_for = excluded.scheduled_for, note = excluded.note, state = 'scheduled',
    proposed_for = null, proposed_by = null, outcome_by = null, updated_at = now(),
    reminder_3h_sent_at = null, reminder_30m_sent_at = null
  returning id into appointment_id;
  return appointment_id;
end;
$$;

create or replace function public.set_handover_outcome(target_appointment_id uuid, outcome text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare selected_appointment public.handover_appointments%rowtype;
declare selected_transaction public.transactions%rowtype;
declare next_state text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if outcome is null or outcome not in ('completed', 'reschedule', 'no_show', 'canceled') then raise exception 'Invalid appointment outcome'; end if;
  -- Lock the parent first, matching cancellation, expiry and handover operations.
  select t.* into selected_transaction
  from public.transactions t
  join public.handover_appointments a on a.transaction_id = t.id
  where a.id = target_appointment_id
  for update of t;
  if not found or auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Appointment not found'; end if;
  if selected_transaction.accepted_at is null or selected_transaction.completed_at is not null or selected_transaction.canceled_at is not null
    or selected_transaction.handed_over_at is not null or selected_transaction.returned_at is not null then
    raise exception 'Only an active accepted deal awaiting handover can change its appointment';
  end if;
  select * into selected_appointment from public.handover_appointments where id = target_appointment_id for update;
  if not found then raise exception 'Appointment not found'; end if;
  if selected_appointment.state not in ('scheduled', 'reschedule_requested', 'no_show_reported') then raise exception 'Appointment is already closed'; end if;

  next_state := case
    when outcome = 'completed' then 'completed'
    when outcome = 'reschedule' then 'reschedule_requested'
    when outcome = 'canceled' then 'canceled'
    when selected_appointment.state = 'no_show_reported' and selected_appointment.outcome_by <> auth.uid() then 'no_show_confirmed'
    else 'no_show_reported'
  end;
  update public.handover_appointments
  set state = next_state,
      proposed_for = case when outcome = 'reschedule' then scheduled_for + interval '1 day' else proposed_for end,
      proposed_by = case when outcome = 'reschedule' then auth.uid() else proposed_by end,
      outcome_by = case when outcome in ('completed', 'no_show', 'canceled') then auth.uid() else outcome_by end,
      updated_at = now()
  where id = selected_appointment.id;
  return next_state;
end;
$$;

-- CREATE OR REPLACE preserves the three existing RPC grants. No RLS, table
-- grants, user roles, notification delivery, or historical rows are changed.
commit;
