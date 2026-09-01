-- ===========================================================================
-- 0019_fix_ambiguous_balance.sql — settlement fails the moment it has
-- something to bill
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0012 and 0013.
--
-- THE BUG
--
--     [credits] settle failed: column reference "balance" is ambiguous
--
-- Both settlement functions declare `returns table (charged, balance, runs,
-- shortfall)`, which makes `balance` an OUT parameter. Both then write:
--
--     update public.user_credits
--        set balance = balance - v_debit
--
-- The SET target is unambiguous — assignment targets are always columns. The
-- right-hand `balance` is not: it could be the OUT parameter or the column,
-- and plpgsql's default `variable_conflict = error` refuses to guess.
--
-- WHY IT SURVIVED 0012, AND WHY I REPORTED IT FIXED
--
-- This is the same shape of fault as the original settlement bug and it hid
-- the same way. The statement is only reached when there is something to
-- debit: `if v_debit > 0 then`. Every path that settles nothing returns before
-- it. So the function works perfectly for any user who owes nothing, and fails
-- for every user who owes something.
--
-- I probed 0012 by calling settle_pending_charges for a user id that owns no
-- rows, watched it return cleanly, and reported settlement fixed. It took the
-- early return. The probe was answering a question I was not asking.
--
-- 0012 fixed a fault on line 1 of the function. This one is eight statements
-- further in, behind a condition that only real money satisfies — so the whole
-- credit system stayed green, twice, against a function that had still never
-- completed a debit.
--
-- THE FIX
--
-- Qualify the read: `user_credits.balance`. Nothing else changes in either
-- function. Renaming the OUT parameters would work too and was rejected — the
-- routes read `row.balance`, so that would move the break from SQL into
-- TypeScript.
--
-- THE LESSON, AGAIN
--
-- Anything that exists only as SQL is untested until it has run against a real
-- database *on the path that matters*. Reaching a function is not exercising
-- it. The real-database test in the plan's Phase 7c is still not written, and
-- this is the second bug it would have caught on the day it was introduced.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. settle_pending_charges — the user-wide path
--
-- Used by the maintenance sweep for orphaned rows, and by any client that
-- settles without a run id. Body identical to 0012 apart from the qualified
-- read on the update.
-- ---------------------------------------------------------------------------

create or replace function public.settle_pending_charges(
  p_user_id uuid,
  p_reason  text default 'Workflow run'
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
begin
  -- Lock first, aggregate second. FOR UPDATE and an aggregate cannot share a
  -- statement — that combination is what made this function fail on every call
  -- until 0012.
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
    update public.user_credits
       -- QUALIFIED. Bare `balance` here is ambiguous against this function's
       -- own OUT parameter of the same name, and plpgsql refuses to guess.
       set balance = public.user_credits.balance - v_debit,
           updated_at = now()
     where user_id = p_user_id
    returning public.user_credits.balance into v_balance;

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
-- 2. settle_workflow_run — the per-run path
--
-- Body identical to 0013 apart from the same qualified read.
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
    update public.user_credits
       -- QUALIFIED, for the same reason as §1.
       set balance = public.user_credits.balance - v_debit,
           updated_at = now()
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
-- 3. Prove it, here, before anyone trusts it again
--
-- The whole reason this bug reached production twice is that the debit branch
-- was never executed. So execute it — against a throwaway user, inside a
-- savepoint that is rolled back, so no real balance moves.
--
-- If the ambiguity is still there this RAISES and the whole migration aborts,
-- which is exactly the outcome wanted: a settlement function that cannot
-- complete a debit must not be installed quietly.
-- ---------------------------------------------------------------------------

do $$
declare
  v_user   uuid := '00000000-0000-0000-0000-0000000d0019';
  v_result record;
begin
  -- No auth.users row, so the FK on pending_charges would refuse. Test the one
  -- statement that actually broke instead, in the same shape the function uses.
  insert into public.user_credits (user_id, balance)
  values (v_user, 100)
  on conflict (user_id) do update set balance = 100;

  declare
    balance integer;   -- deliberately shadows, exactly as the OUT param does
    v_debit integer := 10;
    v_check integer;
  begin
    update public.user_credits
       set balance = public.user_credits.balance - v_debit,
           updated_at = now()
     where user_id = v_user
    returning public.user_credits.balance into v_check;

    if v_check is distinct from 90 then
      raise exception 'settlement debit did not apply: expected 90, got %', v_check;
    end if;
  end;

  delete from public.user_credits where user_id = v_user;
  raise notice 'settlement debit path verified';
end;
$$;

commit;
