-- ===========================================================================
-- 0017_published_workflows.sql — workflows the admin builds, users run
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0013 and 0014.
--
-- WHY
--
-- The studio is admin-only, so a non-admin cannot build a workflow — which
-- left them with a history page that could only ever be empty. Publishing is
-- the other half: the admin builds a workflow and marks it available, and any
-- signed-in user can then run it.
--
-- WHAT PUBLISHING IS, AND IS NOT
--
-- It is a read grant on one project row, nothing more. A published workflow
-- stays owned by whoever built it: they alone may edit it, rename it,
-- unpublish it or delete it. There is no copy, no fork and no second owner.
--
-- It is NOT a grant on anything the workflow produced. Runs, charges,
-- generation events and outputs all belong to whoever ran them — a user
-- running the admin's workflow spends their own credits and gets their own
-- history row, and the admin cannot see it through this policy. That
-- separation is the whole point: publishing shares the recipe, never the
-- kitchen.
--
-- WHY A COLUMN AND NOT A shared_workflows TABLE
--
-- A join table is the right shape for "shared with these specific people".
-- This is "available to everyone signed in", which is one bit. A table would
-- add a row per user per workflow to express a value that is the same for all
-- of them, and every read of the catalogue would carry a join to discover it.
-- If per-user or per-group sharing is ever wanted, THAT is when the table
-- earns its place — and `is_published` becomes the "everyone" special case
-- rather than something to unpick.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The flag
--
-- published_at is kept separately rather than inferred, because "when did this
-- become available" is a question the owner will ask and a boolean cannot
-- answer. Unpublishing clears it: the next publish is a new event, not a
-- resumption of the old one.
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists is_published boolean not null default false,
  add column if not exists published_at timestamptz;

-- The catalogue query: what is available, most recently updated first.
-- Partial, because published workflows are the small minority of all rows.
create index if not exists projects_published_idx
  on public.projects(updated_at desc)
  where is_published and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. RLS — read, and only read
--
-- Postgres OR's permissive policies together, so this sits beside
-- projects_select_own from 0001 rather than replacing it: you can read your
-- own rows, plus any published one.
--
-- SELECT ONLY, DELIBERATELY. There is no matching insert, update or delete
-- policy, so the existing owner-only write policies remain the whole story. A
-- user who can run a published workflow still cannot rename it, edit its
-- graph, unpublish it or delete it — the database refuses, not the UI.
--
-- Soft-deleted rows are excluded here but stay visible to their owner through
-- projects_select_own, which is what lets a deleted workflow keep explaining
-- the money its runs spent.
-- ---------------------------------------------------------------------------

drop policy if exists projects_select_published on public.projects;
create policy projects_select_published on public.projects
  for select to authenticated
  using (is_published and deleted_at is null);

-- ---------------------------------------------------------------------------
-- 3. user_workflow_history — include what is shared with the caller
--
-- DROPPED, not replaced: the return type gains columns, and Postgres will not
-- change the shape of an existing function's OUT parameters in place.
--
-- Two changes only:
--
--   * the filter admits published workflows owned by anyone, not just the
--     caller's own rows;
--   * two new columns say which kind each row is, so the page can offer Open
--     to an owner and Run to everybody else.
--
-- EVERY FIGURE STAYS THE CALLER'S OWN. The run statistics already scope to
-- auth.uid(), and that is exactly right here: on a shared workflow, "cost of
-- one run" must mean what it cost YOU. Showing the admin's cost to a user, or
-- the busiest user's cost to the admin, would be a number about somebody else
-- presented as a number about you.
-- ---------------------------------------------------------------------------

drop function if exists public.user_workflow_history(integer, integer, text, text);

create or replace function public.user_workflow_history(
  p_limit  integer default 25,
  p_offset integer default 0,
  p_q      text    default null,
  p_sort   text    default 'updated'
) returns table (
  project_id   text,
  title        text,
  description  text,
  node_count   integer,
  created_at   timestamptz,
  updated_at   timestamptz,

  -- Who this row belongs to, from the caller's point of view.
  is_owner     boolean,
  is_published boolean,

  est_credits     integer,
  est_duration_ms integer,
  est_partial     boolean,
  est_models      text[],

  -- All of the following count only the CALLER's runs. See the header.
  run_count       bigint,
  success_count   bigint,
  failed_count    bigint,
  last_run_at     timestamptz,
  last_run_status text,

  last_success_at          timestamptz,
  last_success_credits     integer,
  last_success_duration_ms integer,
  last_success_models      text[],

  credits_min integer,
  credits_max integer,

  total_count bigint
)
language sql
security definer
set search_path = public
as $fn$
  with filtered as (
    select
      p.id,
      p.name,
      p.description,
      p.node_count,
      p.created_at,
      p.updated_at,
      p.user_id,
      p.is_published,
      p.est_credits,
      p.est_duration_ms,
      p.est_partial,
      p.models
      from public.projects p
     where p.deleted_at is null
       and (
         -- Mine, or shared with everyone.
         p.user_id = auth.uid()
         or p.is_published
       )
       and (
         p_q is null
         or btrim(p_q) = ''
         or position(lower(btrim(p_q)) in lower(coalesce(p.name, ''))) > 0
         or position(lower(btrim(p_q)) in lower(coalesce(p.description, ''))) > 0
       )
  ),
  run_stats as (
    select
      r.project_id,
      count(*)                                          as run_count,
      count(*) filter (where r.status = 'completed')    as success_count,
      count(*) filter (where r.status in ('failed', 'cancelled', 'abandoned'))
                                                        as failed_count,
      max(r.started_at)                                 as last_run_at,
      min(r.credits_charged) filter (where r.status = 'completed')
                                                        as credits_min,
      max(r.credits_charged) filter (where r.status = 'completed')
                                                        as credits_max
      from public.workflow_runs r
     where r.user_id = auth.uid()
       and r.project_id is not null
     group by r.project_id
  )
  select
    f.id            as project_id,
    f.name          as title,
    f.description,
    f.node_count,
    f.created_at,
    f.updated_at,

    (f.user_id = auth.uid())                        as is_owner,
    coalesce(f.is_published, false)                 as is_published,

    f.est_credits,
    f.est_duration_ms,
    f.est_partial,
    coalesce(f.models, '{}')                        as est_models,

    coalesce(s.run_count, 0)                        as run_count,
    coalesce(s.success_count, 0)                    as success_count,
    coalesce(s.failed_count, 0)                     as failed_count,
    s.last_run_at,
    latest.status                                   as last_run_status,

    win.finished_at                                 as last_success_at,
    win.credits_charged                             as last_success_credits,
    case
      when win.finished_at is null or win.started_at is null then null
      else (extract(epoch from (win.finished_at - win.started_at)) * 1000)::integer
    end                                             as last_success_duration_ms,
    coalesce(models.ids, '{}')                      as last_success_models,

    s.credits_min,
    s.credits_max,

    count(*) over ()                                as total_count
    from filtered f
    left join run_stats s on s.project_id = f.id

    left join lateral (
      select r.status
        from public.workflow_runs r
       where r.project_id = f.id
         and r.user_id = auth.uid()
       order by r.started_at desc
       limit 1
    ) latest on true

    left join lateral (
      select r.id, r.started_at, r.finished_at, r.credits_charged
        from public.workflow_runs r
       where r.project_id = f.id
         and r.user_id = auth.uid()
         and r.status = 'completed'
       order by r.finished_at desc nulls last
       limit 1
    ) win on true

    left join lateral (
      select array_agg(distinct e.model_id) filter (where e.model_id is not null) as ids
        from public.generation_events e
       where e.run_id = win.id
         and e.user_id = auth.uid()
         and e.status = 'succeeded'
    ) models on true

   order by
     -- Your own workflows first, then the shared catalogue. An admin opening
     -- this page is looking for their own work; a user has nothing else here,
     -- so the split costs them nothing.
     (f.user_id = auth.uid()) desc,
     case when p_sort = 'cost'    then win.credits_charged end desc nulls last,
     case when p_sort = 'runs'    then s.run_count         end desc nulls last,
     case when p_sort = 'lastrun' then s.last_run_at       end desc nulls last,
     case when p_sort = 'created' then f.created_at        end desc nulls last,
     case when p_sort = 'title'   then lower(f.name)       end asc  nulls last,
     f.updated_at desc
   limit  greatest(coalesce(p_limit, 25), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

revoke all on function public.user_workflow_history(integer, integer, text, text) from public;
revoke all on function public.user_workflow_history(integer, integer, text, text) from anon;
grant execute on function public.user_workflow_history(integer, integer, text, text) to authenticated;
grant execute on function public.user_workflow_history(integer, integer, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. set_workflow_published — the only way the flag moves
--
-- Owner-checked in SQL rather than trusted from the route. The route checks
-- too, and both checks are wanted: the route's produces a decent 404, and this
-- one is what holds if a future caller forgets.
--
-- Returns the new state, so a caller cannot misreport what happened by
-- assuming its own request succeeded.
-- ---------------------------------------------------------------------------

create or replace function public.set_workflow_published(
  p_project_id text,
  p_published  boolean
) returns table (project_id text, is_published boolean, published_at timestamptz)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
  update public.projects p
     set is_published = p_published,
         -- Cleared on unpublish: the next publish is a new event, not a
         -- resumption of the one before it.
         published_at = case when p_published then coalesce(p.published_at, now()) else null end
   where p.id = p_project_id
     and p.user_id = auth.uid()
     and p.deleted_at is null
  returning p.id, p.is_published, p.published_at;
end;
$fn$;

revoke all on function public.set_workflow_published(text, boolean) from public;
revoke all on function public.set_workflow_published(text, boolean) from anon;
grant execute on function public.set_workflow_published(text, boolean) to authenticated;
grant execute on function public.set_workflow_published(text, boolean) to service_role;

commit;
