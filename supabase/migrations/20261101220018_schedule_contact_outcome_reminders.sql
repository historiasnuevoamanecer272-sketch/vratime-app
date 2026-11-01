begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
 if exists(select 1 from cron.job where jobname='vratime-contact-outcome-reminders') then
  raise exception 'Contact outcome reminder job already exists; inspect before replacing';
 end if;
end $$;
select cron.schedule('vratime-contact-outcome-reminders','* * * * *','select public.generate_listing_contact_outcome_reminders();');
commit;
