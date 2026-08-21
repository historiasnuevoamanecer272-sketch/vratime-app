begin;

revoke update on public.listings from anon, authenticated;
revoke insert on public.reviews from anon, authenticated;
drop policy if exists listings_owner_update on public.listings;

create or replace function public.deactivate_listing(target_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare selected_listing public.listings%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into selected_listing from public.listings where id = target_listing_id for update;
  if not found or selected_listing.user_id <> auth.uid() then raise exception 'Listing not found'; end if;
  if selected_listing.status <> 'active' then raise exception 'Only an active listing can be deactivated'; end if;
  update public.listings set status = 'canceled' where id = selected_listing.id;
end;
$$;

create or replace function public.submit_review(target_transaction_id uuid, target_rating integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare selected_transaction public.transactions%rowtype;
declare review_id uuid;
declare partner_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_rating not between 1 and 5 then raise exception 'Rating must be between 1 and 5'; end if;
  select * into selected_transaction from public.transactions where id = target_transaction_id;
  if not found or auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id) then raise exception 'Transaction not found'; end if;
  if selected_transaction.completed_at is null or selected_transaction.canceled_at is not null then raise exception 'Only completed transactions can be reviewed'; end if;
  partner_id := case when auth.uid() = selected_transaction.giver_id then selected_transaction.taker_id else selected_transaction.giver_id end;
  perform 1 from public.profiles where id = partner_id for update;
  insert into public.reviews (transaction_id, from_user_id, to_user_id, rating)
  values (selected_transaction.id, auth.uid(), partner_id, target_rating)
  returning id into review_id;
  update public.profiles p set rating = (select round(avg(r.rating)::numeric, 2) from public.reviews r where r.to_user_id = partner_id), updated_at = now() where p.id = partner_id;
  return review_id;
exception when unique_violation then
  raise exception 'You already reviewed this transaction';
end;
$$;

revoke all on function public.deactivate_listing(uuid) from public;
grant execute on function public.deactivate_listing(uuid) to authenticated;

commit;
