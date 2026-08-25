-- ===========================================================================
-- 0009_moderation.sql — the review state behind /admin/content
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0006 and 0008.
--
-- WHY STATE ON THE EVENT RATHER THAN A FLAGS TABLE
--
-- A flag is not an event in its own right — it is the current answer to "has
-- a human looked at this row, and what did they decide". Storing that as
-- append-only rows would mean every reader deriving the current state from
-- the newest one, on the table the feed already sorts and pages by.
--
-- The history is not lost: admin_actions (0008 §1) already records every flag,
-- clear and removal with its actor, reason and timestamp. State lives here,
-- the audit trail lives there, and neither is reconstructed from the other.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Review state
--
-- 'unreviewed' is the default and the thing the queue is for. 'cleared' is a
-- human decision, and is deliberately NOT the same as unreviewed: a feed that
-- cannot tell "looked at, fine" from "never opened" makes a moderator review
-- the same picture every day.
--
-- content_removed_at is separate from the state on purpose. Removing a
-- thumbnail is an action taken about a row, not a verdict on it — a flagged
-- row may keep its picture as evidence, and a cleared row may still have had
-- one deleted on request.
-- ---------------------------------------------------------------------------

alter table public.generation_events
  add column if not exists moderation_state text not null default 'unreviewed',
  add column if not exists moderated_at      timestamptz,
  add column if not exists moderated_by      uuid,
  add column if not exists moderation_reason text,
  add column if not exists content_removed_at timestamptz;

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'generation_events_moderation_state_check'
       and conrelid = 'public.generation_events'::regclass
  ) then
    alter table public.generation_events
      add constraint generation_events_moderation_state_check
      check (moderation_state in ('unreviewed', 'flagged', 'cleared'));
  end if;
end
$constraint$;

-- The queue's own index. Partial, because 'unreviewed' is almost every row
-- and a moderator opening the flag queue is asking for the small minority.
create index if not exists generation_events_flagged_idx
  on public.generation_events(created_at desc)
  where moderation_state = 'flagged';

-- The feed filtered by state, newest first — the default view.
create index if not exists generation_events_state_idx
  on public.generation_events(moderation_state, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. admin_moderation_feed — the review surface
--
-- Joins auth.users for the email, because the feed's first question about any
-- picture is whose it is, and the route cannot read that table (0008's header
-- note). user_flags rides along for the same reason: a prompt is judged very
-- differently when it is the account's fourth flag.
--
-- Filters are all optional and all applied in SQL. Paging over a filtered set
-- in Node would mean fetching everything to show forty rows of it.
-- ---------------------------------------------------------------------------

create or replace function public.admin_moderation_feed(
  p_search text    default null,
  p_state  text    default null,
  p_kind   text    default null,
  p_user   uuid    default null,
  p_limit  integer default 40,
  p_offset integer default 0
)
returns table (
  id                 uuid,
  user_id            uuid,
  email              text,
  kind               text,
  provider           text,
  model_id           text,
  prompt             text,
  output_kind        text,
  output_text        text,
  thumb_path         text,
  status             text,
  credits_charged    integer,
  duration_ms        integer,
  created_at         timestamptz,
  moderation_state   text,
  moderated_at       timestamptz,
  moderation_reason  text,
  content_removed_at timestamptz,
  user_flags         integer,
  total_count        bigint
)
language sql
security definer
set search_path = public
as $fn$
  with flags as (
    select e.user_id, count(*)::integer as n
      from generation_events e
     where e.moderation_state = 'flagged'
     group by e.user_id
  ),
  filtered as (
    select
      e.id,
      e.user_id,
      u.email::text as email,
      e.kind,
      e.provider,
      e.model_id,
      e.prompt,
      e.output_kind,
      e.output_text,
      -- A removed thumbnail is gone from storage, so the key is withheld
      -- rather than handed out to be signed into a 404.
      case when e.content_removed_at is null then e.thumb_path end as thumb_path,
      e.status,
      e.credits_charged,
      e.duration_ms,
      e.created_at,
      e.moderation_state,
      e.moderated_at,
      e.moderation_reason,
      e.content_removed_at,
      coalesce(f.n, 0) as user_flags
      from generation_events e
      left join auth.users u on u.id = e.user_id
      left join flags f on f.user_id = e.user_id
     where (p_state is null or e.moderation_state = p_state)
       and (p_kind  is null or e.kind = p_kind)
       and (p_user  is null or e.user_id = p_user)
       -- position(), not ilike, for 0008 §2's reason: the needle is typed by
       -- a moderator and a % in a prompt is a character to find.
       and (
         p_search is null
         or btrim(p_search) = ''
         or position(lower(btrim(p_search)) in lower(coalesce(e.prompt, ''))) > 0
         or position(lower(btrim(p_search)) in lower(coalesce(e.output_text, ''))) > 0
         or position(lower(btrim(p_search)) in lower(coalesce(u.email::text, ''))) > 0
         or position(lower(btrim(p_search)) in lower(coalesce(e.model_id, ''))) > 0
       )
  )
  select f.*, count(*) over () as total_count
    from filtered f
   order by f.created_at desc
   limit  greatest(coalesce(p_limit, 40), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

-- ---------------------------------------------------------------------------
-- 3. admin_moderation_counts — what each filter would return
--
-- The tab counts are computed here rather than by running the feed four times
-- with different filters. One pass, one round trip, and the numbers cannot
-- disagree with each other the way four separate reads can.
-- ---------------------------------------------------------------------------

create or replace function public.admin_moderation_counts()
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'total',      count(*),
    'unreviewed', count(*) filter (where moderation_state = 'unreviewed'),
    'flagged',    count(*) filter (where moderation_state = 'flagged'),
    'cleared',    count(*) filter (where moderation_state = 'cleared'),
    'removed',    count(*) filter (where content_removed_at is not null),
    -- Accounts carrying at least one flag. The moderation queue is about
    -- pictures; this is the figure that turns it into a question about people.
    'flagged_users', (
      select count(distinct user_id) from generation_events
       where moderation_state = 'flagged'
    )
  ) from generation_events;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. admin_users_list gains a flag count
--
-- Phase 3 shipped without one because flags did not exist and a column of
-- zeros reads as "nobody has ever been flagged" rather than "flags are not
-- built yet". They exist now, so the account list carries the count.
--
-- DROP then CREATE, not CREATE OR REPLACE: the return type changes, and
-- Postgres refuses to replace a function whose OUT columns differ. Dropping
-- also drops the grant, so §5 re-applies it.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_users_list(text, text, integer, integer);

create function public.admin_users_list(
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
  flags              integer,
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
      count(*)::integer                                                as runs,
      (count(*) filter (where e.status = 'failed'))::integer            as failed,
      (count(*) filter (where e.moderation_state = 'flagged'))::integer as flags,
      max(e.created_at)                                                 as last_active_at
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
      coalesce(g.failed, 0)                               as generations_failed,
      coalesce(g.flags, 0)                                as flags
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
   order by
     case when p_sort = 'balance'     then f.balance         end desc nulls last,
     case when p_sort = 'spent'       then f.credits_spent   end desc nulls last,
     case when p_sort = 'revenue'     then f.lifetime_paise  end desc nulls last,
     case when p_sort = 'generations' then f.generations     end desc nulls last,
     case when p_sort = 'flags'       then f.flags           end desc nulls last,
     case when p_sort = 'active'      then f.last_active_at  end desc nulls last,
     case when p_sort = 'email'       then lower(f.email)    end asc  nulls last,
     f.created_at desc
   limit  greatest(coalesce(p_limit, 25), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Who may call these — service_role only, same as 0003 §5, 0007 §5, 0008 §5.
-- ---------------------------------------------------------------------------

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_moderation_feed(text, text, text, uuid, integer, integer)',
    'public.admin_moderation_counts()',
    'public.admin_users_list(text, text, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$grants$;

commit;
