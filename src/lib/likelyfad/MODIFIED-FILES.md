# Modified Upstream Files Registry

Every upstream file edited by Likelyfad Studio is listed here. All changes are wrapped in `// === LIKELYFAD CUSTOM START/END ===` markers for easy identification during upstream sync.

## Files Modified

### 1. `src/store/workflowStore.ts`
- **Import**: Added `saveProject` from cloud-storage (line 3)
- **saveToFile() guard**: Removed `saveDirectoryPath` requirement (~line 2158)
- **saveToFile() body**: Replaced filesystem save with `saveProject()` call to Supabase (~line 2219)
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

### 18. `src/lib/likelyfad/cloud-storage.ts` (our file, not upstream — but relevant)
- Added `uploadImageForGeneration()` — uploads base64 to Storage, returns signed URL
- Added `incurred_cost` to `saveProject()`/`loadProject()` signatures
- Added `incurred_cost` to `ProjectListEntry` type

### Database schema change
Run this SQL in Supabase SQL Editor:
```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS incurred_cost NUMERIC DEFAULT 0;
```
