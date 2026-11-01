-- Durable in-app reminders only. No automatic listing closure or external mail.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create extension if not exists pg_cron with schema pg_catalog;
create index listings_owner_check_due on public.listings(owner_check_due_at,id)
 where status='active' and moderation_status='approved';
do $$
begin
 if exists(select 1 from cron.job where jobname='vratime-listing-relevance-checks') then
  raise exception 'Reminder job already exists; inspect it before replacing';
 end if;
end;
$$;
select cron.schedule('vratime-listing-relevance-checks','*/15 * * * *','select public.generate_listing_check_reminders();');
commit;
