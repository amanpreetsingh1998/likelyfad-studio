-- ===========================================================================
-- 0015_model_latency.sql — how long each model actually takes
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0006_generation_events.sql.
--
-- WHY MEASURED AND NOT ESTIMATED
--
-- "How long does this workflow take" has a static answer in
-- src/lib/workflows/estimate.ts — one number per run kind — and that answer is
-- a guess. It has to exist, because a brand-new install has measured nothing
-- and a blank where the time should be is worse than a rough figure. But it is
-- a poor guess: a video model can be four seconds or four minutes, and the
-- kind does not tell you which.
--
-- generation_events has recorded duration_ms per run since 0006. This turns
-- that into a per-model median, which replaces the static fallback for every
-- model that has enough history to have one.
--
-- WHY THE MEDIAN AND NOT THE MEAN
--
-- Provider latency is long-tailed. A single run that hit a cold start or a
-- retry storm drags a mean somewhere no run has ever been, and the figure this
-- feeds is shown to a user as "about this long". p90 is returned alongside so
-- a caller can show a range rather than implying a precision the data does not
-- have.
--
-- ONLY SUCCEEDED RUNS COUNT
--
-- A failed run's duration measures how long the provider took to give up,
-- which is a different quantity and usually a much smaller one. Including
-- those would make an unreliable model look fast.
--
-- p_min_runs EXISTS BECAUSE TWO SAMPLES ARE NOT A MEDIAN. A model with one
-- recorded run would otherwise present that single number with the same
-- authority as one with four hundred, and the first run of any new model is
-- the one most likely to be an outlier.
-- ===========================================================================

begin;

-- The lookup this function does: succeeded runs for a model, newest first.
-- Partial on status, because failed and pending rows are never counted.
create index if not exists generation_events_latency_idx
  on public.generation_events(model_id, created_at desc)
  where status = 'succeeded' and duration_ms is not null;

create or replace function public.model_latency_stats(
  p_days     integer default 30,
  p_min_runs integer default 3
) returns table (
  model_id     text,
  runs         bigint,
  median_ms    integer,
  p90_ms       integer
)
language sql
security definer
set search_path = public
as $fn$
  select
    e.model_id,
    count(*)                                                             as runs,
    (percentile_cont(0.5) within group (order by e.duration_ms))::integer as median_ms,
    (percentile_cont(0.9) within group (order by e.duration_ms))::integer as p90_ms
    from public.generation_events e
   where e.model_id is not null
     and e.status = 'succeeded'
     and e.duration_ms is not null
     -- A run cannot take a negative time, and a multi-hour one is a row whose
     -- completed_at was written long after the fact rather than a measurement.
     and e.duration_ms > 0
     and e.duration_ms < 3600000
     and e.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   group by e.model_id
  having count(*) >= greatest(coalesce(p_min_runs, 3), 1);
$fn$;

-- ---------------------------------------------------------------------------
-- Deliberately readable by any signed-in user.
--
-- This aggregates across every account, which is why it is worth being
-- explicit about what it discloses: a model id, a count of runs, and two
-- durations. No user, no prompt, no output, and nothing that can be traced to
-- an account — the same class of information as a published rate card.
--
-- The alternative, scoping it per user, would mean a user's first run of any
-- model always falls back to the static guess even though we have thousands of
-- measurements of it. That is a worse estimate for no privacy gained.
-- ---------------------------------------------------------------------------
revoke all on function public.model_latency_stats(integer, integer) from public;
revoke all on function public.model_latency_stats(integer, integer) from anon;
grant execute on function public.model_latency_stats(integer, integer) to authenticated;
grant execute on function public.model_latency_stats(integer, integer) to service_role;

commit;
