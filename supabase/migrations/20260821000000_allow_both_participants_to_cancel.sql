-- Either participant may cancel an uncompleted arrangement.
-- The canceled transaction remains in history; the listing becomes active again.
begin;

create or replace function public.cancel_booking(target_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into selected_transaction
  from public.transactions
  where id = target_transaction_id
  for update;

  if not found then raise exception 'Transaction not found'; end if;
  if auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then
    raise exception 'Only a deal participant can cancel';
  end if;
  if selected_transaction.completed_at is not null or selected_transaction.canceled_at is not null then
    raise exception 'Transaction is already closed';
  end if;

  update public.transactions set canceled_at = now() where id = selected_transaction.id;
  update public.listings set status = 'active' where id = selected_transaction.listing_id and status = 'reserved';
end;
$$;

revoke all on function public.cancel_booking(uuid) from public;
grant execute on function public.cancel_booking(uuid) to authenticated;

commit;
