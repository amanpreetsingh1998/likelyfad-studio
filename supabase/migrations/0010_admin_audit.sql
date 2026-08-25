-- ===========================================================================
-- 0010_admin_audit.sql — reading the log of what the admin did
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0008.
--
-- 0008 created admin_actions and every route has been writing to it since.
-- Nothing could read it: the table has RLS on with no policies, so the only
-- reader is the service role, and no route asked. A log nobody can read is a
-- log you only ever see by opening the SQL editor with an incident already
-- underway.
--
-- WHY A FUNCTION FOR WHAT LOOKS LIKE A PLAIN SELECT
--
-- Two things the route cannot do for itself: count the filtered set in the
-- same pass that returns it (0008 §2's reason), and answer whether a target
-- account still exists — auth.users is not readable by the application roles,
-- and "was this person deleted" is exactly what an audit reader asks.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. admin_actions_list — one page of the log
--
-- The emails come off the row, not from a join. They were snapshot at write
-- time precisely so a deleted account still reads as an address rather than a
-- uuid that resolves to nothing — joining auth.users here would undo that for
-- the rows that matter most.
--
-- target_exists is the separate question: whether the account is still there
-- to link to. Null target_user_id (an action against no particular account)
-- reads as false, which is right — there is nothing to open.
-- ---------------------------------------------------------------------------

create or replace function public.admin_actions_list(
  p_action text    default null,
  p_target uuid    default null,
  p_search text    default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id             uuid,
  actor_id       uuid,
  actor_email    text,
  action         text,
  target_user_id uuid,
  target_email   text,
  target_exists  boolean,
  details        jsonb,
  created_at     timestamptz,
  total_count    bigint
)
language sql
security definer
set search_path = public
as $fn$
  with filtered as (
    select
      a.id,
      a.actor_id,
      a.actor_email,
      a.action,
      a.target_user_id,
      a.target_email,
      (a.target_user_id is not null
        and exists (select 1 from auth.users u where u.id = a.target_user_id))
        as target_exists,
      a.details,
      a.created_at
      from admin_actions a
     where (p_action is null or a.action = p_action)
       and (p_target is null or a.target_user_id = p_target)
       -- position(), not ilike — 0008 §2's reason. details is searched as text
       -- so a reason, an event id or a refunded transaction id all find their
       -- own row without a column per key.
       and (
         p_search is null
         or btrim(p_search) = ''
         or position(lower(btrim(p_search)) in lower(coalesce(a.actor_email, ''))) > 0
         or position(lower(btrim(p_search)) in lower(coalesce(a.target_email, ''))) > 0
         or position(lower(btrim(p_search)) in lower(a.action)) > 0
         or position(lower(btrim(p_search)) in lower(a.details::text)) > 0
       )
  )
  select f.*, count(*) over () as total_count
    from filtered f
   order by f.created_at desc
   limit  greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

-- ---------------------------------------------------------------------------
-- 2. admin_actions_summary — how many of each kind, for the filter chips
--
-- One pass rather than a count query per chip, for 0009 §3's reason: separate
-- reads can disagree with each other, and these sit side by side.
--
-- Returned as a jsonb object keyed by action rather than a fixed set of
-- columns, so a new action added later shows up without another migration.
-- ---------------------------------------------------------------------------

create or replace function public.admin_actions_summary()
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'total', (select count(*) from admin_actions),
    'by_action', coalesce(
      (select jsonb_object_agg(action, n)
         from (select action, count(*) as n from admin_actions group by action) s),
      '{}'::jsonb
    ),
    'first_at', (select min(created_at) from admin_actions),
    'last_at',  (select max(created_at) from admin_actions)
  );
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Who may call these — service_role only, same as every admin function.
-- ---------------------------------------------------------------------------

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_actions_list(text, uuid, text, integer, integer)',
    'public.admin_actions_summary()'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$grants$;

commit;
