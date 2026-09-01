-- ===========================================================================
-- 0014_workflow_history_read.sql — one round trip that answers the history page
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0013_workflow_history.sql.
--
-- WHY THESE AGGREGATES ARE SQL AND NOT A QUERY IN THE ROUTE
--
-- Same argument as 0007_admin_stats.sql. These count over tables that only
-- grow, and one aggregate query per workflow on screen is the shape that works
-- fine for a fortnight and then dies quietly. Doing it in Node also means N+1
-- round trips for a page that is meant to be one.
--
-- BOTH FUNCTIONS ARE SCOPED BY auth.uid(), NOT BY A PARAMETER
--
-- They are security definer, so they bypass RLS — which means an id parameter
-- would be an open door: pass someone else's and read their history. Taking
-- the caller's identity from the JWT instead means there is no parameter to
-- forge. The routes call these through the CALLER'S client, never the service
-- client, so auth.uid() is populated.
--
-- WHAT "COST OF ONE RUN" MEANS HERE
--
-- The credits_charged of the newest completed run, and nothing else. Not a
-- mean over runs: runs genuinely vary — a model swap, a different image count,
-- a fallback — and averaging blends a 4-credit run and a 90-credit one into a
-- number that describes neither. The range rides along separately so the
-- variance is visible rather than hidden inside one figure.
--
-- Where no successful run exists the page falls back to projects.est_credits,
-- and it must LABEL that as an estimate. The two numbers are different kinds
-- of claim and showing them in the same column unlabelled makes a guess look
-- like a measurement.
--
-- WHY DURATION IS WALL CLOCK
--
-- finished_at - started_at on the run row, not the sum of the node durations
-- in generation_events. Nodes run concurrently (maxConcurrentCalls), so that
-- sum overstates elapsed time, often by a lot, and always in the direction
-- that makes the product look slower than it is.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. user_workflow_history — one page of the caller's workflows
--
-- total_count rides along as a window function rather than a second count
-- query: the filtered set is already materialised, and a separate count is
-- both another full pass and a chance to disagree with the page it labels.
-- Same reasoning as admin_users_list.
--
-- SEARCH USES position(), NOT ilike '%…%'. The needle is typed by the user
-- into their own search box, so a stray % should find a percent sign rather
-- than silently matching every workflow they own.
--
-- SORTING PICKS A COLUMN, NOT A DIRECTION. Each sortable figure has one useful
-- order — most recent, most expensive, most run — and the reverse doubles the
-- states to answer a question this page is not for. An unrecognised key falls
-- through to the updated_at tiebreak rather than being interpolated into a
-- query.
-- ---------------------------------------------------------------------------

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

  -- What the graph WOULD cost, cached at save. Shown only when there is no
  -- measured figure, and always labelled as an estimate.
  est_credits     integer,
  est_duration_ms integer,
  est_partial     boolean,
  est_models      text[],

  -- What running it DID cost. Null until a run of it has completed.
  run_count       bigint,
  success_count   bigint,
  failed_count    bigint,
  last_run_at     timestamptz,
  last_run_status text,

  last_success_at          timestamptz,
  last_success_credits     integer,
  last_success_duration_ms integer,
  -- Distinct models the last successful run actually used — read from that
  -- run's events, not from the graph, because the graph can be edited after
  -- the run and the charge cannot.
  last_success_models      text[],

  -- Over successful runs, so the card can say "ranged 38-61 across 6 runs"
  -- instead of implying the single headline figure describes all of them.
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
      p.est_credits,
      p.est_duration_ms,
      p.est_partial,
      p.models
      from public.projects p
     where p.user_id = auth.uid()
       and p.deleted_at is null
       and (
         p_q is null
         or btrim(p_q) = ''
         or position(lower(btrim(p_q)) in lower(coalesce(p.name, ''))) > 0
         or position(lower(btrim(p_q)) in lower(coalesce(p.description, ''))) > 0
       )
  ),
  -- One pass over this user's runs, grouped by workflow. Scoped by user_id as
  -- well as project_id: project_id alone would also match a run whose project
  -- was deleted and whose id was later reused by another account's client-
  -- minted string.
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
    -- Wall clock, in milliseconds. See the header.
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

    -- The most recent run of any outcome, for the "last run failed" line. A
    -- separate lateral from the winner below because they are different
    -- questions and the answers are frequently different rows.
    left join lateral (
      select r.status
        from public.workflow_runs r
       where r.project_id = f.id
         and r.user_id = auth.uid()
       order by r.started_at desc
       limit 1
    ) latest on true

    -- The headline figures: the newest COMPLETED run. Backed by
    -- workflow_runs_success_idx, which exists for exactly this lookup.
    left join lateral (
      select r.id, r.started_at, r.finished_at, r.credits_charged
        from public.workflow_runs r
       where r.project_id = f.id
         and r.user_id = auth.uid()
         and r.status = 'completed'
       order by r.finished_at desc nulls last
       limit 1
    ) win on true

    -- What that run actually used. Empty rather than null when retention has
    -- already pruned its events — which is precisely why the cost and duration
    -- live on the run row and not here.
    left join lateral (
      select array_agg(distinct e.model_id) filter (where e.model_id is not null) as ids
        from public.generation_events e
       where e.run_id = win.id
         and e.user_id = auth.uid()
         and e.status = 'succeeded'
    ) models on true

   order by
     case when p_sort = 'cost'    then win.credits_charged end desc nulls last,
     case when p_sort = 'runs'    then s.run_count         end desc nulls last,
     case when p_sort = 'lastrun' then s.last_run_at       end desc nulls last,
     case when p_sort = 'created' then f.created_at        end desc nulls last,
     case when p_sort = 'title'   then lower(f.name)       end asc  nulls last,
     f.updated_at desc
   limit  greatest(coalesce(p_limit, 25), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

-- Called through the caller's own client so auth.uid() is populated, which is
-- why `authenticated` keeps execute here — unlike the admin functions, whose
-- whole point is that only the service role may run them.
revoke all on function public.user_workflow_history(integer, integer, text, text) from public;
revoke all on function public.user_workflow_history(integer, integer, text, text) from anon;
grant execute on function public.user_workflow_history(integer, integer, text, text) to authenticated;
grant execute on function public.user_workflow_history(integer, integer, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. workflow_run_history — every run of one workflow
--
-- The detail drawer. This is where the card's single headline figure stops
-- being a claim about every run: the variance that "cost of one run" hides is
-- visible here, run by run.
--
-- Scoped by auth.uid() like §1, so passing another account's project id
-- returns nothing rather than their history.
-- ---------------------------------------------------------------------------

create or replace function public.workflow_run_history(
  p_project_id text,
  p_limit      integer default 50,
  p_offset     integer default 0
) returns table (
  id              uuid,
  status          text,
  started_at      timestamptz,
  finished_at     timestamptz,
  duration_ms     integer,
  credits_charged integer,
  shortfall       integer,
  node_count      integer,
  models          text[],
  -- Counted rather than listed: the drawer shows how much of the run reached a
  -- provider, and the prompts themselves belong to moderation, not here.
  events_total    bigint,
  events_failed   bigint,
  total_count     bigint
)
language sql
security definer
set search_path = public
as $fn$
  with filtered as (
    select r.*
      from public.workflow_runs r
     where r.user_id = auth.uid()
       and r.project_id = p_project_id
  )
  select
    f.id,
    f.status,
    f.started_at,
    f.finished_at,
    case
      when f.finished_at is null then null
      else (extract(epoch from (f.finished_at - f.started_at)) * 1000)::integer
    end                          as duration_ms,
    f.credits_charged,
    f.shortfall,
    f.node_count,
    coalesce(ev.models, '{}')    as models,
    coalesce(ev.total, 0)        as events_total,
    coalesce(ev.failed, 0)       as events_failed,
    count(*) over ()             as total_count
    from filtered f
    left join lateral (
      select
        array_agg(distinct e.model_id) filter (where e.model_id is not null) as models,
        count(*)                                        as total,
        count(*) filter (where e.status = 'failed')     as failed
        from public.generation_events e
       where e.run_id = f.id
         and e.user_id = auth.uid()
    ) ev on true
   order by f.started_at desc
   limit  greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

revoke all on function public.workflow_run_history(text, integer, integer) from public;
revoke all on function public.workflow_run_history(text, integer, integer) from anon;
grant execute on function public.workflow_run_history(text, integer, integer) to authenticated;
grant execute on function public.workflow_run_history(text, integer, integer) to service_role;

commit;
