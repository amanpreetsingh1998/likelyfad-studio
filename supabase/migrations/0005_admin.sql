-- ===========================================================================
-- 0005_admin.sql — the single admin account
--
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once.
--
-- WHY A TABLE AND NOT A FLAG
--
-- "Only one admin" has to be enforced by something that cannot be talked out
-- of it. A boolean on auth.users, or a role string in app_metadata, is one
-- careless UPDATE away from two admins and gives no way to ask "who is it?"
-- from SQL. The `check (id = 1)` below makes a second row a constraint
-- violation at the storage layer — there is no application code to bypass.
--
-- Nothing here grants admin. Seeding is a deliberate manual step (§4), because
-- a UI that can promote an admin is a UI that can be tricked into promoting
-- one.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The table
--
-- id is not a surrogate key — it is the constraint. A single allowed value
-- means the primary key itself caps the table at one row.
--
-- on delete cascade: if the admin's auth account is deleted, the row goes with
-- it rather than pointing at a user that no longer exists. The app then has no
-- admin at all, which is the correct failure direction — better than a
-- dangling id that some future join treats as a match.
-- ---------------------------------------------------------------------------

create table if not exists public.admins (
  id         int  primary key check (id = 1),
  user_id    uuid unique not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Row level security
--
-- One policy, and it is deliberately narrow: a signed-in user may read the
-- admin row only when it is their own. That is enough for src/proxy.ts to
-- answer "is this visitor the admin?" using the caller's own session, so the
-- service-role key never has to be reachable from the proxy.
--
-- A non-admin selecting from this table gets zero rows — not a denial, just an
-- empty result. They cannot learn who the admin is.
--
-- No insert/update/delete policy anywhere. Writes are service-role only, which
-- in practice means §4 below, typed by a human into the SQL editor.
-- ---------------------------------------------------------------------------

alter table public.admins enable row level security;

drop policy if exists admins_select_self on public.admins;
create policy admins_select_self on public.admins
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. set_admin — promote by email
--
-- Convenience for §4. Takes an email rather than a uuid because that is what
-- you actually know when you sit down to do this, and looking the uuid up by
-- hand first is a step where the wrong row gets copied.
--
-- Idempotent, and it MOVES admin rather than adding one: running it with a
-- second email transfers the role, because the check constraint means there is
-- only ever one seat. That is the intended way to hand it over.
-- ---------------------------------------------------------------------------

create or replace function public.set_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(p_email);

  if v_user_id is null then
    raise exception 'No account found for %. They must sign in once first.', p_email
      using errcode = 'no_data_found';
  end if;

  insert into public.admins (id, user_id) values (1, v_user_id)
  on conflict (id) do update set user_id = excluded.user_id;

  return v_user_id;
end;
$fn$;

-- Same reasoning as 0003 §5: the browser must never reach this.
revoke all on function public.set_admin(text) from public;
revoke all on function public.set_admin(text) from anon;
revoke all on function public.set_admin(text) from authenticated;
grant execute on function public.set_admin(text) to service_role;

commit;

-- ---------------------------------------------------------------------------
-- 4. Seed — run this once, by hand, with your own address
--
-- Deliberately left commented out. An uncommented seed in a migration file is
-- a migration that grants admin to whoever the file was written for, on every
-- environment it is ever replayed against.
--
--   select public.set_admin('you@example.com');
--
-- The account must have signed in at least once, or there is no auth.users row
-- to point at. Verify with:
--
--   select a.user_id, u.email from public.admins a join auth.users u on u.id = a.user_id;
-- ---------------------------------------------------------------------------
