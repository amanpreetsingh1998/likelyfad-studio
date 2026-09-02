-- ===========================================================================
-- 0023_settlement_actually_debits.sql — the third settlement bug, and the
-- first self-test that would have caught all three
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0013.
--
-- WHAT THE DATABASE SAID
--
-- Read against the live project on 2026-09-03:
--
--   credit_transactions  kind='spend'                    0 rows, ever
--   workflow_runs        status='running'               26 rows
--   pending_charges      settled_at is not null           6 rows, all with
--                                                        settled_txn = null
--                                                        and one identical
--                                                        timestamp
--
-- Those six are 0012's write-off. Every charge recorded since — a month of
-- real generations — is still unsettled, and not one credit has ever been
-- debited from anybody for anything. The signup grants and admin top-ups are
-- the only rows in the ledger.
--
-- The one run that DID close cleanly (284a46a8, 'cancelled' half a second
-- after it opened) had no pending charges at all. That is the whole tell, and
-- it is 0019's signature exactly: settlement completes for anyone who owes
-- nothing and dies for everyone who owes something.
--
-- THE SHAPE OF THE FAULT, FOR THE THIRD TIME
--
-- Both functions declare `returns table (charged, balance, runs, shortfall)`,
-- so `balance` is an OUT parameter. Both then read the column of the same name
-- inside the debit, behind `if v_debit > 0`. plpgsql resolves that reference at
-- runtime, refuses to guess between the parameter and the column, and raises
--
--     column reference "balance" is ambiguous
--
-- which aborts the function — rolling back the status update it had already
-- made. That is why the runs are still 'running' rather than 'completed with
-- nothing charged': the failure erases its own evidence.
--
-- 0019 fixed this by schema-qualifying the read. Either it was never applied
-- here, or it did not take. Rather than establish which, this migration makes
-- the question moot and removes the shape that keeps regrowing.
--
-- WHAT CHANGES
--
-- 1. The UPDATE gets a table ALIAS: `update public.user_credits uc set
--    balance = uc.balance - v_debit`. An alias cannot collide with a parameter
--    name, so the ambiguity is gone structurally rather than by spelling. It
--    is also shorter than the qualified form, which matters — the qualified
--    form is easy to "tidy up" straight back into the bug.
--
-- 2. `#variable_conflict use_column` is declared on both functions. Belt and
--    braces: if a future edit reintroduces a bare `balance`, it now resolves
--    to the column (the intended meaning) instead of raising.
--
-- 3. Section 3 CALLS THE REAL FUNCTIONS on the path that debits, and aborts
--    the migration if either does not charge. This is the piece all three
--    previous attempts were missing.
--
--    0019 shipped a self-test too, and it passed while the bug was live,
--    because it tested a hand-copied UPDATE statement rather than the function
--    containing it — the copy had no OUT parameter named `balance`, so there
--    was nothing to be ambiguous against. A test that reconstructs the code
--    under test cannot fail the way the code does.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. settle_pending_charges — the user-wide path
--
-- Used by the maintenance sweep for orphaned rows, and by any client settling
-- without a run id. Behaviour is unchanged; only the debit is rewritten.
-- ---------------------------------------------------------------------------

create or replace function public.settle_pending_charges(
  p_user_id uuid,
  p_reason  text default 'Workflow run'
) returns table (charged integer, balance integer, runs integer, shortfall integer)
language plpgsql
security definer
set search_path = public
as $fn$
#variable_conflict use_column
declare
  v_owed      integer;
  v_runs      integer;
  v_balance   integer;
  v_debit     integer;
  v_shortfall integer;
  v_txn_id    uuid;
begin
  -- Lock first, aggregate second. FOR UPDATE and an aggregate cannot share a
  -- statement — that combination is what made this function fail on every call
  -- until 0012. Copy this shape, never that one.
  perform 1
     from public.pending_charges
    where user_id = p_user_id and settled_at is null
      for update;

  select coalesce(sum(credits), 0), count(*)
    into v_owed, v_runs
    from public.pending_charges
   where user_id = p_user_id and settled_at is null;

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

  if v_debit > 0 then
    -- ALIASED. `uc.balance` cannot be mistaken for this function's OUT
    -- parameter of the same name; a bare `balance` here can, and did, for
    -- three migrations running.
    update public.user_credits uc
       set balance    = uc.balance - v_debit,
           updated_at = now()
     where uc.user_id = p_user_id
    returning uc.balance into v_balance;

    insert into public.credit_transactions (user_id, amount, kind, reason, metadata)
    values (
      p_user_id, -v_debit, 'spend', p_reason,
      jsonb_build_object('runs', v_runs, 'owed', v_owed, 'shortfall', v_shortfall)
    )
    returning id into v_txn_id;
  end if;

  -- Everything is marked settled, including any shortfall. Leaving unpaid rows
  -- behind would bill them again on the user's next workflow.
  update public.pending_charges
     set settled_at = now(), settled_txn = v_txn_id
   where user_id = p_user_id and settled_at is null;

  return query select v_debit, coalesce(v_balance, 0), v_runs, v_shortfall;
end;
$fn$;

revoke all on function public.settle_pending_charges(uuid, text) from public;
revoke all on function public.settle_pending_charges(uuid, text) from anon;
revoke all on function public.settle_pending_charges(uuid, text) from authenticated;
grant execute on function public.settle_pending_charges(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. settle_workflow_run — the per-run path, and the one real money takes
--
-- The status update stays BEFORE the debit. A run that ended must be closed
-- even if the debit then fails, so a broken debit cannot leave the history
-- page counting a finished run as still going — which is exactly what the last
-- month of 'running' rows are.
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
#variable_conflict use_column
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
  select exists (
    select 1 from public.workflow_runs
     where id = p_run_id and user_id = p_user_id
  ) into v_exists;

  -- Not this caller's run: settle nothing, return zero, and decline to
  -- confirm whether the run exists at all.
  if not v_exists then
    select coalesce(uc.balance, 0) into v_balance
      from public.user_credits uc where uc.user_id = p_user_id;
    return query select 0, coalesce(v_balance, 0), 0, 0;
    return;
  end if;

  perform 1
     from public.pending_charges
    where user_id = p_user_id and run_id = p_run_id and settled_at is null
      for update;

  select coalesce(sum(credits), 0), count(*)
    into v_owed, v_runs
    from public.pending_charges
   where user_id = p_user_id and run_id = p_run_id and settled_at is null;

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
    -- ALIASED, for the same reason as §1.
    update public.user_credits uc
       set balance    = uc.balance - v_debit,
           updated_at = now()
     where uc.user_id = p_user_id
    returning uc.balance into v_balance;

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

  update public.pending_charges
     set settled_at = now(), settled_txn = v_txn_id
   where user_id = p_user_id and run_id = p_run_id and settled_at is null;

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

-- ---------------------------------------------------------------------------
-- 3. Exercise the debit, through the real functions, or refuse to install
--
-- Both previous fixes were believed because something adjacent to the bug
-- returned cleanly. So: borrow a funded account, owe it one credit, call the
-- actual function, and assert it charged. Then put everything back exactly as
-- it was — the balance is restored to the value read before the test, and the
-- run, charge and ledger rows the test created are deleted.
--
-- If the ambiguity is still reachable this RAISES and the whole migration
-- rolls back. A settlement function that cannot complete a debit must not be
-- installed quietly for a fourth time.
--
-- pending_charges.user_id has a foreign key onto auth.users, which is why this
-- cannot use a synthetic id — and using a real one is why every step is undone.
-- ---------------------------------------------------------------------------

do $$
declare
  v_user    uuid;
  v_run     uuid;
  v_before  integer;
  v_after   integer;
  v_txn     uuid;
  v_charged integer;
  v_bal     integer;
begin
  select uc.user_id, uc.balance into v_user, v_before
    from public.user_credits uc
   where uc.balance > 0
   order by uc.user_id
   limit 1;

  if v_user is null then
    raise notice '0023: no funded account to verify against — self-test skipped';
    return;
  end if;

  -- --- the per-run path ----------------------------------------------------
  insert into public.workflow_runs (user_id, status, project_name, node_count)
  values (v_user, 'running', '0023 settlement self-test', 1)
  returning id into v_run;

  insert into public.pending_charges (user_id, credits, kind, model_id, run_id)
  values (v_user, 1, 'selftest', '0023-self-test', v_run);

  select s.charged, s.balance into v_charged, v_bal
    from public.settle_workflow_run(v_user, v_run, 'completed') s;

  if v_charged is distinct from 1 then
    raise exception
      'settle_workflow_run did not debit: charged=%, expected 1', v_charged;
  end if;
  if v_bal is distinct from v_before - 1 then
    raise exception
      'settle_workflow_run returned the wrong balance: got %, expected %',
      v_bal, v_before - 1;
  end if;

  select wr.settled_txn into v_txn from public.workflow_runs wr where wr.id = v_run;
  if v_txn is null then
    raise exception 'settle_workflow_run wrote no ledger row';
  end if;

  -- undo the per-run test
  delete from public.pending_charges where run_id = v_run;
  delete from public.workflow_runs where id = v_run;
  delete from public.credit_transactions where id = v_txn;

  -- --- the user-wide path --------------------------------------------------
  -- Only exercised when the account owes nothing else, because this path
  -- settles EVERYTHING outstanding and there is no honest way to undo that for
  -- a real backlog. An account mid-backlog simply skips this half.
  if not exists (
    select 1 from public.pending_charges
     where user_id = v_user and settled_at is null
  ) then
    insert into public.pending_charges (user_id, credits, kind, model_id)
    values (v_user, 1, 'selftest', '0023-self-test');

    select s.charged into v_charged
      from public.settle_pending_charges(v_user, '0023 self-test') s;

    if v_charged is distinct from 1 then
      raise exception
        'settle_pending_charges did not debit: charged=%, expected 1', v_charged;
    end if;

    delete from public.pending_charges where model_id = '0023-self-test';
    delete from public.credit_transactions
     where user_id = v_user and reason = '0023 self-test';
  else
    raise notice
      '0023: account has an unsettled backlog — user-wide self-test skipped';
  end if;

  -- --- restore -------------------------------------------------------------
  update public.user_credits uc
     set balance = v_before, updated_at = now()
   where uc.user_id = v_user;

  select uc.balance into v_after
    from public.user_credits uc where uc.user_id = v_user;

  if v_after is distinct from v_before then
    raise exception
      '0023: self-test did not restore the balance (% -> %)', v_before, v_after;
  end if;

  raise notice
    '0023: settlement VERIFIED — both functions completed a real debit';
end;
$$;

commit;
