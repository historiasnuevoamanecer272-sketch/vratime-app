begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- PostgreSQL CHECK accepts NULL, so range checks alone do not require a term.
-- Add and validate the replacement before removing the previous constraint.
alter table public.listings
  add constraint listings_lend_requirements_strict_check check (
    type <> 'lend' or (
      loan_duration_days is not null
      and loan_duration_days between 1 and 365
      and image_url is not null
      and image_url ~ '[^[:space:]]'
    )
  ) not valid;

alter table public.listings validate constraint listings_lend_requirements_strict_check;
alter table public.listings drop constraint listings_lend_requirements_check;
alter table public.listings rename constraint listings_lend_requirements_strict_check to listings_lend_requirements_check;

commit;
