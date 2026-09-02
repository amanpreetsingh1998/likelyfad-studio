# Changelog

All notable changes to Likelyfad Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

The accounts release. Runs are billed to a signed-in user, credits are bought
with real money, and there is an admin dashboard over the top of it.

### Added

- **Credits** — Every run is charged to the signed-in user. New accounts get a
  free grant; more are bought through Razorpay. A workflow is billed as **one
  debit, not one per node**: each node run records a pending charge server-side
  as it happens, and the whole run settles when it finishes. The client picks
  the moment to settle; it never supplies the amount, so a browser that lies
  about what it ran still pays for what actually reached a provider.
- **Prices are derived, never hand-written** — Run cost is computed from the
  provider rate card, the margin and the FX rate. There used to be a
  hand-maintained table of credit prices, and it drifted until every image sold
  at about half of cost; a test now asserts that no model is billed below what
  it costs us.
- **fal.ai pricing** — fal publishes no pricing field on its models API and has
  no billing endpoint, so `npm run fal:pricing` scrapes the price embedded in
  each model page across the whole catalogue. Unbillable models are refused
  with a clear error rather than guessed at, and the model picker now shows the
  same number the credit gate bills from. The models route also follows the
  cursor, which it previously did not — about 90% of the catalogue was hidden.
- **Admin dashboard** (`/admin`) — Overview, Users, Content and Audit, behind a
  single-admin gate the database enforces rather than application code. Signed
  out is a 401; signed in without the seat is a **404**, because there is no
  benefit in confirming the surface exists to whoever just probed for it.
- **Generation log** — One row per billable run: user, model, prompt, status,
  credits, duration and a 256px thumbnail. Before this, nothing recorded what
  users generated — outputs lived as base64 inside autosaved workflow JSON and
  prompts were stored nowhere at all. It is the one part of the dashboard that
  cannot be backfilled, so its history starts here.
- **Stats board** — Signups, revenue, runs by kind and a model leaderboard,
  aggregated in Postgres rather than by pulling rows into Node. A panel that
  fails says so instead of rendering a zero, because a zero is a number an
  admin would believe.
- **User list** — Accounts with credit, generation and project aggregates in
  one query, and a drawer with Projects, Generations and Ledger tabs. Granting,
  refunding, suspending and deleting are all logged and all idempotent.
- **Moderation feed** — The generation log with review state attached: state
  tabs, a type filter, search over prompts and emails, and per-card flag,
  clear, remove and suspend.
- **Audit log** — Everything the admin did, readable at last. The table had
  been written to since the user list shipped, but nothing could read it, and a
  log nobody can read is a log first seen with an incident already underway.
- **Scheduled maintenance** (`POST /api/cron/maintenance`) — Settles workflow
  charges the browser abandoned, and applies retention to the generation log.
  Both jobs existed as SQL for months and had never once run, because nothing
  here runs on a timer.
- **Runs tab** (`/workflows?tab=runs`) — Every execution the account has made,
  newest first, with what it cost, how long it took and which models it used.
  Not a rearrangement of the workflow list: that page is keyed by workflow, so
  a run belonging to none of them could not appear on it — and two ordinary
  things produce exactly that. A canvas that was never saved has no workflow
  row, and deleting a workflow deliberately keeps its runs so the ledger still
  explains money already spent. Both spent real credits and neither was
  visible anywhere before this. A run whose workflow is gone keeps the name it
  had when it ran, and is marked as deleted rather than offered as a link that
  goes nowhere.

### Fixed

- **The poll route is authenticated** — `/api/generate/poll` was the one
  generation route reachable without a session, where a guessed task id
  returned someone else's media and spent our provider key. Completion now
  matches on the user and the task together, never the task alone.
- **Quickstart templates were missing** — All six preset templates (Product
  Shot, Model Product, Colour Variations, Background Swap, Style Transfer,
  Scene Composite) had been deleted by accident, leaving the template browser
  empty while every consumer still expected them.
- **The test suite was grading itself on a fraction of itself** — Below Node
  22.12, a transitive CommonJS/ESM conflict inside jsdom killed the test worker,
  and vitest reported the affected files as "no tests" rather than as failures,
  so they left the run instead of breaking it. Among them was the admin
  gate's own test file. Fixing collection surfaced 183 real failures across 19 files,
  all now fixed; `engines.node` is `>=22.12`.

### Notes

Two coverage gaps in moderation are stated in the UI rather than papered over:
nothing generated before the log shipped can be reviewed at all, and video,
audio and 3D runs have no thumbnail, so they are judged on their prompt alone.

Suspending an account blocks sign-in and token refresh, but an access token
already issued keeps working until it expires, up to an hour. The drawer says
so rather than implying the session is dead.


## [1.9.0] - 2026-08-06

The ComfyUI release. A ComfyUI workflow becomes a node on the canvas, wired to
the rest of a Likelyfad Studio pipeline.

> Note: 1.7.0 and 1.8.0 shipped without entries here. Their notes are on the
> [releases page](https://github.com/shrimbly/node-banana/releases).

### Added

- **Run a ComfyUI workflow as a node** — Drop a workflow onto the canvas and it becomes a `comfyApp` node. If it was set up in ComfyUI's **App Mode**, the author's chosen inputs become typed handles, their widgets become inline settings, and their output nodes become typed outputs. Otherwise Likelyfad Studio detects them and asks you to confirm. Both upload formats work: the normal editor save and the API export.
- **Three backends** — Comfy Cloud (the default, nothing to install), a ComfyUI on this machine, or one elsewhere on the network. Chosen in Settings → ComfyUI and sent per request, so no server configuration is needed.
- **Blueprints** — The ready-made pipelines your ComfyUI already ships, listed in their own tab. Importing one materialises a loader per media input and a sink per output, so there is nothing to upload at all.
- **Saved nodes** — Keep a configured Comfy node and it comes back set up, not merely attached: the workflow, the contract, and the values it was running. Saved nodes appear in the canvas double-click search, in the connection-drop menus for any handle type they match, and in the dialog's own tab.
- **Live previews** — While a run is going, the node shows the latent forming instead of a spinner, streamed from the engine's event channel.
- **Curve editor** — ComfyUI's `CURVE` widget renders as a draggable tone curve rather than raw JSON.
- **Revisit a node's picks** — Reopening the dialog on an attached workflow shows the same candidate list with that node's selections applied, so inputs, settings and outputs can be changed without starting over.

### Fixed

- **Annotation modal shortcuts** — Delete inside the modal no longer removes the node behind it, and undo works with the shortcut typed in either case.
- **Running outline** — A node that is running is outlined as one piece, settings panel included, instead of drawing a second line where the panel starts.

### Notes

Comfy Cloud reports job progress too thinly to draw — no node name, no step
counts, and a fraction computed against a node total that grows during the run,
so it reaches 100% several times before the job ends. Previews are shown
instead, and progress deliberately is not.

## [1.6.0] - 2026-04-21

### Added

- **Seedance 2 I2V: richer media inputs** — The ByteDance Seedance 2.0 and 2.0 Fast image-to-video nodes now expose Last Frame, Reference Images (up to 9), Reference Videos (up to 3), and Reference Audio (up to 3) handles alongside First Frame. Handle descriptions document the First/Last Frame vs Reference Images mutual-exclusivity rule.

### Fixed

- **Seedance 2 I2V: reference-only runs no longer rejected** — When connecting images only to Reference Images, the request no longer duplicates them into `first_frame_url`, which Kie was rejecting as a mutually-exclusive combination.

## [1.5.0] - 2026-04-20

### Added

- **Onboarding & setup flow** — New first-run setup experience to get users configured and started quickly
- **Interactive tutorial** — Guided onboarding tutorial that walks first-time users through the workflow editor with mock execution and step-by-step demonstration
- **Kie.ai model expansion** — Added 7 new image models, Kling 3.0 / 3.0 Motion Control, Wan 2.7 (text-to-video & image-to-video), and Seedance 2.0 / 2.0 Fast video models
- **Model fallback/redundancy** — Generation nodes now support a fallback model that automatically kicks in if the primary model fails, with a dedicated settings tab for configuring fallback parameters
- **Loop edges** — Connect a node's output back to an upstream input with magenta-styled loop edges and configurable iteration counts via an edge toolbar
- **Client-side polling** — Long-running Kie tasks now return immediately and poll for results on the client side, keeping the UI responsive during video/3D generation
- **Download buttons** — All media-displaying nodes (image, video, audio, 3D) now have download buttons
- **Output gallery extraction** — New "Extract" button on OutputGalleryNode to batch-create input nodes from gallery items
- **Handle labels** — Connection handles now show descriptive labels on hover/select/drag for easier wiring

### Fixed

- **Video handle and edge colors** — Unified video handles, labels, and edges to consistent pink styling
- **Loop execution reliability** — Fixed downstream observer collection during loop iterations, validated loop counts, and handled resume inside loops
- **Orphaned edge cleanup** — Edges referencing deleted nodes are now filtered out on workflow load
- **Audio stitching** — Embedded audio is preserved when stitching video segments
- **Kie API compatibility** — Fixed Seedance 2.0 model ID mapping, schema defaults pre-population, and video/audio upload handling

## [1.4.0] - 2026-04-02

### Added

- **Audio-to-video generation** — Video generation nodes now accept audio inputs, enabling audio-driven video workflows with handle rendering, connection validation, model discovery, and drop-menu wiring
- **Array batch mode** — New batch execution mode that sequentially generates from all items in an array, with shared helper logic across all execution entry points

### Fixed

- **Undo/redo memory bloat** — Eliminated excessive memory usage caused by deep-cloning base64 image blobs in history snapshots; clipboard and snapshot operations now use a string-preserving clone
- **Cancellable batch execution** — Wired AbortController into `regenerateNode` so batch runs can be properly cancelled
- **Output gallery correctness** — Output gallery now reads fresh node data to preserve all batch-generated images
- **Array batch behavior** — Batch mode is now derived dynamically from the source node rather than being statically configured
- **UI polish** — Normalized button sizes in array node headers and repositioned batch/auto-route controls inline with split rows

## [1.3.0] - 2026-03-31

### Added

- **Video Input node** — Upload, preview, and wire video files through workflows with drag-and-drop support, native playback controls, and full-bleed styling matching Image Input nodes
- **Undo/Redo** — Full undo/redo history with Cmd+Z / Cmd+Shift+Z, intelligently coalescing multi-node deletions into single undo steps
- **Veo model parameters** — Aspect ratio, quality, and duration controls now render in the Generate Video node UI
- **NB Pro Waitlist** — Added waitlist link to the welcome modal

### Fixed

- Selected-node execution now properly hydrates audio and video input nodes from upstream connections

## [1.2.0] - 2026-03-29

### Added

- **Workflow Browser** — browse, search, and open saved workflows from a new modal (supports nested subdirectories, directory picker, and last-used path memory)
- **Media Externalization** — videos and audio now save alongside images in the generations/ folder for portable workflows
- **Optional Inputs & Skip Propagation** — mark input nodes as optional; execution skips downstream nodes when optional inputs are empty
- **Group Context Menu** — redesigned as a vertical dropdown with color picker, lock toggle, and NBP Input flag

### Fixed

- Video/audio save-load roundtrip (3 compounding bugs)
- Lock icon now shown on locked groups
- Error state cleared when navigating generation carousel
- Various a11y, regex, and dialog semantics fixes

### Performance

- Faster workflow listing by reading only file headers

### Documentation

- Redesigned README with hero layout, all 23 node types, and updated screenshots

## [1.1.3] - 2026-03-22

### Fixed

- Clamp expand height to minHeight and resolve text through switch nodes
- Move ImageInputNode handles after visual content to prevent z-order clipping
- Add z-index to handles so they paint above positioned node content
- Move overflow-clip from contentClassName to inner visual wrappers to prevent handle clipping
- Move panel height correction from loadWorkflow into BaseNode render
- Prevent node height accumulation with inline parameters on reload
- Update WelcomeModal test to match bg-black/60 backdrop class
- Resolve prompt variables through router nodes for PromptConstructor
- Use overflow-visible on non-fullBleed nodes to prevent handle clipping

### Other

- Replace ArrayNode auto-route icon with Lucide split icon

## [1.1.2] - 2026-03-12

### Added

- Adaptive image resolution scaling — swaps full-res images for JPEG thumbnails when nodes are small on screen

### Fixed

- Router/switch passthrough losing data when multiple types (text + image) flow through the same router to one target
- SplitGrid node Split button permanently disabled — sourceImage now updates reactively when an edge is connected
- Node connection handles clipped at edges — removed paint containment that acted like overflow hidden
- Thumbnail cache key collisions causing wrong images on nodes
- Pending thumbnail map not cleaned up on rejection, causing stale entries
- Pointer-events on node images/content blocking pan and drag interactions
- Hover state updates firing during node drag, causing unnecessary re-renders
- Hover events not blocked during mouse-down drag
- backdrop-blur-sm causing poor rendering performance on Windows

## [1.1.1] - 2026-03-12

### Fixed

- Ensure auto-routed prompts retain correct individual item text
- Add rounded corners to ImageInput image and InlineParameterPanel settings

### Other

- Increase ArrayNode top padding to match side padding
- Add top padding and max-width to ArrayNode top fields
- Update ArrayNode layout to match new design language

## [1.1.0] - 2026-03-12

### Added

- **Router, Switch & ConditionalSwitch Nodes** - Three new flow-control node types with toggle UI, rule editing, dynamic handles, and dimming integration
- **Gemini Veo Video Generation** - Veo 3.1 video models with full parameter support and error handling
- **Anthropic Claude LLM Provider** - Claude models available in LLM node alongside Gemini and OpenAI
- **Floating Node Headers** - Headers rendered via ViewportPortal with drag-to-move, hover controls, and Browse button
- **ControlPanel** - Centralized parameter editing panel with node-type routing and Run/Apply buttons
- **Full-Bleed Node Layouts** - All major nodes converted to edge-to-edge content with overlay controls
- **Inline Parameters** - Toggle to show model parameters directly on nodes with reactive sync
- **Video Autoplay** - useVideoAutoplay hook integrated into all 5 video node types
- **Inline Variable Highlights** - PromptConstructor highlights template variables inline
- **Minimap Navigation** - Click-to-navigate and scroll-to-zoom on minimap
- **Node Dimming System** - CSS-based visual dimming for disabled Switch/ConditionalSwitch paths
- **Unsaved Changes Warning** - Browser warns before closing tab with unsaved workflow
- **All Nodes Menu** - Floating action bar with All Nodes dropdown and All Models button
- **Provider Filter Icons** - ModelSearchDialog filters by available providers

### Fixed

- Ease curve outputDuration passthrough through parent-child connections
- Canvas hover state suppressed during panning to prevent re-render cascading
- Node click-to-select failures caused by d3-drag dead zone
- Aspect-fit resize after manual resize aligns with React Flow dimension priority
- Settings panel seamless selection ring, background matching, and z-index layering
- ConditionalSwitch stale input, handle alignment, and text routing
- Veo negative prompt connectable as text handle, error handling, image validation
- API headers scoped to active provider, temperature falsy bug fixed
- Image flicker on settings toggle, presets popup dismiss, modal overlay click-through
- Node paste height compounding, group label anchoring, file input backdrop issues
- Handle visibility on full-bleed and OutputNode, clipped handle resolution
- FloatingNodeHeader width tracking, right-alignment, and Windows drag interception
- Smart cascade made type-aware so text inputs don't rescue dimmed image paths
- RouterNode auto-resize, handle colors, and placeholder styling

### Changed

- EaseCurveNode, SplitGridNode, Generate3DControls, GenerateVideoControls refactored to full-bleed patterns
- ConditionalSwitch execution logic deduplicated with shared evaluateRule utility
- ModelParameters collapsible toggle removed

### Performance

- Selective Zustand subscriptions replace bare useWorkflowStore() calls
- RAF-debounced setHoveredNodeId and BaseNode ResizeObserver
- Edge rendering optimized for large canvases
- FloatingNodeHeader, InlineParameterPanel, ModelParameters wrapped in React.memo
- useShallow for WorkflowCanvas store subscription
- Narrow selectors for ControlPanel and GroupControlsOverlay

### Tests

- Removed redundant and brittle component tests (-1,958 lines)
- Updated assertions for full-bleed nodes, floating action bar, and Gemini video

### Other

- Added MIT license
- Handle diameter increased from 10px to 14px
- Settings redesigned with pill tabs, segmented controls, and toggles
- Multi-layer box-shadow for smooth settings panel shadow

## [1.0.0] - Initial Release

### Added

- Visual node editor with drag-and-drop canvas
- Image Input node for loading images
- Prompt node for text input
- Annotation node with full-screen drawing tools (rectangles, circles, arrows, freehand, text)
- NanoBanana node for AI image generation using Gemini
- LLM Generate node for text generation (Gemini and OpenAI)
- Output node for displaying results
- Workflow save/load as JSON files
- Connection validation (image-to-image, text-to-text)
- Multi-image input support for generation nodes
