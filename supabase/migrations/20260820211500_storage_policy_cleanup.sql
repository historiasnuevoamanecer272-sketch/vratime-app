begin;

drop policy if exists "Authenticated Upload" on storage.objects;
drop policy if exists "Owner Delete" on storage.objects;
drop policy if exists "Public Read" on storage.objects;

commit;
