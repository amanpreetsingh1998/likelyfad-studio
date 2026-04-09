# Modified Upstream Files Registry

Every upstream file edited by Likelyfad Studio is listed here. All changes are wrapped in `// === LIKELYFAD CUSTOM START/END ===` markers for easy identification during upstream sync.

## Files Modified

### 1. `src/store/workflowStore.ts`
- **Import**: Added `saveProject`, `ensureProjectRow` from cloud-storage (line 3)
- **saveToFile() guard**: Removed `saveDirectoryPath` requirement (~line 2158)
- **saveToFile() isNewDirectory bypass**: Forced to `false` in cloud mode. The upstream heuristic regenerated `workflowId` on every auto-save (because `saveDirectoryPath` is null and refs exist after first save), creating a duplicate project row every 30s. (~line 2187)
- **saveToFile() body**: Reordered to `ensureProjectRow → externalize → saveProject` so the `media.project_id` FK is satisfied during media upload (fixes 409 on first save). (~line 2223)
- **initializeAutoSave()**: Changed interval from 90s to 30s, removed `saveDirectoryPath` check (~line 2368)
- **loadWorkflow()**: Changed hydration to use project ID instead of directory path (~line 1990)

### 2. `src/utils/mediaStorage.ts`
- **saveImageAndGetId()**: Routes image uploads to `/api/likelyfad/media` instead of `/api/workflow-images` (~line 581)
- **saveVideoAndGetRef()**: Routes video uploads to `/api/likelyfad/media` instead of `/api/save-generation` (~line 648)
- **saveAudioAndGetRef()**: Routes audio uploads to `/api/likelyfad/media` instead of `/api/save-generation` (~line 718)
- **loadMediaById()**: Routes all media loads to `/api/likelyfad/media` instead of filesystem APIs (~line 1100)

### 3. `src/components/ProjectSetupModal.tsx`
- **handleSaveProject()**: Simplified to name-only (no directory validation) (~line 266)
- **Project tab UI**: Replaced directory picker + embed toggle with cloud message (~line 418)

### 4. `src/app/page.tsx`
- **Full rewrite**: Added ProjectListModal, cloud project loading, "Projects" button bridge via window

### 5. `src/components/Header.tsx`
- **Projects button**: Added folder icon button that opens ProjectListModal (~line 311)

### 6. `src/components/WorkflowCanvas.tsx`
- **New project onSave**: Passes "cloud" as directory path (~line 1988)

### 7. `package.json`
- **Dependencies**: Added `@supabase/supabase-js`

### 8. `.env.example`
- **Variables**: Added NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

### 9. `src/components/quickstart/WorkflowBrowserView.tsx`
- **Import**: Added `useRef` to React imports
- **handleImportJson()**: New function to read JSON file via `<input type="file">` and load as workflow
- **State A UI**: Added "Import Workflow JSON" button below "Choose folder" with divider
- **State B footer**: Added "Import JSON" button next to "Open from directory"

### 10. `src/store/execution/generateVideoExecutor.ts`
- **Import**: Added `uploadImageForGeneration` from cloud-storage
- **Image upload**: Uploads base64 inputs to Supabase Storage, sends signed URLs in request (avoids Vercel 4.5MB body limit)
- **Cost tracking**: Tracks cost for ALL providers with `pricing` metadata (previously fal-only)

### 11. `src/store/execution/nanoBananaExecutor.ts`
- **Import**: Added `uploadImageForGeneration` from cloud-storage
- **Image upload**: Uploads base64 inputs to Supabase Storage, sends signed URLs
- **Cost tracking**: Tracks cost for ALL providers with `pricing` metadata (previously fal + Gemini only)

### 12. `src/store/execution/generate3dExecutor.ts`
- **Import**: Added `uploadImageForGeneration` from cloud-storage
- **Image upload**: Uploads base64 inputs to Supabase Storage, sends signed URLs

### 13. `src/store/execution/generateAudioExecutor.ts`
- **Cost tracking**: Broadened to ALL providers with `pricing` metadata (previously fal-only)

### 14. `src/store/execution/llmGenerateExecutor.ts`
- **Import**: Added `uploadImageForGeneration` from cloud-storage
- **Image upload**: Uploads base64 vision inputs to Supabase Storage, sends signed URLs

### 15. `src/app/api/generate/providers/gemini.ts`
- **Image handling**: Fetches HTTP URL image inputs and converts to base64 (Gemini requires inline format)

### 16. `src/app/api/llm/route.ts`
- **Gemini handler**: Fetches HTTP URL image inputs and converts to base64
- **Anthropic handler**: Fetches HTTP URL image inputs and converts to base64
- (OpenAI handler already supports URLs natively — no change needed)

### 17. `src/components/CostIndicator.tsx`
- **Display logic**: Removed `hasNonGeminiProviders` guard — cost now shown for all providers, displays incurred cost when available

### 17b. `src/components/CostDialog.tsx`
- **Incurred Cost section copy**: Removed "Gemini only" language — now describes incurred cost as actual spend across all generations
- **Pricing note**: Updated to mention pricing-overrides file for external providers

### 17c. `src/app/api/models/route.ts`
- **Import**: Added `getPricingOverride` from `@/lib/likelyfad/pricing-overrides`
- **mapFalModel()**: Injects pricing from override map for fal.ai models that don't expose pricing via API

### 18. `src/lib/likelyfad/cloud-storage.ts` (our file, not upstream — but relevant)
- Added `uploadImageForGeneration()` — uploads base64 to Storage, returns signed URL
- Added `uploadDynamicInputsForGeneration()` — walks dynamicInputs and uploads any base64 strings
- Added `incurred_cost` to `saveProject()`/`loadProject()` signatures
- Added `incurred_cost` to `ProjectListEntry` type
- Added diagnostic logging in `uploadMedia()` and `loadMedia()` (logs every storage path tried)
- Added `inspectPersistence()` exposed as `window.__likelyfadInspect()` — lists projects, walks the bucket, reports refs vs files, missing/orphan media
- Added `ensureProjectRow(id, name)` — minimal upsert with `ignoreDuplicates: true` to satisfy `media.project_id` FK before externalization
- `deleteProject()`: walks Storage by prefix (`default/<id>/{generations,inputs,generation-inputs}`) instead of querying the unreliable `media` table

### `src/app/api/likelyfad/projects/[id]/route.ts` (new file, our route)
- DELETE handler now walks Storage by prefix instead of querying the `media` table, so orphaned files are cleaned up even when the metadata insert previously failed

### `src/components/likelyfad/ProjectListModal.tsx` (new file, our component)
- `handleDelete`: surfaces server errors instead of silently swallowing, refetches list on partial failure

### 19. `src/utils/mediaStorage.ts` (additional edit)
- **`loadMediaById()`**: On direct loadMedia failure, falls back to `/api/likelyfad/media` GET (which uses service role and bypasses any storage RLS issue). Logs both the direct error and any API fallback failure instead of silently swallowing.

### Additional executor edits (sections 10/11/12 also updated)
- All four generation executors (video, nanoBanana, 3D) now also upload base64 found in `dynamicInputs` (not just the `images` array). This was the cause of the 413 on Kling Video v2.6 — the upstream image was sent through both `images[]` AND `dynamicInputs.image_url`, and only the former was being uploaded.

### 20. `src/app/api/generate/providers/fal.ts`
- **New exports** (wrapped in LIKELYFAD CUSTOM markers): `submitToFalQueue`, `pollFalQueueStatus`, `fetchFalQueueResult`, plus internal `buildFalRequestBody` helper
- These split the fal queue lifecycle into 3 short calls so the browser can drive long-running video jobs without hitting Vercel's 60s function timeout
- The original `generateWithFalQueue` is **untouched** — image gen path is byte-identical

### 21. `src/app/api/likelyfad/fal-async/route.ts` (new file, our route)
- POST endpoint with three actions: `submit`, `poll`, `fetch-result`
- Each call finishes well under 60s (submit: ~5s, poll: <2s, fetch-result: <30s)
- API key stays server-side via `X-Fal-API-Key` header / `FAL_API_KEY` env
- Returns the same response shape as `/api/generate` so executors can parse identically

### 22. `src/store/execution/generateVideoExecutor.ts` (additional edit)
- When `provider === "fal"`, routes through `runFalAsyncVideo()` helper instead of `/api/generate`
- `runFalAsyncVideo()` (added at bottom of file, wrapped in LIKELYFAD CUSTOM markers) does submit → poll every 2s (15 min cap) → fetch-result, returning a synthetic Response so the rest of the executor parses identically
- Fixes Kling Video v2.6 (and any fal video model >60s) silently dying mid-generation when the Vercel function times out

### Database schema change
Run this SQL in Supabase SQL Editor:
```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS incurred_cost NUMERIC DEFAULT 0;
```
