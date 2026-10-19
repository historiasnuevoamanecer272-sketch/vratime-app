begin;

-- A loan describes a particular reusable item. Existing material loans and
-- their transaction history remain unchanged; only new/edited content is checked.
create function public.validate_loan_item_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.type = 'lend' then
    if new.category_id is not null or new.category_path is distinct from 'lend/item' then
      raise exception 'loan_item_category_required';
    end if;
    if char_length(btrim(coalesce(new.category,''))) not between 3 and 100 then
      raise exception 'loan_item_name_required';
    end if;
    if char_length(btrim(coalesce(new.description,''))) not between 5 and 500 then
      raise exception 'loan_item_description_required';
    end if;
    if new.condition is null or new.condition not in ('new','usable','worn','repair') then
      raise exception 'loan_item_condition_required';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_loan_item_fields() from public,anon,authenticated;
create trigger listings_validate_loan_item before insert or update of type,category_id,category,category_path,description,condition on public.listings
for each row execute function public.validate_loan_item_fields();

-- Keep the existing map contract for already-open clients. The new projection
-- adds only the public loan duration, never the private pickup coordinates.
create function public.get_public_map_listings_v2()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('loan_duration_days',
    case when l.type='lend' then l.loan_duration_days else null end) order by p.created_at desc,p.id),'[]'::jsonb)
  from public.get_public_map_listings() p join public.listings l on l.id=p.id;
$$;
revoke all on function public.get_public_map_listings_v2() from public;
grant execute on function public.get_public_map_listings_v2() to anon,authenticated;

commit;
