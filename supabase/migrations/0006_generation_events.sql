-- ===========================================================================
-- 0006_generation_events.sql — what was generated, by whom, from what prompt
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0003_credits.sql.
--
-- WHY THIS EXISTS
--
-- Before this table, nothing in the system recorded what a user generated.
-- Outputs lived as base64 inside projects.workflow_json, overwritten on every
-- autosave and gone entirely when the node was deleted; prompts were not
-- stored anywhere at all. cost_events came closest and holds no prompt, no
-- output, and self-deletes after 48 hours.
--
-- That makes this the one part of the admin dashboard that cannot be
-- backfilled. Every hour before it ships is an hour of history that does not
-- exist — which is why it lands before any chart.
--
-- WHY THE THUMBNAIL IS NOT IN project-media
--
-- 0002_storage_policies.sql grants a user delete on everything under their own
-- prefix in that bucket. Evidence the subject can delete is not evidence, so
-- moderation thumbnails go in a separate bucket with no authenticated policies
-- at all — service role only, which in practice means the admin routes.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The table
--
-- One row per billable run, written from withCredits() — the single chokepoint
-- every /api/generate and /api/llm call already passes through.
--
-- status is a lifecycle, not a success flag:
--   'succeeded' — output in hand, thumbnail written if it was an image
--   'pending'   — dispatched to a provider that answers asynchronously (Kie
--                 long-running tasks), completed later by /api/generate/poll
--   'failed'    — the provider was reached and did not deliver
--
-- A 'pending' row that never advances is not a bug to clean up. It is the
-- record that this prompt was sent to a provider, which is the thing worth
-- keeping for moderation even when the output never came back.
-- ---------------------------------------------------------------------------

create table if not exists public.generation_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- What was asked for. `kind` mirrors RunKind in src/lib/credits/pricing.ts.
  kind       text not null,
  provider   text,
  model_id   text,
  prompt     text,

  -- What came back. thumb_path is a key in the `moderation` bucket (§4);
  -- output_text carries LLM output, truncated by the writer.
  output_kind text,
  thumb_path  text,
  output_text text,

  -- Telemetry. credits_charged is what withCredits() recorded as pending for
  -- this step, so the admin view can rank users by spend without re-deriving
  -- it from the rate card.
  credits_charged integer,
  duration_ms     integer,
  status          text not null default 'pending',
  error           text,

  -- Join key for the asynchronous path. Set at dispatch, matched by the poll
  -- route together with user_id — never on its own, or one user could complete
  -- (and read) another's event by guessing a task id.
  task_id text,

  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 2. Indexes — one per question the dashboard actually asks
-- ---------------------------------------------------------------------------

-- The moderation feed: newest first, across everyone.
create index if not exists generation_events_recent_idx
  on public.generation_events(created_at desc);

-- The per-user drawer, and every "what has this account made" query.
create index if not exists generation_events_user_idx
  on public.generation_events(user_id, created_at desc);

-- Model breakdowns over a window (runs per model, success rate, latency).
create index if not exists generation_events_model_idx
  on public.generation_events(model_id, created_at desc);

-- The poll completion lookup. Partial, because only the asynchronous path
-- sets task_id and it is a small minority of rows.
create unique index if not exists generation_events_task_idx
  on public.generation_events(user_id, task_id) where task_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Row level security
--
-- Enabled with NO policies whatsoever. Not an oversight: every reader and
-- writer of this table is the service role (withCredits, the poll route, the
-- admin routes), and service role bypasses RLS.
--
-- A user must not be able to delete their own row — the entire point is that
-- the subject of a moderation record cannot remove it. Since RLS denies by
-- default once enabled, "no policies" is the strictest possible statement and
-- needs no policy to express it.
-- ---------------------------------------------------------------------------

alter table public.generation_events enable row level security;

-- ---------------------------------------------------------------------------
-- 4. The moderation bucket
--
-- Private, and deliberately policy-free for the same reason as §3.
--
-- If this insert fails (some projects restrict storage.buckets from the SQL
-- editor), create it by hand: Storage → New bucket → name `moderation`,
-- Public bucket OFF, and add no policies.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('moderation', 'moderation', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Retention
--
-- Deletes rows older than p_days and RETURNS the thumbnail keys it removed,
-- because SQL cannot delete storage objects — the caller must pass these to
-- the storage API or the images outlive the rows that pointed at them.
--
-- Nothing calls this yet. It needs a scheduler, which this project does not
-- have; the same gap keeps settle_pending_charges from closing the closed-tab
-- billing leak. Written now so the retention story is a cron entry away rather
-- than a migration away.
-- ---------------------------------------------------------------------------

create or replace function public.prune_generation_events(p_days integer)
returns table (deleted_thumb_path text)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
  delete from public.generation_events
   where created_at < now() - make_interval(days => p_days)
  returning thumb_path;
end;
$fn$;

revoke all on function public.prune_generation_events(integer) from public;
revoke all on function public.prune_generation_events(integer) from anon;
revoke all on function public.prune_generation_events(integer) from authenticated;
grant execute on function public.prune_generation_events(integer) to service_role;

commit;
