begin;

-- PostgreSQL resolves CASE branches containing only string literals as text,
-- which cannot be assigned to the listing_status enum. Keep the enum explicit
-- in every reservation and handover state transition.
create or replace function public.restore_or_consume_reservation(target_transaction_id uuid, mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
begin
  if mode not in ('restore', 'consume') then raise exception 'Invalid reservation mode'; end if;
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found or selected_transaction.reserved_quantity <= 0 then return; end if;

  perform 1 from public.listings where id = selected_transaction.listing_id for update;
  if mode = 'restore' then
    update public.listings
    set available_quantity = least(quantity, coalesce(available_quantity, 0) + selected_transaction.reserved_quantity),
        reserved_quantity = greatest(0, reserved_quantity - selected_transaction.reserved_quantity),
        status = 'active',
        updated_at = now()
    where id = selected_transaction.listing_id;
  else
    update public.listings
    set reserved_quantity = greatest(0, reserved_quantity - selected_transaction.reserved_quantity),
        status = case when coalesce(available_quantity, 0) <= 0 and greatest(0, reserved_quantity - selected_transaction.reserved_quantity) = 0 then 'completed'::public.listing_status else 'active'::public.listing_status end,
        updated_at = now()
    where id = selected_transaction.listing_id;
  end if;
  update public.transactions set reserved_quantity = 0 where id = selected_transaction.id;
end;
$$;

create or replace function public.accept_deal(target_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
declare selected_listing public.listings%rowtype;
declare next_available integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.refresh_expired_deals();
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found then raise exception 'Request not found'; end if;
  select * into selected_listing from public.listings where id = selected_transaction.listing_id for update;
  if selected_listing.user_id <> auth.uid() then raise exception 'Only the listing owner can accept this request'; end if;
  if selected_transaction.completed_at is not null or selected_transaction.canceled_at is not null then raise exception 'Request is already closed'; end if;
  if selected_transaction.accepted_at is not null then
    return jsonb_build_object('transaction_id', selected_transaction.id, 'available_quantity', selected_listing.available_quantity);
  end if;
  if selected_listing.status <> 'active' then raise exception 'Listing is no longer available'; end if;
  if selected_listing.available_quantity < selected_transaction.requested_quantity then raise exception 'Not enough quantity available'; end if;

  next_available := selected_listing.available_quantity - selected_transaction.requested_quantity;
  update public.transactions
  set accepted_at = now(), expires_at = now() + interval '24 hours',
      return_due_at = case when selected_listing.type = 'lend' then now() + make_interval(days => selected_listing.loan_duration_days) else null end,
      reserved_quantity = selected_transaction.requested_quantity
  where id = selected_transaction.id;
  update public.listings
  set available_quantity = next_available,
      reserved_quantity = reserved_quantity + selected_transaction.requested_quantity,
      status = case when next_available <= 0 then 'reserved'::public.listing_status else 'active'::public.listing_status end,
      updated_at = now()
  where id = selected_listing.id;
  return jsonb_build_object('transaction_id', selected_transaction.id, 'available_quantity', next_available);
end;
$$;

create or replace function public.confirm_loan_handover(target_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
declare selected_listing public.listings%rowtype;
declare updated_transaction public.transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into selected_transaction from public.transactions where id = target_transaction_id for update;
  if not found or auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Transaction not found'; end if;
  select * into selected_listing from public.listings where id = selected_transaction.listing_id for update;
  if selected_listing.type <> 'lend' then raise exception 'Transaction is not a loan'; end if;
  if selected_transaction.accepted_at is null then raise exception 'The request has not been accepted'; end if;
  if selected_transaction.canceled_at is not null or selected_transaction.returned_at is not null then raise exception 'Loan is closed'; end if;
  if selected_transaction.handed_over_at is not null then return jsonb_build_object('transaction_id', selected_transaction.id, 'handed_over', true); end if;

  update public.transactions
  set giver_confirmed_at = case when auth.uid() = giver_id then coalesce(giver_confirmed_at, now()) else giver_confirmed_at end,
      taker_confirmed_at = case when auth.uid() = taker_id then coalesce(taker_confirmed_at, now()) else taker_confirmed_at end
  where id = selected_transaction.id returning * into updated_transaction;
  if updated_transaction.giver_confirmed_at is not null and updated_transaction.taker_confirmed_at is not null then
    update public.transactions set handed_over_at = now(), reserved_quantity = 0 where id = updated_transaction.id;
    update public.listings set reserved_quantity = greatest(0, reserved_quantity - updated_transaction.reserved_quantity), status = case when available_quantity > 0 then 'active'::public.listing_status else 'reserved'::public.listing_status end, updated_at = now() where id = selected_listing.id;
    return jsonb_build_object('transaction_id', updated_transaction.id, 'handed_over', true, 'return_due_at', updated_transaction.return_due_at);
  end if;
  return jsonb_build_object('transaction_id', updated_transaction.id, 'handed_over', false);
end;
$$;

revoke execute on function public.accept_deal(uuid) from public, anon;
revoke execute on function public.confirm_loan_handover(uuid) from public, anon;
grant execute on function public.accept_deal(uuid) to authenticated;
grant execute on function public.confirm_loan_handover(uuid) to authenticated;

commit;
