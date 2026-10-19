begin;

create function public.media_storage_usage()
returns jsonb language sql stable security invoker set search_path='' as $$
  with targets(bucket) as(values('AVATARS'),('LISTING-PHOTOS'),('FEEDBACK-ATTACHMENTS')),
  usage as(
    select t.bucket,count(o.name) as objects,
      coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint else 0 end),0) as bytes,
      count(o.name) filter(where not coalesce(o.metadata->>'size' ~ '^[0-9]{1,15}$',false)) as unknown
    from targets t left join storage.objects o on o.bucket_id=t.bucket group by t.bucket
  )
  select jsonb_build_object('knownBytes',sum(bytes),'objects',sum(objects),'unknownObjects',sum(unknown),
    'buckets',jsonb_agg(jsonb_build_object('bucket',bucket,'knownBytes',bytes,'objects',objects,'unknownObjects',unknown) order by bucket)) from usage;
$$;
revoke all on function public.media_storage_usage() from public,anon,authenticated;
grant execute on function public.media_storage_usage() to service_role;

create table media_private.storage_monitor_state(
  singleton boolean primary key default true check(singleton),
  budget_bytes bigint not null check(budget_bytes>0),
  last_level smallint not null default 0 check(last_level in(0,80,95)),
  episode bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table media_private.storage_alerts(
  id uuid primary key default gen_random_uuid(),episode bigint not null,threshold smallint not null check(threshold in(80,95)),
  budget_bytes bigint not null,known_bytes bigint not null,unknown_objects bigint not null default 0,
  status text not null default 'pending' check(status in('pending','leased','delivered','failed','ambiguous','unconfigured','superseded')),
  attempts integer not null default 0 check(attempts between 0 and 3),
  lease_token uuid,leased_until timestamptz,next_attempt_at timestamptz not null default now(),
  last_error_code text,telegram_message_id text,delivered_at timestamptz,created_at timestamptz not null default now(),
  unique(episode,threshold)
);
alter table media_private.storage_monitor_state enable row level security;
alter table media_private.storage_alerts enable row level security;
revoke all on media_private.storage_monitor_state,media_private.storage_alerts from public,anon,authenticated;
grant select,insert,update on media_private.storage_monitor_state,media_private.storage_alerts to service_role;
create index media_storage_alerts_due on media_private.storage_alerts(next_attempt_at) where status in('pending','failed','unconfigured','leased');

create function public.media_observe_storage(storage_budget_bytes bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare usage jsonb; state media_private.storage_monitor_state%rowtype; level smallint; event_id uuid;
begin
  if storage_budget_bytes is null or storage_budget_bytes not between 1 and 1000000000000000 then raise exception 'Invalid storage budget'; end if;
  insert into media_private.storage_monitor_state(singleton,budget_bytes) values(true,storage_budget_bytes) on conflict do nothing;
  select * into state from media_private.storage_monitor_state where singleton for update;
  usage:=public.media_storage_usage();
  level:=case when (usage->>'knownBytes')::numeric*100>=storage_budget_bytes::numeric*95 then 95 when (usage->>'knownBytes')::numeric*100>=storage_budget_bytes::numeric*80 then 80 else 0 end;
  if state.budget_bytes<>storage_budget_bytes then
    state.last_level:=0;state.episode:=state.episode+1;
    update media_private.storage_alerts set status='superseded' where status in('pending','failed','unconfigured');
  end if;
  -- Unknown object sizes are a lower bound, never evidence that usage decreased.
  if (usage->>'unknownObjects')::bigint>0 then level:=greatest(level,state.last_level);end if;
  if level<>state.last_level then
    state.episode:=state.episode+1;
    update media_private.storage_alerts set status='superseded' where status in('pending','failed','unconfigured') and (threshold<>level or budget_bytes<>storage_budget_bytes);
    if level>state.last_level then
      insert into media_private.storage_alerts(episode,threshold,budget_bytes,known_bytes,unknown_objects)
      values(state.episode,level,storage_budget_bytes,(usage->>'knownBytes')::bigint,(usage->>'unknownObjects')::bigint) returning id into event_id;
    end if;
  end if;
  update media_private.storage_monitor_state set budget_bytes=storage_budget_bytes,last_level=level,episode=state.episode,updated_at=now() where singleton;
  return usage||jsonb_build_object('budgetBytes',storage_budget_bytes,'level',level,'alertId',event_id);
end;
$$;
revoke all on function public.media_observe_storage(bigint) from public,anon,authenticated;
grant execute on function public.media_observe_storage(bigint) to service_role;

create function public.media_claim_storage_alert(is_configured boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare alert media_private.storage_alerts%rowtype;
begin
  update media_private.storage_alerts set status='ambiguous',last_error_code='lease_expired_acknowledgement_unknown' where status='leased' and leased_until<=now();
  select * into alert from media_private.storage_alerts
    where status in('pending','failed','unconfigured') and attempts<3 and (next_attempt_at<=now() or status='unconfigured')
    order by threshold desc,created_at for update skip locked limit 1;
  if not found then
    select * into alert from media_private.storage_alerts where status<>'superseded' order by episode desc,created_at desc limit 1;
    if not found then return jsonb_build_object('delivery','none');end if;
    return jsonb_build_object('delivery',case when alert.status='leased' then 'in_progress' else alert.status end,'alertId',alert.id,'attempts',alert.attempts,
      'duplicate',alert.status='delivered','messageId',alert.telegram_message_id,'retryExhausted',alert.status='failed' and alert.attempts>=3,'nextAttemptAt',alert.next_attempt_at);
  end if;
  if not coalesce(is_configured,false) then
    update media_private.storage_alerts set status='unconfigured',last_error_code='telegram_not_configured' where id=alert.id;
    return jsonb_build_object('delivery','unconfigured','alertId',alert.id,'attempts',alert.attempts);
  end if;
  update media_private.storage_alerts set status='leased',attempts=attempts+1,lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes'
  where id=alert.id returning * into alert;
  return jsonb_build_object('delivery','claimed','alertId',alert.id,'claimToken',alert.lease_token,'attempts',alert.attempts,'threshold',alert.threshold,
    'budgetBytes',alert.budget_bytes,'knownBytes',alert.known_bytes,'unknownObjects',alert.unknown_objects);
end;
$$;

create function public.media_finish_storage_alert(target_alert_id uuid,claim_token uuid,delivery_outcome text,error_code text default null,message_id text default null,retry_after_seconds integer default 60)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if delivery_outcome not in('delivered','failed','ambiguous') or (error_code is not null and error_code !~ '^[a-z0-9_]{1,80}$')
    or (delivery_outcome='delivered' and (message_id is null or message_id !~ '^[0-9]{1,20}$')) then raise exception 'Invalid delivery receipt';end if;
  update media_private.storage_alerts a set status=delivery_outcome,last_error_code=error_code,
    telegram_message_id=case when delivery_outcome='delivered' then message_id else null end,
    delivered_at=case when delivery_outcome='delivered' then now() else null end,
    next_attempt_at=now()+make_interval(secs=>greatest(60,least(coalesce(retry_after_seconds,60),86400)))
  where a.id=target_alert_id and a.lease_token=media_finish_storage_alert.claim_token and a.status='leased' and a.leased_until>now();
  return found;
end;
$$;
revoke all on function public.media_claim_storage_alert(boolean) from public,anon,authenticated;
revoke all on function public.media_finish_storage_alert(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.media_claim_storage_alert(boolean) to service_role;
grant execute on function public.media_finish_storage_alert(uuid,uuid,text,text,text,integer) to service_role;

commit;
