-- ===========================================================================
-- 0024_run_history_scoped_project_join.sql — scope the run feed's workflow join
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0022_user_run_history.sql.
--
-- WHAT WAS WRONG
--
-- 0022's user_run_history is `security definer`, so it bypasses RLS entirely
-- and every table it touches must carry its own scope. The runs were scoped —
-- `where r.user_id = auth.uid()` — and so was the generation_events lateral.
-- The workflow join was not:
--
--     left join public.projects p
--            on p.id = r.project_id
--           and p.deleted_at is null
--
-- Nothing there says the workflow is one the caller may see. The function
-- then reads p.name for the row's title, sets project_exists from p.id, and
-- searches p.name — so any workflow id that reached a run row of the caller's
-- was rendered back with its owner's private name attached.
--
-- On its own that was unreachable, because a run's project_id was supposed to
-- be the caller's own. It was not: startRun() wrote the id straight from the
-- request body through the service-role client with no ownership check, so a
-- signed-in user could open a run against any workflow id — the seeded ones
-- (wf_seed_*) are fixed and in the repo — and read the name back off their own
-- feed. src/lib/workflows/runs.ts now resolves that id before storing it.
--
-- BOTH HALVES ARE FIXED, DELIBERATELY. Either one alone closes the leak. The
-- reason to take both is that they are different claims: the route's is "we do
-- not store an id the caller has no business naming", and this one is "even
-- if such a row existed, this function will not read a workflow out of it".
-- A security definer function that trusts its own table's contents is one
-- careless INSERT away from leaking again, and the next careless insert will
-- not be written by whoever remembers this.
--
-- WHY `or p.is_published` AND NOT OWNERSHIP ALONE
--
-- The join condition mirrors the two select policies on public.projects that
-- RLS would have applied if this function were not security definer: your own
-- rows (0001, projects_select_own) and published ones (0017,
-- projects_select_published). Nothing wider, nothing narrower.
--
-- Ownership alone would be wrong, not merely strict. The studio is admin-only,
-- so /workflows/[id]/run is the only place a non-admin can run anything, and
-- every run made there is against a workflow somebody else owns. Requiring
-- ownership would blank the title and the link on every run those users have
-- ever made — the runs they can actually see are precisely the ones it would
-- break.
--
-- A workflow unpublished after the fact loses its link and falls back to the
-- name snapshot on the run row, which is the same treatment a deleted one
-- already gets, and correct: there is no longer anywhere for that link to go.
-- ===========================================================================

begin;

create or replace function public.user_run_history(
  p_limit  integer default 25,
  p_offset integer default 0,
  p_status text    default null,
  p_q      text    default null
) returns table (
  id           uuid,

  -- The workflow this run belonged to, and whether there is still one to open.
  project_id     text,
  project_name   text,
  project_exists boolean,

  status      text,
  started_at  timestamptz,
  finished_at timestamptz,
  -- Wall clock, never the sum of node durations: nodes run concurrently, so
  -- that sum overstates elapsed time in the direction that flatters nobody.
  duration_ms integer,

  credits_charged integer,
  shortfall       integer,
  node_count      integer,

  -- What actually ran, read from the run's own events rather than the graph.
  -- The graph can be edited after the run; the charge cannot.
  models        text[],
  events_total  bigint,
  events_failed bigint,

  -- Over the whole filtered set, not this page. See 0022's header.
  total_count   bigint,
  total_credits bigint
)
language sql
security definer
set search_path = public
as $fn$
  with filtered as (
    select
      r.id,
      r.project_id,
      -- Snapshot first, live name only as a fallback. See 0022's header.
      coalesce(
        nullif(btrim(coalesce(r.project_name, '')), ''),
        p.name
      )                                as project_name,
      (p.id is not null)               as project_exists,
      r.status,
      r.started_at,
      r.finished_at,
      r.credits_charged,
      r.shortfall,
      r.node_count
      from public.workflow_runs r
      -- Left join, so a run whose workflow is gone still appears. Restricted
      -- to live rows: a soft-deleted workflow is not somewhere to navigate.
      --
      -- AND restricted to workflows this caller may actually see. This
      -- function is security definer, so RLS applies to nothing it reads and
      -- the scope has to be written here. The two arms are the two select
      -- policies on projects: own (0001) and published (0017). See the header
      -- for why published has to be one of them.
      left join public.projects p
             on p.id = r.project_id
            and p.deleted_at is null
            and (p.user_id = auth.uid() or p.is_published)
     where r.user_id = auth.uid()
       and (
         p_status is null
         or btrim(p_status) = ''
         or btrim(p_status) = 'all'
         or r.status = btrim(p_status)
       )
       and (
         p_q is null
         or btrim(p_q) = ''
         or position(lower(btrim(p_q)) in lower(coalesce(r.project_name, ''))) > 0
         or position(lower(btrim(p_q)) in lower(coalesce(p.name, ''))) > 0
       )
  )
  select
    f.id,
    f.project_id,
    f.project_name,
    f.project_exists,
    f.status,
    f.started_at,
    f.finished_at,
    case
      when f.finished_at is null then null
      else (extract(epoch from (f.finished_at - f.started_at)) * 1000)::integer
    end                                        as duration_ms,
    f.credits_charged,
    f.shortfall,
    f.node_count,
    coalesce(ev.models, '{}')                  as models,
    coalesce(ev.total, 0)                      as events_total,
    coalesce(ev.failed, 0)                     as events_failed,
    count(*) over ()                           as total_count,
    -- coalesce inside the sum, not around it: a run still running has a null
    -- charge, which must contribute nothing rather than void the whole total.
    (sum(coalesce(f.credits_charged, 0)) over ())::bigint as total_credits
    from filtered f
    left join lateral (
      select
        array_agg(distinct e.model_id) filter (where e.model_id is not null) as models,
        count(*)                                    as total,
        count(*) filter (where e.status = 'failed') as failed
        from public.generation_events e
       where e.run_id = f.id
         and e.user_id = auth.uid()
    ) ev on true
   order by f.started_at desc
   limit  greatest(coalesce(p_limit, 25), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

-- Re-asserted rather than assumed. `create or replace` keeps the existing
-- grants, but this file has to be correct when it is the one that creates the
-- function — on a database where 0022 was skipped, which is the failure mode
-- this project has hit twice.
revoke all on function public.user_run_history(integer, integer, text, text) from public;
revoke all on function public.user_run_history(integer, integer, text, text) from anon;
grant execute on function public.user_run_history(integer, integer, text, text) to authenticated;
grant execute on function public.user_run_history(integer, integer, text, text) to service_role;

commit;
