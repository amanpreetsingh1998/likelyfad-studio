/**
 * Cloud storage functions for Likelyfad Studio.
 * All persistence goes through Supabase (PostgreSQL + Storage).
 */

import { supabase, MEDIA_BUCKET } from "./supabase";

// ─── Types ──────────────────────────────────────────────────────────

export interface ProjectListEntry {
  id: string;
  name: string;
  node_count: number;
  updated_at: string;
  created_at: string;
  incurred_cost?: number;
}

// ─── Project CRUD ───────────────────────────────────────────────────

export async function listProjects(): Promise<ProjectListEntry[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, node_count, updated_at, created_at")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Failed to list projects:", error);
    throw new Error(error.message);
  }

  return data ?? [];
}

/**
 * Ensure a project row exists for the given id (creates a minimal stub if missing).
 * Used to satisfy the media.project_id FK before externalizing media.
 * If the row already exists, this is a no-op (does NOT overwrite workflow_json/name).
 */
export async function ensureProjectRow(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("projects").upsert(
    { id, name },
    { onConflict: "id", ignoreDuplicates: true }
  );
  if (error) {
    console.warn(`[cloud-storage] ensureProjectRow failed for ${id}:`, error.message);
  }
}

export async function saveProject(
  id: string,
  name: string,
  workflowJson: Record<string, unknown>,
  edgeStyle: string = "angular",
  nodeCount: number = 0,
  incurredCost: number = 0
): Promise<void> {
  const { error } = await supabase.from("projects").upsert(
    {
      id,
      name,
      workflow_json: workflowJson,
      edge_style: edgeStyle,
      node_count: nodeCount,
      incurred_cost: incurredCost,
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("Failed to save project:", error);
    throw new Error(error.message);
  }
}

export async function loadProject(
  id: string
): Promise<{ name: string; workflow_json: Record<string, unknown>; incurred_cost?: number } | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("name, workflow_json, incurred_cost")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    console.error("Failed to load project:", error);
    throw new Error(error.message);
  }

  return data;
}

export async function deleteProject(id: string): Promise<void> {
  // Walk Storage by prefix instead of relying on the (often-empty) media table.
  // We delete every file under default/<id>/{generations,inputs,generation-inputs}.
  const folders = ["generations", "inputs", "generation-inputs"];
  const allPaths: string[] = [];
  for (const folder of folders) {
    const prefix = `default/${id}/${folder}`;
    const { data: files, error: listErr } = await supabase.storage
      .from(MEDIA_BUCKET)
      .list(prefix, { limit: 1000 });
    if (listErr) {
      console.warn(`[cloud-storage] deleteProject list error on ${prefix}:`, listErr.message);
      continue;
    }
    for (const f of files ?? []) {
      allPaths.push(`${prefix}/${f.name}`);
    }
  }

  if (allPaths.length > 0) {
    const { error: removeErr } = await supabase.storage.from(MEDIA_BUCKET).remove(allPaths);
    if (removeErr) {
      console.warn(`[cloud-storage] deleteProject remove error:`, removeErr.message);
    }
  }

  // Delete media metadata rows (best-effort)
  await supabase.from("media").delete().eq("project_id", id);

  // Delete project row
  const { error } = await supabase.from("projects").delete().eq("id", id);

  if (error) {
    console.error("Failed to delete project:", error);
    throw new Error(error.message);
  }
}

// ─── Media Upload/Download ──────────────────────────────────────────

/**
 * Upload a base64 media file to Supabase Storage.
 * Returns the media ID (filename without extension).
 */
export async function uploadMedia(
  projectId: string,
  mediaId: string,
  base64Data: string,
  folder: "inputs" | "generations" = "inputs"
): Promise<string> {
  // Parse data URL: "data:image/png;base64,iVBOR..."
  const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid base64 data URL");
  }

  const mimeType = match[1];
  const rawBase64 = match[2];
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const storagePath = `default/${projectId}/${folder}/${mediaId}.${ext}`;

  // Decode base64 to Uint8Array
  const binary = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));

  console.log(`[cloud-storage] uploadMedia → ${storagePath} (${binary.length} bytes)`);

  // Upload to Supabase Storage (upsert to handle re-saves)
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, binary, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) {
    console.error(`[cloud-storage] uploadMedia FAILED for ${storagePath}:`, uploadError);
    throw new Error(uploadError.message);
  }

  console.log(`[cloud-storage] uploadMedia OK → ${storagePath}`);

  // Upsert metadata row (best-effort — main source of truth is the storage path)
  const { error: metaError } = await supabase.from("media").upsert(
    {
      id: `${projectId}/${folder}/${mediaId}`,
      project_id: projectId,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: binary.length,
    },
    { onConflict: "id" }
  );
  if (metaError) {
    console.warn(`[cloud-storage] media table upsert failed (non-fatal):`, metaError.message);
  }

  return mediaId;
}

/**
 * Load a media file from Supabase Storage and return as base64 data URL.
 */
export async function loadMedia(
  projectId: string,
  mediaId: string,
  mediaType: "image" | "video" | "audio" = "image"
): Promise<string> {
  // Search for the media file across folders and extensions
  const folders = ["generations", "inputs"];
  const extensions =
    mediaType === "image"
      ? ["png", "jpg", "jpeg", "webp"]
      : mediaType === "video"
        ? ["mp4", "webm"]
        : ["mp3", "wav", "ogg", "m4a"];

  console.log(`[cloud-storage] loadMedia start → project=${projectId} mediaId=${mediaId} type=${mediaType}`);
  const attempts: string[] = [];

  for (const folder of folders) {
    for (const ext of extensions) {
      const storagePath = `default/${projectId}/${folder}/${mediaId}.${ext}`;
      attempts.push(storagePath);
      const { data, error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .download(storagePath);

      if (!error && data) {
        console.log(`[cloud-storage] loadMedia HIT → ${storagePath} (${data.size} bytes)`);
        // Convert blob to base64 data URL
        const arrayBuffer = await data.arrayBuffer();
        const base64 = btoa(
          String.fromCharCode(...new Uint8Array(arrayBuffer))
        );
        const mime =
          ext === "jpg"
            ? "image/jpeg"
            : ext === "jpeg"
              ? "image/jpeg"
              : `${mediaType}/${ext}`;
        return `data:${mime};base64,${base64}`;
      }
      if (error) {
        // Log non-404 errors loudly (RLS denials, network errors, etc.)
        const msg = (error as Error).message || String(error);
        if (!/not.found|object.not.found|404/i.test(msg)) {
          console.warn(`[cloud-storage] loadMedia error on ${storagePath}:`, msg);
        }
      }
    }
  }

  console.error(`[cloud-storage] loadMedia MISS → all paths failed for ${mediaId}. Tried:`, attempts);
  throw new Error(`Media not found: ${mediaId} for project ${projectId}`);
}

/**
 * Upload a base64 image to Supabase Storage for use as generation API input.
 * Returns a signed URL that generation providers (fal, Gemini, etc.) can fetch.
 *
 * If the input is already an HTTP URL, returns it unchanged.
 * This is used to bypass Vercel's 4.5MB request body limit — instead of sending
 * base64 in the request to /api/generate, we upload to Storage and send the URL.
 */
/**
 * Walk a dynamicInputs object and upload any base64 image strings to Supabase Storage,
 * replacing them with signed URLs. Non-base64 values pass through unchanged.
 *
 * Used by generation executors to ensure no base64 data ends up in the request body
 * (which would trip Vercel's 4.5MB limit).
 */
export async function uploadDynamicInputsForGeneration(
  dynamicInputs: Record<string, string | string[]>,
  projectId?: string
): Promise<Record<string, string | string[]>> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(dynamicInputs)) {
    if (Array.isArray(value)) {
      result[key] = await Promise.all(
        value.map((v) =>
          typeof v === "string" && v.startsWith("data:")
            ? uploadImageForGeneration(v, projectId)
            : Promise.resolve(v)
        )
      );
    } else if (typeof value === "string" && value.startsWith("data:")) {
      result[key] = await uploadImageForGeneration(value, projectId);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function uploadImageForGeneration(
  imageData: string,
  projectId?: string
): Promise<string> {
  // Already an HTTP URL — return as-is
  if (!imageData.startsWith("data:")) {
    return imageData;
  }

  const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid base64 data URL");
  }

  const mimeType = match[1];
  const rawBase64 = match[2];
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";

  // Store in a generation-inputs folder, scoped to project if available
  const folder = projectId ? `default/${projectId}/generation-inputs` : "default/anonymous/generation-inputs";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const storagePath = `${folder}/${fileName}`;

  // Decode base64 to Uint8Array
  const binary = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, binary, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error("Failed to upload image for generation:", uploadError);
    throw new Error(uploadError.message);
  }

  // Create a signed URL valid for 1 hour (plenty for generation)
  const { data: signedData, error: signedError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(storagePath, 3600);

  if (signedError || !signedData) {
    throw new Error(signedError?.message || "Failed to create signed URL");
  }

  return signedData.signedUrl;
}

// ─── Debug Inspector ────────────────────────────────────────────────
// Exposes window.__likelyfadInspect() in the browser to diagnose
// persistence issues. Lists projects, walks the storage bucket, and
// reports what is stored vs what the workflow_json references.

export interface InspectResult {
  projects: Array<{
    id: string;
    name: string;
    node_count: number;
    refs_in_workflow: string[];
    storage_files: string[];
    missing_in_storage: string[];
    orphan_in_storage: string[];
  }>;
}

export async function inspectPersistence(targetProjectId?: string): Promise<InspectResult> {
  const out: InspectResult = { projects: [] };

  const { data: projectRows, error: projErr } = await supabase
    .from("projects")
    .select("id, name, node_count, workflow_json")
    .order("updated_at", { ascending: false });

  if (projErr) {
    console.error("[inspect] failed to list projects:", projErr);
    throw projErr;
  }

  for (const row of projectRows ?? []) {
    if (targetProjectId && row.id !== targetProjectId) continue;

    // Walk workflow_json for refs
    const refs: string[] = [];
    const wf = row.workflow_json as { nodes?: Array<{ data?: Record<string, unknown> }> };
    for (const node of wf?.nodes ?? []) {
      const d = (node.data ?? {}) as Record<string, unknown>;
      for (const key of [
        "imageRef",
        "outputImageRef",
        "sourceImageRef",
        "videoRef",
        "outputVideoRef",
        "audioFileRef",
      ]) {
        const v = d[key];
        if (typeof v === "string" && v.length > 0) refs.push(v);
      }
      const inputRefs = d.inputImageRefs;
      if (Array.isArray(inputRefs)) {
        for (const r of inputRefs) if (typeof r === "string" && r) refs.push(r);
      }
    }

    // List storage files for this project
    const storageFiles: string[] = [];
    for (const folder of ["generations", "inputs"]) {
      const { data: files, error: listErr } = await supabase.storage
        .from(MEDIA_BUCKET)
        .list(`default/${row.id}/${folder}`, { limit: 1000 });
      if (listErr) {
        console.warn(`[inspect] list error on default/${row.id}/${folder}:`, listErr.message);
        continue;
      }
      for (const f of files ?? []) {
        storageFiles.push(`${folder}/${f.name}`);
      }
    }

    // Compute missing/orphans
    const storedIds = new Set(
      storageFiles.map((p) => p.split("/").pop()!.replace(/\.[^.]+$/, ""))
    );
    const missing = refs.filter((r) => !storedIds.has(r));
    const orphan = [...storedIds].filter((id) => !refs.includes(id));

    out.projects.push({
      id: row.id,
      name: row.name,
      node_count: row.node_count,
      refs_in_workflow: refs,
      storage_files: storageFiles,
      missing_in_storage: missing,
      orphan_in_storage: orphan,
    });
  }

  console.log("[inspect] result", out);
  return out;
}

// Expose to window for browser console use
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__likelyfadInspect = inspectPersistence;
}
