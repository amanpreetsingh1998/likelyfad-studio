-- ===========================================================================
-- 0001_auth_rls.sql — Google OAuth + per-user isolation
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Written to be safe to run more than once.
--
-- After this runs, your existing rows have user_id = NULL and are therefore
-- invisible to everyone (RLS matches on auth.uid() = user_id). That is
-- deliberate: `node scripts/claim-default-data.mjs --email you@example.com`
-- assigns them to your account and moves the storage objects. Until then the
-- data is untouched, just not selectable through the anon/authenticated roles.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Owner columns
--
-- projects.user_id and media.user_id are `text` today with every row set to
-- the literal 'default'. Convert to uuid, mapping that placeholder to NULL.
-- The DO guards make the conversion a no-op on a second run.
-- ---------------------------------------------------------------------------

-- Both columns carry DEFAULT 'default'. Postgres refuses to cast an existing
-- default to the new type ("default for column ... cannot be cast
-- automatically to type uuid"), so it has to go first. Nothing replaces it:
-- the app stamps user_id explicitly on every write, and the RLS check below
-- rejects a row that omits it rather than letting it default to someone.
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'projects'
        and column_name = 'user_id') = 'text'
  then
    alter table public.projects alter column user_id drop default;
    alter table public.projects
      alter column user_id type uuid using nullif(user_id, 'default')::uuid;
  end if;
end $$;

do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'media'
        and column_name = 'user_id') = 'text'
  then
    alter table public.media alter column user_id drop default;
    alter table public.media
      alter column user_id type uuid using nullif(user_id, 'default')::uuid;
  end if;
end $$;

-- templates and cost_events have no owner column at all yet.
alter table public.templates   add column if not exists user_id uuid;
alter table public.cost_events add column if not exists user_id uuid;

-- ---------------------------------------------------------------------------
-- 2. Foreign keys — deleting an account takes its data with it.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['projects', 'media', 'templates', 'cost_events'] loop
    if not exists (
      select 1 from pg_constraint
      where conname = t || '_user_id_fkey'
        and conrelid = ('public.' || t)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I
           foreign key (user_id) references auth.users(id) on delete cascade',
        t, t || '_user_id_fkey'
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Indexes — every RLS policy below filters on user_id, so each of these
--    backs a predicate that now runs on every single query.
-- ---------------------------------------------------------------------------

create index if not exists projects_user_id_idx    on public.projects(user_id);
create index if not exists media_user_id_idx       on public.media(user_id);
create index if not exists templates_user_id_idx   on public.templates(user_id);
create index if not exists cost_events_user_id_idx on public.cost_events(user_id);

-- ---------------------------------------------------------------------------
-- 4. Row level security
--
-- projects / media / cost_events: strictly private to the owner.
-- templates: readable by any signed-in user (it is a shared library), but only
--            the owner may modify their own rows.
--
-- The service-role key still bypasses all of this by design — that is what the
-- claim script uses, and why no route may serve a user request with it.
-- ---------------------------------------------------------------------------

alter table public.projects    enable row level security;
alter table public.media       enable row level security;
alter table public.templates   enable row level security;
alter table public.cost_events enable row level security;

-- Private tables: one policy set each, generated to keep them identical.
do $$
declare
  t text;
begin
  foreach t in array array['projects', 'media', 'cost_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated
         using (auth.uid() = user_id)', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (auth.uid() = user_id)', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (auth.uid() = user_id)', t || '_delete_own', t);
  end loop;
end $$;

-- Templates: shared read, owned write.
drop policy if exists templates_select_all on public.templates;
drop policy if exists templates_insert_own on public.templates;
drop policy if exists templates_update_own on public.templates;
drop policy if exists templates_delete_own on public.templates;

create policy templates_select_all on public.templates
  for select to authenticated using (true);
create policy templates_insert_own on public.templates
  for insert to authenticated with check (auth.uid() = user_id);
create policy templates_update_own on public.templates
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy templates_delete_own on public.templates
  for delete to authenticated using (auth.uid() = user_id);

commit;

-- Storage policies live in 0002_storage_policies.sql: storage.objects is
-- owned by a role the SQL Editor cannot alter, so that half needs a different
-- route and must not abort this migration.
