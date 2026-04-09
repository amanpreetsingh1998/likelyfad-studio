/**
 * NanoBanana Executor
 *
 * Unified executor for nanoBanana (image generation) nodes.
 * Used by both executeWorkflow and regenerateNode.
 */

import type {
  NanoBananaNodeData,
} from "@/types";
import { calculateGenerationCost } from "@/utils/costCalculator";
import { buildGenerateHeaders } from "@/store/utils/buildApiHeaders";
import type { NodeExecutionContext } from "./types";
// === LIKELYFAD CUSTOM START ===
import { uploadImageForGeneration, uploadDynamicInputsForGeneration } from "@/lib/likelyfad/cloud-storage";
import { logCostEvent } from "@/lib/likelyfad/costEvents";
import { useWorkflowStore } from "@/store/workflowStore";
import { getPricingOverride } from "@/lib/likelyfad/pricing-overrides";
// === LIKELYFAD CUSTOM END ===

export interface NanoBananaOptions {
  /** When true, falls back to stored inputImages/inputPrompt if no connections provide them. */
  useStoredFallback?: boolean;
}

export async function executeNanoBanana(
  ctx: NodeExecutionContext,
  options: NanoBananaOptions = {}
): Promise<void> {
  const {
    node,
    getConnectedInputs,
    updateNodeData,
    getFreshNode,
    getEdges,
    getNodes,
    signal,
    providerSettings,
    addIncurredCost,
    addToGlobalHistory,
    generationsPath,
    trackSaveGeneration,
    appendOutputGalleryImage,
    get,
  } = ctx;

  const { useStoredFallback = false } = options;

  const { images: connectedImages, text: connectedText, dynamicInputs } = getConnectedInputs(node.id);

  // Get fresh node data from store
  const freshNode = getFreshNode(node.id);
  const nodeData = (freshNode?.data || node.data) as NanoBananaNodeData;

  // Determine images and text (with optional fallback to stored values)
  let images: string[];
  let promptText: string | null;

  if (useStoredFallback) {
    images = connectedImages.length > 0 ? connectedImages : nodeData.inputImages;
    promptText = connectedText ?? nodeData.inputPrompt;
  } else {
    images = connectedImages;
    // For dynamic inputs, check if we have at least a prompt
    const promptFromDynamic = Array.isArray(dynamicInputs.prompt)
      ? dynamicInputs.prompt[0]
      : dynamicInputs.prompt;
    promptText = connectedText || promptFromDynamic || null;
  }

  // Defensive: ensure promptText is actually a string at runtime
  // (Guards against corrupted node data or race conditions in parallel execution)
  if (promptText !== null && typeof promptText !== 'string') {
    const raw: unknown = promptText;
    console.warn('[nanoBanana] promptText was not a string, coercing:', typeof raw, Array.isArray(raw) ? `<redacted array length=${raw.length}>` : '<redacted>');
    promptText = Array.isArray(raw) ? (raw as string[])[0] ?? null : null;
  }

  if (!promptText) {
    updateNodeData(node.id, {
      status: "error",
      error: "Missing text input",
    });
    throw new Error("Missing text input");
  }

  updateNodeData(node.id, {
    inputImages: images,
    inputPrompt: promptText,
    status: "loading",
    error: null,
  });

  const provider = nodeData.selectedModel?.provider || "gemini";
  const headers = buildGenerateHeaders(provider, providerSettings);

  // Sanitize dynamicInputs: remove prompt since it's already sent as the top-level
  // `prompt` field in requestPayload. Keeping both can cause providers like Replicate
  // to prefer dynamicInputs.prompt over the authoritative top-level value.
  const sanitizedDynamicInputs = { ...dynamicInputs };
  delete sanitizedDynamicInputs.prompt;

  // === LIKELYFAD CUSTOM START === (upload base64 images to Supabase Storage, pass URLs to avoid 4.5MB payload limit)
  const { useWorkflowStore: _storeForUpload } = await import("@/store/workflowStore");
  const _workflowIdForUpload = _storeForUpload.getState().workflowId || undefined;

  let uploadedImages = images;
  let uploadedDynamicInputs = sanitizedDynamicInputs;
  try {
    if (images.length > 0) {
      uploadedImages = await Promise.all(
        images.map((img) => uploadImageForGeneration(img, _workflowIdForUpload))
      );
    }
    // Also upload base64 in dynamicInputs (fal models receive image via schema fields like image_url)
    uploadedDynamicInputs = await uploadDynamicInputsForGeneration(sanitizedDynamicInputs, _workflowIdForUpload);
  } catch (err) {
    console.error("Failed to upload images for generation:", err);
    updateNodeData(node.id, {
      status: "error",
      error: `Failed to upload input images: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
    throw err;
  }
  // === LIKELYFAD CUSTOM END ===

  const requestPayload = {
    // === LIKELYFAD CUSTOM: use uploaded image URLs instead of base64 ===
    images: uploadedImages,
    prompt: promptText,
    aspectRatio: nodeData.aspectRatio,
    resolution: nodeData.resolution,
    model: nodeData.model,
    useGoogleSearch: nodeData.useGoogleSearch,
    useImageSearch: nodeData.useImageSearch,
    selectedModel: nodeData.selectedModel,
    parameters: nodeData.parameters,
    dynamicInputs: uploadedDynamicInputs,
  };

  // Final guard: assert that prompt is a string before sending to API
  // This catches any remaining edge cases and provides a clear error message
  if (typeof requestPayload.prompt !== 'string') {
    const errorMsg = `Internal error: prompt is ${typeof requestPayload.prompt}, expected string`;
    console.error('[nanoBanana]', errorMsg);
    updateNodeData(node.id, { status: 'error', error: errorMsg });
    throw new Error(errorMsg);
  }

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload),
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

    if (result.success && result.image) {
      const timestamp = Date.now();
      const imageId = `${timestamp}`;

      // Save to global history
      addToGlobalHistory({
        image: result.image,
        timestamp,
        prompt: promptText,
        aspectRatio: nodeData.aspectRatio,
        model: nodeData.model,
      });

      // Add to node's carousel history
      const newHistoryItem = {
        id: imageId,
        timestamp,
        prompt: promptText,
        aspectRatio: nodeData.aspectRatio,
        model: nodeData.model,
      };
      const updatedHistory = [newHistoryItem, ...(nodeData.imageHistory || [])].slice(0, 50);

      updateNodeData(node.id, {
        outputImage: result.image,
        status: "complete",
        error: null,
        imageHistory: updatedHistory,
        selectedHistoryIndex: 0,
      });

      // Push new image to connected downstream outputGallery nodes (atomic append)
      const edges = getEdges();
      const nodes = getNodes();
      edges
        .filter((e) => e.source === node.id)
        .forEach((e) => {
          const target = nodes.find((n) => n.id === e.target);
          if (target?.type === "outputGallery") {
            appendOutputGalleryImage(target.id, result.image);
          }
        });

      // === LIKELYFAD CUSTOM START === (track cost + log event to 48h rolling table + diagnostics)
      {
        let costAmount = 0;
        let modelName: string | undefined;
        const sel = nodeData.selectedModel;
        console.log("[cost] nanoBanana generation complete", {
          nodeId: node.id,
          hasSelectedModel: !!sel,
          provider: sel?.provider,
          modelId: sel?.modelId,
          displayName: sel?.displayName,
          hasPricing: !!sel?.pricing,
          pricingAmount: sel?.pricing?.amount,
          legacyModel: nodeData.model,
        });
        if (sel?.pricing) {
          costAmount = sel.pricing.amount;
          modelName = sel.displayName || sel.modelId;
          addIncurredCost(costAmount);
        } else if (sel?.modelId) {
          // Fallback: look up pricing override directly by modelId. This catches
          // already-selected models whose cached metadata is missing pricing.
          const override = getPricingOverride(sel.modelId);
          if (override) {
            costAmount = override.amount;
            modelName = sel.displayName || sel.modelId;
            addIncurredCost(costAmount);
            console.log(`[cost] pricing from override for ${sel.modelId}: $${override.amount}`);
          } else if (!sel || sel.provider === "gemini") {
            costAmount = calculateGenerationCost(nodeData.model, nodeData.resolution);
            modelName = nodeData.model;
            addIncurredCost(costAmount);
          } else {
            console.warn(
              `[cost] NOT tracking cost for ${sel.provider}/${sel.modelId} — no pricing metadata and no override. Add to src/lib/likelyfad/pricing-overrides.ts`
            );
          }
        } else {
          costAmount = calculateGenerationCost(nodeData.model, nodeData.resolution);
          modelName = nodeData.model;
          addIncurredCost(costAmount);
        }
        if (costAmount > 0) {
          console.log(`[cost] +${costAmount} for ${modelName}, new total: ${useWorkflowStore.getState().incurredCost}`);
          logCostEvent({
            projectId: useWorkflowStore.getState().workflowId,
            nodeId: node.id,
            nodeType: "image",
            modelName,
            amount: costAmount,
          });
          // Force an immediate save so a refresh doesn't lose this cost (auto-save is 30s).
          void useWorkflowStore.getState().saveToFile().catch((err) => {
            console.warn("[cost] immediate save after cost update failed:", err);
          });
        }
      }
      // === LIKELYFAD CUSTOM END ===

      // Auto-save to generations folder if configured
      if (generationsPath) {
        const savePromise = fetch("/api/save-generation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directoryPath: generationsPath,
            image: result.image,
            prompt: promptText,
            imageId,
          }),
        })
          .then((res) => res.json())
          .then((saveResult) => {
            if (saveResult.success && saveResult.imageId && saveResult.imageId !== imageId) {
              const currentNode = getNodes().find((n) => n.id === node.id);
              if (currentNode) {
                const currentData = currentNode.data as NanoBananaNodeData;
                const histCopy = [...(currentData.imageHistory || [])];
                const entryIndex = histCopy.findIndex((h) => h.id === imageId);
                if (entryIndex !== -1) {
                  histCopy[entryIndex] = { ...histCopy[entryIndex], id: saveResult.imageId };
                  updateNodeData(node.id, { imageHistory: histCopy });
                }
              }
            }
          })
          .catch((err) => {
            console.error("Failed to save generation:", err);
          });

        trackSaveGeneration(imageId, savePromise);
      }
    } else {
      updateNodeData(node.id, {
        status: "error",
        error: result.error || "Generation failed",
      });
      throw new Error(result.error || "Generation failed");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    // Convert network errors to user-friendly messages
    let errorMessage = "Generation failed";
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
