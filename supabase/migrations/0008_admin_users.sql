-- ===========================================================================
-- 0008_admin_users.sql — the account list behind /admin/users, and the record
-- of what an admin did to it
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0003, 0004, 0005 and 0006.
--
-- WHY THESE ARE FUNCTIONS AND NOT ROUTE QUERIES
--
-- Same reason as 0007: every column on this page is an aggregate over a table
-- that only grows, and auth.users is not readable by the application roles at
-- all. A route cannot join it, so the join happens here, once, in one round
-- trip — rather than an aggregate query per account per page.
--
-- SECURITY DEFINER, granted to service_role alone. The admin routes reach
-- these only after requireAdmin() has passed; nothing else can execute them.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. admin_actions — what the admin did, and to whom
--
-- Phase 4 lists "admin audit log" among its own work, but the actions arrive
-- in Phase 3: granting credits, suspending and deleting all become possible on
-- this page. An action taken before the log exists is an action with no record
-- of itself, so the table ships with the first thing that writes to it.
--
-- TARGET_USER_ID CARRIES NO FOREIGN KEY, DELIBERATELY.
--
-- Every other reference to auth.users in this schema is `on delete cascade`.
-- That is right for a user's own data and wrong here: deleting an account
-- would erase the record that the account was deleted, which is the single
-- most important row this table will ever hold. The email is snapshot beside
-- it for the same reason — after the delete, the uuid resolves to nothing.
--
-- The actor's email is snapshot too. The admin seat is transferable (0005's
-- set_admin hands it over), so "who held it in March" is not a question the
-- admins table can answer; it only knows who holds it now.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_actions (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid not null,
  actor_email    text,
  -- 'grant_credits' | 'refund' | 'suspend' | 'unsuspend' | 'delete_user'
  action         text not null,
  target_user_id uuid,
  target_email   text,
  -- Amounts, reasons, the refunded transaction id — whatever the action needs
  -- to be reconstructed from this row alone.
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists admin_actions_recent_idx
  on public.admin_actions(created_at desc);

create index if not exists admin_actions_target_idx
  on public.admin_actions(target_user_id, created_at desc);

-- RLS on, no policies — the 0006 §3 pattern. Every reader and writer is the
-- service role, and the subject of an action must not be able to read (or
-- remove) the record of it.
alter table public.admin_actions enable row level security;

-- ---------------------------------------------------------------------------
-- 2. admin_users_list — one page of accounts, already counted
--
-- total_count rides along as a window function rather than a second round
-- trip: the filtered set is already materialised here, and counting it again
-- separately is both a second full pass and a chance to disagree with the page
-- if a signup lands between the two.
--
-- SEARCH USES position(), NOT ilike '%…%'.
--
-- The needle is admin-typed, so a stray % or _ in a pattern would silently
-- widen the match instead of finding the literal address entered. position()
-- has no metacharacters to escape, and neither form can use an index at this
-- size anyway.
--
-- last_active_at is when they last GENERATED, which is not last_sign_in_at.
-- Both are returned and labelled separately: a silent token refresh moves the
-- second one, so treating it as activity reports a dormant account as live.
-- That is the same distinction 0007 §1 draws for active_30d.
-- ---------------------------------------------------------------------------

create or replace function public.admin_users_list(
  p_search text    default null,
  p_sort   text    default 'recent',
  p_limit  integer default 25,
  p_offset integer default 0
)
returns table (
  user_id            uuid,
  email              text,
  name               text,
  created_at         timestamptz,
  last_sign_in_at    timestamptz,
  last_active_at     timestamptz,
  banned_until       timestamptz,
  balance            integer,
  pending            integer,
  lifetime_paise     bigint,
  credits_purchased  integer,
  credits_spent      integer,
  projects           integer,
  generations        integer,
  generations_failed integer,
  total_count        bigint
)
language sql
security definer
set search_path = public
as $fn$
  with txns as (
    select
      t.user_id,
      coalesce(sum(case when t.kind = 'purchase'
                        then coalesce(nullif(t.metadata->>'amount_paise','')::bigint, 0)
                        else 0 end), 0)                                              as lifetime_paise,
      coalesce(sum(case when t.kind = 'purchase' then t.amount  else 0 end), 0)::integer as purchased,
      coalesce(sum(case when t.kind = 'spend'    then -t.amount else 0 end), 0)::integer as spent
      from credit_transactions t
     group by t.user_id
  ),
  gens as (
    select
      e.user_id,
      count(*)::integer                                      as runs,
      (count(*) filter (where e.status = 'failed'))::integer  as failed,
      max(e.created_at)                                       as last_active_at
      from generation_events e
     group by e.user_id
  ),
  projs as (
    select p.user_id, count(*)::integer as n
      from projects p
     where p.user_id is not null
     group by p.user_id
  ),
  owed as (
    select pc.user_id, coalesce(sum(pc.credits), 0)::integer as pending
      from pending_charges pc
     where pc.settled_at is null
     group by pc.user_id
  ),
  filtered as (
    select
      u.id                                                as user_id,
      u.email::text                                       as email,
      nullif(coalesce(u.raw_user_meta_data->>'full_name',
                      u.raw_user_meta_data->>'name'), '')  as name,
      u.created_at,
      u.last_sign_in_at,
      g.last_active_at,
      u.banned_until,
      coalesce(c.balance, 0)                              as balance,
      coalesce(o.pending, 0)                              as pending,
      coalesce(t.lifetime_paise, 0)                       as lifetime_paise,
      coalesce(t.purchased, 0)                            as credits_purchased,
      coalesce(t.spent, 0)                                as credits_spent,
      coalesce(p.n, 0)                                    as projects,
      coalesce(g.runs, 0)                                 as generations,
      coalesce(g.failed, 0)                               as generations_failed
      from auth.users u
      left join user_credits c on c.user_id = u.id
      left join txns  t on t.user_id = u.id
      left join gens  g on g.user_id = u.id
      left join projs p on p.user_id = u.id
      left join owed  o on o.user_id = u.id
     where p_search is null
        or btrim(p_search) = ''
        or position(lower(btrim(p_search)) in lower(coalesce(u.email::text, ''))) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(u.raw_user_meta_data->>'full_name', ''))) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(u.raw_user_meta_data->>'name', ''))) > 0
        or lower(btrim(p_search)) = lower(u.id::text)
  )
  select
    f.*,
    count(*) over () as total_count
    from filtered f
   -- One CASE per sort key rather than dynamic SQL: the sortable columns are
   -- fixed at write time, so an unrecognised p_sort falls through to the
   -- created_at tiebreak instead of being interpolated into a query.
   order by
     case when p_sort = 'balance'     then f.balance         end desc nulls last,
     case when p_sort = 'spent'       then f.credits_spent   end desc nulls last,
     case when p_sort = 'revenue'     then f.lifetime_paise  end desc nulls last,
     case when p_sort = 'generations' then f.generations     end desc nulls last,
     case when p_sort = 'active'      then f.last_active_at  end desc nulls last,
     case when p_sort = 'email'       then lower(f.email)    end asc  nulls last,
     f.created_at desc
   limit  greatest(coalesce(p_limit, 25), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

-- ---------------------------------------------------------------------------
-- 3. admin_user_detail — one account, in full
--
-- A jsonb blob for 0007 §1's reason: unrelated scalars read together, and a
-- figure added later should not change the signature. Returns null for an id
-- that does not exist, which the route turns into a 404 rather than an empty
-- shell that reads as "an account that has done nothing".
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'user_id',            u.id,
    'email',              u.email,
    'name',               nullif(coalesce(u.raw_user_meta_data->>'full_name',
                                          u.raw_user_meta_data->>'name'), ''),
    'created_at',         u.created_at,
    'last_sign_in_at',    u.last_sign_in_at,
    'email_confirmed_at', u.email_confirmed_at,
    'banned_until',       u.banned_until,
    -- How they sign in. Worth showing because suspending an OAuth account and
    -- suspending a password one are the same operation with very different
    -- recovery stories for the person on the other end.
    'providers',          coalesce(u.raw_app_meta_data->'providers', '[]'::jsonb),
    'balance',            (select coalesce(balance, 0) from user_credits where user_id = u.id),
    'pending',            (select coalesce(sum(credits), 0) from pending_charges
                            where user_id = u.id and settled_at is null),
    'credits', (
      select jsonb_build_object(
        'granted',   coalesce(sum(case when kind = 'signup'   then amount  else 0 end), 0),
        'purchased', coalesce(sum(case when kind = 'purchase' then amount  else 0 end), 0),
        'refunded',  coalesce(sum(case when kind = 'refund'   then amount  else 0 end), 0),
        'adjusted',  coalesce(sum(case when kind = 'admin'    then amount  else 0 end), 0),
        'spent',     coalesce(sum(case when kind = 'spend'    then -amount else 0 end), 0),
        'lifetime_paise', coalesce(sum(case when kind = 'purchase'
                                            then coalesce(nullif(metadata->>'amount_paise','')::bigint, 0)
                                            else 0 end), 0),
        'purchases', count(*) filter (where kind = 'purchase')
      ) from credit_transactions where user_id = u.id
    ),
    'runs', (
      select jsonb_build_object(
        'total',     count(*),
        'succeeded', count(*) filter (where status = 'succeeded'),
        'failed',    count(*) filter (where status = 'failed'),
        'pending',   count(*) filter (where status = 'pending'),
        'first_at',  min(created_at),
        'last_at',   max(created_at)
      ) from generation_events where user_id = u.id
    ),
    'projects', (select count(*) from projects where user_id = u.id),
    'media',    (select count(*) from media    where user_id = u.id)
  )
    from auth.users u
   where u.id = p_user_id;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. admin_user_ledger — the money tab, newest first
--
-- The projects and generations tabs are plain owner-filtered selects the route
-- makes through the service client. This one is a function because each row
-- needs to know whether it has already been refunded, and answering that in
-- Node means pulling the account's entire history to render ten lines of it.
--
-- A refund's ref IS the refunded spend's id (0003 §1), so `refunded` is an
-- exact lookup rather than a guess from amounts and timestamps.
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_ledger(
  p_user_id uuid,
  p_limit   integer default 50,
  p_offset  integer default 0
)
returns table (
  id          uuid,
  amount      integer,
  kind        text,
  reason      text,
  ref         text,
  metadata    jsonb,
  created_at  timestamptz,
  refunded    boolean,
  total_count bigint
)
language sql
security definer
set search_path = public
as $fn$
  select
    t.id,
    t.amount,
    t.kind,
    t.reason,
    t.ref,
    t.metadata,
    t.created_at,
    exists (
      select 1 from credit_transactions r
       where r.user_id = t.user_id and r.kind = 'refund' and r.ref = t.id::text
    ) as refunded,
    count(*) over () as total_count
    from credit_transactions t
   where t.user_id = p_user_id
   order by t.created_at desc
   limit  greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Who may call these — service_role only, same as 0003 §5 and 0007 §5.
-- ---------------------------------------------------------------------------

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_users_list(text, text, integer, integer)',
    'public.admin_user_detail(uuid)',
    'public.admin_user_ledger(uuid, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$grants$;

commit;
