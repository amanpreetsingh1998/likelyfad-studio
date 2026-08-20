-- ===========================================================================
-- 0004_workflow_settlement.sql — charge once per workflow, not once per node
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0003_credits.sql.
--
-- WHY A PENDING TABLE RATHER THAN "CLIENT TELLS US THE TOTAL"
--
-- Charging on workflow completion means something has to remember what ran
-- between the first node and the last. Letting the browser carry that total
-- would make the bill editable — a workflow could report that it ran nothing.
--
-- So each node run writes a pending_charges row server-side as it happens, and
-- settlement sums those rows. The client picks the *moment* to settle; it never
-- supplies the amount.
--
-- This is also the hook for closing the closed-tab gap later: a run that never
-- settles leaves its rows sitting here with settled_at null. A sweep job that
-- settles anything older than N minutes turns the leak off without touching
-- any other part of the system. Until that exists, unsettled rows are simply
-- unbilled — a deliberate, known loss.
-- ===========================================================================

begin;

create table if not exists public.pending_charges (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  credits      integer not null check (credits > 0),
  kind         text not null,
  model_id     text,
  created_at   timestamptz not null default now(),
  -- Null until a workflow settles this row. Never reset.
  settled_at   timestamptz,
  -- The credit_transactions row that paid for it, once settled.
  settled_txn  uuid references public.credit_transactions(id) on delete set null
);

-- Settlement and the affordability check both ask the same question: "what
-- does this user owe right now". This index is what makes that a lookup
-- rather than a scan of their whole history.
create index if not exists pending_charges_unsettled_idx
  on public.pending_charges(user_id) where settled_at is null;

alter table public.pending_charges enable row level security;

-- Read-own so the UI can show a live "this run so far" figure. No write policy:
-- rows are created and settled by the service role alone.
drop policy if exists pending_charges_select_own on public.pending_charges;
create policy pending_charges_select_own on public.pending_charges
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- record_pending_charge — one node run, not yet billed
-- ---------------------------------------------------------------------------

create or replace function public.record_pending_charge(
  p_user_id  uuid,
  p_credits  integer,
  p_kind     text,
  p_model_id text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owed integer;
begin
  insert into public.pending_charges (user_id, credits, kind, model_id)
  values (p_user_id, p_credits, p_kind, p_model_id);

  select coalesce(sum(credits), 0) into v_owed
    from public.pending_charges
   where user_id = p_user_id and settled_at is null;

  return v_owed;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- settle_pending_charges — bill the whole workflow in one debit
--
-- Returns what was charged, the new balance, and how many node runs it
-- covered, so the UI can show a receipt.
--
-- The balance is clamped rather than allowed to fail. By the time settlement
-- runs the provider calls have already happened, so refusing the debit would
-- not un-spend the money — it would only leave the rows stuck forever. The
-- affordability check in the route makes a shortfall rare; when one happens we
-- take what is there and record the gap.
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
  -- Lock the pending rows for this user so two settlements racing (a double
  -- click on Run, or a retry) cannot both bill the same node runs.
  select coalesce(sum(credits), 0), count(*)
    into v_owed, v_runs
    from public.pending_charges
   where user_id = p_user_id and settled_at is null
     for update;

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

-- ---------------------------------------------------------------------------
-- discard_pending_charges — a run that never reached a provider
--
-- Used when a workflow fails before any node dispatched. Deletes rather than
-- settles: nothing was spent, so there is nothing to record.
-- ---------------------------------------------------------------------------

create or replace function public.discard_pending_charges(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deleted integer;
begin
  delete from public.pending_charges
   where user_id = p_user_id and settled_at is null;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

-- Service role only — same reasoning as 0003 §5.
revoke all on function public.record_pending_charge(uuid, integer, text, text) from public;
revoke all on function public.record_pending_charge(uuid, integer, text, text) from anon;
revoke all on function public.record_pending_charge(uuid, integer, text, text) from authenticated;
revoke all on function public.settle_pending_charges(uuid, text) from public;
revoke all on function public.settle_pending_charges(uuid, text) from anon;
revoke all on function public.settle_pending_charges(uuid, text) from authenticated;
revoke all on function public.discard_pending_charges(uuid) from public;
revoke all on function public.discard_pending_charges(uuid) from anon;
revoke all on function public.discard_pending_charges(uuid) from authenticated;

grant execute on function public.record_pending_charge(uuid, integer, text, text) to service_role;
grant execute on function public.settle_pending_charges(uuid, text) to service_role;
grant execute on function public.discard_pending_charges(uuid) to service_role;

commit;
