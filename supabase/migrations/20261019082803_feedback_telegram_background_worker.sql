begin;

create function public.pending_feedback_telegram(maximum integer default 5)
returns table(feedback_id uuid,user_id uuid)
language plpgsql security invoker set search_path='' as $$
begin
  -- A timed-out sending lease cannot prove whether Telegram accepted it.
  -- Hold it for reconciliation; never put it back in the retry candidates.
  update public.feedback_telegram_deliveries d set status='ambiguous',last_error_code='lease_expired_acknowledgement_unknown',updated_at=now()
  where d.status='sending' and (d.lease_expires_at is null or d.lease_expires_at<=now());
  return query select d.feedback_id,f.user_id from public.feedback_telegram_deliveries d
    join public.user_feedback f on f.id=d.feedback_id
    where d.status in('queued','failed','unconfigured') and d.attempts<5 and (d.next_attempt_at is null or d.next_attempt_at<=now())
    order by d.created_at,d.feedback_id limit greatest(0,least(coalesce(maximum,5),5));
end;
$$;
revoke all on function public.pending_feedback_telegram(integer) from public,anon,authenticated;
grant execute on function public.pending_feedback_telegram(integer) to service_role;
comment on table public.feedback_telegram_deliveries is 'Server-only feedback delivery queue/receipt. A separately configured secret-gated background worker retries due queued/failed/unconfigured rows. Ambiguous sends remain held for operator reconciliation.';

commit;
