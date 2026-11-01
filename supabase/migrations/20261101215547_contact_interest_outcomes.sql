-- Independent responses to contact exchanges. No bookings, penalties or deletion.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.listing_contact_exchanges
 add column owner_outcome text check(owner_outcome in('success','failure')),
 add column requester_outcome text check(requester_outcome in('success','failure')),
 add column owner_reason text check(owner_reason in('time','recipient_declined','owner_changed_mind','other')),
 add column requester_reason text check(requester_reason in('time','recipient_declined','owner_changed_mind','other')),
 add column owner_details text check(char_length(owner_details)<=500),
 add column requester_details text check(char_length(requester_details)<=500),
 add column owner_answered_at timestamptz,
 add column requester_answered_at timestamptz,
 add column owner_action text check(owner_action in('complete','remaining','keep')),
 add column owner_remaining integer,
 add column outcome_prompted_at timestamptz;
create index listing_contact_exchanges_open on public.listing_contact_exchanges(listing_id)
 where owner_outcome is null or requester_outcome is null;
create index listing_contact_exchanges_outcome_due on public.listing_contact_exchanges(created_at,id)
 where outcome_prompted_at is null;

create table public.listing_contact_email_jobs(
 id uuid primary key default gen_random_uuid(),
 exchange_id uuid not null references public.listing_contact_exchanges(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 payload jsonb not null,
 status text not null default 'pending' check(status in('pending','sending','sent','failed','ambiguous','suppressed')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz,
 sent_at timestamptz,
 receipt text,
 created_at timestamptz not null default now(),
 unique(exchange_id,recipient_id)
);
alter table public.listing_contact_email_jobs enable row level security;
revoke all on public.listing_contact_email_jobs from public,anon,authenticated;
grant all on public.listing_contact_email_jobs to service_role;
create index listing_contact_email_jobs_ready on public.listing_contact_email_jobs(next_attempt_at,created_at) where status in('pending','failed');

create or replace function public.get_my_listing_contacts(target_exchange_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'exchange_id',e.id,'listing_id',l.id,'category',l.category,'category_path',l.category_path,
  'listing_type',l.type,'image_url',l.image_url,'remaining_quantity',coalesce(l.available_quantity,l.quantity),
  'listing_status',l.status,'is_listing_owner',e.owner_id=auth.uid(),
  'partner_name',p.full_name,'created_at',e.created_at,
  'active_interest_count',case when l.status='active' then interest.n else 0 end,
  'interest_active',l.status='active' and interest.n>0,
  'feedback_due_at',e.created_at+interval '24 hours',
  'feedback_available',now()>=e.created_at+interval '24 hours' and (case when e.owner_id=auth.uid() then e.owner_outcome else e.requester_outcome end) is null,
  'my_outcome',case when e.owner_id=auth.uid() then e.owner_outcome else e.requester_outcome end,
  'my_reason',case when e.owner_id=auth.uid() then e.owner_reason else e.requester_reason end,
  'my_details',case when e.owner_id=auth.uid() then e.owner_details else e.requester_details end,
  'my_answered_at',case when e.owner_id=auth.uid() then e.owner_answered_at else e.requester_answered_at end,
  'partner_outcome',case when e.owner_id=auth.uid() then e.requester_outcome else e.owner_outcome end,
  'partner_reason',case when e.owner_id=auth.uid() then e.requester_reason else e.owner_reason end,
  'contacts',coalesce((select jsonb_agg(jsonb_build_object('messenger_type',c.messenger_type,'contact_value',c.contact_value) order by c.messenger_type)
    from public.profile_contacts c where c.user_id=p.id and nullif(btrim(c.contact_value),'') is not null),'[]'::jsonb)
 ) order by e.created_at desc,e.id),'[]'::jsonb)
 from (select * from public.listing_contact_exchanges where auth.uid() in(owner_id,requester_id) and (target_exchange_id is null or id=target_exchange_id) order by created_at desc,id limit 200) e
 join public.listings l on l.id=e.listing_id
 join public.profiles p on p.id=case when e.owner_id=auth.uid() then e.requester_id else e.owner_id end
 cross join lateral(select count(*)::integer n from public.listing_contact_exchanges other where other.listing_id=l.id and (other.owner_outcome is null or other.requester_outcome is null)) interest;
$$;

create function public.get_my_listing_interest_counts()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('listing_id',l.id,'active_interest_count',case when l.status='active' then interest.n else 0 end)),'[]'::jsonb)
 from public.listings l cross join lateral(select count(*)::integer n from public.listing_contact_exchanges e where e.listing_id=l.id and (e.owner_outcome is null or e.requester_outcome is null)) interest
 where l.user_id=auth.uid();
$$;

create or replace function public.get_public_map_listings_v2()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('loan_duration_days',case when l.type='lend' then l.loan_duration_days else null end,
  'active_interest_count',case when l.status='active' then interest.n else 0 end) order by p.created_at desc,p.id),'[]'::jsonb)
 from public.get_public_map_listings() p join public.listings l on l.id=p.id
 cross join lateral(select count(*)::integer n from public.listing_contact_exchanges e where e.listing_id=l.id and (e.owner_outcome is null or e.requester_outcome is null)) interest;
$$;

create or replace function public.request_listing_contacts(target_listing_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare selected_listing public.listings%rowtype; exchange_id uuid; recipient uuid; partner uuid; notice jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into selected_listing from public.listings where id=target_listing_id for update;
 if not found then raise exception 'Listing not found'; end if;
 if selected_listing.user_id=auth.uid() then raise exception 'You cannot contact your own listing'; end if;
 select id into exchange_id from public.listing_contact_exchanges where listing_id=target_listing_id and requester_id=auth.uid();
 if exchange_id is null then
  if selected_listing.status is distinct from 'active' or selected_listing.moderation_status is distinct from 'approved' or coalesce(selected_listing.available_quantity,selected_listing.quantity,0)<1 then raise exception 'Listing is no longer available'; end if;
  if not exists(select 1 from public.profile_contacts where user_id=auth.uid() and nullif(btrim(contact_value),'') is not null)
   or not exists(select 1 from public.profile_contacts where user_id=selected_listing.user_id and nullif(btrim(contact_value),'') is not null) then raise exception 'contact_details_required'; end if;
  if (select count(*) from public.listing_contact_exchanges where requester_id=auth.uid() and created_at>now()-interval '24 hours')>=20 then raise exception 'Contact request limit reached'; end if;
  insert into public.listing_contact_exchanges(listing_id,owner_id,requester_id) values(target_listing_id,selected_listing.user_id,auth.uid()) returning id into exchange_id;
  foreach recipient in array array[selected_listing.user_id,auth.uid()] loop
   partner:=case when recipient=auth.uid() then selected_listing.user_id else auth.uid() end;
   notice:=jsonb_build_object('kind','listing_contact','listing_id',target_listing_id,'exchange_id',exchange_id,
    'category',selected_listing.category,'contact_by',now()+interval '24 hours',
    'partner_name',(select full_name from public.profiles where id=partner),
    'language',coalesce((select language from public.profiles where id=recipient),'ru'),
    'partner_contacts',(select coalesce(jsonb_agg(jsonb_build_object('messenger_type',messenger_type,'contact_value',contact_value)),'[]'::jsonb) from public.profile_contacts where user_id=partner and nullif(btrim(contact_value),'') is not null));
   insert into public.user_inbox(user_id,item_type,title,body,payload,idempotency_key)
    values(recipient,'system','Проявлен интерес','Свяжитесь по указанным контактам в течение 24 ч.',notice,'listing-contact:'||exchange_id::text)
    on conflict(user_id,idempotency_key) do nothing;
   insert into public.listing_contact_email_jobs(exchange_id,recipient_id,payload) values(exchange_id,recipient,notice) on conflict on constraint listing_contact_email_jobs_exchange_id_recipient_id_key do nothing;
  end loop;
  update public.listings set owner_check_due_at=least(owner_check_due_at,now()+interval '24 hours') where id=target_listing_id;
 end if;
 return public.get_my_listing_contacts(exchange_id)->0;
end;
$$;

create function public.submit_listing_contact_outcome(target_exchange_id uuid,outcome text,failure_reason text default null,details text default null,owner_action text default null,remaining_quantity integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.listing_contact_exchanges%rowtype; l public.listings%rowtype; owner_call boolean; existing_outcome text; existing_reason text; existing_details text; clean_details text:=nullif(btrim(details),'');
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into e from public.listing_contact_exchanges where id=target_exchange_id and auth.uid() in(owner_id,requester_id);
 if not found then raise exception 'Contact exchange not found'; end if;
 -- Same lock order as contact requests and stock updates: listing, then exchange.
 select * into l from public.listings where id=e.listing_id for update;
 select * into e from public.listing_contact_exchanges where id=target_exchange_id for update;
 owner_call:=auth.uid()=e.owner_id;
 if outcome is null or outcome not in('success','failure') then raise exception 'Invalid outcome'; end if;
 if outcome='failure' and (failure_reason is null or failure_reason not in('time','recipient_declined','owner_changed_mind','other')) then raise exception 'Invalid failure reason'; end if;
 if outcome='success' and (failure_reason is not null or clean_details is not null) then raise exception 'Invalid failure reason'; end if;
 if char_length(clean_details)>500 then raise exception 'Outcome details too long'; end if;
 if not owner_call or outcome='failure' then
  if owner_action is not null or remaining_quantity is not null then raise exception 'Only the author can change the listing'; end if;
 else
  if owner_action is null or owner_action not in('complete','remaining','keep') then raise exception 'Invalid owner action'; end if;
  if (owner_action='remaining' and (remaining_quantity is null or remaining_quantity<1 or remaining_quantity>10000)) or (owner_action<>'remaining' and remaining_quantity is not null) then raise exception 'Invalid quantity'; end if;
 end if;
 existing_outcome:=case when owner_call then e.owner_outcome else e.requester_outcome end;
 existing_reason:=case when owner_call then e.owner_reason else e.requester_reason end;
 existing_details:=case when owner_call then e.owner_details else e.requester_details end;
 if existing_outcome is not null then
  if existing_outcome is distinct from outcome or existing_reason is distinct from failure_reason or existing_details is distinct from clean_details
    or (owner_call and (e.owner_action is distinct from owner_action or e.owner_remaining is distinct from remaining_quantity)) then raise exception 'Outcome already recorded'; end if;
  return public.get_my_listing_contacts(e.id)->0;
 end if;
 if now()<e.created_at+interval '24 hours' then raise exception 'Outcome available after 24 hours'; end if;
 if owner_call and outcome='success' then
  if owner_action='remaining' then
   if l.status is distinct from 'active' or remaining_quantity>coalesce(l.available_quantity,l.quantity,0) then raise exception 'Invalid quantity'; end if;
   perform public.set_my_listing_remaining(l.id,remaining_quantity,null);
  elsif owner_action='complete' then
   if l.status='active' then perform public.set_my_listing_remaining(l.id,0,'completed');
   elsif l.status is distinct from 'completed' then raise exception 'Listing is no longer available'; end if;
  end if;
 end if;
 if owner_call then
  update public.listing_contact_exchanges set owner_outcome=outcome,owner_reason=failure_reason,owner_details=clean_details,owner_answered_at=now(),owner_action=submit_listing_contact_outcome.owner_action,owner_remaining=remaining_quantity where id=e.id;
 else
  update public.listing_contact_exchanges set requester_outcome=outcome,requester_reason=failure_reason,requester_details=clean_details,requester_answered_at=now() where id=e.id;
 end if;
 update public.user_inbox set read_at=coalesce(read_at,now()) where user_id=auth.uid() and payload->>'kind'='listing_contact_outcome_due' and payload->>'exchange_id'=e.id::text;
 return public.get_my_listing_contacts(e.id)->0;
end;
$$;

create function public.generate_listing_contact_outcome_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare e record; n integer:=0;
begin
 for e in select * from public.listing_contact_exchanges where outcome_prompted_at is null and created_at<=now()-interval '24 hours' order by created_at,id limit 500 for update skip locked loop
  insert into public.user_inbox(user_id,item_type,title,body,payload,idempotency_key)
   select recipient,'reminder','Как прошла сделка?','Отметьте результат в разделе «Сделки».',jsonb_build_object('kind','listing_contact_outcome_due','exchange_id',e.id,'listing_id',e.listing_id),'listing-contact-outcome:'||e.id::text
   from (values(e.owner_id,e.owner_outcome),(e.requester_id,e.requester_outcome)) as participants(recipient,result) where result is null
   on conflict(user_id,idempotency_key) do nothing;
  update public.listing_contact_exchanges set outcome_prompted_at=now() where id=e.id;
  n:=n+1;
 end loop;
 return n;
end;
$$;

-- Server-only email leases. Unknown SMTP acceptance is held, never auto-resend.
create function public.claim_listing_contact_email()
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.listing_contact_email_jobs%rowtype; recipient_email text; token uuid;
begin
 update public.listing_contact_email_jobs set status='ambiguous',receipt='expired_lease' where status='sending' and lease_until<now();
 for job in select * from public.listing_contact_email_jobs where status in('pending','failed') and attempts<3 and next_attempt_at<=now() order by created_at,id limit 10 for update skip locked loop
  select email into recipient_email from auth.users where id=job.recipient_id and email_confirmed_at is not null;
  if nullif(btrim(recipient_email),'') is null then update public.listing_contact_email_jobs set status='suppressed',receipt='no_verified_email' where id=job.id; continue; end if;
  token:=gen_random_uuid();
  update public.listing_contact_email_jobs set status='sending',attempts=attempts+1,lease_token=token,lease_until=now()+interval '5 minutes' where id=job.id;
  return jsonb_build_object('id',job.id,'lease_token',token,'email',recipient_email,'payload',job.payload);
 end loop;
 return null;
end;
$$;

create function public.finish_listing_contact_email(job_id uuid,token uuid,delivery_status text,delivery_receipt text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if delivery_status is null or delivery_status not in('sent','failed','ambiguous') then raise exception 'Invalid delivery status'; end if;
 if delivery_status='sent' and nullif(btrim(delivery_receipt),'') is null then raise exception 'Delivery receipt required'; end if;
 update public.listing_contact_email_jobs set status=delivery_status,receipt=left(delivery_receipt,200),sent_at=case when delivery_status='sent' then now() else null end,next_attempt_at=now()+interval '10 minutes',lease_until=null
  where id=job_id and lease_token=token and status='sending';
 return found;
end;
$$;

revoke all on function public.get_my_listing_interest_counts() from public,anon;
revoke all on function public.submit_listing_contact_outcome(uuid,text,text,text,text,integer) from public,anon;
revoke all on function public.generate_listing_contact_outcome_reminders() from public,anon,authenticated;
revoke all on function public.claim_listing_contact_email() from public,anon,authenticated;
revoke all on function public.finish_listing_contact_email(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.get_my_listing_interest_counts() to authenticated;
grant execute on function public.submit_listing_contact_outcome(uuid,text,text,text,text,integer) to authenticated;
grant execute on function public.generate_listing_contact_outcome_reminders() to service_role;
grant execute on function public.claim_listing_contact_email() to service_role;
grant execute on function public.finish_listing_contact_email(uuid,uuid,text,text) to service_role;

notify pgrst,'reload schema';
commit;
