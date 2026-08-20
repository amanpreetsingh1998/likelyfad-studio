-- ===========================================================================
-- 0003_credits.sql — per-user credit balance, ledger, and Razorpay grants
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once.
--
-- Two tables rather than one:
--   credit_transactions is the truth — an append-only ledger, never updated.
--   user_credits is the running balance, kept in step by the functions below.
--
-- The balance could be derived with sum(amount) on every read, but a debit has
-- to be atomic against concurrent runs: two workflows starting at the same
-- instant must not both pass a check against the same stale total. A single
-- conditional UPDATE on one row gives that for free, where a SELECT-then-INSERT
-- would need an explicit lock.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.user_credits (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Signed: positive is a grant/purchase/refund, negative is a spend.
  amount     integer not null,
  -- 'signup' | 'purchase' | 'spend' | 'refund' | 'admin'
  kind       text not null,
  reason     text,
  -- Idempotency handle. For a purchase this is the Razorpay payment id, so the
  -- checkout callback and the webhook racing each other still grant once. For a
  -- refund it is the spend's own id, so a retried refund cannot pay out twice.
  ref        text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists credit_transactions_user_idx
  on public.credit_transactions(user_id, created_at desc);

-- Partial unique: many rows legitimately have no ref (ordinary spends), but a
-- ref that IS present must be unique per user. This constraint is what makes
-- the grant path idempotent — not application logic.
create unique index if not exists credit_transactions_ref_idx
  on public.credit_transactions(user_id, ref) where ref is not null;

-- ---------------------------------------------------------------------------
-- 2. Row level security
--
-- Read-own on both tables, and NO insert/update/delete policy anywhere: all
-- writes go through the SECURITY DEFINER functions below. A user who could
-- write their own balance row directly would simply set it to a million.
-- ---------------------------------------------------------------------------

alter table public.user_credits        enable row level security;
alter table public.credit_transactions enable row level security;

drop policy if exists user_credits_select_own on public.user_credits;
create policy user_credits_select_own on public.user_credits
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists credit_transactions_select_own on public.credit_transactions;
create policy credit_transactions_select_own on public.credit_transactions
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. grant_credits — add credits (signup bonus, purchase, refund, admin)
--
-- Returns the new balance. A repeated p_ref is a no-op that returns the
-- CURRENT balance, so a duplicate webhook delivery is silently absorbed.
-- ---------------------------------------------------------------------------

create or replace function public.grant_credits(
  p_user_id  uuid,
  p_amount   integer,
  p_kind     text,
  p_reason   text default null,
  p_ref      text default null,
  p_metadata jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_balance  integer;
  v_inserted integer := 0;
begin
  if p_amount <= 0 then
    raise exception 'grant_credits requires a positive amount, got %', p_amount
      using errcode = 'check_violation';
  end if;

  insert into public.credit_transactions (user_id, amount, kind, reason, ref, metadata)
  values (p_user_id, p_amount, p_kind, p_reason, p_ref, coalesce(p_metadata, '{}'::jsonb))
  on conflict (user_id, ref) where ref is not null do nothing;

  get diagnostics v_inserted = row_count;

  -- Already granted under this ref — return what they have, change nothing.
  if v_inserted = 0 then
    select balance into v_balance from public.user_credits where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  insert into public.user_credits (user_id, balance, updated_at)
  values (p_user_id, p_amount, now())
  on conflict (user_id) do update
    set balance = public.user_credits.balance + excluded.balance,
        updated_at = now()
  returning balance into v_balance;

  return v_balance;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. spend_credits — debit for a run
--
-- Raises 'insufficient_credits' when the balance would go negative. The
-- WHERE balance >= p_amount on the UPDATE is the whole concurrency story:
-- Postgres serialises the row update, so of two simultaneous runs against a
-- balance that only covers one, exactly one matches and the other gets zero
-- rows back.
--
-- Returns the spend's transaction id, which the caller keeps as the refund ref.
-- ---------------------------------------------------------------------------

create or replace function public.spend_credits(
  p_user_id  uuid,
  p_amount   integer,
  p_reason   text default null,
  p_metadata jsonb default '{}'::jsonb
) returns table (transaction_id uuid, balance integer)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_balance integer;
  v_txn_id  uuid;
begin
  if p_amount <= 0 then
    raise exception 'spend_credits requires a positive amount, got %', p_amount
      using errcode = 'check_violation';
  end if;

  update public.user_credits
     set balance = balance - p_amount, updated_at = now()
   where user_id = p_user_id and balance >= p_amount
  returning public.user_credits.balance into v_balance;

  if v_balance is null then
    raise exception 'insufficient_credits'
      using errcode = 'P0001', hint = 'Not enough credits for this run';
  end if;

  insert into public.credit_transactions (user_id, amount, kind, reason, metadata)
  values (p_user_id, -p_amount, 'spend', p_reason, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_txn_id;

  return query select v_txn_id, v_balance;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Who may call these
--
-- service_role only. The routes authenticate the caller with getAuthedContext()
-- and then pass that verified id — the browser never reaches these directly, or
-- a user could call grant_credits() on themselves from the console.
-- ---------------------------------------------------------------------------

revoke all on function public.grant_credits(uuid, integer, text, text, text, jsonb) from public;
revoke all on function public.grant_credits(uuid, integer, text, text, text, jsonb) from anon;
revoke all on function public.grant_credits(uuid, integer, text, text, text, jsonb) from authenticated;
revoke all on function public.spend_credits(uuid, integer, text, jsonb) from public;
revoke all on function public.spend_credits(uuid, integer, text, jsonb) from anon;
revoke all on function public.spend_credits(uuid, integer, text, jsonb) from authenticated;

grant execute on function public.grant_credits(uuid, integer, text, text, text, jsonb) to service_role;
grant execute on function public.spend_credits(uuid, integer, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Signup grant
--
-- New accounts land with a starter balance so the studio is usable before any
-- payment. Change the 100 below AND the SIGNUP_GRANT_CREDITS constant in
-- src/lib/credits/pricing.ts — the constant is display only, this is the one
-- that actually pays out.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.grant_credits(
    new.id, 100, 'signup', 'Welcome bonus', 'signup:' || new.id::text
  );
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created_credits on auth.users;
create trigger on_auth_user_created_credits
  after insert on auth.users
  for each row execute function public.handle_new_user_credits();

-- Backfill: everyone who signed up before this migration gets the same grant.
-- The ref makes it a no-op on a second run.
do $backfill$
declare
  u record;
begin
  for u in select id from auth.users loop
    perform public.grant_credits(
      u.id, 100, 'signup', 'Welcome bonus', 'signup:' || u.id::text
    );
  end loop;
end
$backfill$;

commit;
