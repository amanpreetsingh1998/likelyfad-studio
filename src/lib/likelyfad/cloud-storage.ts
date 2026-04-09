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
  // Delete media files from storage first
  const { data: mediaRows } = await supabase
    .from("media")
    .select("storage_path")
    .eq("project_id", id);

  if (mediaRows && mediaRows.length > 0) {
    const paths = mediaRows.map((r) => r.storage_path);
    await supabase.storage.from(MEDIA_BUCKET).remove(paths);
  }

  // Delete project (cascades to media table rows)
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

  // Upload to Supabase Storage (upsert to handle re-saves)
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, binary, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) {
    console.error("Failed to upload media:", uploadError);
    throw new Error(uploadError.message);
  }

  // Upsert metadata row
  await supabase.from("media").upsert(
    {
      id: `${projectId}/${folder}/${mediaId}`,
      project_id: projectId,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: binary.length,
    },
    { onConflict: "id" }
  );

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

  for (const folder of folders) {
    for (const ext of extensions) {
      const storagePath = `default/${projectId}/${folder}/${mediaId}.${ext}`;
      const { data, error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .download(storagePath);

      if (!error && data) {
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
    }
  }

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
