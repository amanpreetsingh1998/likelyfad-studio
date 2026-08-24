-- ===========================================================================
-- 0007_admin_stats.sql — the numbers behind the admin dashboard
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0003, 0004 and 0006.
--
-- WHY SQL FUNCTIONS RATHER THAN QUERIES IN THE ROUTE
--
-- Every figure here is an aggregate over a table that only grows. Pulling rows
-- into Node to count them works until it very suddenly does not, and the
-- failure lands on the one page you open when something is already wrong.
-- Postgres does the counting; the route does one round trip per panel.
--
-- They are SECURITY DEFINER because auth.users is not readable by the
-- application roles, and granted to service_role alone — the admin routes
-- reach them only after requireAdmin() has passed.
--
-- A NOTE ON DATES
--
-- Days are bucketed by created_at::date in the database's timezone (UTC on
-- Supabase). A dashboard read from IST will therefore cut days at 05:30 local.
-- That is a reporting quirk, not a bug to fix here — moving it would mean
-- storing an offset and applying it consistently to every panel.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. admin_stats_overview — the headline tiles
--
-- One jsonb blob rather than a wide row: these are unrelated scalars read
-- together and never joined, and a blob means adding a tile later does not
-- change the function's signature.
--
-- "Active" counts users who GENERATED, not users who signed in. A session that
-- opens the studio and does nothing is not a measure of anything, and
-- last_sign_in_at moves on a silent token refresh.
-- ---------------------------------------------------------------------------

create or replace function public.admin_stats_overview()
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'users', jsonb_build_object(
      'total',     (select count(*) from auth.users),
      'new_7d',    (select count(*) from auth.users where created_at >= now() - interval '7 days'),
      'new_30d',   (select count(*) from auth.users where created_at >= now() - interval '30 days'),
      'active_30d',(select count(distinct user_id) from generation_events
                     where created_at >= now() - interval '30 days'),
      'paying',    (select count(distinct user_id) from credit_transactions where kind = 'purchase')
    ),
    'revenue', jsonb_build_object(
      -- Stored in the purchase's metadata by the Razorpay grant paths. Paise,
      -- so the UI divides by 100 — never rounded here.
      'total_paise', (select coalesce(sum(coalesce(nullif(metadata->>'amount_paise','')::bigint, 0)), 0)
                        from credit_transactions where kind = 'purchase'),
      'paise_30d',   (select coalesce(sum(coalesce(nullif(metadata->>'amount_paise','')::bigint, 0)), 0)
                        from credit_transactions
                       where kind = 'purchase' and created_at >= now() - interval '30 days'),
      'purchases',   (select count(*) from credit_transactions where kind = 'purchase')
    ),
    'credits', jsonb_build_object(
      -- Outstanding balance is a liability, not an asset: it is compute you
      -- owe and have already been paid for.
      'outstanding',   (select coalesce(sum(balance), 0) from user_credits),
      'granted_total', (select coalesce(sum(amount), 0) from credit_transactions where kind = 'signup'),
      'purchased_total',(select coalesce(sum(amount), 0) from credit_transactions where kind = 'purchase'),
      'spent_total',   (select coalesce(sum(-amount), 0) from credit_transactions where kind = 'spend'),
      -- Runs that dispatched but never settled — the closed-tab leak in
      -- 0004's header note, in credits.
      'unsettled',     (select coalesce(sum(credits), 0) from pending_charges where settled_at is null)
    ),
    'runs', jsonb_build_object(
      'total',        (select count(*) from generation_events),
      'runs_30d',     (select count(*) from generation_events where created_at >= now() - interval '30 days'),
      'succeeded_30d',(select count(*) from generation_events
                        where status = 'succeeded' and created_at >= now() - interval '30 days'),
      'failed_30d',   (select count(*) from generation_events
                        where status = 'failed' and created_at >= now() - interval '30 days'),
      -- Dispatched asynchronously and never completed. A steady number here is
      -- normal; a growing one means the poll route is not closing rows out.
      'pending',      (select count(*) from generation_events where status = 'pending')
    )
  );
$fn$;

-- ---------------------------------------------------------------------------
-- 2. admin_stats_daily — one row per day, gaps filled with zeros
--
-- The generate_series is the point. Grouping alone returns only days that had
-- activity, and a line chart drawn from that silently compresses quiet periods
-- — a week with two signups on Monday and Friday looks like two consecutive
-- days of growth.
-- ---------------------------------------------------------------------------

create or replace function public.admin_stats_daily(p_days integer default 30)
returns table (
  day               date,
  signups           integer,
  revenue_paise     bigint,
  credits_purchased integer,
  credits_granted   integer,
  credits_spent     integer,
  runs              integer,
  runs_failed       integer
)
language sql
security definer
set search_path = public
as $fn$
  with bounds as (
    select (current_date - (greatest(p_days, 1) - 1))::date as first_day
  ),
  days as (
    select generate_series((select first_day from bounds), current_date, interval '1 day')::date as day
  ),
  signups as (
    select created_at::date as day, count(*)::integer as n
      from auth.users
     where created_at >= (select first_day from bounds)
     group by 1
  ),
  txns as (
    select
      created_at::date as day,
      -- CASE rather than FILTER for the cast: it keeps the ::bigint from ever
      -- being applied to a row where the key is absent.
      coalesce(sum(case when kind = 'purchase'
                        then coalesce(nullif(metadata->>'amount_paise','')::bigint, 0)
                        else 0 end), 0) as revenue_paise,
      coalesce(sum(case when kind = 'purchase' then amount  else 0 end), 0)::integer as purchased,
      coalesce(sum(case when kind = 'signup'   then amount  else 0 end), 0)::integer as granted,
      coalesce(sum(case when kind = 'spend'    then -amount else 0 end), 0)::integer as spent
      from credit_transactions
     where created_at >= (select first_day from bounds)
     group by 1
  ),
  gens as (
    select
      created_at::date as day,
      count(*)::integer as runs,
      (count(*) filter (where status = 'failed'))::integer as failed
      from generation_events
     where created_at >= (select first_day from bounds)
     group by 1
  )
  select
    d.day,
    coalesce(s.n, 0),
    coalesce(t.revenue_paise, 0),
    coalesce(t.purchased, 0),
    coalesce(t.granted, 0),
    coalesce(t.spent, 0),
    coalesce(g.runs, 0),
    coalesce(g.failed, 0)
    from days d
    left join signups s on s.day = d.day
    left join txns    t on t.day = d.day
    left join gens    g on g.day = d.day
   order by d.day;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. admin_stats_runs_by_kind — the usage mix, per day
--
-- Returns only days that had runs. Unlike §2 this feeds a stacked chart whose
-- series list the client already knows, so filling the grid here would mean
-- emitting days × kinds rows to say mostly nothing.
-- ---------------------------------------------------------------------------

create or replace function public.admin_stats_runs_by_kind(p_days integer default 30)
returns table (day date, kind text, runs integer)
language sql
security definer
set search_path = public
as $fn$
  select created_at::date as day, kind, count(*)::integer as runs
    from generation_events
   where created_at >= (current_date - (greatest(p_days, 1) - 1))
   group by 1, 2
   order by 1, 2;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. admin_stats_models — the leaderboard
--
-- Runs, reliability and latency per model. avg_duration_ms is computed over
-- successful runs only: a model that fails fast would otherwise look faster
-- than one that works.
-- ---------------------------------------------------------------------------

create or replace function public.admin_stats_models(
  p_days  integer default 30,
  p_limit integer default 15
)
returns table (
  model_id        text,
  kind            text,
  provider        text,
  runs            integer,
  succeeded       integer,
  failed          integer,
  credits         bigint,
  avg_duration_ms integer
)
language sql
security definer
set search_path = public
as $fn$
  select
    coalesce(e.model_id, '(unknown)') as model_id,
    min(e.kind)     as kind,
    min(e.provider) as provider,
    count(*)::integer                                     as runs,
    (count(*) filter (where e.status = 'succeeded'))::integer as succeeded,
    (count(*) filter (where e.status = 'failed'))::integer    as failed,
    coalesce(sum(e.credits_charged), 0)::bigint           as credits,
    coalesce(avg(e.duration_ms) filter (where e.status = 'succeeded'), 0)::integer
                                                          as avg_duration_ms
    from generation_events e
   where e.created_at >= (current_date - (greatest(p_days, 1) - 1))
   group by coalesce(e.model_id, '(unknown)')
   order by runs desc
   limit greatest(p_limit, 1);
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Who may call these — service_role only, same as 0003 §5.
-- ---------------------------------------------------------------------------

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_stats_overview()',
    'public.admin_stats_daily(integer)',
    'public.admin_stats_runs_by_kind(integer)',
    'public.admin_stats_models(integer, integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$grants$;

commit;
