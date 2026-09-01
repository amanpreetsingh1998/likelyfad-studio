# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev      # Start Next.js dev server at http://localhost:3000
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run Next.js linting
npm run test     # Run all tests with Vitest (watch mode)
npm run test:run # Run all tests once (CI mode)
```

## Environment Setup

Create `.env.local` in the root directory:
```
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key  # Optional, for OpenAI LLM provider
KIE_API_KEY=your_kie_api_key        # Optional, for Kie.ai models (Sora, Veo, Kling, etc.)

# Credits + payments (see "Credit System" below)
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxx  # public; the browser checkout needs it
RAZORPAY_KEY_SECRET=your_razorpay_secret    # server only
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret # server only; set when adding the webhook

# Scheduled maintenance (see "Scheduled maintenance" below)
CRON_SECRET=long_random_value               # server only; the route refuses everything without it
```

## Credit System

Every run is charged to the signed-in user's credit balance. New accounts get a
free grant; more are bought with real money through Razorpay.

### Where the numbers live

**Three files, in order of how often you will touch them.**

| To change | Edit |
|-----------|------|
| Your margin over provider cost | `MARGIN` in `src/lib/credits/rates.ts` |
| ₹ per USD | `USD_INR_RATE` in `src/lib/credits/rates.ts` |
| What one credit is worth | `CREDIT_VALUE_INR` in `src/lib/credits/rates.ts` **and** `CREDIT_PACKS` |
| A provider's real USD rate | `USD_RATES` in `src/lib/credits/rates.ts` |
| Pack price or credits per pack | `CREDIT_PACKS` in `src/lib/credits/pricing.ts` |
| Free signup grant | `SIGNUP_GRANT_CREDITS` **and** the two `100` literals in `0003_credits.sql` §6 — the SQL is what pays out |

Run costs are **derived**: `credits = ceil(usd × USD_INR_RATE × MARGIN ÷ CREDIT_VALUE_INR)`.
There is no hand-written table of credit prices. There used to be, and it drifted
until every image sold at ~50% of cost — `pricing.test.ts` now asserts no model
is billed below provider cost, so that cannot come back silently.

Prices are never read from the request body. A client picks a model, not a price.

### fal.ai pricing

fal's models API returns **no pricing field at all** — verified across the whole
catalogue. There is no billing or usage endpoint either. The only
machine-readable price fal publishes is an `endpointBilling` object embedded in
each model page:

```json
{ "endpoint": "fal-ai/nano-banana-2/edit", "billing_unit": "images", "price": 0.08 }
```

`npm run fal:pricing` pages through the catalogue, scrapes that object from all
919 relevant models, and writes `src/lib/likelyfad/fal-pricing.generated.ts`.
Re-run it whenever fal's catalogue moves — same idea as `comfy:record`.

That payload is internal, not a documented API, so the script **aborts** if
coverage drops below 80% rather than writing a file of zeroes that would price
the whole catalogue at nothing.

`price` is per billing unit, not per run, and fal uses seventeen different
units. `src/lib/credits/falPricing.ts` does the conversion: megapixels scale
with resolution, seconds with clip length, `5 seconds`/`video segments` round up
to whole blocks, `compute seconds` uses `ASSUMED_COMPUTE_SECONDS`.

`/api/providers/fal/models` attaches the recorded price to each model, so the
picker and `calculatePredictedCost` read the same number the credit gate bills
from — `calculatePredictedCost` already prefers `ProviderModel.pricing`, so
setting it there is what makes fal prices show up in the UI at all. That route
also follows the cursor now (it previously read only the first of ~15 pages,
hiding ~90% of the catalogue) and caches the walk for 5 minutes.

**Unbillable rows are refused, not guessed.** `$0`, an empty unit, and fal's
`$1 / units` variable-pricing placeholder (which appears on models that really
cost a few cents) all return `null`, and the guard answers **409
`unpriced_model`**. Add a manual override rather than letting a 30x mispricing
through — `falUnusableIds()` lists the backlog.

### Files

| Purpose | Location |
|---------|----------|
| Margin, FX, peg, USD rate card | `src/lib/credits/rates.ts` |
| Recorded fal prices (generated) | `src/lib/likelyfad/fal-pricing.generated.ts` |
| fal billing-unit → per-run USD | `src/lib/credits/falPricing.ts` |
| Pricing recorder | `scripts/fal-record-pricing.mjs` |
| Packs + run costs derived from rates | `src/lib/credits/pricing.ts` |
| Balance / pending / settle / grant | `src/lib/credits/server.ts` |
| Route wrapper: auth → afford → record | `src/lib/credits/guard.ts` |
| Razorpay orders + signature verification | `src/lib/credits/razorpay.ts` |
| Ledger schema, RLS, SQL functions | `supabase/migrations/0003_credits.sql` |
| Pending charges + settlement | `supabase/migrations/0004_workflow_settlement.sql` |
| Balance store + `settleRun()` | `src/store/creditStore.ts` |
| Header badge / buy modal | `src/components/credits/` |

### Routes

| Route | Purpose |
|-------|---------|
| `GET /api/credits` | Balance, packs, recent ledger |
| `POST /api/credits/settle` | Bill a finished workflow in one debit |
| `POST /api/credits/order` | Create a Razorpay order for a pack |
| `POST /api/credits/verify` | Verify checkout callback → grant (fast path) |
| `POST /api/credits/webhook` | Razorpay `payment.captured` → grant (safety net) |

Both grant paths use `ref = razorpay:<payment_id>`; the ledger's partial unique
index makes whichever arrives second a no-op, so a payment credits exactly once.

### How charging works

**One debit per workflow, not per node.**

1. Each node run hits `/api/generate` or `/api/llm`, wrapped by `withCredits()`.
   It authenticates the caller, checks `balance − pending ≥ this step`, runs the
   handler, and — only if the run actually reached a provider — writes a
   `pending_charges` row.
2. When `executeWorkflow` exits (any path), `settleRun()` posts to
   `/api/credits/settle`, which sums the unsettled rows and debits once.

The client picks the *moment* to settle; it never supplies the *amount*. That is
the whole reason `pending_charges` exists rather than the browser tallying its
own total — a workflow could otherwise report that it ran nothing.

A failed or cancelled workflow still pays for the nodes that already dispatched;
that money is spent regardless. Settling twice is harmless — the second call
finds nothing unsettled.

**Settlement was broken from 0004 until 0012, and nothing noticed.**
`settle_pending_charges` opened with `FOR UPDATE` on an aggregate query, which
Postgres rejects at plan time. plpgsql does not plan a function body until the
first call, so `create function` accepted it and the failure only ever appeared
at runtime — on every single invocation, in the first statement. That function
is the only thing that debits credits for a workflow, so for its whole life no
run was ever billed: `pending_charges` accumulated and settlement never wrote a
`credit_transactions` row.

It surfaced the first time the 0011 maintenance sweep called it from something
that reported the error instead of swallowing it. `0012_fix_settlement.sql`
splits the lock from the aggregate and writes off the backlog — the rows are
kept, marked settled against no transaction, so what the bug cost stays
answerable.

**The lesson worth keeping: the tests could not have caught this.** Everything
around settlement is mocked, so the whole credit system was green against a
function that never once ran. Anything that only exists as SQL needs to be
exercised against a real database before it is believed.

**The closed-tab leak is swept, not fixed at the source.** A tab closed
mid-run still never settles itself, so those rows sit unbilled until
`POST /api/cron/maintenance` picks them up — see "Scheduled maintenance"
below. The note that used to sit here said this needed "no new logic, only a
scheduler". That was half right: `settle_pending_charges` does take just a
user id, but a sweep has to know *which* users are owed, and enumerating them
is `sweep_stale_pending_charges` in `0011_maintenance.sql`.

A refused step returns **402** with `code: "insufficient_credits"`; the executors
turn that into the buy-credits modal. Every gated response carries
`X-Credits-Balance` and `X-Credits-Pending`.

### Setup

1. Run `supabase/migrations/0003_credits.sql`, then `0004_workflow_settlement.sql`,
   then `0012_fix_settlement.sql`, then `0013_workflow_history.sql`, then
   `0014_workflow_history_read.sql`, then `0015_model_latency.sql`, then
   `0016_close_abandoned_runs.sql`, in the Supabase SQL editor.
2. Add the three Razorpay vars above to `.env.local`.
3. Razorpay dashboard → Settings → Webhooks → add
   `https://<domain>/api/credits/webhook` for `payment.captured`, using the
   same secret as `RAZORPAY_WEBHOOK_SECRET`.

## Admin Dashboard

One admin, enforced by the database rather than by application code: the
`admins` table is `id int primary key check (id = 1)`, so a second row is a
constraint violation. There is no UI that grants admin — seeding is a manual
`select set_admin('you@example.com')` in the SQL editor, because a UI that can
promote an admin is a UI that can be tricked into promoting one.

### Two gates, different jobs

| Surface | Gate | Refusal |
|---------|------|---------|
| `/admin/*` pages | `src/proxy.ts` | redirect to `/` |
| `/api/admin/*` routes | `requireAdmin()` in `src/lib/admin/guard.ts` | 401 signed out, **404** signed in |

404 rather than 403 for a non-admin: there is no benefit in confirming the
surface exists to someone who just probed for it.

The proxy asks through the **caller's own session** — `admins_select_self` in
`0005_admin.sql` limits that read to their own row — so no service-role key is
reachable from the edge. `requireAdmin()` asks through the service client
instead, so route authorization does not depend on that policy being right.

Both compare `row.user_id === session.user.id` explicitly rather than treating
"a row came back" as a pass, and both **fail closed**: a missing migration,
revoked grant, or absent `SUPABASE_SERVICE_ROLE_KEY` is a refusal, not a 500
and not an admission.

**Admin reads deliberately do not go through RLS.** The obvious alternative —
an `is_admin()` helper wired into every table's policies — was rejected: it
widens the blast radius of every policy in the schema at once, on tables whose
entire security model is `auth.uid() = user_id`. Keeping the bypass in
`guard.ts` means RLS stays exactly as strict as it is and the exception lives
in one file. `requireAdmin()` returns the service client only *after* the check
passes, so a handler cannot obtain it by forgetting to check.

### Files

| Purpose | Location |
|---------|----------|
| `admins` table, RLS, `set_admin()` | `supabase/migrations/0005_admin.sql` |
| `isAdmin()` / `requireAdmin()` | `src/lib/admin/guard.ts` |
| Page gate | `src/proxy.ts` (`isAdminPath`) |
| Shell, nav, pages | `src/app/admin/`, `src/components/admin/` |
| Gate smoke test route | `src/app/api/admin/me/route.ts` |
| Stats SQL functions | `supabase/migrations/0007_admin_stats.sql` |
| Stats reader + pivot | `src/lib/admin/stats.ts` |
| Stats route | `src/app/api/admin/stats/route.ts` |
| Charts, palette, formatters | `src/components/admin/charts/` |
| User list SQL + `admin_actions` | `supabase/migrations/0008_admin_users.sql` |
| User reader + action log | `src/lib/admin/users.ts` |
| User routes | `src/app/api/admin/users/` |
| Table, drawer, tabs | `src/components/admin/users/` |
| Review state + feed SQL | `supabase/migrations/0009_moderation.sql` |
| Feed reader + flag/remove | `src/lib/admin/moderation.ts` |
| Thumbnail signing | `src/lib/admin/thumbnails.ts` |
| Content routes | `src/app/api/admin/content/` |
| Feed and cards | `src/components/admin/content/` |
| Audit log SQL | `supabase/migrations/0010_admin_audit.sql` |
| Log reader + detail formatting | `src/lib/admin/audit.ts` |
| Audit route | `src/app/api/admin/audit/route.ts` |
| Log table | `src/components/admin/audit/` |

### Setup

1. Run `supabase/migrations/0005_admin.sql`, then `0006_generation_events.sql`,
   then `0007_admin_stats.sql`, then `0008_admin_users.sql`, then
   `0009_moderation.sql`, then `0010_admin_audit.sql`, then
   `0011_maintenance.sql`, then `0012_fix_settlement.sql`, then
   `0013_workflow_history.sql`, then `0014_workflow_history_read.sql`, then
   `0015_model_latency.sql`, then `0016_close_abandoned_runs.sql`.
2. Sign in once with the account that should be admin (there must be an
   `auth.users` row to point at).
3. `select public.set_admin('you@example.com');`

Re-running `set_admin` with a different email **transfers** the seat rather
than adding one — that is the intended handover path.

### The generation log

`generation_events` is one row per billable run — user, model, prompt, status,
credits, duration, and a 256px thumbnail of the output. It is what both halves
of the dashboard read from: the moderation feed wants prompts and pictures, the
stats want models, statuses and timings.

Written from `withCredits()`, for the same reason billing lives there: it is
the one point every `/api/generate` and `/api/llm` call passes through with the
user, the model and the response all in scope. The write is deferred with
`deferAfterResponse()` so no user waits on a resize.

Before this table nothing recorded what users generated. Outputs lived as
base64 in `projects.workflow_json`, overwritten on every autosave; prompts were
stored nowhere at all. **It is the only part of the dashboard that cannot be
backfilled** — history starts the day it ships.

**Two writes, not one.** The row lands first, the thumbnail follows. A picture
that fails to encode or upload then costs only the picture; the prompt, model
and user — what moderation actually turns on — are already recorded.

**`status` is a lifecycle, not a success flag.** `pending` means the run was
dispatched to a provider that answers asynchronously (long-running Kie tasks);
`/api/generate/poll` closes it out later. A `pending` row that never advances
is not garbage to sweep — it is the record that this prompt reached a provider,
which is worth keeping even when the output never came back.

**Completion matches `(user_id, task_id)`, never `task_id` alone.** Task ids
come from the provider and are guessable enough that matching on one by itself
would let a user attach output to someone else's event, or read a completion
that is not theirs. The unique index is on the pair for the same reason.

`/api/generate/poll` **is now authenticated**. It was not before — the one
generation route reachable without a session, where anyone could spend
`KIE_API_KEY` and a guessed task id returned someone else's media. `proxy.ts`
lets `/api/*` through on purpose, so nothing else was covering it.

**Thumbnails live in their own `moderation` bucket**, not `project-media`:
`0002_storage_policies.sql` grants users delete on everything under their own
prefix there, and evidence the subject can delete is not evidence. Keyed by
event id with no user prefix, so the shape never invites an owner-scoped policy
later.

**Video, audio and 3D get no thumbnail** — a representative frame needs a
decoder that does not run server-side here, so those runs are moderated on
their prompt alone. A real gap in visual coverage, recorded rather than papered
over.

**Nothing here throws.** Every failure path logs and returns null. By the time
any of it runs the generation has succeeded and the credits are committed; a
logging fault must not become the user's error. The cost is that a broken log
is silent, so failures log loudly enough to find.

### Files

| Purpose | Location |
|---------|----------|
| Table, indexes, `moderation` bucket, retention | `supabase/migrations/0006_generation_events.sql` |
| Record / complete an event | `src/lib/moderation/events.ts` |
| 256px webp encoder | `src/lib/moderation/thumbnail.ts` |
| `after()` wrapper | `src/lib/moderation/defer.ts` |
| Write site | `src/lib/credits/guard.ts` |
| Async completion | `src/app/api/generate/poll/route.ts` |

### The stats board

Every aggregate is a SQL function in `0007_admin_stats.sql`, not a query in the
route. These count over tables that only grow; pulling rows into Node to count
them works right up until it very suddenly does not, and the failure lands on
the one page you open when something is already wrong.

`/admin` renders server-side with real numbers on first paint, then refetches
through `/api/admin/stats` when the window changes — no navigation, no skeleton.

**A failed panel costs one panel.** `getAdminStats()` collects the names of
queries that failed into `stats.failed` and returns 200 regardless; each panel
says whether it is *empty* or *broken*. Those are different facts, and showing
zero for a failed query is showing a number an admin would believe.

**Charts are hand-rolled SVG**, not a chart library. The mark spec is exact —
2px surface gaps between touching fills, 4px radius on the data end only,
square at the baseline — and every panel carries a table twin, which is what a
tooltip-only value fails to be for keyboard and screen-reader users.

Rules the charts are built to, worth knowing before adding one:

- **Never a second y-axis.** Signups and revenue are separate charts because
  the alignment between two scales is arbitrary, so a dual axis invents a
  correlation that is not in the data.
- **Colour follows the entity, never its position.** `kindColor()` maps a run
  kind to a fixed slot from `KIND_ORDER`. Deriving it from the series on screen
  meant a window with no video runs shifted every later kind down a slot and
  repainted them.
- **One filter row above everything it scopes**, never inside a chart card, so
  two panels cannot disagree about the period on screen.
- **One colour per bar in the leaderboard** — a darker-where-bigger ramp would
  double-encode length as hue and spend the only free channel restating it.
- **Six categorical slots, never cycled.** A seventh series folds into "Other";
  a generated hue is indistinguishable under CVD.

The palette is the reference dark steps, re-validated against *this* app's
surface (`neutral-900`) rather than the reference's — contrast and
lightness-band results only mean anything against the surface the chart really
renders on. All six pass; worst adjacent CVD ΔE 8.4.

### The user list

`/admin/users` is a page of accounts with a drawer over it: Overview,
Projects, Generations, Ledger. `admin_users_list` joins `auth.users` to the
credit, generation and project aggregates in one round trip — the route cannot
join `auth.users` at all, and one aggregate query per row on screen is the
shape that dies quietly as the tables grow.

- **`total_count` rides along as a window function**, not a second count
  query. The filtered set is already materialised, and a separate count is
  both another full pass and a chance to disagree with the page it labels.
- **Search is `position()`, not `ilike '%…%'`.** The needle is admin-typed, so
  a stray `%` should find a percent sign rather than silently matching every
  account.
- **Sorting picks a column, not a direction.** Each sortable figure has one
  useful order; the reverse doubles the states to answer a question this page
  is not for. Unknown keys fall through to the `created_at` tiebreak rather
  than being interpolated into a query.
- **A failed read is reported, never rendered as an empty table.** `listUsers`
  returns `failed`, because "no accounts matched" and "the query broke" look
  identical otherwise — and the first is a fact an admin would act on.
- **Last active is the last generation**, not `last_sign_in_at`, which a
  silent token refresh moves. Both are shown, separately labelled.

**Actions are logged, in `admin_actions`.** Granting, refunding, suspending
and deleting all write a row naming the actor, the target and the details.
The actor's email is snapshot because the admin seat transfers, and
`target_user_id` deliberately carries **no foreign key**: every other
reference to `auth.users` cascades, which would erase the record of the delete
along with the account it describes.

Both credit paths are idempotent by `ref` — a refund carries the refunded
spend's id, a grant a per-submission request id — so the partial unique index
from 0003, not application logic, is what makes a double-click pay out once.
Only a `spend` can be refunded, and the lookup is filtered by `(id, user_id)`
for the same reason the poll route matches on the pair.

**Suspension is a GoTrue ban, and it is not instant.** It blocks sign-in and
token refresh; an access token already issued keeps working until it expires,
up to an hour. The drawer says so rather than implying the session is dead. A
suspended user is *not* refused by `withCredits()` — closing that would mean a
lookup on the hot path of every generation.

**Deletion cascades over the moderation record.** Everything under the
account goes, `generation_events` included — the evidence of whatever they
were deleted for. Suspend is therefore the primary action, delete needs the
account's email typed, and the confirmation spells out what is lost. The
orphaned thumbnails are removed afterwards, and the figures worth keeping are
snapshot into the log first.

**"View as user" was cut, deliberately.** It means minting a session as
someone else: the admin could spend their credits and edit their projects,
with nothing on the user's side recording it. The read-only tabs answer what
it was for.

### The moderation feed

`/admin/content` is the generation log with decisions attached: state tabs,
a type filter, search over prompts and emails, and per-card actions.

**A flag is state on the event, not a row in a flags table.** It is the
current answer to "has a human looked at this, and what did they decide" —
storing it append-only would make every reader fold a history to find the
present, on the table the feed already sorts and pages by. The history is not
lost: `admin_actions` records each flag, clear and removal with its actor and
reason. State here, audit trail there, neither derived from the other.

- **Three states, not two.** `cleared` is a decision and `unreviewed` is the
  absence of one. Collapsing them hands the moderator the same picture every
  morning.
- **`content_removed_at` is separate from the state.** Removing a thumbnail is
  an action about a row, not a verdict on it — a flagged row may keep its
  picture as evidence, and a cleared one may still have had it deleted.
- **Removal deletes the picture and keeps the row.** The prompt, model and
  account are the record. Storage goes first, then the row is marked: the
  other order would leave a live thumbnail the feed can no longer see, which
  hides evidence rather than leaving litter.
- **The tab counts are one query, not four filtered feeds** — and a failed
  count renders as no number rather than a zero, because a zero on the
  Flagged tab claims the queue is clear.
- **Every card carries the account's flag count**, and links to it. The same
  prompt reads differently on a first flag and a fourth, which is also why
  `/admin/users` now takes `?q=` and shows a Flags column of its own.

**Suspending from a card is the same route the Users page uses**, with the
event id as the reason, so the account's history explains itself later.

The two coverage gaps are stated in the UI rather than papered over: nothing
before `generation_events` shipped can be reviewed at all, and video, audio
and 3D runs have no thumbnail, so they are judged on their prompt alone.

### The audit log

`/admin/audit` reads `admin_actions`, which every mutating route has written
to since Phase 3. The table's RLS is on with no policies, so the only possible
reader was the service role — and until this page, no route asked. A log
nobody can read is a log first seen with an incident already underway.

**Read-only, and there is no writer here.** Rows are written by the handlers
that take the actions; nothing edits or deletes one. An audit log with an edit
endpoint is not an audit log.

- **Emails come off the row, never a join.** They were snapshot at write time
  so a deleted account still reads as an address. `target_exists` answers the
  separate question — whether there is still an account to open — and a row
  without one says "no account" rather than offering a dead link on the very
  row that documents the deletion.
- **`describeDetail()` prints keys it does not know.** `details` is jsonb so a
  new action can record what it needs without a migration; a renderer written
  to a fixed schema per action would quietly hide the next one's evidence.
- **The action filter is capped, not whitelisted**, for the same reason: a
  chip for an action this build has never heard of must filter to it rather
  than degrade to "everything".
- The chips' counts come from one summary query, and a failed summary shows
  no number instead of a zero beside "Deleted account".

The Users drawer links here with `?target=`, which is how one account's
history is read.

### Status

Phases 0–4, plus the audit log and the maintenance sweep. Every tab of the
dashboard is real: auth, the shell, the generation log, the stats board, the
user list, the moderation feed and the record of what the admin did.

The usage panels read from `generation_events`, which starts empty — "no data
yet" is the honest first-week state of half this dashboard, and the panels say
so rather than drawing empty axes that look like a bug.

**Retention runs from the maintenance endpoint.**
`prune_generation_events(days)` returns the thumbnail keys it deleted, because
SQL cannot remove storage objects; `pruneGenerationEvents()` passes them to the
storage API. Rows go first and storage second — the opposite order to
`removeContent()`, and deliberately: there the row survives, so a live
thumbnail it can no longer reach would be hidden evidence, while here the row
is gone entirely and the worst case is an orphaned object. Litter beats a
dangling reference.

The retention floor is **7 days, enforced in code**, not because 7 is right but
because `days=0` would delete the whole moderation record and every usage
panel's history in one call, and none of it can be backfilled.

## Workflow History

`/api/workflows` answers "every workflow I own, what one run of it costs, what
models it uses, and how long it takes". The graph itself already lived in
`public.projects`; what was missing was any way to attribute money to it.

### Why `projects` and not a new `workflows` table

The PRD specified `public.workflows` with a `graph` jsonb column. That was
rejected on contact with the schema: `projects` already **is** the
account-owned workflow — it holds `workflow_json`, `workflowStore`'s save path
writes it, `ProjectListModal` reads it, and `media.project_id` has a foreign
key onto it. A second table holding the same graphs would be two sources of
truth for one canvas, drifting from the first save that did not happen to open
the history page. The cost is cosmetic: `projects.id` is a client-minted
`wf_<ts>_<rand>` text id, so every reference to it is `text`, not `uuid`.

### The two invariants

**1. The client picks *when*, never *how much*.** A `runId` in a request body
is a grouping key. Cost always comes from the `pending_charges` rows the server
wrote in `withCredits()`; models and timings come from `generation_events`. If
you find yourself reading a credit amount, model list or duration out of a
request body, stop — that is the vulnerability the whole pending-charges design
exists to prevent.

**2. Estimates are derived, never written down.** `est_credits` is the sum of
`creditCostForRun()` over the graph's billable nodes — the same function the
gate bills from, asserted by `estimateMatchesBilling.test.ts` at three levels
(header, gate, stored estimate). A model with `hasKnownPrice() === false` makes
the estimate **partial**, mirroring the 409 `unpriced_model` refusal; never
substitute a guessed price.

### The run entity

`workflow_runs` is one row per execution. Before it, `pending_charges` and
`generation_events` were flat per-node lists scoped only by `user_id`, so "what
did workflow X cost" was unanswerable.

- **The id is minted server-side** by `POST /api/workflows/runs` and handed to
  the client. A client-chosen id would let one user file their charges under
  another user's run — a billing fault *and* a read of someone else's history.
  `record_pending_charge` re-checks ownership in SQL; that copy is the
  load-bearing one, because it holds even if a caller forgets the other.
- **`project_id` is `on delete set null`, and `project_name` is snapshot.**
  Deleting a workflow must not erase the ledger's explanation of money already
  spent — the same reason `admin_actions` snapshots the actor's email.
- **`credits_charged` and the wall clock live on the run row**, not recomputed
  from events, because retention prunes events and a run's cost has to outlive
  them.
- **`abandoned` is not `cancelled`.** Cancelled is a decision someone made;
  abandoned is a tab that closed. They read identically in the ledger and mean
  different things to whoever is asking why a run stopped.
- **Every failure degrades.** An absent, malformed or foreign run id records an
  untagged charge that settles through the user-wide path exactly as before. A
  run row that cannot be written answers 200 with a null id. A history feature
  must never be able to stop a user working.

`settle_workflow_run` bills one run; `settle_pending_charges` is kept unchanged
for the maintenance sweep's orphaned rows and for clients that send no run id.
Both copy 0012's **lock-then-aggregate** shape — never `FOR UPDATE` on an
aggregate, which is the exact form that failed on every call for that
function's entire life while the mocked suites stayed green.

### What the page shows, and what it must never show

- **"Cost of one run" is the newest completed run, not a mean.** Runs vary — a
  model swap, a different image count, a fallback — and averaging blends a
  4-credit run and a 90-credit one into a number that describes neither. The
  range rides alongside so variance is visible, and only when successful runs
  actually disagree: a range of 38 to 38 says nothing.
- **Time is wall clock**, `finished_at - started_at`, never the sum of node
  durations. Nodes run concurrently, so that sum overstates elapsed time in the
  direction that makes the product look slower than it is.
- **Models are what ran**, read from the run's events, because the graph can be
  edited after the run and the charge cannot.
- **Never invent a number.** Never run: "not run yet". Runs but no success: "no
  successful run yet", plus the failure count. A failed read: "could not load".
  Both readers return a `failed` marker precisely so that "you have no
  workflows" and "the query broke" cannot render identically.
- **Label which number is showing.** The measured figure and the estimate are
  different kinds of claim; unlabelled in the same column, a guess looks like a
  measurement.

**No backfill is possible.** Existing charges and events carry no run id and
there is no way to infer one from timestamps without guessing. History starts
the day the migrations are applied — the same honest position
`generation_events` already takes, and the UI has to say so.

### The page

`/workflows` is server-rendered on first paint with real numbers — the same
approach as `/admin`, for the same reason — then refetches through
`GET /api/workflows` on search, sort or paging without a navigation.

There is **no auth gate in the page**. `proxy.ts` already redirects any
non-public path to `/signin`, so reaching the file means there is a session;
repeating the check would be a second source of truth answering later. The data
gates itself regardless, because `user_workflow_history` scopes to `auth.uid()`
rather than taking an id.

**Four states render as "nothing on screen" and three are different facts:** no
workflows at all, no search matches, a failed read, and a page of results. The
failed read is the one that must never be mistaken for the others — telling
someone they have no workflows when the query broke is the most alarming thing
this page could do, which is why both readers return a `failed` marker rather
than an empty array.

**Sorting picks a column, not a direction**, matching the admin user list: each
option has one useful order and the reverse doubles the states to answer a
question this page is not for. Changing the filter resets to page one, or page
three of everything silently becomes page three of a one-match filter.

The card's derived subtitle is deliberately shallow — node count and model
names, not "2 image generations, 1 LLM". The richer summary needs the graph,
and loading every workflow's graph to render a list is exactly the N+1 that
`user_workflow_history` exists to avoid.

`Open` navigates to `/?project=<id>`, which the studio reads on mount. **The
param is stripped before the load, not after:** leaving it in the address bar
means a refresh silently reloads the saved copy over whatever is on the canvas,
discarding the user's work with no prompt.

### Files

| Purpose | Location |
|---------|----------|
| Runs, attribution columns, `settle_workflow_run` | `supabase/migrations/0013_workflow_history.sql` |
| History aggregates | `supabase/migrations/0014_workflow_history_read.sql` |
| Per-model measured latency | `supabase/migrations/0015_model_latency.sql` |
| Abandoned-run sweep | `supabase/migrations/0016_close_abandoned_runs.sql` |
| Run lifecycle (server) | `src/lib/workflows/runs.ts` |
| Run open (client) | `src/lib/workflows/startRun.ts` |
| History readers | `src/lib/workflows/history.ts` |
| Estimate engine | `src/lib/workflows/estimate.ts` |
| Attribution entry point | `src/lib/credits/guard.ts` (`withCredits`) |
| Ambient run id for executors | `src/store/execution/activeRun.ts` |
| Page shell and server-read first paint | `src/app/workflows/` |
| List, card, run drawer | `src/components/workflows/` |

### Routes

| Route | Purpose |
|-------|---------|
| `GET /api/workflows` | The caller's history, one page |
| `POST /api/workflows/runs` | Open a run; returns a server-minted id |
| `GET /api/workflows/[id]/runs` | One workflow's runs. **Ownership-checked**, 404 otherwise |
| `POST /api/workflows/[id]/estimate` | Reprice from the **stored** graph; takes no graph |

### Setup

Run `0013_workflow_history.sql`, then `0014_workflow_history_read.sql`, then
`0015_model_latency.sql`, then `0016_close_abandoned_runs.sql`. `0012` must be
applied first — everything here reads the numbers settlement writes, so
applying it on top of the broken function would build a history page that
faithfully reports every workflow as having cost nothing.

## Scheduled maintenance

`POST /api/cron/maintenance` runs three jobs: settling abandoned workflow
charges, closing abandoned runs, and applying retention to
`generation_events`. The first and last had been written and left uncalled
for months, both waiting on a scheduler this project did not have.

The abandoned-run sweep is the run-level twin of the charge sweep.
`executeWorkflow` closes its run on both exit paths, but neither runs if the
tab is closed or the machine sleeps mid-render — and a row left at `running`
permanently inflates the history page's counts with a run that is neither a
success nor a failure. It is ordered *after* the charge sweep, which has
usually already billed the money, so the run sweep only closes the row.

POST rather than GET, because it moves money and deletes rows; a GET that does
either is one prefetch away from doing it by accident.

```bash
curl -X POST https://<domain>/api/cron/maintenance \
     -H "Authorization: Bearer $CRON_SECRET"
```

Hourly is the intended cadence, from any scheduler that can make an HTTP
request — this app runs behind its own `server.js`, so there is no platform
cron to lean on. Running it more often is harmless: settling finds nothing
inside the staleness window, and pruning is a no-op once the tail is gone.

**There is no session here.** That makes `CRON_SECRET` the only thing guarding
a route that spends money, so the gate is modelled on `requireAdmin()` and
fails closed the same way: an unset secret refuses *every* request rather than
admitting all of them, the comparison is constant-time over a hash so a length
mismatch is a refusal rather than a thrown 500, and the refusal is **404**
rather than 401.

**Staleness is the safety argument.** A workflow that is still running also has
unsettled rows, so the sweep only touches charges older than `p_minutes`
(default 60; the longest route timeout in the app is 5). Sweeping too early
would not overcharge — every row is a provider call that really happened — but
it would split one workflow across two ledger lines, which is a confusing thing
to hand a user reading their history.

**Always 200 when the caller is authorised, even if a job failed.** The body
reports each job separately and `ok` says whether both succeeded. A scheduler
watching only the status code would otherwise retry a broken prune forever
while a working settle rode along with it.

| Purpose | Location |
|---------|----------|
| Sweep SQL + supporting index | `supabase/migrations/0011_maintenance.sql` |
| Abandoned-run sweep | `supabase/migrations/0016_close_abandoned_runs.sql` |
| Both jobs, clamps, storage cleanup | `src/lib/maintenance/sweep.ts` |
| Shared-secret gate | `src/lib/maintenance/guard.ts` |
| Route | `src/app/api/cron/maintenance/route.ts` |

## Architecture Overview

Likelyfad Studio is a node-based visual workflow editor for AI image generation. Users drag nodes onto a React Flow canvas, connect them via typed handles, and execute pipelines that call AI APIs.

### Core Stack
- **Next.js 16** (App Router) with TypeScript
- **@xyflow/react** (React Flow) for the node editor canvas
- **Konva.js / react-konva** for canvas annotation drawing
- **Zustand** for state management (single store pattern)

### Key Files

| Purpose | Location |
|---------|----------|
| Central workflow state & execution logic | `src/store/workflowStore.ts` |
| All TypeScript type definitions | `src/types/index.ts` |
| Main canvas component & connection validation | `src/components/WorkflowCanvas.tsx` |
| Base node component (shared by all nodes) | `src/components/nodes/BaseNode.tsx` |
| Image generation API route | `src/app/api/generate/route.ts` |
| LLM text generation API route | `src/app/api/llm/route.ts` |
| Cost calculations | `src/utils/costCalculator.ts` |
| Grid splitting utility | `src/utils/gridSplitter.ts` |

### State Management

State lives in `workflowStore.ts` using Zustand; **per-node execution logic does
not** — it was split out into `src/store/execution/`, one module per node kind
(`nanoBananaExecutor.ts`, `llmGenerateExecutor.ts`, `comfyAppExecutor.ts`, the
video and image processing executors, and so on), with `executeNode.ts`
dispatching and `runWithFallback.ts` handling the fallback model. Key patterns:
- `useWorkflowStore()` hook provides access to nodes, edges, and all actions
- `executeWorkflow(startFromNodeId?)` runs the pipeline via topological sort
- `getConnectedInputs(nodeId)` retrieves upstream data for a node
- `updateNodeData(nodeId, partialData)` updates node state
- Auto-save runs every 90 seconds when enabled

### Execution Flow

1. User clicks Run or presses `Cmd/Ctrl+Enter`
2. `executeWorkflow()` performs topological sort on node graph
3. Nodes execute in dependency order, calling APIs as needed
4. `getConnectedInputs()` provides upstream images/text to each node
5. Locked groups are skipped; pause edges halt execution

## AI Models

**Seven providers**, not two. `ProviderType` in `src/types/providers.ts` is
`gemini | openai | anthropic | replicate | fal | kie | wavespeed`, and each has
an adapter under `src/app/api/generate/providers/`. The models below are the
built-in defaults; most of the catalogue is fetched from the provider at
runtime through `/api/models`, so it is not enumerable here.

Image generation models (these exist and are recently released):
- `gemini-2.5-flash-image` → internal name: `nano-banana`
- `gemini-3-pro-image-preview` → internal name: `nano-banana-pro`

LLM models:
- Google: `gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-3-pro-preview`
- OpenAI: `gpt-4.1-mini`, `gpt-4.1-nano`

## Node Types

The authoritative list is the `NodeType` union in `src/types/nodes.ts` — all
28 of them. If this table and that union disagree, the union is right.

**Inputs**

| Type | Purpose | Inputs | Outputs |
|------|---------|--------|---------|
| `imageInput` | Load/upload images | reference | image |
| `audioInput` | Load/upload audio files | audio | audio |
| `videoInput` | Load/upload video files | none | video |
| `prompt` | Text prompt input | none | text |
| `promptConstructor` | Build a prompt from parts | text | text |
| `array` | Fan a list out to downstream nodes | any | any |

**Generation**

| Type | Purpose | Inputs | Outputs |
|------|---------|--------|---------|
| `nanoBanana` | AI image generation | image, text | image |
| `generateVideo` | AI video generation | image, text | video |
| `generateAudio` | AI audio/TTS generation | text | audio |
| `generate3d` | AI 3D model generation | image, text | model |
| `llmGenerate` | AI text generation | text, image | text |
| `comfyApp` | Run a ComfyUI workflow as a node | schema-driven | schema-driven |

**Image processing**

| Type | Purpose | Inputs | Outputs |
|------|---------|--------|---------|
| `annotation` | Draw on images (Konva) | image | image |
| `splitGrid` | Split image into grid cells | image | reference |
| `imageResize` | Resize an image | image | image |
| `removeBackground` | Cut the subject out | image | image |
| `imageCompare` | Show two images side by side | image | none |

**Video processing**

| Type | Purpose | Inputs | Outputs |
|------|---------|--------|---------|
| `videoStitch` | Join clips into one video | video | video |
| `videoTrim` | Trim a clip | video | video |
| `videoFrameGrab` | Pull a still from a clip | video | image |
| `gifEncoder` | Encode frames to GIF | image, video | image |
| `easeCurve` | Easing curve for timing | none | curve |

**Control flow**

| Type | Purpose | Inputs | Outputs |
|------|---------|--------|---------|
| `router` | Send input down one of several paths | any | any |
| `switch` | Pick between inputs | any | any |
| `conditionalSwitch` | Pick based on a condition | any, text | any |

**Output**

| Type | Purpose | Inputs | Outputs |
|------|---------|--------|---------|
| `output` | Display final result | image | none |
| `outputGallery` | Collect many results in a grid | image | none |
| `glbViewer` | Load/display 3D GLB models | none | image |

## Node Connection System

### Handle Types

| Handle Type | Data Format | Description |
|-------------|-------------|-------------|
| `image` | Base64 data URL | Visual content |
| `text` | String | Text content |
| `audio` | Base64 data URL | Audio content |

### Connection Rules

1. **Type Matching**: Handles only connect to matching types (`image`→`image`, `text`→`text`)
2. **Direction**: Connections flow from source (output) to target (input)
3. **Multiplicity**: Image inputs accept multiple connections; text inputs accept one

### Data Flow in `getConnectedInputs`

Returns `{ images: string[], text: string | null }`.

**Image data extracted from:**
- `imageInput` → `data.image`
- `annotation` → `data.outputImage`
- `nanoBanana` → `data.outputImage`

**Text data extracted from:**
- `prompt` → `data.prompt`
- `llmGenerate` → `data.outputText`

**Audio data extracted from:**
- `audioInput` → `data.audioFile`
- `generateAudio` → `data.outputAudio`

## Keyboard Shortcuts

- `Cmd/Ctrl + Enter` - Run workflow
- `Cmd/Ctrl + C/V` - Copy/paste nodes
- `Shift + P` - Add prompt node at center
- `Shift + I` - Add image input node
- `Shift + G` - Add generate (nanoBanana) node
- `Shift + V` - Add video (generateVideo) node
- `Shift + L` - Add LLM node
- `Shift + A` - Add annotation node
- `Shift + T` - Add audio (generateAudio) node
- `Shift + C` - Add ComfyUI app node
- `H` - Stack selected nodes horizontally
- `V` - Stack selected nodes vertically
- `G` - Arrange selected nodes in grid
- `?` - Show keyboard shortcuts

## Adding New Node Types

1. Define the data interface in `src/types/index.ts`
2. Add to `NodeType` union in `src/types/index.ts`
3. Create default data in `createDefaultNodeData()` in `workflowStore.ts`
4. Add dimensions to `defaultDimensions` in `workflowStore.ts`
5. Create the component in `src/components/nodes/`
6. Export from `src/components/nodes/index.ts`
7. Register in `nodeTypes` in `WorkflowCanvas.tsx`
8. Add minimap color in `WorkflowCanvas.tsx`
9. Update `getConnectedInputs()` if the node produces consumable output
10. Add execution logic in `executeWorkflow()` if the node requires processing
11. Update `ConnectionDropMenu.tsx` to include the node in source/target lists

### Handle Naming Convention

Use descriptive handle IDs matching the data type:
- `id="image"` for image data
- `id="text"` for text data

### Validation

- Connection validation: `isValidConnection()` in `WorkflowCanvas.tsx`
- Workflow validation: `validateWorkflow()` in `workflowStore.ts`

## Adding New Kie.ai Models (SOP)

Reference docs: https://docs.kie.ai/llms.txt lists all available model API pages.

### Step 1: Gather API Details
Visit the model's doc page on https://docs.kie.ai/ and collect:
- Model ID(s) (the `model` param sent to the API)
- Capabilities: text-to-image, image-to-image, text-to-video, image-to-video
- API endpoint (standard: `/api/v1/jobs/createTask`, or model-specific like Veo's `/api/v1/veo/generate`)
- All input parameters: name, type, enum values, defaults, required status
- Image/video input parameter name (e.g., `image_urls`, `imageUrls`, `input_urls`)
- Polling endpoint (standard: `/api/v1/jobs/recordInfo`, or model-specific)
- Response format and status field names
- Pricing (per-run cost if available)

### Step 2: Add Model Registry Entry
**File:** `src/app/api/models/route.ts` — Add to `KIE_MODELS` array.
Each model entry needs: `id`, `name`, `description`, `provider: "kie"`, `capabilities`, `pricing`, `pageUrl`.
Use separate entries for each capability variant (e.g., `model/text-to-video` and `model/image-to-video`).

### Step 3: Add Parameter Schema
**File:** `src/app/api/models/[modelId]/route.ts` — Add to `getKieSchema()`.
Define `parameters` (user-configurable settings) and `inputs` (connectable handles like prompt, images).

### Step 4: Add Default Parameters
**File:** `src/app/api/generate/route.ts` — Add case to `getKieModelDefaults()`.
Provide required defaults that must be present even if the user doesn't set them.

### Step 5: Add Image Input Key Mapping
**File:** `src/app/api/generate/route.ts` — Add to `getKieImageInputKey()`.
Map the model to its correct image parameter name if it differs from the default `image_urls`.

### Step 6: Handle Non-Standard API (if applicable)
If the model uses different endpoints than `/api/v1/jobs/createTask` and `/api/v1/jobs/recordInfo`:
- Add a detection function (e.g., `isVeoModel()`)
- Add a model-ID-to-API-model mapping function
- Add a custom polling function for the model's status endpoint
- Add a branch in the Kie request-building logic (see `src/app/api/generate/providers/kie.ts`) for the custom request format

## ComfyUI Integration

Likelyfad Studio can run a ComfyUI workflow as a node (`comfyApp`). The workflow's
**App Mode** (linear mode) configuration defines the node's surface: the
author's chosen inputs become typed handles, their widgets become inline
settings, and their output nodes become typed output handles.

### Backends

Chosen in Settings → ComfyUI, stored in `likelyfad-studio-comfy-settings` and
forwarded per request as `X-Comfy-*` headers (so no server config is needed):

| Mode | Transport | Notes |
|------|-----------|-------|
| `cloud` (default) | `@comfyorg/sdk` (Comfy API v2) | Needs a `comfyui-…` key from platform.comfy.org |
| `local` | legacy `/api/prompt` | A stock ComfyUI; no sidecar needed |
| `remote` | legacy `/api/prompt` | Same, elsewhere on the network |

Local/remote endpoints fronted by `comfy-api-proxy` can opt into the SDK path
with the "Behind comfy-api-proxy" toggle. A stock ComfyUI has no `/api/v2/*`
routes, which is why the legacy engine is the default there.

### Key files

| Purpose | Location |
|---------|----------|
| Graph parsing, patching, pruning | `src/lib/comfy/graph.ts` |
| Editor→API conversion, App Mode, Blueprints | `src/lib/comfy/editor.ts` |
| Workflow → node contract | `src/lib/comfy/inspect.ts` |
| Backend settings + request headers | `src/lib/comfy/settings.ts` |
| Engine interface + both transports | `src/lib/comfy/server/` |
| Node component | `src/components/nodes/ComfyAppNode.tsx` |
| Import/confirm dialog | `src/components/modals/ComfyWorkflowImportModal.tsx` |
| Settings tab | `src/components/settings/ComfySettingsTab.tsx` |
| Executor | `src/store/execution/comfyAppExecutor.ts` |
| Saved-node library | `src/lib/comfy/library.ts` |

### Saved nodes

A confirmed node can be kept — "Save as node" in the confirm step of the import
and edit dialog. An entry holds the workflow, the contract *and* the values the
node was running (seeds excluded, since they are re-randomised per run), so it
comes back set up rather than merely attached.

Saved nodes then appear as ordinary nodes: in the canvas double-click search
under "Saved nodes", in the connection-drop menus for any handle type their
contract matches, and in the dialog's own "Saved nodes" tab. All three create a
plain `comfyApp` node seeded via `seedFromSavedComfyNode`; there is no new node
type.

Saving is a **snapshot**. A node created from an entry records `savedNodeId`, so
the dialog can offer "Update saved node" as well as "Save as new"; attaching a
different workflow clears it.

### Formats

Dropping either format onto the canvas creates a `comfyApp` node at the drop
point and opens the confirm step on it; our own workflow saves still replace the
canvas, told apart by shape in `src/lib/comfy/detect.ts`.

Both upload formats are accepted. An **editor save** (the normal ComfyUI Save)
is the one that carries App Mode, but it is not executable — widget values are
positional — so converting it needs `/api/object_info` from a reachable engine.
An **API export** runs as-is but carries no App Mode, so inputs and outputs are
detected heuristically and confirmed in the dialog.

**Blueprints** are saved subgraphs, listed from `/api/global_subgraphs` (public,
on Cloud and local alike). Their data enters and leaves through boundary slots,
so importing one materialises a loader per media input and a sink per output.

### Live previews

While a run is going, a v2 engine streams partial images over
`GET /api/v2/jobs/{id}/events`. `/api/comfy/preview` relays those to the node,
which shows the latent forming instead of a spinner. Two things to know:

- The payload is **not** the bare JPEG the SDK's types describe. ComfyUI wraps
  it: `[uint32 kind][uint32 jsonLength][JSON metadata][image bytes]`, and the
  frame's own `node_id` arrives empty — the real one is in the metadata. See
  `previewImage` in `src/lib/comfy/server/sdkEngine.ts`.
- The same stream carries `progress`, and it is deliberately **not** used.
  Measured against a live Cloud render it reports no node name, no step counts,
  and a fraction computed against a node total that grows as the graph expands
  — so it reaches 100% several times before the job ends. The job record's
  `progress` field is `null` on Cloud throughout, despite the spec.

Previews live in component state (`useComfyPreview`), never in the workflow
store: they are 50–80KB JPEGs belonging to a run, and node data gets written
into saved workflow files.

### Smoke tests

The Blueprint corpus is the regression net for this integration — every entry
is a real published Blueprint that once broke it in a different way.

| Command | Cost | What it covers |
|---------|------|----------------|
| `npx vitest run src/lib/comfy/__tests__/catalog.test.ts` | none | Hermetic. Runs the real conversion over recorded workflows and a recorded node catalog. Runs in CI. |
| `npm run comfy:smoke` | credits | Real renders end to end, through Likelyfad Studio's own routes. Needs a dev server and `COMFY_SMOKE_KEY`. |
| `npm run comfy:record` | none | Re-record the corpus when Comfy Cloud's catalog moves. |

Point the live tier at a local ComfyUI with
`node scripts/comfy-smoke.mjs run --mode local --url http://127.0.0.1:8188`.

## API Routes

There are **54** route files under `src/app/api/`; this table covers the ones
worth knowing before changing anything. The credits and admin routes are
documented in their own sections above. `find src/app/api -name route.ts` is
the complete list.

**Generation**

| Route | Timeout | Purpose |
|-------|---------|---------|
| `/api/generate` | 5 min | Image/video/3D generation across all seven providers |
| `/api/generate/poll` | default | Complete an async provider task. **Authenticated** — matches on `(user_id, task_id)`, never the task alone |
| `/api/llm` | 1 min | Text generation (Google/OpenAI/Anthropic) |
| `/api/models` | default | Model catalogue across providers |
| `/api/models/[modelId]` | default | Parameter schema for one model |
| `/api/providers/fal/models` | default | fal catalogue, cursor-followed and cached 5 min |
| `/api/providers/replicate/models` | default | Replicate catalogue |

**Workflows and media**

| Route | Timeout | Purpose |
|-------|---------|---------|
| `/api/workflow` | default | Save/load workflow files |
| `/api/list-workflows` | default | Discover workflows under a directory |
| `/api/workflow-images` | default | Save an image beside its workflow |
| `/api/save-generation` | default | Auto-save generated images |
| `/api/load-generation` | default | Read a saved generation back |
| `/api/images/[id]` | default | Serve a stored image |
| `/api/likelyfad/projects` | default | Cloud projects (list/create) |
| `/api/likelyfad/media` | default | Cloud media upload/fetch |
| `/api/likelyfad/templates` | default | Cloud templates |
| `/api/community-workflows` | default | Shared workflow gallery |

**ComfyUI**

| Route | Timeout | Purpose |
|-------|---------|---------|
| `/api/comfy/status` | 1 min | Probe the configured ComfyUI engine |
| `/api/comfy/inspect` | 2 min | Workflow upload → node contract |
| `/api/comfy/blueprints` | 2 min | List/import ComfyUI Blueprints |
| `/api/comfy/run` | 5 min | Submit a Comfy app run |
| `/api/comfy/poll` | 5 min | Poll a run and collect its outputs |
| `/api/comfy/preview` | 5 min | Stream a running job's preview images (NDJSON) |

**Assistant, quickstart and local tooling**

| Route | Timeout | Purpose |
|-------|---------|---------|
| `/api/chat` | default | AI assistant that edits the graph via tool calls |
| `/api/quickstart` | default | Instantiate a preset template |
| `/api/quickstart/propose` | default | Propose a workflow from a prompt |
| `/api/logs` | default | Session logging |
| `/api/env-status` | default | Which provider keys are configured |
| `/api/open-file`, `/api/open-directory`, `/api/browse-directory` | default | Local filesystem helpers; localhost-only, home-directory-scoped |

**Maintenance**

| Route | Timeout | Purpose |
|-------|---------|---------|
| `/api/cron/maintenance` | 5 min | Settle abandoned charges, close abandoned runs, apply retention. Shared-secret gated |

**Workflow history**

| Route | Timeout | Purpose |
|-------|---------|---------|
| `GET /api/workflows` | default | The caller's workflow history, one page |
| `POST /api/workflows/runs` | default | Open a run; returns a server-minted id |
| `GET /api/workflows/[id]/runs` | default | One workflow's runs. **Ownership-checked**, 404 otherwise |
| `POST /api/workflows/[id]/estimate` | default | Reprice from the **stored** graph; takes no graph |

## localStorage Keys

- `likelyfad-studio-workflow-configs` - Project metadata (paths)
- `likelyfad-studio-workflow-costs` - Cost tracking per workflow
- `likelyfad-studio-nanoBanana-defaults` - Sticky generation settings
- `likelyfad-studio-comfy-settings` - ComfyUI backend (cloud/local/remote), keys, job timeout
- `likelyfad-studio-comfy-apps` - Saved Comfy nodes (workflow + contract + settings)

## Git Workflow

- The primary development branch is `develop`, NOT `main` or `master`
- Always checkout `develop` before creating feature branches: `git checkout develop`
- Create feature branches from `develop` using: `feature/<short-description>` or `fix/<short-description>`
- All PRs MUST target `develop`: use `gh pr create --base develop`
- Never push directly to `main`, `master`, or `develop`

## Commits
- Commit after each logical task or unit of work is complete. When implementing a multi-task plan, commit after finishing each task — do NOT batch all tasks into a single commit at the end.
- Each commit should be atomic and self-contained: one task = one commit.
- The .planning directory is untracked, do not attempt to commit any changes to the files in this directory.

