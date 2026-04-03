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
