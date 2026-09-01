# PRD — Per-User Workflow History (cloud persistence + run costs)

**Goal.** A signed-in user's role is to run workflows. They should see every
workflow they have ever created, backed by the existing login (Supabase auth)
and credit system. Each history entry shows: **title**, **description**,
**total charges of one successful run** (actual settled cost of the last
successful run, falling back to a pricing-engine estimate for workflows never
run successfully), **models used**, and **estimated time of the whole
workflow**.

**Decisions taken** (confirmed 2026-09-01): actual + estimate for cost; full
workflow graph stored in Supabase so any history entry can be reopened
anywhere; a new dedicated `/workflows` page for the UI.

---

## What the codebase gives us today — and the two gaps

Workflows are currently saved **only as local JSON files**: `POST /api/workflow`
and `GET /api/list-workflows` sit behind `requireLocal` and are off by default
in production. Nothing ties a workflow to an account. Cost data exists but is
not attributable: `pending_charges` (written per node run by `withCredits()` in
`src/lib/credits/guard.ts`) and `generation_events` (model_id,
credits_charged, duration_ms, status per run) both lack any
**workflow_id / run_id**. Settlement bills "everything this user owes right
now", not "this workflow's run".

So the feature decomposes into: (1) a `workflows` table + `workflow_runs`
table, (2) attribution of charges and generation events to a workflow run,
(3) cloud CRUD routes, (4) client save/load rework, (5) the history page,
(6) the estimate engine, (7) hardening. Every phase below ends with a
verification gate and names the Claude Code skills (in `.claude/skills/`) to
invoke for that phase.

---

## Phase 0 — Land what's already in flight (prerequisite)

History is built on settlement data; settlement has been broken since 0004 and
the fix (`0012_fix_settlement.sql`) is still uncommitted. Building on top of an
unpushed, partially broken branch multiplies risk.

1. Commit the four uncommitted units on `feature/admin-dashboard` separately
   (maintenance cron, 0012 settlement fix, quickstart templates, test-infra
   fix) and push the branch — 28 commits currently exist in one place only.
2. Apply `0011_maintenance.sql` then `0012_fix_settlement.sql` to the live
   Supabase project. Billing does not exist until this runs.
3. Point an hourly scheduler at `POST /api/cron/maintenance` with `CRON_SECRET`.

**Gate:** `npm run test:run` and `npm run build` pass; a real workflow run
settles and writes a `credit_transactions` row in the live DB.

**Skills:** `supabase-migration` (applying 0011/0012 correctly, in order,
idempotently), `run-tests` (the vitest invocation rules), `audit`
(pre-flight mechanical checks before pushing).

---

## Phase 1 — Schema: workflows, runs, and attribution columns

One migration, `0013_workflow_history.sql`, written to the project's manual-
application rules (idempotent, `begin/commit`, RLS on, service-role writes).

**`public.workflows`** — the account-owned workflow itself:

| column | notes |
|---|---|
| `id uuid pk`, `user_id uuid → auth.users` | |
| `title text not null`, `description text` | what history displays |
| `graph jsonb not null` | full canvas: `{version, nodes, edges, groups}` — the same shape `/api/workflow` writes to disk today |
| `models text[] not null default '{}'` | derived server-side at save from the graph's billable nodes; never trusted from the client as a price input |
| `node_count int`, `version int not null default 1` | |
| `est_credits int`, `est_duration_ms int` | cached estimate, recomputed on save (Phase 6 computes them) |
| `created_at`, `updated_at`, `deleted_at timestamptz` | soft delete so run history keeps its join target |

RLS: select/insert/update own (`auth.uid() = user_id`); no delete policy —
soft delete via update. Index `(user_id, updated_at desc)`.

**`public.workflow_runs`** — one row per execution:

`id uuid pk`, `workflow_id → workflows`, `user_id`, `status text`
(`running | completed | failed | cancelled`), `started_at`, `finished_at`,
`credits_charged int`, `shortfall int`, `settled_txn uuid`. RLS read-own,
written by service role only. Index `(workflow_id, started_at desc)` and a
partial index on `(user_id) where status = 'running'`.

**Attribution columns:** `alter table pending_charges add column if not exists
run_id uuid`, same on `generation_events` (+ `workflow_id uuid` on both, so a
successful run's cost and its models are one indexed query). Nullable — old
rows and non-workflow runs stay valid.

**SQL functions:** extend `record_pending_charge` with optional
`p_run_id/p_workflow_id`; add `settle_workflow_run(p_user_id, p_run_id,
p_status)` that reuses the fixed lock-then-aggregate pattern from 0012
(**not** the 0004 `FOR UPDATE`-on-aggregate shape — that exact bug went
unnoticed for the function's entire life), settles only that run's rows, and
finalises the `workflow_runs` row with totals. Keep the old
user-wide `settle_pending_charges` for the maintenance sweep of orphaned rows.

**Gate:** migration pastes into the SQL editor twice without error; a
signed-in Supabase client can select only its own rows; service role can
write. Since nothing here is exercised by mocked tests, verify against a real
database — the settlement bug's structural lesson.

**Skills:** `supabase-migration` (the whole phase lives inside its rules),
`credits-pricing` (so `est_credits` derivation follows "run costs are derived,
never written down"), `run-tests`.

---

## Phase 2 — Run attribution through the credit gate

The client already calls `/api/generate`, `/api/llm` per node and
`/api/credits/settle` once per workflow. Thread identity through that existing
chokepoint; do not add a parallel accounting path.

1. `executeWorkflow` generates a `runId` (uuid) at start; `POST /api/workflows/runs`
   creates the `workflow_runs` row (status `running`) and returns it.
2. Every node-run request body gains `{ workflowId, runId }`. `withCredits()`
   passes them to `recordPendingCharge` and to `recordGenerationEvent` — this
   is the single point where user, model, and response are all in scope, which
   is exactly why billing and the generation log already live there.
3. `settleRun()` in `src/store/creditStore.ts` posts `{ status, runId }`;
   `/api/credits/settle` calls `settle_workflow_run` when a `runId` is present,
   falling back to user-wide settlement when not (old clients, quickstart).
   Settle-twice must stay harmless — the client reaches it from a `finally`
   block that retries and double-clicks can hit.
4. The maintenance sweep (0011) continues to catch closed-tab leaks; it should
   mark any `running` row older than the sweep threshold as `cancelled`.

The invariant to preserve verbatim: **the client picks the moment to settle,
never the amount** — `runId` is a grouping key, not a price input.

**Gate:** run a two-node workflow; `pending_charges` and `generation_events`
rows carry the run id; settle bills exactly that run; `workflow_runs` shows
`completed` with the right `credits_charged`. `estimateMatchesBilling.test.ts`
still passes.

**Skills:** `credits-pricing` (touching guard/settle is touching real money),
`run-tests`, `supabase-migration` (only if the function signatures need a
follow-up 0014).

---

## Phase 3 — Cloud workflow CRUD API

New authed routes — `getAuthedContext` like `/api/credits/*`, **never**
`requireLocal` (that guard is for the local-filesystem routes and is off in
production by design):

| Route | Purpose |
|---|---|
| `GET /api/workflows` | List the caller's workflows, newest first: title, description, models, est_credits, est_duration_ms, last successful run cost + timestamp (lateral join on `workflow_runs where status='completed'`), paginated |
| `POST /api/workflows` | Create/upsert: validates graph shape (`version`, `nodes[]`, `edges[]` — same check `/api/workflow` GET does), derives `models`/`node_count`/estimates server-side, strips embedded base64 media the same way the `6ddba62` media-leak fix does for file saves |
| `GET /api/workflows/[id]` | Full graph for reopening — ownership-checked, not just authed (the `/api/images/[id]` open finding is this exact class of bug; do not reintroduce it) |
| `PATCH /api/workflows/[id]` | Rename / edit description / update graph |
| `DELETE /api/workflows/[id]` | Soft delete (`deleted_at`) |
| `POST /api/workflows/runs` | Start a run row (Phase 2) |

Size guard on `graph` (reject > ~2 MB after media stripping) so a pathological
canvas can't be stored per keystroke.

**Gate:** route tests following the existing `app/api/*/__tests__` pattern:
401 unauthenticated, 404 cross-user, upsert idempotency, graph validation
rejects junk. Every route added to the CLAUDE.md API-routes table.

**Skills:** `audit` (its route-auth review method is the checklist for these
routes), `run-tests`, `supabase-migration` (RLS-vs-service-role behaviour when
a route "works for service role but returns nothing for a user").

---

## Phase 4 — Client persistence rework

`src/store/workflowStore.ts` currently saves via localStorage
(`WorkflowSaveConfig`) + local file writes. Change of ownership: **cloud is
the source of truth for signed-in users; local file save becomes Export.**

1. Save path: debounced upsert to `POST /api/workflows` on explicit save and on
   meaningful graph change; keep the localStorage autosave as offline crash
   recovery only.
2. Load path: opening from history hydrates the canvas from
   `GET /api/workflows/[id]`. The existing "Load from directory" and the
   ComfyUI import flows stay, but a loaded/imported workflow is immediately
   persisted to the account.
3. Export/Import `.json` keeps the current file format so nothing breaks for
   existing local workflows; a one-time "import my local workflows" affordance
   can walk `list-workflows` when running locally.
4. Migrate `WorkflowCostData` (localStorage per-workflow incurred cost) to read
   from `workflow_runs` instead — one source of truth for money.

**Gate:** `workflowStore.integration.test.ts` extended: save → reload →
identical graph; offline save falls back to localStorage and reconciles;
`npm run test:run` green.

**Skills:** `run-tests`; `comfy-workflow` (only when touching the ComfyUI
import path so `comfyApp` node contracts survive the round-trip);
`add-node-type` as a reference for what "persisted node content" means (its
sixteen registration points include persistence — nodes with non-persisted
content must serialize the same to cloud as to file).

---

## Phase 5 — The `/workflows` history page

New authed page (pattern: `/admin`'s gate-then-shell, minus the admin role
check — signed-in is enough) listing every non-deleted workflow, newest first.

Each card/row shows exactly the fields asked for:

- **Title** and **description** (inline rename/edit via PATCH).
- **Total charges of one successful run** — the settled `credits_charged` of
  the most recent `completed` run, labelled as actual ("last successful run:
  42 credits"); when no successful run exists, the cached `est_credits`
  labelled as estimate ("~38 credits est."). Both figures come from the server;
  the page never computes money client-side.
- **Models used** — chips from `workflows.models` (display names via the
  existing model registry).
- **Estimated time of the whole workflow** — `est_duration_ms` (Phase 6),
  rendered as "~2 min 40 s".
- Run count / last-run status, Open (→ canvas), Export `.json`, Delete.

Plus empty state, pagination, and a header entry point next to the existing
credit badge.

**Gate:** component tests (list rendering, actual-vs-estimate labelling, delete
confirm); screenshot pass in both themes; a fresh account sees the empty state.

**Skills:** `admin-charts` **only if** the page grows stat tiles or a spend
sparkline — its theme/mark rules are the house visual contract; otherwise no
chart work here. `run-tests` for the component suites.

---

## Phase 6 — The estimate engine (cost + time)

**Estimated credits** (server-side, at save): walk the graph's billable nodes,
map each to a `RunCostInput`, sum `creditCostForRun()` — the same derived
pricing the gate bills from, so estimate and bill cannot drift (that is what
`estimateMatchesBilling.test.ts` asserts; extend it to cover the workflow-level
sum). Unpriced models (`hasKnownPrice()` false) mark the estimate partial
rather than guessing — mirroring the 409 `unpriced_model` refusal.

**Estimated duration:** add `model_latency_stats(p_days)` — median and p90 of
`generation_events.duration_ms` per `model_id` over succeeded runs (the 0007
admin-stats migration already computes latency aggregates; reuse its approach).
Workflow estimate = sum over billable nodes of the model's median, with a
static per-RunKind fallback table for models with no history yet, honestly
labelled ("no data yet"). Recompute and cache on save and on run completion.
Sequential sum is the honest baseline; refine with the graph's parallel
branches later if wanted.

**Gate:** unit tests for the walker (mixed graph, unpriced model, empty
graph); the extended estimate-matches-billing invariant; SQL function
exercised against a real database, not only mocks.

**Skills:** `credits-pricing` (this phase is the skill's subject matter),
`supabase-migration` (the latency-stats function → `0014`), `run-tests`.

---

## Phase 7 — Hardening, CI, docs

1. Run the full audit: mechanical checks + the route-auth review over the new
   surface (`/api/workflows*` are user-data routes; the audit's open finding on
   `/api/images/[id]` ownership is the cautionary example). Fix what it finds.
2. CI at last: a workflow running `npm run test:run` + `npm run build` on PRs —
   this feature adds SQL-adjacent code, the exact class the silent-skip bug hid.
   Ideally the smoke job applies migrations to a throwaway Postgres and calls
   each SQL function once.
3. Docs: CLAUDE.md gains a "Workflow history" section (tables, routes,
   attribution invariant), the API-routes table gains the new rows, CHANGELOG
   entry; fix the two stale claims already flagged (no `develop` branch,
   nothing runs in CI) while in there.
4. Commit discipline: one phase = one or more single-task commits, per the
   project's commit rules.

**Skills:** `audit` (drives the whole phase), `run-tests`,
`supabase-migration` (smoke-testing SQL against a real database).

---

## Skills-per-phase summary

| Phase | Invoke |
|---|---|
| 0 Land the branch | `supabase-migration`, `run-tests`, `audit` |
| 1 Schema | `supabase-migration`, `credits-pricing`, `run-tests` |
| 2 Attribution | `credits-pricing`, `run-tests` (+`supabase-migration` if 0014) |
| 3 CRUD API | `audit`, `run-tests`, `supabase-migration` |
| 4 Client persistence | `run-tests`, `comfy-workflow`, `add-node-type` (reference) |
| 5 History page | `run-tests` (+`admin-charts` only for tiles/charts) |
| 6 Estimates | `credits-pricing`, `supabase-migration`, `run-tests` |
| 7 Hardening | `audit`, `run-tests`, `supabase-migration` |

One skill is missing from the repo for this work: nothing documents workflow
persistence itself. `.claude/skills/workflow-persistence/SKILL.md` (added
alongside this PRD) captures the tables, routes, and the two invariants —
*client picks when, never how much* and *estimates are derived, never written
down* — so every later phase, and every future session, works from the same
contract.

## Order and dependencies

0 → 1 → 2 → 3 → (4 ∥ 6) → 5 → 7. Phases 4 and 6 are independent once the
schema and routes exist. The history page (5) is last of the feature phases
because it is pure presentation over data the earlier phases make true.
