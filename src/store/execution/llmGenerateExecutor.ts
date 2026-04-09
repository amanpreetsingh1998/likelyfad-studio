/**
 * LLM Generate Executor
 *
 * Unified executor for llmGenerate (text generation) nodes.
 * Used by both executeWorkflow and regenerateNode.
 */

import type { LLMGenerateNodeData } from "@/types";
import { buildLlmHeaders } from "@/store/utils/buildApiHeaders";
import type { NodeExecutionContext } from "./types";
// === LIKELYFAD CUSTOM START ===
import { uploadImageForGeneration } from "@/lib/likelyfad/cloud-storage";
// === LIKELYFAD CUSTOM END ===

export interface LlmGenerateOptions {
  /** When true, falls back to stored inputImages/inputPrompt if no connections provide them. */
  useStoredFallback?: boolean;
}

export async function executeLlmGenerate(
  ctx: NodeExecutionContext,
  options: LlmGenerateOptions = {}
): Promise<void> {
  const {
    node,
    getConnectedInputs,
    updateNodeData,
    signal,
    providerSettings,
    // === LIKELYFAD CUSTOM === (runtime LLM cost tracking)
    addIncurredCost,
  } = ctx;

  const { useStoredFallback = false } = options;

  const inputs = getConnectedInputs(node.id);
  const nodeData = node.data as LLMGenerateNodeData;

  // Determine images and text
  let images: string[];
  let text: string | null;

  if (useStoredFallback) {
    images = inputs.images.length > 0 ? inputs.images : nodeData.inputImages;
    text = inputs.text ?? nodeData.inputPrompt;
  } else {
    images = inputs.images;
    text = inputs.text ?? nodeData.inputPrompt;
  }

  if (!text) {
    updateNodeData(node.id, {
      status: "error",
      error: "Missing text input - connect a prompt node or set internal prompt",
    });
    throw new Error("Missing text input");
  }

  updateNodeData(node.id, {
    inputPrompt: text,
    inputImages: images,
    status: "loading",
    error: null,
  });

  const headers = buildLlmHeaders(nodeData.provider, providerSettings);

  // === LIKELYFAD CUSTOM START === (upload base64 images to Supabase Storage, pass URLs to avoid 4.5MB payload limit)
  let uploadedImages = images;
  try {
    if (images.length > 0) {
      const { useWorkflowStore } = await import("@/store/workflowStore");
      const workflowId = useWorkflowStore.getState().workflowId || undefined;
      uploadedImages = await Promise.all(
        images.map((img) => uploadImageForGeneration(img, workflowId))
      );
    }
  } catch (err) {
    console.error("Failed to upload images for LLM:", err);
    updateNodeData(node.id, {
      status: "error",
      error: `Failed to upload input images: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
    throw err;
  }
  // === LIKELYFAD CUSTOM END ===

  try {
    const response = await fetch("/api/llm", {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: text,
        // === LIKELYFAD CUSTOM: use uploaded image URLs instead of base64 ===
        ...(uploadedImages.length > 0 && { images: uploadedImages }),
        provider: nodeData.provider,
        model: nodeData.model,
        temperature: nodeData.temperature,
        maxTokens: nodeData.maxTokens,
      }),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorMessage;
      } catch {
        if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
      }
      updateNodeData(node.id, {
        status: "error",
        error: errorMessage,
      });
      throw new Error(errorMessage);
    }

    const result = await response.json();

    if (result.success && result.text) {
      updateNodeData(node.id, {
        outputText: result.text,
        status: "complete",
        error: null,
      });

      // === LIKELYFAD CUSTOM START === (track real LLM cost from server-computed dollars)
      const costAmount: number = typeof result.cost === "number" ? result.cost : 0;
      const usageInput: number = result.usage?.inputTokens ?? 0;
      const usageOutput: number = result.usage?.outputTokens ?? 0;
      console.log(
        `[cost] LLM ${nodeData.provider}/${nodeData.model}: ` +
          `${usageInput} in + ${usageOutput} out → $${costAmount.toFixed(6)}`
      );
      if (costAmount > 0) {
        addIncurredCost(costAmount);
        const { logCostEvent } = await import("@/lib/likelyfad/costEvents");
        const { useWorkflowStore } = await import("@/store/workflowStore");
        logCostEvent({
          projectId: useWorkflowStore.getState().workflowId,
          nodeId: node.id,
          nodeType: "llm",
          modelName: nodeData.model,
          amount: costAmount,
        });
        void useWorkflowStore.getState().saveToFile().catch(() => {});
      }
      // === LIKELYFAD CUSTOM END ===
    } else {
      updateNodeData(node.id, {
        status: "error",
        error: result.error || "LLM generation failed",
      });
      throw new Error(result.error || "LLM generation failed");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    let errorMessage = "LLM generation failed";
    if (error instanceof TypeError && error.message.includes("NetworkError")) {
      errorMessage = "Network error. Check your connection and try again.";
    } else if (error instanceof TypeError) {
      errorMessage = `Network error: ${error.message}`;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    updateNodeData(node.id, {
      status: "error",
      error: errorMessage,
    });
    throw new Error(errorMessage);
  }
}
