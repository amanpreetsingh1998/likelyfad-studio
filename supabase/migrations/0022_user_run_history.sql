-- ===========================================================================
-- 0022_user_run_history.sql — every run the caller has made, newest first
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0013_workflow_history.sql.
--
-- WHY A SECOND FEED, WHEN 0014 ALREADY READS RUNS
--
-- 0014 has two readers and both are keyed by workflow: user_workflow_history
-- lists workflows, and workflow_run_history lists the runs OF ONE of them.
-- Neither can answer "what have I run lately", and more importantly neither
-- can show a run that belongs to no workflow at all.
--
-- Those exist, and they are not an edge case:
--
--   * workflow_runs.project_id is nullable. A canvas that has never been
--     saved has no projects row, so its runs are recorded with a null
--     project_id and a snapshot name.
--   * project_id is `on delete set null` (0013 §2), which is the whole point
--     of that choice: deleting a workflow must not erase the ledger's
--     explanation of money already spent. The run survives its workflow.
--
-- Both spend real credits and both are invisible on a page keyed by workflow.
-- This function is the surface where that spend can be seen.
--
-- SCOPED BY auth.uid(), NOT BY A PARAMETER — same as everything in 0014.
-- Security definer means it bypasses RLS, so an id parameter would be an open
-- door onto another account's runs. Taking the caller from the JWT means
-- there is no parameter to forge. Called through the CALLER's client, never
-- the service client, or auth.uid() is null and this correctly returns
-- nothing.
--
-- NO SORT PARAMETER. A run feed has exactly one useful order and this is it.
-- The other columns people might sort by — cost, duration — are questions
-- about a workflow rather than about a moment, and user_workflow_history
-- already answers those, ordered, on the tab next door.
--
-- THE INDEX ALREADY EXISTS. workflow_runs_user_idx on (user_id, started_at
-- desc) was created in 0013 and described there as "this account's runs,
-- newest first — the history page's own feed". It has had no reader until
-- now; this is the query it was built for.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- user_run_history — one page of the caller's runs, across every workflow
--
-- WHICH NAME A ROW CARRIES. workflow_runs.project_name is snapshot when the
-- run opens, and it wins over the workflow's current name. That is deliberate
-- and it is the same rule admin_actions follows for the actor's email: the
-- snapshot names what was actually run, so a workflow renamed last week does
-- not silently retitle every run that happened before it. The live name is
-- the fallback for runs old enough to predate the snapshot, not the default.
--
-- project_exists ANSWERS A DIFFERENT QUESTION from project_id being set. A
-- run can name a workflow that has since been deleted or soft-deleted, and
-- the row must then say "no workflow" rather than offer a link that 404s —
-- on the very row that documents the deletion. Exactly the reasoning behind
-- target_exists in admin_actions_list.
--
-- TOTALS RIDE ALONG AS WINDOW FUNCTIONS, over the filtered set and not the
-- page. Summing the twenty-five rows on screen and calling it "credits
-- spent" produces a number that looks like a fact about the account and is
-- actually a fact about the pagination. Same trick, and same reason, as
-- total_count in admin_users_list.
--
-- SEARCH USES position(), NOT ilike '%…%' — the needle is typed into the
-- user's own search box, so a stray % should find a percent sign rather than
-- matching every run they have ever made.
--
-- THE STATUS FILTER IS CAPPED, NOT WHITELISTED. An unrecognised status
-- filters to that status and returns nothing, rather than falling back to
-- "everything". The audit log's action filter takes the same position for the
-- same reason: a filter that silently widens when it does not recognise its
-- own argument shows the user a list that is not what they asked for.
-- ---------------------------------------------------------------------------

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

  -- Over the whole filtered set, not this page. See the header.
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
      -- Snapshot first, live name only as a fallback. See the header.
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
      left join public.projects p
             on p.id = r.project_id
            and p.deleted_at is null
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

-- anon has no auth.uid(), so this would return nothing anyway. Revoked all the
-- same: a function that reads a user's ledger should not be callable without a
-- session, whatever it would happen to answer.
revoke all on function public.user_run_history(integer, integer, text, text) from public;
revoke all on function public.user_run_history(integer, integer, text, text) from anon;
grant execute on function public.user_run_history(integer, integer, text, text) to authenticated;
grant execute on function public.user_run_history(integer, integer, text, text) to service_role;

commit;
