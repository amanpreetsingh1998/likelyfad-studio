---
name: workflow-persistence
description: Work on Likelyfad Studio's per-user workflow history — the workflows/workflow_runs tables, /api/workflows* routes, run attribution through the credit gate, or the /workflows history page. Use when saving/loading workflows to the account, attributing charges or generation events to a workflow run, computing a workflow's estimated cost or duration, or when history shows the wrong cost, models or time.
---

# Workflow persistence and history

A workflow is account data. The graph lives in `public.workflows.graph`
(jsonb: `{version, nodes, edges, groups}` — the same shape the legacy local
file save wrote to disk). Local `.json` files are **export/import only**;
`/api/workflow` and `/api/list-workflows` are the legacy local-FS routes behind
`requireLocal` and must never become the history's backend.

## The two invariants

**1. The client picks *when*, never *how much*.** `runId`/`workflowId` sent
from the browser are grouping keys only. Cost always comes from
`pending_charges` rows the server wrote in `withCredits()`, and time/models
come from `generation_events`. If you find yourself reading a credit amount,
model list or duration out of a request body, stop — that is the vulnerability
the whole pending-charges design exists to prevent.

**2. Estimates are derived, never written down.** `est_credits` is the sum of
`creditCostForRun()` over the graph's billable nodes — the same function the
gate bills from, asserted by `estimateMatchesBilling.test.ts`. A model with
`hasKnownPrice() === false` makes the estimate *partial*, mirroring the 409
`unpriced_model` refusal; never substitute a guessed price.
`est_duration_ms` sums per-model median `duration_ms` from succeeded
`generation_events` (see `model_latency_stats`), with the static per-RunKind
fallback for unseen models.

## Where things live

| Concern | Location |
|---|---|
| Tables, RLS, settle-run function | `supabase/migrations/0013_workflow_history.sql` (+ later) |
| CRUD + list routes | `src/app/api/workflows/**` |
| Run start | `POST /api/workflows/runs` |
| Attribution entry point | `src/lib/credits/guard.ts` (`withCredits`) |
| Settlement | `/api/credits/settle` → `settle_workflow_run` (per-run) or `settle_pending_charges` (user-wide fallback + maintenance sweep) |
| Client save/load | `src/store/workflowStore.ts` |
| Run lifecycle client-side | `executeWorkflow` → creates run row; `settleRun()` in `src/store/creditStore.ts` posts `{status, runId}` from a `finally` |
| History UI | `src/app/workflows/` |

## Rules that bite

- **Ownership check, not just auth**, on every `[id]` route. `/api/images/[id]`
  shipped without one; do not repeat it. RLS is the backstop, not the check —
  routes using the service role bypass RLS entirely.
- **Settling twice must stay harmless.** The client settles from a `finally`
  block reached by retries and double-clicks. `settle_workflow_run` finding no
  unsettled rows returns a zero charge, not an error.
- **Never `FOR UPDATE` on an aggregate.** That exact shape in 0004 silently
  broke settlement for its entire life (plpgsql plans at first call). Lock
  rows first, aggregate second — copy the 0012 pattern.
- **Strip embedded base64 media before storing a graph** (same as the
  `6ddba62` media-leak fix for file saves) and reject graphs > ~2 MB after
  stripping.
- **Soft delete only** (`deleted_at`): `workflow_runs` history must keep its
  join target.
- **Failed/cancelled runs still cost money.** Nodes that dispatched were real
  provider calls; the run's status is a label for the ledger, never a reason
  to skip settlement.
- Anything that exists only as SQL is **not tested until it has run against a
  real database**. The mocked suites stayed green for the entire life of a
  settlement function that had never once succeeded.

## Displaying cost in history

"Cost of one successful run" = `credits_charged` of the newest
`workflow_runs` row with `status = 'completed'`, labelled **actual**. Only
when none exists, show `est_credits` labelled **estimate** (`~` prefix). The
page never computes money client-side; both figures arrive from
`GET /api/workflows`.

## Related skills

`supabase-migration` for any schema change here; `credits-pricing` before
touching guard, settle or estimates; `audit` for the route-auth review;
`run-tests` before running anything.
