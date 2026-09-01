-- ---------------------------------------------------------------------------
-- 0012_fix_settlement.sql — settlement has never worked; make it work, and
-- write off everything it failed to bill
--
-- settle_pending_charges (0004) opens with:
--
--     select coalesce(sum(credits), 0), count(*)
--       into v_owed, v_runs
--       from public.pending_charges
--      where user_id = p_user_id and settled_at is null
--        for update;
--
-- Postgres does not allow FOR UPDATE together with aggregates. That is a
-- planner error, raised every time the statement runs — and because plpgsql
-- bodies are not planned until first call, `create function` accepted it and
-- the failure only ever appeared at runtime.
--
-- It is the first statement in the function, so it fails on every invocation.
-- settle_pending_charges is the only thing that debits credits for a workflow:
-- /api/credits/settle calls it, and so does the maintenance sweep. So no
-- workflow run has ever been billed. pending_charges has been accumulating
-- since the credit system shipped, and settlement has never written a single
-- credit_transactions row.
--
-- It surfaced when the maintenance sweep in 0011 called it for the first time
-- from something that reported the error instead of swallowing it.
--
-- Two jobs here, in one transaction: write off the backlog (§1), then fix the
-- function (§2). That order matters — the reverse would leave a window in
-- which a concurrent settle could bill months of accumulated charges.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. Write off the backlog
--
-- These charges are real — every row is a provider call that really happened
-- and really cost money. They are being written off anyway, because billing
-- them now would debit users for runs from weeks or months ago that they were
-- never told about and never saw a balance move for. A surprise charge for
-- forgotten work is worse than absorbing the cost of our own bug.
--
-- NOT a delete. The rows stay, with their credits intact, so the size of what
-- was absorbed stays answerable. They are marked settled against no
-- transaction, which is exactly the state a settled row would be in if it had
-- cost nothing.
--
-- IDENTIFYING THIS BATCH LATER: now() is the transaction timestamp, so every
-- row written off here shares one settled_at to the microsecond, and all carry
-- settled_txn is null. Since settlement has never once succeeded, any row with
-- settled_at set and settled_txn null predates this fix and is part of what
-- the bug cost:
--
--     select settled_at, count(*), sum(credits)
--       from public.pending_charges
--      where settled_txn is null and settled_at is not null
--      group by settled_at;
--
-- THE ONE HOUR CUTOFF: rows younger than that may belong to a workflow that is
-- running right now. Once §2 lands, those will settle normally when the run
-- finishes, and the user will see the debit they expect. Writing them off
-- would hand out a free run and, worse, hide a live charge.
-- ---------------------------------------------------------------------------

do $$
declare
  v_rows    integer;
  v_credits integer;
  v_users   integer;
begin
  select count(*), coalesce(sum(credits), 0), count(distinct user_id)
    into v_rows, v_credits, v_users
    from public.pending_charges
   where settled_at is null
     and created_at < now() - interval '1 hour';

  update public.pending_charges
     set settled_at = now(), settled_txn = null
   where settled_at is null
     and created_at < now() - interval '1 hour';

  raise notice 'wrote off % unbilled rows (% credits) across % users',
    v_rows, v_credits, v_users;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fix settle_pending_charges
--
-- The lock and the aggregate become two statements. PERFORM ... FOR UPDATE
-- takes exactly the same row locks the original intended — so two settlements
-- racing (a double click on Run, or a retry) still cannot both bill the same
-- node runs — and the aggregate then reads the rows it just locked.
--
-- Everything below this point is unchanged from 0004.
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
  -- Lock the pending rows for this user. Separate from the aggregate below
  -- because FOR UPDATE and aggregates cannot appear in the same statement --
  -- that combination is what made this function fail on every call until 0012.
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
       set balance = balance - v_debit, updated_at = now()
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
  -- behind would bill them again on the user's next workflow, which is worse
  -- than absorbing a gap that our own affordability check let through.
  update public.pending_charges
     set settled_at = now(), settled_txn = v_txn_id
   where user_id = p_user_id and settled_at is null;

  return query select v_debit, coalesce(v_balance, 0), v_runs, v_shortfall;
end;
$fn$;

-- create or replace preserves the existing ACL, so these are belt and braces
-- rather than a requirement. Same reasoning as 0003 §5: service role only.
revoke all on function public.settle_pending_charges(uuid, text) from public;
revoke all on function public.settle_pending_charges(uuid, text) from anon;
revoke all on function public.settle_pending_charges(uuid, text) from authenticated;
grant execute on function public.settle_pending_charges(uuid, text) to service_role;

commit;
