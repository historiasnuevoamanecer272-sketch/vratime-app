-- Contact exchange does not create a transaction or reserve any stock.
-- Previous transactions and their history remain intact.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.listings add column owner_checked_at timestamptz not null default now();
alter table public.listings add column owner_check_due_at timestamptz not null default (now() + interval '7 days');
alter table public.listings add column owner_close_reason text check (owner_close_reason in ('completed','not_relevant'));

create table public.listing_contact_exchanges (
 id uuid primary key default gen_random_uuid(),
 listing_id uuid not null references public.listings(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 requester_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(listing_id,requester_id),
 check(owner_id <> requester_id)
);
create index listing_contact_exchanges_owner_created on public.listing_contact_exchanges(owner_id,created_at desc);
create index listing_contact_exchanges_requester_created on public.listing_contact_exchanges(requester_id,created_at desc);
alter table public.listing_contact_exchanges enable row level security;
revoke all on public.listing_contact_exchanges from public,anon,authenticated;
grant select on public.listing_contact_exchanges to authenticated;
grant all on public.listing_contact_exchanges to service_role;
create policy contact_exchanges_participant_read on public.listing_contact_exchanges
 for select to authenticated using ((select auth.uid()) in (owner_id,requester_id));

create function public.get_my_listing_contacts(target_exchange_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'exchange_id',e.id,'listing_id',l.id,'category',l.category,'category_path',l.category_path,
  'listing_type',l.type,'image_url',l.image_url,'remaining_quantity',coalesce(l.available_quantity,l.quantity),
  'listing_status',l.status,'is_listing_owner',e.owner_id=auth.uid(),
  'partner_name',p.full_name,'created_at',e.created_at,
  'contacts',coalesce((select jsonb_agg(jsonb_build_object('messenger_type',c.messenger_type,'contact_value',c.contact_value) order by c.messenger_type)
    from public.profile_contacts c where c.user_id=p.id and nullif(btrim(c.contact_value),'') is not null),'[]'::jsonb)
 ) order by e.created_at desc,e.id),'[]'::jsonb)
 from (select * from public.listing_contact_exchanges where auth.uid() in (owner_id,requester_id) and (target_exchange_id is null or id=target_exchange_id) order by created_at desc,id limit 200) e
 join public.listings l on l.id=e.listing_id
 join public.profiles p on p.id=case when e.owner_id=auth.uid() then e.requester_id else e.owner_id end;
$$;

create function public.request_listing_contacts(target_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected_listing public.listings%rowtype;
declare exchange_id uuid;
declare result jsonb;
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
  insert into public.listing_contact_exchanges(listing_id,owner_id,requester_id)
   values(target_listing_id,selected_listing.user_id,auth.uid()) returning id into exchange_id;
  insert into public.user_inbox(user_id,item_type,title,body,payload,idempotency_key)
   values(selected_listing.user_id,'system','New contact exchange','The participant contacts are available in Contacts.',jsonb_build_object('kind','listing_contact','listing_id',target_listing_id,'exchange_id',exchange_id), 'listing-contact:'||exchange_id::text)
   on conflict(user_id,idempotency_key) do nothing;
  update public.listings set owner_check_due_at=least(owner_check_due_at,now()+interval '24 hours') where id=target_listing_id;
 end if;
 select value into result from jsonb_array_elements(public.get_my_listing_contacts(exchange_id)) where value->>'exchange_id'=exchange_id::text;
 return result;
end;
$$;

create function public.set_my_listing_remaining(target_listing_id uuid,remaining_quantity integer,close_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected_listing public.listings%rowtype;
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into selected_listing from public.listings where id=target_listing_id for update;
 if not found or selected_listing.user_id<>auth.uid() then raise exception 'Listing not found'; end if;
 if selected_listing.moderation_status='rejected' then raise exception 'A removed listing cannot be republished'; end if;
 if coalesce(selected_listing.reserved_quantity,0)>0 or exists(select 1 from public.transactions where listing_id=target_listing_id and accepted_at is not null and completed_at is null and canceled_at is null) then raise exception 'An accepted booking cannot be edited'; end if;
 if remaining_quantity is null or remaining_quantity not between 0 and 10000 then raise exception 'Invalid quantity'; end if;
 if close_reason is not null and close_reason not in ('completed','not_relevant') then raise exception 'Invalid closure reason'; end if;
 if (remaining_quantity=0 and close_reason is null) or (remaining_quantity>0 and close_reason is not null) then raise exception 'Invalid closure reason'; end if;
 update public.listings set
  quantity=case when remaining_quantity>0 then remaining_quantity else quantity end,
  available_quantity=remaining_quantity,
  status=case when close_reason='completed' then 'completed'::public.listing_status when close_reason='not_relevant' then 'canceled'::public.listing_status else 'active'::public.listing_status end,
  owner_close_reason=close_reason,owner_checked_at=now(),owner_check_due_at=now()+interval '7 days',updated_at=now()
 where id=target_listing_id returning to_jsonb(listings.*) into result;
 update public.user_inbox set read_at=coalesce(read_at,now()) where user_id=auth.uid() and payload->>'kind'='listing_check' and payload->>'listing_id'=target_listing_id::text;
 return result;
end;
$$;

create function public.confirm_my_listing_current(target_listing_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 update public.listings set owner_checked_at=now(),owner_check_due_at=now()+interval '7 days'
  where id=target_listing_id and user_id=auth.uid() and status='active' and moderation_status='approved';
 if not found then raise exception 'Listing not found'; end if;
 update public.user_inbox set read_at=coalesce(read_at,now()) where user_id=auth.uid() and payload->>'kind'='listing_check' and payload->>'listing_id'=target_listing_id::text;
end;
$$;

create function public.generate_listing_check_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare listing record;
declare count_sent integer:=0;
begin
 for listing in select id,user_id,category,owner_check_due_at from public.listings
  where status='active' and moderation_status='approved' and coalesce(available_quantity,quantity,0)>0 and owner_check_due_at<=now()
  order by owner_check_due_at,id limit 500 for update skip locked
 loop
  insert into public.user_inbox(user_id,item_type,title,body,payload,idempotency_key)
   values(listing.user_id,'reminder','Is your listing still current?','Check the remaining quantity in My listings.',jsonb_build_object('kind','listing_check','listing_id',listing.id,'category',listing.category),
    'listing-check:'||listing.id::text||':'||extract(epoch from listing.owner_check_due_at)::text)
   on conflict(user_id,idempotency_key) do nothing;
  update public.listings set owner_check_due_at=now()+interval '7 days' where id=listing.id;
  count_sent:=count_sent+1;
 end loop;
 return count_sent;
end;
$$;

revoke all on function public.get_my_listing_contacts(uuid) from public,anon;
revoke all on function public.request_listing_contacts(uuid) from public,anon;
revoke all on function public.set_my_listing_remaining(uuid,integer,text) from public,anon;
revoke all on function public.confirm_my_listing_current(uuid) from public,anon;
revoke all on function public.generate_listing_check_reminders() from public,anon,authenticated;
grant execute on function public.get_my_listing_contacts(uuid) to authenticated;
grant execute on function public.request_listing_contacts(uuid) to authenticated;
grant execute on function public.set_my_listing_remaining(uuid,integer,text) to authenticated;
grant execute on function public.confirm_my_listing_current(uuid) to authenticated;
grant execute on function public.generate_listing_check_reminders() to service_role;

-- Stop cached clients from introducing more reservations after the new release.
create or replace function public.book_listing(target_listing_id uuid,requested_quantity integer default 1)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 raise exception 'contact_exchange_only';
end;
$$;

notify pgrst, 'reload schema';
commit;
