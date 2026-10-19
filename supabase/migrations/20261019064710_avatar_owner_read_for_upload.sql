-- Prepared locally; apply only with the agreed publication.
-- Storage upsert needs SELECT as well as INSERT/UPDATE. Public downloads do
-- not grant an authenticated owner permission to read object metadata.
begin;

drop policy if exists avatars_owner_select on storage.objects;
create policy avatars_owner_select on storage.objects for select to authenticated
  using (
    bucket_id = 'AVATARS'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;
