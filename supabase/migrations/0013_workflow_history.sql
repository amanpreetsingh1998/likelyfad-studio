-- ===========================================================================
-- 0013_workflow_history.sql — give a workflow run an identity, and give a
-- workflow somewhere to record what running it costs
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0003, 0004, 0006 and 0012.
--
-- MUST RUN AFTER 0012. Settlement has never once succeeded (see that file);
-- everything here reads the numbers settlement writes, so applying this on top
-- of the broken function would build a history page that faithfully reports
-- every workflow as having cost nothing.
--
-- WHY THIS EXTENDS public.projects RATHER THAN ADDING public.workflows
--
-- The obvious shape was a new `workflows` table with a jsonb `graph`. It was
-- rejected: public.projects already IS the account-owned workflow. It holds
-- workflow_json, it is written by workflowStore's save path, read by
-- ProjectListModal, and public.media.project_id has a foreign key onto it.
-- A second table holding the same graphs would mean two sources of truth for
-- one canvas, drifting from the first save that did not happen to open the
-- history page.
--
-- The cost is cosmetic and worth paying: projects.id is a client-minted text
-- id ('wf_<ts>_<rand>'), not a uuid, so every reference to it below is text.
--
-- WHAT IS MISSING TODAY, AND WHAT EACH PIECE FIXES
--
--   * There is no run entity. pending_charges and generation_events are flat
--     per-node lists scoped only by user_id, so nothing represents "one
--     execution of one workflow".                            → §2
--   * Nothing links a charge to a workflow. It is currently impossible to
--     answer "what did workflow X cost".                     → §3
--   * Settlement is user-scoped. settle_pending_charges sweeps every
--     unsettled row a user has and cannot bill one run.      → §6
--   * projects has no description, and nowhere to cache an estimate. → §1
--
-- NO BACKFILL IS POSSIBLE. Existing pending_charges and generation_events rows
-- carry no run id and there is no way to infer one from timestamps without
-- guessing. History starts the day this is applied — the same honest position
-- generation_events already takes, and the UI must say so rather than drawing
-- a zero.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. projects gains the columns the history page displays
--
-- description is user-written. When it is empty the UI derives a one-line
-- summary from the graph ("6 nodes, 2 image generations, 1 LLM") on read —
-- deliberately never stored, so it cannot go stale against an edited graph.
--
-- models / est_credits / est_duration_ms are a CACHE, recomputed server-side
-- on every save. They are never accepted from the client: a browser that could
-- write est_credits could write its own price, which is precisely what the
-- pending_charges design exists to prevent. They describe what the graph
-- WOULD cost; what a run DID cost lives on workflow_runs and always wins.
--
-- est_partial mirrors the 409 unpriced_model refusal. A graph containing a
-- model with no recorded price cannot be totalled honestly, and substituting a
-- category average is how a $1.68 run gets shown as $0.05. The flag makes the
-- UI say "at least N credits" instead of inventing the rest.
--
-- deleted_at: soft delete only. workflow_runs.project_id is `on delete set
-- null` so a hard delete would not orphan the ledger, but it would strip the
-- history of every run's title while the money it explains stays on the
-- account. The row is cheap; the explanation is not.
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists description     text,
  add column if not exists models          text[] not null default '{}',
  add column if not exists est_credits     integer,
  add column if not exists est_duration_ms integer,
  add column if not exists est_partial     boolean not null default false,
  add column if not exists deleted_at      timestamptz;

-- The history list: the caller's own live workflows, newest touched first.
-- Partial on deleted_at so soft-deleted rows cost nothing to skip.
create index if not exists projects_user_live_idx
  on public.projects(user_id, updated_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. workflow_runs — one row per execution
--
-- project_id is `on delete set null`, NOT cascade: deleting a workflow must
-- not erase the ledger's explanation of money already spent. project_name is
-- snapshot at start for the same reason admin_actions snapshots the actor's
-- email — the project can be renamed or removed and this row still has to name
-- what was run.
--
-- credits_charged and finished_at - started_at are STORED on this row rather
-- than recomputed from generation_events, because retention prunes events
-- (0006) and a run's cost must outlive them. That is the whole reason they
-- are here and not derived.
--
-- 'abandoned' is a distinct status from 'cancelled': cancelled is a user
-- decision, abandoned is a tab that closed and was swept by maintenance. They
-- look identical in the ledger and mean different things to whoever is asking
-- why a run stopped.
-- ---------------------------------------------------------------------------

create table if not exists public.workflow_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,

  -- text, not uuid: projects.id is the client-minted 'wf_<ts>_<rand>' string.
  project_id   text references public.projects(id) on delete set null,
  project_name text,
  node_count   integer,

  status       text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'cancelled', 'abandoned')),

  started_at   timestamptz not null default now(),
  finished_at  timestamptz,

  -- Written by settlement (§6). Null until the run settles.
  credits_charged integer,
  shortfall       integer,
  settled_txn     uuid references public.credit_transactions(id) on delete set null
);

-- One index per question the page actually asks.

-- "This account's runs, newest first" — the history page's own feed.
create index if not exists workflow_runs_user_idx
  on public.workflow_runs(user_id, started_at desc);

-- "Every run of this workflow" — the detail drawer.
create index if not exists workflow_runs_project_idx
  on public.workflow_runs(project_id, started_at desc);

-- "The last successful run of this workflow", which is the hot path of the
-- whole feature: it is where the headline cost and duration come from.
create index if not exists workflow_runs_success_idx
  on public.workflow_runs(project_id, finished_at desc)
  where status = 'completed';

-- The maintenance sweep's question: "what is still open and too old to be?"
create index if not exists workflow_runs_open_idx
  on public.workflow_runs(started_at)
  where status = 'running';

alter table public.workflow_runs enable row level security;

-- Read-own, matching pending_charges. Deliberately no insert/update/delete
-- policy: rows are written by the service role alone, so a user cannot forge
-- a run or edit what one cost.
drop policy if exists workflow_runs_select_own on public.workflow_runs;
create policy workflow_runs_select_own on public.workflow_runs
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Attribution — tag the per-node rows with the run they belong to
--
-- Nullable, and `on delete set null`. Old rows have no run, and so do the
-- paths that are not a workflow execution at all (the quickstart proposer, a
-- single node fired from the canvas). Those must stay valid and stay billable:
-- an untagged charge is settled by the user-wide path exactly as before.
--
-- No project_id column here. The workflow is one indexed hop away through
-- workflow_runs, and a second denormalised copy is a second thing that can
-- disagree about which workflow a charge belonged to.
-- ---------------------------------------------------------------------------

alter table public.pending_charges
  add column if not exists run_id uuid
  references public.workflow_runs(id) on delete set null;

alter table public.generation_events
  add column if not exists run_id uuid
  references public.workflow_runs(id) on delete set null;

-- Settlement's scan (§6) and the "which models did this run use" lookup.
-- Partial, because the overwhelming majority of historic rows have no run.
create index if not exists pending_charges_run_idx
  on public.pending_charges(run_id) where run_id is not null;

create index if not exists generation_events_run_idx
  on public.generation_events(run_id) where run_id is not null;

-- ---------------------------------------------------------------------------
-- 4. record_pending_charge — carry the run id
--
-- DROPPED AND RECREATED, not `create or replace`. Adding a defaulted parameter
-- produces a new overload rather than replacing the old function, and a
-- four-argument call against both would then fail with "function is not
-- unique". The drop is what keeps the existing call site working.
--
-- src/lib/credits/server.ts is the only caller.
-- ---------------------------------------------------------------------------

drop function if exists public.record_pending_charge(uuid, integer, text, text);

create or replace function public.record_pending_charge(
  p_user_id  uuid,
  p_credits  integer,
  p_kind     text,
  p_model_id text default null,
  p_run_id   uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owed integer;
begin
  -- The run must be the caller's own. A run id is a grouping key supplied by
  -- the browser, and an unchecked one would let a user file their charges
  -- against someone else's run — which is both a billing fault and a read of
  -- another account's history. Same rule as the (user_id, task_id) match on
  -- generation_events: never trust an externally-supplied id alone.
  --
  -- A mismatch degrades to an untagged charge rather than raising. Billing
  -- must not fail because history is unavailable; the row is still recorded
  -- and still settles through the user-wide path.
  if p_run_id is not null and not exists (
    select 1 from public.workflow_runs
     where id = p_run_id and user_id = p_user_id
  ) then
    p_run_id := null;
  end if;

  insert into public.pending_charges (user_id, credits, kind, model_id, run_id)
  values (p_user_id, p_credits, p_kind, p_model_id, p_run_id);

  select coalesce(sum(credits), 0) into v_owed
    from public.pending_charges
   where user_id = p_user_id and settled_at is null;

  return v_owed;
end;
$fn$;

revoke all on function public.record_pending_charge(uuid, integer, text, text, uuid) from public;
revoke all on function public.record_pending_charge(uuid, integer, text, text, uuid) from anon;
revoke all on function public.record_pending_charge(uuid, integer, text, text, uuid) from authenticated;
grant execute on function public.record_pending_charge(uuid, integer, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. settle_workflow_run — bill exactly one run, and close it out
--
-- A NEW function, not a change to settle_pending_charges. That one stays
-- byte-identical because the maintenance sweep (0011) depends on its
-- behaviour for orphaned rows that have no run at all, and it is the fallback
-- for clients that send no run id.
--
-- THE SHAPE HERE IS NOT NEGOTIABLE. settle_pending_charges opened with
-- FOR UPDATE on an aggregate query, which Postgres rejects at plan time —
-- and because plpgsql does not plan a body until first call, it was accepted
-- at create time and failed on every invocation for the function's entire
-- life, unnoticed, while 2,778 mocked tests stayed green. Lock the rows in one
-- statement, aggregate them in the next. Copy this, never that.
--
-- SETTLING TWICE MUST BE HARMLESS. The client calls this from a finally block
-- that a retry, a double-click or a reconnect can each reach again. The second
-- call finds no unsettled rows for the run, returns a zero charge, and leaves
-- the already-written figures on the run row alone.
--
-- A FAILED OR CANCELLED RUN STILL PAYS. Every pending row is a provider call
-- that really happened and really cost money. p_status is a label for the
-- ledger, never a reason to skip the debit.
-- ---------------------------------------------------------------------------

create or replace function public.settle_workflow_run(
  p_user_id uuid,
  p_run_id  uuid,
  p_status  text default 'completed'
) returns table (charged integer, balance integer, runs integer, shortfall integer)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owed      integer;
  v_runs      integer;
  v_balance   integer;
  v_debit     integer;
  v_shortfall integer;
  v_txn_id    uuid;
  v_reason    text;
  v_exists    boolean;
begin
  -- Ownership, on the pair. A run id that is not this user's settles nothing
  -- rather than raising: the caller is authenticated and the id is a grouping
  -- key, so the honest answer to "settle a run you do not own" is "there was
  -- nothing to settle", not an error that leaks whether the run exists.
  select exists (
    select 1 from public.workflow_runs
     where id = p_run_id and user_id = p_user_id
  ) into v_exists;

  if not v_exists then
    select coalesce(uc.balance, 0) into v_balance
      from public.user_credits uc where uc.user_id = p_user_id;
    return query select 0, coalesce(v_balance, 0), 0, 0;
    return;
  end if;

  -- Lock this run's pending rows. Separate statement from the aggregate below
  -- — see the header. These are the same locks the aggregate then reads under,
  -- so two settlements racing cannot both bill the same node runs.
  perform 1
     from public.pending_charges
    where user_id = p_user_id and run_id = p_run_id and settled_at is null
      for update;

  select coalesce(sum(credits), 0), count(*)
    into v_owed, v_runs
    from public.pending_charges
   where user_id = p_user_id and run_id = p_run_id and settled_at is null;

  -- Close the run out whatever the charge came to. A run with nothing to bill
  -- is still a run that ended, and leaving it 'running' would have the
  -- maintenance sweep reopen the question forever.
  update public.workflow_runs
     set status      = p_status,
         finished_at = coalesce(finished_at, now())
   where id = p_run_id and user_id = p_user_id;

  if v_owed = 0 then
    select coalesce(uc.balance, 0) into v_balance
      from public.user_credits uc where uc.user_id = p_user_id;
    return query select 0, coalesce(v_balance, 0), 0, 0;
    return;
  end if;

  select coalesce(uc.balance, 0) into v_balance
    from public.user_credits uc where uc.user_id = p_user_id for update;

  v_debit := least(v_owed, coalesce(v_balance, 0));
  v_shortfall := v_owed - v_debit;

  v_reason := case
    when p_status = 'completed' then 'Workflow run'
    else 'Workflow run (' || p_status || ')'
  end;

  if v_debit > 0 then
    update public.user_credits
       set balance = balance - v_debit, updated_at = now()
     where user_id = p_user_id
    returning public.user_credits.balance into v_balance;

    insert into public.credit_transactions (user_id, amount, kind, reason, metadata)
    values (
      p_user_id, -v_debit, 'spend', v_reason,
      jsonb_build_object(
        'runs', v_runs, 'owed', v_owed,
        'shortfall', v_shortfall, 'run_id', p_run_id
      )
    )
    returning id into v_txn_id;
  end if;

  -- Everything is marked settled, including any shortfall. Leaving unpaid rows
  -- behind would bill them again on the user's next workflow, which is worse
  -- than absorbing a gap our own affordability check let through. Same
  -- reasoning as 0012.
  update public.pending_charges
     set settled_at = now(), settled_txn = v_txn_id
   where user_id = p_user_id and run_id = p_run_id and settled_at is null;

  -- The figures the history page reads. Written here, on the run row, so they
  -- survive the retention sweep that eventually deletes the events.
  update public.workflow_runs
     set credits_charged = v_debit,
         shortfall       = v_shortfall,
         settled_txn     = v_txn_id
   where id = p_run_id and user_id = p_user_id;

  return query select v_debit, coalesce(v_balance, 0), v_runs, v_shortfall;
end;
$fn$;

revoke all on function public.settle_workflow_run(uuid, uuid, text) from public;
revoke all on function public.settle_workflow_run(uuid, uuid, text) from anon;
revoke all on function public.settle_workflow_run(uuid, uuid, text) from authenticated;
grant execute on function public.settle_workflow_run(uuid, uuid, text) to service_role;

commit;
