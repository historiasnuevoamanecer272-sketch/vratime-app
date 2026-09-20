begin;

create table if not exists public.funding_settings (
  id boolean primary key default true check (id),
  monthly_target_eur_cents integer not null default 5000 check (monthly_target_eur_cents > 0),
  annual_target_eur_cents integer not null default 60000 check (annual_target_eur_cents > 0),
  campaign_started_on date not null default date_trunc('month', current_date)::date,
  tribute_url text not null default '' check (tribute_url = '' or tribute_url ~ '^https://(t\.me/tribute|web\.tribute\.tg)/'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.funding_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.support_contributions (
  id bigint generated always as identity primary key,
  provider text not null default 'tribute' check (provider = 'tribute'),
  external_event_id text not null unique,
  supporter_hash text,
  event_type text not null check (event_type in ('new_donation', 'recurrent_donation')),
  gross_amount_minor bigint not null check (gross_amount_minor > 0),
  original_currency text not null check (original_currency in ('eur', 'rub', 'usd')),
  net_amount_eur_cents integer not null check (net_amount_eur_cents > 0),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists support_contributions_occurred_at_idx
  on public.support_contributions (occurred_at desc);
create index if not exists support_contributions_supporter_hash_idx
  on public.support_contributions (supporter_hash)
  where supporter_hash is not null;

alter table public.funding_settings enable row level security;
alter table public.support_contributions enable row level security;

revoke all on public.funding_settings from public, anon, authenticated;
revoke all on public.support_contributions from public, anon, authenticated;

create or replace function public.get_funding_progress()
returns table (
  enabled boolean,
  tribute_url text,
  monthly_target_eur_cents integer,
  annual_target_eur_cents integer,
  month_covered_eur_cents bigint,
  year_collected_eur_cents bigint,
  reserve_eur_cents bigint,
  reserved_months numeric,
  supporters_count bigint,
  last_contribution_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with settings as (
    select
      s.enabled,
      s.tribute_url,
      s.monthly_target_eur_cents,
      s.annual_target_eur_cents,
      s.campaign_started_on,
      greatest(
        1,
        (extract(year from current_date)::integer * 12 + extract(month from current_date)::integer)
        - (extract(year from s.campaign_started_on)::integer * 12 + extract(month from s.campaign_started_on)::integer)
        + 1
      )::bigint as months_elapsed
    from public.funding_settings s
    where s.id = true
  ), totals as (
    select
      coalesce(sum(c.net_amount_eur_cents) filter (
        where c.occurred_at >= settings.campaign_started_on::timestamptz
      ), 0)::bigint as campaign_total,
      coalesce(sum(c.net_amount_eur_cents) filter (
        where c.occurred_at >= date_trunc('year', current_date)::timestamptz
          and c.occurred_at < (date_trunc('year', current_date) + interval '1 year')::timestamptz
      ), 0)::bigint as year_total,
      (
        count(distinct c.supporter_hash) filter (where c.supporter_hash is not null)
        + count(*) filter (where c.id is not null and c.supporter_hash is null)
      )::bigint as supporter_total,
      max(c.occurred_at) as last_contribution
    from settings
    left join public.support_contributions c on true
    group by settings.campaign_started_on
  )
  select
    settings.enabled,
    settings.tribute_url,
    settings.monthly_target_eur_cents,
    settings.annual_target_eur_cents,
    greatest(
      least(
        totals.campaign_total - settings.monthly_target_eur_cents::bigint * (settings.months_elapsed - 1),
        settings.monthly_target_eur_cents::bigint
      ),
      0::bigint
    ) as month_covered_eur_cents,
    totals.year_total as year_collected_eur_cents,
    greatest(
      totals.campaign_total - settings.monthly_target_eur_cents::bigint * settings.months_elapsed,
      0::bigint
    ) as reserve_eur_cents,
    round(
      greatest(
        totals.campaign_total - settings.monthly_target_eur_cents::bigint * settings.months_elapsed,
        0::bigint
      )::numeric / settings.monthly_target_eur_cents,
      1
    ) as reserved_months,
    totals.supporter_total as supporters_count,
    totals.last_contribution as last_contribution_at
  from settings cross join totals;
$$;

revoke all on function public.get_funding_progress() from public;
grant execute on function public.get_funding_progress() to anon, authenticated;

commit;
