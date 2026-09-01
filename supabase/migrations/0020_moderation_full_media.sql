-- ===========================================================================
-- 0020_moderation_full_media.sql — keep the actual output, not just a 256px
-- guess at it
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0006_generation_events.sql.
--
-- WHY, AND WHAT THIS REVERSES
--
-- 0006 stored a 256px webp and nothing else, on the stated reasoning that NSFW
-- triage is a shape-and-skin-tone judgement that survives downscaling, and
-- that full-resolution copies are "a storage bill that grows linearly with
-- usage and a much larger thing to hold on someone else's behalf".
--
-- That was right about triage and wrong about adjudication. A moderator
-- deciding whether to suspend an account cannot do it from a thumbnail: text
-- in the image is unreadable, faces are unidentifiable, and video, audio and
-- 3D had no visual record AT ALL — those runs were judged on their prompt
-- alone, which is the weakest evidence available.
--
-- So the full output is kept too. The storage argument stands and is answered
-- by bounding it rather than by refusing:
--
--   * a per-object ceiling in src/lib/moderation/media.ts, so one pathological
--     run cannot cost unboundedly;
--   * retention, which now deletes the full media with the row (§2) — that is
--     the part that keeps this from growing forever, and it is why the prune
--     function had to change in the same migration rather than later.
--
-- WHERE IT LIVES
--
-- The `moderation` bucket, beside the thumbnail, keyed by event id with no
-- user prefix — the same shape and the same reason as 0006: the bucket has no
-- storage policies at all, so the subject of a record cannot delete the
-- evidence, and a flat key never invites an owner-scoped policy by analogy
-- with project-media.
--
-- BE DELIBERATE ABOUT WHAT THIS MEANS. Every generated output now has a second
-- copy the user cannot reach or delete, retained for the retention window.
-- That is the point of a moderation record, and it is also a real obligation.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The columns
--
-- media_type is stored rather than inferred from the extension, because the
-- viewer has to choose between <img>, <video> and <audio> and guessing from a
-- key is how a webm audio track ends up in an image tag.
--
-- media_bytes so the admin surface can say how large it is before fetching it.
-- A moderator on a phone should know they are about to pull 40MB.
-- ---------------------------------------------------------------------------

alter table public.generation_events
  add column if not exists media_path  text,
  add column if not exists media_type  text,
  add column if not exists media_bytes integer;

-- ---------------------------------------------------------------------------
-- 2. Retention has to take the media with the row
--
-- DROPPED and recreated: the return type gains a column, and Postgres will not
-- reshape an existing function's OUT parameters in place.
--
-- SQL cannot delete storage objects, so this returns the keys and
-- pruneGenerationEvents() passes them to the storage API — the same contract
-- 0006 established for thumbnails. Returning only the thumbnail, as it did
-- until now, would leave every full-resolution object orphaned in the bucket
-- forever: the row that named it is gone, so nothing could ever find it again.
-- ---------------------------------------------------------------------------

drop function if exists public.prune_generation_events(integer);

create or replace function public.prune_generation_events(p_days integer)
returns table (deleted_thumb_path text, deleted_media_path text)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
  delete from public.generation_events
   where created_at < now() - make_interval(days => p_days)
  returning thumb_path, media_path;
end;
$fn$;

revoke all on function public.prune_generation_events(integer) from public;
revoke all on function public.prune_generation_events(integer) from anon;
revoke all on function public.prune_generation_events(integer) from authenticated;
grant execute on function public.prune_generation_events(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. admin_moderation_feed carries the media keys
--
-- DROPPED and recreated for the same reason as §2: the return type gains
-- columns.
--
-- media_path is withheld on a removed row exactly as thumb_path already was.
-- Removing content deletes both objects, so handing either key out afterwards
-- would only produce a signed URL that 404s — and a broken picture reads as a
-- fault in the dashboard rather than as content deliberately taken down.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_moderation_feed(text, text, text, uuid, integer, integer);

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
  media_path         text,
  media_type         text,
  media_bytes        integer,
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
      case when e.content_removed_at is null then e.media_path  end as media_path,
      case when e.content_removed_at is null then e.media_type  end as media_type,
      case when e.content_removed_at is null then e.media_bytes end as media_bytes,
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
       -- position(), not ilike, for 0008 section 2's reason: the needle is
       -- typed by a moderator and a % in a prompt is a character to find.
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

revoke all on function public.admin_moderation_feed(text, text, text, uuid, integer, integer) from public;
revoke all on function public.admin_moderation_feed(text, text, text, uuid, integer, integer) from anon;
revoke all on function public.admin_moderation_feed(text, text, text, uuid, integer, integer) from authenticated;
grant execute on function public.admin_moderation_feed(text, text, text, uuid, integer, integer) to service_role;

commit;
