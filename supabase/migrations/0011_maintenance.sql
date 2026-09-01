-- ---------------------------------------------------------------------------
-- 0011_maintenance.sql — the sweep the other two migrations were waiting for
--
-- Two features shipped finished and uncalled because this project had no
-- scheduler:
--
--   * settle_pending_charges (0004) bills a workflow, but only ever when the
--     browser tells it to. A tab closed mid-run never tells it, so those rows
--     sit unsettled forever — work that reached a provider and was never paid
--     for. That is the closed-tab billing leak.
--   * prune_generation_events (0006) enforces retention, and nothing has ever
--     invoked it, so nothing has ever been pruned.
--
-- The note in 0006 said settle_pending_charges "needs no new logic, only a
-- scheduler". That was half right. It takes one user id, and a sweep does not
-- know which users are owed — enumerating them is the missing piece, and it is
-- what this file adds. Retention needed nothing new and gets nothing new here.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- sweep_stale_pending_charges — settle everyone the browser never settled
--
-- "Stale" is the whole safety argument. A workflow that is still running also
-- has unsettled rows, and sweeping those would bill a live run mid-flight.
-- That does not overcharge — every row is a provider call that really happened
-- — but it splits one workflow across two ledger lines, which is a confusing
-- thing to hand a user reading their history. So p_minutes must comfortably
-- exceed the longest workflow anyone runs; the caller defaults it to 60, and
-- the longest single route timeout in the app is 5.
--
-- p_limit bounds one invocation. A sweep that has been broken for a week
-- should come back in bounded batches rather than taking every lock in the
-- table at once on the first run after the fix.
-- ---------------------------------------------------------------------------

create or replace function public.sweep_stale_pending_charges(
  p_minutes integer default 60,
  p_limit   integer default 500
) returns table (
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
  v_user   uuid;
  v_result record;
begin
  if p_minutes is null or p_minutes < 1 then
    raise exception 'p_minutes must be >= 1 (got %)', p_minutes;
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be >= 1 (got %)', p_limit;
  end if;

  for v_user in
    select pc.user_id
      from public.pending_charges pc
     where pc.settled_at is null
       and pc.created_at < now() - make_interval(mins => p_minutes)
     group by pc.user_id
     order by min(pc.created_at)   -- oldest debt first, so a capped run drains the backlog
     limit p_limit
  loop
    -- Labelled so the ledger says why this charge appeared with no workflow
    -- visibly ending. Same shape as the client's "Workflow run (cancelled)".
    select * into v_result
      from public.settle_pending_charges(v_user, 'Workflow run (swept)');

    -- settle_pending_charges settles *all* of a user's unsettled rows, not just
    -- the stale ones. That is deliberate and matches what the client does: the
    -- alternative is leaving a fresh row behind to be swept an hour later as a
    -- second ledger line for the same session.
    user_id   := v_user;
    charged   := v_result.charged;
    runs      := v_result.runs;
    shortfall := v_result.shortfall;
    return next;
  end loop;
end;
$fn$;

revoke all on function public.sweep_stale_pending_charges(integer, integer) from public;
revoke all on function public.sweep_stale_pending_charges(integer, integer) from anon;
revoke all on function public.sweep_stale_pending_charges(integer, integer) from authenticated;
grant execute on function public.sweep_stale_pending_charges(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Supporting index
--
-- pending_charges_unsettled_idx (0004) is on (user_id) where settled_at is
-- null, which serves the per-user settle. The sweep asks a different question
-- — who is stale, oldest first — and answers it by created_at.
-- ---------------------------------------------------------------------------

create index if not exists pending_charges_stale_idx
  on public.pending_charges(created_at) where settled_at is null;

commit;
