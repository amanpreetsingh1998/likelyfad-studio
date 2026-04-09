// === LIKELYFAD CUSTOM === (cloud templates — client-side helpers)

import type { WorkflowFile } from "@/store/workflowStore";
import type { WorkflowNode } from "@/types";

export interface CloudTemplate {
  id: string;
  name: string;
  description: string;
  category: "simple" | "advanced" | "community";
  tags: string[];
  node_count: number;
  thumbnail_url: string | null;
  created_at: string;
}

export interface CloudTemplateFull extends CloudTemplate {
  workflow_json: WorkflowFile;
}

/**
 * Fetch list of templates from the cloud (lightweight — no workflow_json).
 */
export async function fetchCloudTemplates(): Promise<CloudTemplate[]> {
  try {
    const res = await fetch("/api/likelyfad/templates");
    if (!res.ok) return [];
    const json = await res.json();
    return json.templates ?? [];
  } catch (err) {
    console.error("[templatesCloud] fetch failed:", err);
    return [];
  }
}

/**
 * Load a single template's full workflow_json.
 */
export async function fetchCloudTemplate(id: string): Promise<CloudTemplateFull | null> {
  try {
    const res = await fetch(`/api/likelyfad/templates/${id}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.template ?? null;
  } catch (err) {
    console.error("[templatesCloud] fetchOne failed:", err);
    return null;
  }
}

/**
 * Save current workflow as a template.
 * Returns new template id or null on failure.
 */
export async function saveCloudTemplate(body: {
  name: string;
  description: string;
  category: "simple" | "advanced";
  tags: string[];
  node_count: number;
  thumbnail_url?: string | null;
  workflow_json: Omit<WorkflowFile, "id">;
}): Promise<string | null> {
  try {
    const res = await fetch("/api/likelyfad/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      console.error("[templatesCloud] save failed:", json.error);
      return null;
    }
    return json.id ?? null;
  } catch (err) {
    console.error("[templatesCloud] save failed:", err);
    return null;
  }
}

export async function deleteCloudTemplate(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/likelyfad/templates/${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Sanitization ──────────────────────────────────────────────────────
// Strip heavy base64 payloads and per-project references from a workflow
// before saving it as a shareable template. Templates are structural
// blueprints — users bring their own inputs on instantiation.

const MEDIA_FIELDS_TO_CLEAR: string[] = [
  "image",
  "outputImage",
  "outputVideo",
  "outputAudio",
  "sourceImage",
  "annotatedImage",
  "backgroundImage",
];

const ARRAY_FIELDS_TO_CLEAR: string[] = [
  "inputImages",
  "imageHistory",
  "videoHistory",
  "audioHistory",
];

const REF_FIELDS_TO_CLEAR: string[] = [
  "imageRef",
  "outputImageRef",
  "sourceImageRef",
  "inputImageRefs",
  "outputVideoRef",
  "outputAudioRef",
];

function stripNodeMedia(node: WorkflowNode): WorkflowNode {
  const data = { ...(node.data as Record<string, unknown>) };
  for (const f of MEDIA_FIELDS_TO_CLEAR) {
    if (f in data) data[f] = null;
  }
  for (const f of ARRAY_FIELDS_TO_CLEAR) {
    if (f in data) data[f] = [];
  }
  for (const f of REF_FIELDS_TO_CLEAR) {
    if (f in data) delete data[f];
  }
  // Reset status fields so it doesn't look mid-run
  if ("status" in data) data.status = "idle";
  if ("error" in data) data.error = null;
  return { ...node, data: data as WorkflowNode["data"] };
}

export function stripWorkflowForTemplate(workflow: WorkflowFile): Omit<WorkflowFile, "id"> {
  const cleanNodes = workflow.nodes.map(stripNodeMedia);
  return {
    version: workflow.version,
    name: workflow.name,
    nodes: cleanNodes,
    edges: workflow.edges,
    edgeStyle: workflow.edgeStyle,
    groups: workflow.groups,
  };
}

/**
 * Walk nodes and collect unique provider tags from generation nodes.
 * Used to auto-fill provider chips on the template card.
 */
export function deriveProviderTags(nodes: WorkflowNode[]): string[] {
  const set = new Set<string>();
  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;
    const sel = data?.selectedModel as { provider?: string } | undefined;
    if (sel?.provider) {
      // Normalize provider display names
      const p = sel.provider;
      if (p === "gemini") set.add("Gemini");
      else if (p === "fal") set.add("fal.ai");
      else if (p === "replicate") set.add("Replicate");
      else if (p === "openai") set.add("OpenAI");
      else if (p === "anthropic") set.add("Anthropic");
      else if (p === "google") set.add("Google");
      else set.add(p);
    }
  }
  return Array.from(set).sort();
}
