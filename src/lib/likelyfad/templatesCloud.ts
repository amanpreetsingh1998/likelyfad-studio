// === LIKELYFAD CUSTOM === (cloud templates — client-side helpers)

import type { WorkflowFile } from "@/store/workflowStore";
import type { WorkflowNode } from "@/types";
import { PRICING_OVERRIDES } from "./pricing-overrides";

export interface CloudTemplate {
  id: string;
  name: string;
  description: string;
  category: "simple" | "advanced" | "community";
  tags: string[];
  node_count: number;
  thumbnail_url: string | null;
  hover_url: string | null;
  models: string[];
  estimated_cost: number;
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
  hover_url?: string | null;
  models: string[];
  estimated_cost: number;
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

// ─── Auto-detection helpers ────────────────────────────────────────────

/**
 * Full list of providers the user can toggle in the SaveTemplateModal.
 * Auto-detection pre-checks the ones found in the workflow; users can also
 * check additional providers manually (e.g. if a template is meant to be
 * swapped to a different provider).
 */
export const KNOWN_PROVIDERS = [
  "Gemini",
  "fal.ai",
  "Replicate",
  "OpenAI",
  "Anthropic",
  "Google",
  "ElevenLabs",
  "HeyGen",
  "Runway",
  "Wavespeed",
] as const;

/**
 * Normalize a raw provider string to one of the known display names.
 * Returns the normalized name or the raw string if unknown.
 */
function normalizeProvider(raw: string): string {
  const p = raw.toLowerCase();
  if (p === "gemini") return "Gemini";
  if (p === "fal" || p === "fal.ai" || p === "fal-ai") return "fal.ai";
  if (p === "replicate") return "Replicate";
  if (p === "openai" || p === "chatgpt") return "OpenAI";
  if (p === "anthropic" || p === "claude") return "Anthropic";
  if (p === "google") return "Google";
  if (p === "elevenlabs" || p === "eleven-labs") return "ElevenLabs";
  if (p === "heygen") return "HeyGen";
  if (p === "runway" || p === "runwayml") return "Runway";
  if (p === "wavespeed") return "Wavespeed";
  return raw;
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
      set.add(normalizeProvider(sel.provider));
    }
  }
  return Array.from(set).sort();
}

/**
 * Walk nodes and collect unique model display names actually used in the
 * workflow. Dedupes by display name (or modelId as fallback) so the same
 * model used in three nodes only shows up once.
 */
export function deriveModelsUsed(nodes: WorkflowNode[]): string[] {
  const set = new Set<string>();
  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;
    const sel = data?.selectedModel as
      | { displayName?: string; modelId?: string }
      | undefined;
    if (!sel) continue;
    const label = sel.displayName?.trim() || sel.modelId?.trim();
    if (label) set.add(label);
  }
  return Array.from(set).sort();
}

/**
 * Estimate the dollar cost of one full run of the workflow by summing the
 * pricing of every generation node. Falls back to the pricing-overrides
 * table for models whose selectedModel.pricing is missing.
 *
 * This is a simple lower-bound estimate: one generation per generation
 * node. Real costs can be higher (4K output, batch runs, long videos).
 */
export function estimateWorkflowCost(nodes: WorkflowNode[]): number {
  let total = 0;
  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;
    const sel = data?.selectedModel as
      | { modelId?: string; pricing?: { amount?: number } }
      | undefined;
    if (!sel) continue;
    if (typeof sel.pricing?.amount === "number") {
      total += sel.pricing.amount;
      continue;
    }
    if (sel.modelId) {
      const override = PRICING_OVERRIDES[sel.modelId];
      if (override) {
        total += override.amount;
      }
    }
  }
  // Round to 4 decimals to avoid floating point noise in the DB column
  return Math.round(total * 10000) / 10000;
}
