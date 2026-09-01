# Implementation Plan — User Workflow History

Feature: a signed-in user whose role is to run workflows can see every workflow
they have created, with its title, description, what one successful run costs,
which models it uses, and how long a whole run takes.

Written 2026-09-01 against branch `feature/admin-dashboard` (HEAD `6ddba62`).
Target: seven phases, one commit per phase, plus a Phase 0 that is a blocker.

---

## PART A — WHAT EXISTS TODAY

Established by reading the schema and the store, not by assumption.

### A.1 What is already there

| Thing | Where | Shape |
|-------|-------|-------|
| Accounts + sessions | Supabase Auth, Google OAuth | `auth.users`, cookie session |
| Saved workflows | `public.projects` | `id` **text** (`wf_<ts>_<rand>`), `name`, `workflow_json`, `node_count`, `edge_style`, `incurred_cost`, `user_id`, `created_at`, `updated_at` |
| Per-node billing | `public.pending_charges` | `credits`, `kind`, `model_id`, `settled_at`, `settled_txn` |
| Per-node telemetry | `public.generation_events` | `kind`, `provider`, `model_id`, `prompt`, `credits_charged`, `duration_ms`, `status`, `created_at`, `completed_at` |
| The ledger | `public.credit_transactions` | signed `amount`, `kind`, `reason`, `ref` |
| Settlement | `settle_pending_charges(user_id, reason)` | sums **all** unsettled rows for that user |
| Client run loop | `executeWorkflow()` in `src/store/workflowStore.ts:1578` | knows `workflowId`; calls `settleRun(status)` on every exit path |

### A.2 What is missing — the actual gap

1. **There is no run entity.** Nothing in the database represents "one
   execution of one workflow". `pending_charges` and `generation_events` are
   both flat per-node lists scoped only by `user_id`.
2. **Nothing links a charge to a workflow.** Neither table carries a project
   id. `credit_transactions` records "Workflow run" as free text and nothing
   more. It is currently impossible to answer "what did workflow X cost".
3. **Settlement is user-scoped, not run-scoped.** `settle_pending_charges`
   sweeps every unsettled row the user has. It cannot bill one run.
4. **`projects` has no `description` column.**
5. **No user-facing history surface exists.** `/admin/users` has a Generations
   tab, but that is admin-only and per-account, not per-workflow.
6. **No wall-clock duration is recorded** for a workflow. `generation_events`
   has per-node `duration_ms`, but nodes run concurrently
   (`maxConcurrentCalls`), so summing them overstates elapsed time — often by
   a lot.

### A.3 Consequences to accept up front

- **No backfill is possible.** Existing `pending_charges` and
  `generation_events` rows carry no run id, and there is no way to infer one
  from timestamps without guessing. History starts the day this ships — the
  same honest position `generation_events` already takes. The UI must say so.
- **A workflow that has never run has no cost and no duration.** Show "not run
  yet", never a zero and never an estimate. A zero is a number a user believes.

---

## PART B — DECISIONS MADE

Stated so they can be argued with, rather than buried in the code.

**B.1 "Total charges of running that workflow one successful time" =
the most recent successful run.**
Not a mean. Runs vary — model swaps, different image counts, fallbacks — and a
mean silently blends a 4-credit run with a 90-credit one into a number that
matches neither. The card shows the last successful run's cost, labelled with
its date, and the detail view lists every run so the variance is visible.
Where more than one successful run exists, show the range beneath it.

**B.2 "Estimated time of whole workflow" = wall clock of the run.**
`finished_at - started_at` on the run row. Not the sum of node durations —
concurrency makes that sum wrong in the pessimistic direction. Same source
rule as B.1: last successful run, range where available.

**B.3 The run id is minted by the server, never invented by the client.**
`POST /api/runs/start` creates the row and returns its id; the client echoes
that id back on each generation call. The server verifies the run belongs to
the caller before tagging anything with it. This mirrors the existing rule
that the client picks the *moment* to settle but never the *amount* — here it
picks the moment to start, never the identity.

**B.4 Settlement becomes run-scoped, with the user-scoped path kept.**
`settle_pending_charges(user_id, reason, run_id default null)`. Passing a run
settles that run; passing null keeps today's behaviour, which is what the
maintenance sweep in `0011` needs for abandoned charges that have no run.

**B.5 Description is user-written, with a generated fallback.**
Free text the user can edit. When empty, derive a one-line summary from the
graph ("6 nodes, 2 image generations, 1 LLM") so the list is never a column of
blanks. The derived line is computed on read, never stored, so it cannot go
stale against an edited graph.

**B.6 Models are recorded per run, not per workflow.**
A workflow's model list is whatever its last successful run actually used —
read from that run's `generation_events` — rather than what the graph
currently says. The graph can be edited after the run; the charge cannot.

---

## PART C — PHASES

---

### PHASE 0 — Unblock: apply the settlement fix (BLOCKER)

**This phase is not optional and nothing after it is meaningful without it.**

`settle_pending_charges` has never worked (see `0012_fix_settlement.sql`).
Until it is applied to the live database, every run settles to nothing, so a
history page built on top would faithfully report that every workflow costs 0
credits. That is worse than no page.

Steps:

1. Commit the four uncommitted units already in the tree (maintenance sweep,
   `0011`, `0012`, quickstart templates, test-infra fix) — see
   `PROJECT_STATUS.md` section 2.
2. Run `0011_maintenance.sql` then `0012_fix_settlement.sql` in the Supabase
   SQL editor.
3. Confirm by hand: run a one-node workflow, then
   `select * from credit_transactions order by created_at desc limit 1;`
   A `spend` row must exist. If it does not, stop — do not start Phase 1.

**Acceptance:** one real workflow run produces one `credit_transactions` row
with a negative amount.

---

### PHASE 1 — Schema: give a run an identity

**Goal:** the database can represent one execution of one workflow.

**New migration: `supabase/migrations/0013_workflow_runs.sql`**

    -- 1. Description on projects
    alter table public.projects
      add column if not exists description text;

    -- 2. The run entity
    create table if not exists public.workflow_runs (
      id           uuid primary key default gen_random_uuid(),
      user_id      uuid not null references auth.users(id) on delete cascade,
      -- text, NOT uuid: projects.id is a client-minted 'wf_<ts>_<rand>' string.
      project_id   text references public.projects(id) on delete set null,
      -- Snapshot, because the project may be renamed or deleted later and this
      -- row still has to name what was run.
      project_name text,
      node_count   integer,
      status       text not null default 'running',  -- running|completed|failed|cancelled|abandoned
      started_at   timestamptz not null default now(),
      finished_at  timestamptz,
      -- Filled by settlement. Null until the run settles.
      credits_charged integer,
      settled_txn  uuid references public.credit_transactions(id) on delete set null
    );

    -- 3. Tag the per-node rows
    alter table public.pending_charges
      add column if not exists run_id uuid
      references public.workflow_runs(id) on delete set null;
    alter table public.generation_events
      add column if not exists run_id uuid
      references public.workflow_runs(id) on delete set null;

    -- 4. Indexes — one per question the page actually asks
    create index if not exists workflow_runs_user_idx
      on public.workflow_runs(user_id, started_at desc);
    create index if not exists workflow_runs_project_idx
      on public.workflow_runs(project_id, started_at desc);
    -- The "last successful run" lookup, which is the hot path of the whole page.
    create index if not exists workflow_runs_success_idx
      on public.workflow_runs(project_id, finished_at desc)
      where status = 'completed';
    create index if not exists pending_charges_run_idx
      on public.pending_charges(run_id) where run_id is not null;
    create index if not exists generation_events_run_idx
      on public.generation_events(run_id) where run_id is not null;

    -- 5. RLS: read your own, write through functions only.
    alter table public.workflow_runs enable row level security;
    create policy workflow_runs_select_own on public.workflow_runs
      for select using (auth.uid() = user_id);
    -- Deliberately no insert/update/delete policy, matching user_credits: rows
    -- are written by security-definer functions so a user cannot forge a run or
    -- edit what one cost.

`on delete set null` on `project_id`, not cascade: deleting a workflow must not
erase the ledger's explanation of money already spent. `project_name` is
snapshot for the same reason `admin_actions` snapshots the actor's email.

**Files:** `supabase/migrations/0013_workflow_runs.sql` (new).

**Acceptance:** migration runs twice with no error (every statement guarded);
a hand-inserted run row is visible to its owner and invisible to another
account when queried through the anon key.

**Commit:** `Give a workflow run an identity`

---

### PHASE 2 — Server: open, tag and close a run

**Goal:** every node charge and every generation event carries the run it
belongs to, and settlement bills one run.

**2a. SQL functions** (same migration, or `0014` if that keeps review
readable):

- `start_workflow_run(p_project_id text, p_project_name text, p_node_count int)
  returns uuid` — security definer, inserts with `auth.uid()`.
- `finish_workflow_run(p_run_id uuid, p_status text)` — sets `finished_at` and
  `status`, only where `user_id = auth.uid()`.
- `settle_pending_charges(p_user_id uuid, p_reason text, p_run_id uuid default null)`
  — **amend, carefully.** Add the run filter to the WHERE clauses; when a run
  is given, also write `credits_charged` and `settled_txn` back onto the run
  row. Keep the null path byte-identical to 0012's behaviour, because the
  maintenance sweep depends on it.

> Risk: this is the function 0012 just fixed, and the function whose breakage
> went unnoticed for months. Do not ship this change on mocked tests alone —
> Phase 7 adds the real-database test, and this function is the reason it
> exists.

**2b. Routes**

- `POST /api/runs/start` — new. Auth via `getAuthedContext()`, calls
  `start_workflow_run`, returns `{ runId }`.
- `POST /api/runs/finish` — new. Calls `finish_workflow_run`. Verifies
  ownership through RLS by using the caller's client, not the service client.
- `POST /api/credits/settle` — accept an optional `runId` in the body and pass
  it through. A `runId` that is not the caller's returns nothing through RLS;
  treat that as a 404, not a 500.

**2c. `withCredits()`** (`src/lib/credits/guard.ts`)

Read `runId` from the request body, validate it belongs to the caller (one
indexed lookup, cached per request), and pass it into `recordPendingCharge()`
and `recordGenerationEvent()`. An absent or invalid `runId` must **not** fail
the generation — it degrades to today's untagged behaviour and logs. Billing
must never break because history is unavailable.

**Files:** `src/lib/credits/guard.ts`, `src/lib/credits/server.ts`,
`src/lib/moderation/events.ts`, `src/app/api/credits/settle/route.ts`,
`src/app/api/runs/start/route.ts` and `src/app/api/runs/finish/route.ts`
(new), plus tests beside each.

**Acceptance:** a two-node workflow produces one `workflow_runs` row with
`status='completed'`, two `pending_charges` rows carrying that `run_id`, one
`credit_transactions` row, and `credits_charged` written back onto the run.

**Commit:** `Bill a workflow run as a run, not as a pile of charges`

---

### PHASE 3 — Client: thread the run through execution

**Goal:** `executeWorkflow` opens a run before the first node and closes it on
every exit path.

**`src/store/workflowStore.ts`**

- At the top of `executeWorkflow` (after the `requireAuth()` gate, before the
  first node dispatches): call `/api/runs/start` with `workflowId`,
  `workflowName`, `nodes.length`. Hold the id in a run-local variable — **not
  in the persisted store**, for the same reason Comfy previews are not stored:
  node data gets written into saved workflow files.
- Pass `runId` on every generation request. The executors under
  `src/store/execution/` build those bodies; add it in one shared place
  (`runWithFallback.ts` / the shared fetch helper) rather than in each
  executor.
- On all exit paths (`:1981` completed/cancelled, `:2005` failed, and the
  cancel path), call `settleRun(status, runId)` and `/api/runs/finish`.

**`src/store/creditStore.ts`** — `settleRun(status, runId?)` forwards the id.

**Failure behaviour:** if `/api/runs/start` fails, log and run anyway with a
null run id. A history feature must never be able to stop a user working.

**Files:** `src/store/workflowStore.ts`, `src/store/creditStore.ts`,
`src/store/execution/runWithFallback.ts` (or the shared request helper),
`src/store/__tests__/workflowStore.integration.test.ts`.

**Acceptance:** running a workflow with devtools open shows one start call,
N tagged generation calls, one finish, one settle — in that order. Cancelling
mid-run still closes the run as `cancelled`.

**Commit:** `Open and close a run around every execution`

---

### PHASE 4 — Read API: the history query

**Goal:** one round trip returns the page.

**SQL function `user_workflow_history(p_limit int, p_offset int, p_q text)`**
— security definer, filtered to `auth.uid()`. Per project it returns:

| Field | Source |
|-------|--------|
| `project_id`, `title` | `projects.id`, `projects.name` |
| `description` | `projects.description` |
| `node_count`, `updated_at`, `created_at` | `projects` |
| `run_count`, `success_count` | count over `workflow_runs` |
| `last_success_credits` | `credits_charged` of the newest `status='completed'` run |
| `last_success_duration_ms` | `finished_at - started_at` of that same run |
| `last_success_at` | its `finished_at` |
| `credits_min` / `credits_max` | over successful runs, for the range line |
| `models` | distinct `provider`/`model_id` from that run's `generation_events` |
| `total_count` | window function, same pattern as `admin_users_list` |

Aggregate in Postgres, not in Node — the same argument as
`0007_admin_stats.sql`, and these tables only grow. `total_count` rides along
as a window function rather than a second count query, for the reason already
documented for the admin user list.

Follow the existing house rules: search with `position()` not `ilike '%…%'`;
sorting picks a column, not a direction; a failed read returns a `failed`
marker rather than an empty list, because "no workflows" and "the query broke"
must not look identical.

**Routes:** `GET /api/workflows/history` (list) and
`GET /api/workflows/[id]/runs` (one workflow's run list, for the detail view).
Both use the caller's client so RLS does the scoping.

**Files:** `supabase/migrations/0014_workflow_history.sql`,
`src/lib/workflows/history.ts`, `src/app/api/workflows/history/route.ts`,
`src/app/api/workflows/[id]/runs/route.ts`, tests for each.

**Acceptance:** two accounts each with workflows — each sees only their own,
verified through the API and not only through the SQL.

**Commit:** `Aggregate a user's workflow history in Postgres`

---

### PHASE 5 — UI: the history page

**Goal:** `/workflows` — the page the feature is actually for.

**Route:** `src/app/workflows/page.tsx`, server-rendered with real numbers on
first paint (the same approach as `/admin`), refetching on filter change.

**Card contents**, one per workflow:

    Title                                            [Open]
    Description (or the derived "6 nodes, 2 image gens, 1 LLM")
    ──────────────────────────────────────────────────────────
    Cost of one run   Time         Models          Runs
    42 credits        1m 18s       nano-banana     7 (6 ok)
    last run 28 Aug   wall clock   gpt-4.1-mini

Rules to hold to:

- **Never invent a number.** Never run: "Not run yet". Runs exist but none
  succeeded: "No successful run yet", plus the failure count. A failed read:
  "Could not load", not a zero.
- **Label the source.** "Cost of one run" is the last successful run, so the
  date sits under it. Where successful runs disagree, add
  "ranged 38-61 across 6 runs".
- **Time is wall clock, and say so** in a tooltip — a user comparing it to the
  sum of node times will otherwise think it is wrong.
- **Models are what ran, not what the graph says.** A note on the detail view
  covers the case where the graph was edited after the run.
- **State the coverage gap in the UI**, as the moderation feed does: workflows
  run before this shipped show "no run history".

**Detail view** (drawer, matching the admin users drawer): every run with its
date, status, credits, duration and models. This is where variance becomes
visible, and where the card's single number stops being a claim about all runs.

**Navigation:** an entry in `Header.tsx`, signed-in users only.

**Files:** `src/app/workflows/page.tsx`,
`src/components/workflows/HistoryList.tsx`, `HistoryCard.tsx`,
`RunDrawer.tsx`, `src/components/Header.tsx`, tests beside each.

**Acceptance:** the page renders correctly for a user with zero workflows, one
workflow never run, one workflow run but failed, and one with several
successful runs — all four states legible, none showing a misleading zero.

**Commit:** `Show a user their workflow history`

---

### PHASE 6 — Description editing

**Goal:** the description is writable.

- Add the field to the project rename / setup path
  (`ProjectSetupModal.tsx`), and make it inline-editable on the history card.
- `PATCH /api/likelyfad/projects/[id]` accepts `description`; RLS already
  scopes the write to the owner.
- Cap the length server-side (500 chars) and store trimmed.

**Files:** `src/app/api/likelyfad/projects/[id]/route.ts`,
`src/components/modals/ProjectSetupModal.tsx`,
`src/components/workflows/HistoryCard.tsx`.

**Acceptance:** the description survives a save/reload cycle; another account
cannot PATCH it.

**Commit:** `Let a workflow carry a description`

---

### PHASE 7 — Loose ends: abandoned runs, retention, and a real test

**7a. Abandoned runs.** A closed tab leaves `status='running'` forever. Extend
`sweep_stale_pending_charges` in the maintenance job to also close runs older
than the staleness window as `abandoned`, settling their charges. Reuse the
existing hourly `POST /api/cron/maintenance` — no new scheduler.

**7b. Retention.** `prune_generation_events(days)` deletes events. Decide
explicitly what happens to a `workflow_runs` row whose events are gone: keep
it. The run's cost and duration live on the run row itself, so history survives
event retention — and that is precisely why they are stored there rather than
recomputed from events.

**7c. The real-database test — the most important item in this plan.**
Every function added in Phases 1, 2 and 4 is SQL. The credit system was green
across 2,778 tests while `settle_pending_charges` had never once succeeded,
because everything around it is mocked. Add a suite that:

- spins up a throwaway Postgres (Docker, or a scratch Supabase branch),
- applies `0001` through `0014` in order,
- calls `start_workflow_run` → `record_pending_charge` →
  `settle_pending_charges(run)` → `user_workflow_history`,
- asserts the numbers, and asserts a second account sees none of it.

This is the test that would have caught `0012` on the day it was written.

**Files:** `supabase/migrations/0015_run_sweep.sql`,
`src/lib/maintenance/sweep.ts`,
`src/lib/db/__tests__/*.integration.test.ts`, a `test:db` npm script.

**Commit:** `Close abandoned runs, and test the SQL against a real database`

---

## PART D — SEQUENCING AND RISK

| Phase | Depends on | Risk | Note |
|-------|-----------|------|------|
| 0 | — | **High** | Everything downstream reports zeros without it |
| 1 | 0 | Low | Additive columns and one new table |
| 2 | 1 | **High** | Touches `settle_pending_charges`, which is money |
| 3 | 2 | Medium | Three exit paths in `executeWorkflow`, easy to miss one |
| 4 | 1 | Low | Read-only |
| 5 | 4 | Low | UI only |
| 6 | 1 | Low | Independent of 2-5; can land any time after 1 |
| 7 | 2 | Medium | Amends the maintenance sweep |

Phases 4 and 6 do not depend on 2 or 3 and can be built in parallel with them;
they will simply show empty history until runs are being recorded.

**Do not skip Phase 0.** The single largest risk in this plan is building five
phases of history UI on top of a settlement function that still returns zero,
and only discovering it when a user asks why every workflow they own claims to
have cost nothing.

---

## PART E — OUT OF SCOPE

Recorded so they are decisions rather than omissions.

- **No backfill.** Pre-existing charges cannot be attributed to a run.
- **No cost prediction for a workflow that has never run.** The rate card could
  produce an estimate, but presenting a predicted figure in the same column as
  a measured one makes the two indistinguishable.
- **No cross-user or team views.** This is one user's own history.
- **No re-run-from-history button.** Worth doing, but it is an execution
  feature, not a history feature, and it would spend credits from a screen
  built for reading.
