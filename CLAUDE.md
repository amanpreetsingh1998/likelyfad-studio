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

**Known gap:** a tab closed mid-run never settles, so those rows stay unbilled.
This is deliberate and temporary. The fix is a sweep job settling rows older
than N minutes — `settle_pending_charges` already takes just a user id, so it
needs no new logic, only a scheduler.

A refused step returns **402** with `code: "insufficient_credits"`; the executors
turn that into the buy-credits modal. Every gated response carries
`X-Credits-Balance` and `X-Credits-Pending`.

### Setup

1. Run `supabase/migrations/0003_credits.sql`, then `0004_workflow_settlement.sql`, in the Supabase SQL editor.
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
   `0009_moderation.sql`, then `0010_admin_audit.sql`.
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

Phases 0–4, plus the audit log. Every tab of the dashboard is real: auth, the
shell, the generation log, the stats board, the user list, the moderation feed
and the record of what the admin did.

The usage panels read from `generation_events`, which starts empty — "no data
yet" is the honest first-week state of half this dashboard, and the panels say
so rather than drawing empty axes that look like a bug.

**Retention is not wired up.** `prune_generation_events(days)` exists and
returns the thumbnail keys it deleted — SQL cannot remove storage objects, so a
caller must pass those to the storage API. It needs a scheduler this project
does not have, the same gap that keeps `settle_pending_charges` from closing
the closed-tab billing leak.

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

All application state lives in `workflowStore.ts` using Zustand. Key patterns:
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

Image generation models (these exist and are recently released):
- `gemini-2.5-flash-image` → internal name: `nano-banana`
- `gemini-3-pro-image-preview` → internal name: `nano-banana-pro`

LLM models:
- Google: `gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-3-pro-preview`
- OpenAI: `gpt-4.1-mini`, `gpt-4.1-nano`

## Node Types

| Type | Purpose | Inputs | Outputs |
|------|---------|--------|---------|
| `imageInput` | Load/upload images | reference | image |
| `annotation` | Draw on images (Konva) | image | image |
| `prompt` | Text prompt input | none | text |
| `nanoBanana` | AI image generation | image, text | image |
| `llmGenerate` | AI text generation | text, image | text |
| `splitGrid` | Split image into grid cells | image | reference |
| `generateAudio` | AI audio/TTS generation | text | audio |
| `audioInput` | Load/upload audio files | audio | audio |
| `glbViewer` | Load/display 3D GLB models | none | image |
| `comfyApp` | Run a ComfyUI workflow as a node | schema-driven | schema-driven |
| `output` | Display final result | image | none |

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

All routes in `src/app/api/`:

| Route | Timeout | Purpose |
|-------|---------|---------|
| `/api/generate` | 5 min | Image generation via Gemini |
| `/api/llm` | 1 min | Text generation (Google/OpenAI) |
| `/api/workflow` | default | Save/load workflow files |
| `/api/save-generation` | default | Auto-save generated images |
| `/api/logs` | default | Session logging |
| `/api/comfy/status` | 1 min | Probe the configured ComfyUI engine |
| `/api/comfy/inspect` | 2 min | Workflow upload → node contract |
| `/api/comfy/blueprints` | 2 min | List/import ComfyUI Blueprints |
| `/api/comfy/run` | 5 min | Submit a Comfy app run |
| `/api/comfy/poll` | 5 min | Poll a run and collect its outputs |
| `/api/comfy/preview` | 5 min | Stream a running job's preview images (NDJSON) |

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

