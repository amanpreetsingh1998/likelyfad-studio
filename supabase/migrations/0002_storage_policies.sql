-- ===========================================================================
-- 0002_storage_policies.sql — per-user access to the project-media bucket
--
-- Split from 0001 because storage.objects is owned by the `supabase_storage_admin`
-- role. A SQL Editor session runs as `postgres`, which is not that owner, so
-- `alter table storage.objects ...` and `create policy ... on storage.objects`
-- both fail with:
--
--     ERROR: 42501: must be owner of table objects
--
-- TRY THIS FILE FIRST — on some projects `postgres` has been granted enough
-- privilege and it just works. If it errors, use the dashboard instead:
-- Storage → project-media → Policies. The UI runs as the owning role. Create
-- the same four policies there, using the expressions from each block below.
--
-- ---------------------------------------------------------------------------
-- BEFORE YOU ADD ANYTHING, REMOVE WHAT IS ALREADY THERE.
--
-- Postgres combines permissive policies with OR. This bucket currently lets a
-- signed-out anon client upload and read (verified: both return HTTP 200), so
-- at least one permissive "allow anyone" policy already exists. Leaving it in
-- place makes everything below decorative — the old policy alone still grants
-- access.
--
-- Inspect what exists (these are read-only and work in the SQL Editor):
--
--   select relrowsecurity as rls_enabled
--   from pg_class where oid = 'storage.objects'::regclass;
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'storage' and tablename = 'objects';
--
-- Delete every policy that grants access to `anon`, or whose USING clause is
-- simply `true`, from Storage → project-media → Policies. If rls_enabled comes
-- back false, enabling it is also a dashboard job.
-- ---------------------------------------------------------------------------
--
-- The layout these depend on is <ownerId>/<projectId>/<folder>/<file>, built
-- only by src/lib/likelyfad/storagePaths.ts. storage.foldername(name) splits
-- the key into segments; [1] is the owner. A wrong prefix is a 403, not a typo.
-- ===========================================================================

drop policy if exists project_media_select_own on storage.objects;
drop policy if exists project_media_insert_own on storage.objects;
drop policy if exists project_media_update_own on storage.objects;
drop policy if exists project_media_delete_own on storage.objects;

-- Dashboard equivalent — Storage → project-media → Policies → New policy →
-- "For full customization". Allowed operation: SELECT. Target roles:
-- authenticated. USING expression: the body of the using(...) clause below.
create policy project_media_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allowed operation: INSERT. Target roles: authenticated.
-- WITH CHECK expression: the body of the with check(...) clause below.
create policy project_media_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allowed operation: UPDATE. Target roles: authenticated.
-- Needs both a USING and a WITH CHECK expression — same text for each.
create policy project_media_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allowed operation: DELETE. Target roles: authenticated.
create policy project_media_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Verify from the terminal once this is in place:
--
--   npm run supabase:check -- --write
--
-- The "Anon write exposure" section should report that anon writes are
-- blocked. While it still warns, the bucket is open to anyone holding the
-- publishable anon key.
-- ---------------------------------------------------------------------------
