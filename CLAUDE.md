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

### Setup

1. Run `supabase/migrations/0005_admin.sql`.
2. Sign in once with the account that should be admin (there must be an
   `auth.users` row to point at).
3. `select public.set_admin('you@example.com');`

Re-running `set_admin` with a different email **transfers** the seat rather
than adding one — that is the intended handover path.

### Status

Phase 0 (auth + shell) only. The Overview, Users and Content pages are
placeholders naming the phase that fills them.

**Nothing records generated content yet**, so the moderation feed has no data
source: `uploadMedia()` in `cloud-storage.ts` is uncalled, outputs live as
base64 inside `projects.workflow_json` and are overwritten on every autosave,
and prompts are not logged anywhere. Phase 1 adds a `generation_events` table
written from `withCredits()` — the one chokepoint every billable run passes
through. It is the only part of the dashboard that cannot be backfilled.

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

