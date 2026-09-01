-- ===========================================================================
-- 0016_close_abandoned_runs.sql — a closed tab leaves a run open forever
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0013_workflow_history.sql.
--
-- THE LEAK
--
-- executeWorkflow closes its run from both exit paths, but neither runs if the
-- tab is closed, the machine sleeps, or the browser kills the page mid-render.
-- Those rows sit at status 'running' with no finished_at, forever. They are
-- the run-level twin of the unsettled pending_charges leak 0011 sweeps, and
-- they need the same treatment for the same reason.
--
-- Left alone they are worse than untidy. The history page counts runs by
-- status, so every abandoned tab permanently inflates "7 runs (6 ok)" with a
-- run that is neither — and a workflow whose only run was abandoned would show
-- as still running, weeks later, on a page whose whole job is to say what
-- happened.
--
-- WHY 'abandoned' AND NOT 'cancelled'
--
-- Cancelled is a decision someone made; abandoned is the absence of one. They
-- read identically in the ledger and mean different things to whoever is
-- asking why a run stopped — and the difference is exactly what tells a user
-- "you stopped this" from "we never found out how this ended". Collapsing them
-- would throw that away to save a status string.
--
-- STALENESS IS THE SAFETY ARGUMENT, AGAIN
--
-- A workflow that is still running also has an open run row, so sweeping too
-- early would close a run that is still going and settle it mid-flight. The
-- caller defaults p_minutes to 60; the longest single route timeout in the app
-- is 5.
--
-- SETTLE, DO NOT JUST RELABEL. An abandoned run's nodes really did reach
-- providers, so its pending rows are real money. settle_workflow_run bills
-- them and writes the totals back, which also means the history page shows
-- what the abandoned run cost rather than a blank where a number belongs.
-- ===========================================================================

begin;

create or replace function public.sweep_abandoned_runs(
  p_minutes integer default 60,
  p_limit   integer default 500
) returns table (
  run_id    uuid,
  user_id   uuid,
  charged   integer,
  runs      integer,
  shortfall integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_run    record;
  v_result record;
begin
  if p_minutes is null or p_minutes < 1 then
    raise exception 'p_minutes must be >= 1 (got %)', p_minutes;
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be >= 1 (got %)', p_limit;
  end if;

  -- Oldest first, so a sweep that has been broken for a week drains the
  -- backlog in bounded batches rather than taking every lock at once. Backed
  -- by workflow_runs_open_idx, which 0013 created for this query.
  for v_run in
    select r.id, r.user_id
      from public.workflow_runs r
     where r.status = 'running'
       and r.started_at < now() - make_interval(mins => p_minutes)
     order by r.started_at
     limit p_limit
  loop
    -- Bills this run's pending rows and sets status/finished_at in one call.
    -- Finding nothing to bill is fine and common: the client usually settled
    -- before the tab died and only failed to close the row.
    select * into v_result
      from public.settle_workflow_run(v_run.user_id, v_run.id, 'abandoned');

    run_id    := v_run.id;
    user_id   := v_run.user_id;
    charged   := v_result.charged;
    runs      := v_result.runs;
    shortfall := v_result.shortfall;
    return next;
  end loop;
end;
$fn$;

revoke all on function public.sweep_abandoned_runs(integer, integer) from public;
revoke all on function public.sweep_abandoned_runs(integer, integer) from anon;
revoke all on function public.sweep_abandoned_runs(integer, integer) from authenticated;
grant execute on function public.sweep_abandoned_runs(integer, integer) to service_role;

commit;
