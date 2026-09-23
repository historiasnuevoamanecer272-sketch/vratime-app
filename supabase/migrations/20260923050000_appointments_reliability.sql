begin;

create table if not exists public.handover_appointments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  scheduled_for timestamptz not null,
  state text not null default 'scheduled' check (state in ('scheduled', 'reschedule_requested', 'completed', 'no_show_reported', 'no_show_confirmed', 'canceled')),
  note text check (note is null or char_length(note) <= 1000),
  proposed_for timestamptz,
  proposed_by uuid references public.profiles(id),
  outcome_by uuid references public.profiles(id),
  reminder_3h_sent_at timestamptz,
  reminder_30m_sent_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists handover_appointments_one_open
  on public.handover_appointments (transaction_id)
  where state in ('scheduled', 'reschedule_requested', 'no_show_reported');
create index if not exists handover_appointments_reminder_idx
  on public.handover_appointments (scheduled_for)
  where state = 'scheduled';

alter table public.handover_appointments enable row level security;
revoke all on public.handover_appointments from public, anon, authenticated;
grant select on public.handover_appointments to authenticated;
create policy handover_appointments_participant_read on public.handover_appointments
  for select to authenticated using (
    exists (
      select 1 from public.transactions t
      where t.id = transaction_id and auth.uid() in (t.giver_id, t.taker_id)
    )
  );

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
  select * into selected_transaction from public.transactions where id = target_transaction_id;
  if not found or auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Transaction not found'; end if;
  if selected_transaction.accepted_at is null or selected_transaction.completed_at is not null or selected_transaction.canceled_at is not null then raise exception 'Only an active accepted deal can be scheduled'; end if;
  if scheduled_for <= now() then raise exception 'Appointment must be in the future'; end if;

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
  if outcome not in ('completed', 'reschedule', 'no_show', 'canceled') then raise exception 'Invalid appointment outcome'; end if;
  select * into selected_appointment from public.handover_appointments where id = target_appointment_id for update;
  if not found then raise exception 'Appointment not found'; end if;
  select * into selected_transaction from public.transactions where id = selected_appointment.transaction_id;
  if auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Appointment not found'; end if;

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

create or replace function public.get_my_reliability()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'completed_count', (
      select count(*)::integer from public.transactions
      where auth.uid() in (giver_id, taker_id) and completed_at is not null
    ),
    'accepted_cancellations', (
      select count(*)::integer from public.transactions
      where auth.uid() in (giver_id, taker_id) and accepted_at is not null and canceled_at is not null
    ),
    'confirmed_no_shows_90d', (
      select count(*)::integer
      from public.handover_appointments a
      join public.transactions t on t.id = a.transaction_id
      where auth.uid() in (t.giver_id, t.taker_id)
        and a.state = 'no_show_confirmed'
        and a.updated_at >= now() - interval '90 days'
    )
  );
$$;

create or replace function public.queue_handover_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare reminder_record record;
declare queued_count integer := 0;
begin
  for reminder_record in
    update public.handover_appointments
    set reminder_3h_sent_at = now()
    where scheduled_for between now() + interval '2 hours 55 minutes' and now() + interval '3 hours 5 minutes'
    and reminder_3h_sent_at is null
    and state = 'scheduled'
    returning id, transaction_id, scheduled_for, '3h'::text as reminder_kind
  loop
    insert into public.user_inbox (user_id, item_type, title, body, payload, idempotency_key)
    select participant_id, 'reminder', 'VratiMe: встреча скоро', 'До встречи по сделке осталось около 3 часов.',
      jsonb_build_object('appointment_id', reminder_record.id, 'transaction_id', reminder_record.transaction_id, 'scheduled_for', reminder_record.scheduled_for, 'kind', reminder_record.reminder_kind),
      'handover:' || reminder_record.id::text || ':3h:' || participant_id::text
    from (
      select giver_id as participant_id from public.transactions where id = reminder_record.transaction_id
      union
      select taker_id as participant_id from public.transactions where id = reminder_record.transaction_id
    ) participants
    on conflict (user_id, idempotency_key) do nothing;
    queued_count := queued_count + 1;
  end loop;

  for reminder_record in
    update public.handover_appointments
    set reminder_30m_sent_at = now()
    where scheduled_for between now() + interval '25 minutes' and now() + interval '35 minutes'
    and reminder_30m_sent_at is null
    and state = 'scheduled'
    returning id, transaction_id, scheduled_for, '30m'::text as reminder_kind
  loop
    insert into public.user_inbox (user_id, item_type, title, body, payload, idempotency_key)
    select participant_id, 'reminder', 'VratiMe: встреча совсем скоро', 'До встречи по сделке осталось около 30 минут.',
      jsonb_build_object('appointment_id', reminder_record.id, 'transaction_id', reminder_record.transaction_id, 'scheduled_for', reminder_record.scheduled_for, 'kind', reminder_record.reminder_kind),
      'handover:' || reminder_record.id::text || ':30m:' || participant_id::text
    from (
      select giver_id as participant_id from public.transactions where id = reminder_record.transaction_id
      union
      select taker_id as participant_id from public.transactions where id = reminder_record.transaction_id
    ) participants
    on conflict (user_id, idempotency_key) do nothing;
    queued_count := queued_count + 1;
  end loop;
  return queued_count;
end;
$$;

revoke execute on function public.schedule_handover(uuid, timestamptz, text) from public, anon;
revoke execute on function public.set_handover_outcome(uuid, text) from public, anon;
revoke execute on function public.get_my_reliability() from public, anon;
revoke execute on function public.queue_handover_reminders() from public, anon, authenticated;
grant execute on function public.schedule_handover(uuid, timestamptz, text) to authenticated;
grant execute on function public.set_handover_outcome(uuid, text) to authenticated;
grant execute on function public.get_my_reliability() to authenticated;
grant execute on function public.queue_handover_reminders() to service_role;

commit;
