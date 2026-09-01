-- ===========================================================================
-- 0018_published_media.sql — a published workflow's media, readable by the
-- people allowed to run it
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0002_storage_policies.sql and
-- 0017_published_workflows.sql.
--
-- THE BUG THIS FIXES
--
-- 0017 made a published workflow's *graph* readable by everyone signed in, but
-- not the media the graph points at. Saved workflows do not carry their images
-- inline — they were externalised to the `project-media` bucket and replaced
-- with a `<field>Ref`, and 0002 scopes that bucket to
--
--     (storage.foldername(name))[1] = auth.uid()::text
--
-- which is the OWNER's id. So a user opening a published workflow got the
-- graph, then a 403 on every input image in it. The run page rendered with
-- empty pictures and the run itself went to a provider with nothing attached.
-- Nothing errored loudly; it just did not work.
--
-- THE FIX, AND ITS EXACT SCOPE
--
-- The layout is `<ownerId>/<projectId>/<folder>/<mediaId>.<ext>` (see
-- src/lib/likelyfad/storagePaths.ts), so segment 2 names the project. This
-- grants SELECT on objects whose project is published — and only SELECT.
--
-- WHAT IT DOES NOT GRANT
--
--   * No insert, update or delete. A runner cannot write into, overwrite or
--     remove anything under the author's prefix. 0002's owner-only write
--     policies remain the whole story for writes.
--   * Nothing outside a published project. The subquery names one project id
--     and requires is_published; unpublishing revokes this in the same
--     statement that hides the workflow, with no second thing to remember.
--   * Nothing from a soft-deleted project, matching 0017.
--
-- WHY THE WHOLE PROJECT PREFIX AND NOT JUST `inputs`
--
-- Considered narrowing this to the input folders. Rejected: the author's saved
-- node outputs are referenced by the same graph that publishing already makes
-- readable, so withholding them would leave the run page showing broken
-- pictures for results the viewer is entitled to see anyway. Publishing shares
-- the workflow, and the media embedded in it is part of the workflow.
--
-- Be deliberate about that when publishing: everything stored under a
-- project's prefix becomes readable by every signed-in user, including
-- generations saved into it.
-- ===========================================================================

begin;

drop policy if exists project_media_select_published on storage.objects;

-- Dashboard equivalent — Storage → project-media → Policies → New policy →
-- "For full customization". Allowed operation: SELECT. Target roles:
-- authenticated. USING expression: the body of the using(...) clause below.
--
-- Permissive policies are OR'd, so this sits beside project_media_select_own
-- from 0002 rather than replacing it: your own prefix, plus published projects.
create policy project_media_select_published on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-media'
    and exists (
      select 1
        from public.projects p
       where p.id = (storage.foldername(name))[2]
         and p.is_published
         and p.deleted_at is null
    )
  );

-- The subquery runs per object listed, so it wants the primary key lookup it
-- already has on projects.id — plus this, so the is_published filter does not
-- pull the row in only to reject it.
create index if not exists projects_published_lookup_idx
  on public.projects(id)
  where is_published and deleted_at is null;

commit;
