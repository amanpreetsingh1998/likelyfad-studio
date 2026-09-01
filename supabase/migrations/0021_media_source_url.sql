-- ===========================================================================
-- 0021_media_source_url.sql — remember where the output came from
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once. Requires 0020_moderation_full_media.sql.
--
-- WHY
--
-- 0020 copies the output into the moderation bucket so the record survives the
-- provider. That copy can fail for reasons that are nobody's fault and are not
-- visible afterwards: the CDN link expired between the run and the copy, the
-- object was over the ceiling, the download timed out.
--
-- When it fails, the admin surface currently shows nothing at all — and
-- "nothing" is indistinguishable from "this run produced nothing", which is a
-- very different fact about a user.
--
-- So the provider's own URL is recorded alongside. It is a fallback, not a
-- replacement:
--
--   * the stored copy is the evidence — durable, ours, and unreachable by the
--     subject of the record;
--   * the source URL is a courtesy — it will expire, and it points at
--     infrastructure we do not control.
--
-- The admin UI must therefore label which one it is showing. A provider link
-- that 404s next week is fine as long as nobody mistook it for the archive.
--
-- IT IS ALSO THE DIAGNOSTIC. A row with a source URL and no media_path says
-- the copy was attempted and failed, and names exactly what it tried to copy.
-- Before this, that case and "no output at all" were the same empty row.
-- ===========================================================================

begin;

alter table public.generation_events
  add column if not exists media_source_url text;

-- ---------------------------------------------------------------------------
-- admin_moderation_feed carries it, withheld on a removed row like the rest.
--
-- Withholding matters more here than for the stored keys: those point at
-- objects that removal actually deleted, whereas this points at the provider's
-- copy, which we cannot delete. Handing it out after a takedown would let the
-- feed reconstitute content an admin had removed.
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
  media_source_url   text,
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
      case when e.content_removed_at is null then e.thumb_path       end as thumb_path,
      case when e.content_removed_at is null then e.media_path       end as media_path,
      case when e.content_removed_at is null then e.media_type       end as media_type,
      case when e.content_removed_at is null then e.media_bytes      end as media_bytes,
      case when e.content_removed_at is null then e.media_source_url end as media_source_url,
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
