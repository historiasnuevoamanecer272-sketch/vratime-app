-- Local candidate only. No network calls, tokens, cron jobs, or deployment in this migration.
begin;
create table public.feedback_telegram_deliveries (
  feedback_id uuid primary key references public.user_feedback(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','unconfigured','sending','delivered','failed','ambiguous')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  claim_token uuid,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  telegram_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  check (status <> 'delivered' or (telegram_message_id is not null and delivered_at is not null))
);
alter table public.feedback_telegram_deliveries enable row level security;
revoke all on public.feedback_telegram_deliveries from public, anon, authenticated;
grant select, insert, update on public.feedback_telegram_deliveries to service_role;
grant select on public.user_feedback to service_role;
create index feedback_telegram_retry_idx on public.feedback_telegram_deliveries(next_attempt_at) where status in ('queued','failed','unconfigured');

create function public.queue_feedback_telegram()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.feedback_telegram_deliveries(feedback_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.queue_feedback_telegram() from public, anon, authenticated;
grant execute on function public.queue_feedback_telegram() to service_role;
-- Existing create_feedback is SECURITY DEFINER, so its INSERT trigger can create the queue row.
create trigger queue_feedback_telegram_after_insert
after insert on public.user_feedback for each row execute function public.queue_feedback_telegram();

create function public.claim_feedback_telegram(target_feedback_id uuid, expected_user_id uuid, is_configured boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  feedback public.user_feedback%rowtype;
  delivery public.feedback_telegram_deliveries%rowtype;
  token uuid;
  recent_count integer;
begin
  -- The Edge Function supplies expected_user_id ONLY after Auth getUser validation.
  -- The function itself is callable ONLY with server service_role privileges.
  select * into feedback from public.user_feedback where id = target_feedback_id and user_id = expected_user_id;
  if not found then return jsonb_build_object('delivery','not_found'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(expected_user_id::text, 0));
  insert into public.feedback_telegram_deliveries(feedback_id) values(target_feedback_id) on conflict do nothing;
  select * into delivery from public.feedback_telegram_deliveries where feedback_id = target_feedback_id for update;
  if delivery.status = 'delivered' then return jsonb_build_object('delivery','delivered'); end if;
  if delivery.status = 'ambiguous' then return jsonb_build_object('delivery','ambiguous'); end if;
  if delivery.status = 'sending' then
    if delivery.lease_expires_at > now() then
      return jsonb_build_object('delivery','queued','retryAfterSeconds',greatest(1,ceil(extract(epoch from delivery.lease_expires_at-now()))::integer));
    end if;
    update public.feedback_telegram_deliveries set status='ambiguous',last_error_code='lease_expired_acknowledgement_unknown',updated_at=now() where feedback_id=target_feedback_id;
    return jsonb_build_object('delivery','ambiguous');
  end if;
  if not coalesce(is_configured,false) then
    update public.feedback_telegram_deliveries set status='unconfigured',last_error_code='telegram_not_configured',updated_at=now() where feedback_id=target_feedback_id;
    return jsonb_build_object('delivery','unconfigured');
  end if;
  if delivery.attempts >= 5 then
    update public.feedback_telegram_deliveries set last_error_code='retry_exhausted',updated_at=now() where feedback_id=target_feedback_id;
    return jsonb_build_object('delivery','queued');
  end if;
  if delivery.next_attempt_at > now() then
    return jsonb_build_object('delivery','queued','retryAfterSeconds',greatest(1,ceil(extract(epoch from delivery.next_attempt_at-now()))::integer));
  end if;
  select count(*) into recent_count from public.feedback_telegram_deliveries d
  join public.user_feedback f on f.id=d.feedback_id where f.user_id=expected_user_id and d.last_attempt_at > now()-interval '1 minute';
  if recent_count >= 5 then return jsonb_build_object('delivery','queued','retryAfterSeconds',60); end if;
  token := gen_random_uuid();
  update public.feedback_telegram_deliveries set status='sending',attempts=attempts+1,claim_token=token,
    lease_expires_at=now()+interval '1 minute',last_attempt_at=now(),next_attempt_at=null,last_error_code=null,updated_at=now()
  where feedback_id=target_feedback_id;
  return jsonb_build_object('delivery','claimed','claimToken',token,'feedback',jsonb_build_object(
    'id',feedback.id,'user_id',feedback.user_id,'feedback_type',feedback.feedback_type,'message',feedback.message,
    'screenshot_url',feedback.screenshot_url,'created_at',feedback.created_at));
end;
$$;

create function public.finish_feedback_telegram(target_feedback_id uuid, claim_token uuid, outcome text, error_code text default null, telegram_message_id text default null, retry_after_seconds integer default 60)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if outcome not in ('delivered','failed','ambiguous') or outcome is null then raise exception 'Invalid delivery outcome'; end if;
  if outcome='delivered' and (telegram_message_id is null or telegram_message_id !~ '^[1-9][0-9]{0,19}$') then raise exception 'Missing delivery receipt'; end if;
  update public.feedback_telegram_deliveries d set status=outcome,
    telegram_message_id=case when outcome='delivered' then finish_feedback_telegram.telegram_message_id else null end,
    delivered_at=case when outcome='delivered' then now() else null end,
    last_error_code=case when outcome='delivered' then null else left(coalesce(error_code,'delivery_failed'),100) end,
    next_attempt_at=case when outcome='failed' then now()+make_interval(secs=>greatest(60,least(coalesce(retry_after_seconds,60),86400))) else null end,
    lease_expires_at=null,updated_at=now()
  where d.feedback_id=target_feedback_id and d.claim_token=finish_feedback_telegram.claim_token and d.status='sending';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.claim_feedback_telegram(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.finish_feedback_telegram(uuid,uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.claim_feedback_telegram(uuid,uuid,boolean) to service_role;
grant execute on function public.finish_feedback_telegram(uuid,uuid,text,text,text,integer) to service_role;

comment on table public.feedback_telegram_deliveries is 'Server-only feedback delivery queue/receipt; no automatic worker is scheduled. Ambiguous sends require operator reconciliation before any resend.';
commit;
