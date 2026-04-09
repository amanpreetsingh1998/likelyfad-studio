/**
 * Generate3D Executor
 *
 * Executor for generate3d (3D model generation) nodes.
 * Extracted from nanoBananaExecutor's 3D handling code.
 */

import type { Generate3DNodeData } from "@/types";
import { buildGenerateHeaders } from "@/store/utils/buildApiHeaders";
import type { NodeExecutionContext } from "./types";
// === LIKELYFAD CUSTOM START ===
import { uploadImageForGeneration, uploadDynamicInputsForGeneration } from "@/lib/likelyfad/cloud-storage";
// === LIKELYFAD CUSTOM END ===

export interface Generate3DOptions {
  /** When true, falls back to stored inputImages/inputPrompt if no connections provide them. */
  useStoredFallback?: boolean;
}

export async function executeGenerate3D(
  ctx: NodeExecutionContext,
  options: Generate3DOptions = {}
): Promise<void> {
  const {
    node,
    getConnectedInputs,
    updateNodeData,
    getFreshNode,
    signal,
    providerSettings,
    addIncurredCost,
    generationsPath,
    trackSaveGeneration,
  } = ctx;

  const { useStoredFallback = false } = options;

  const { images: connectedImages, text: connectedText, dynamicInputs } = getConnectedInputs(node.id);

  // Get fresh node data from store
  const freshNode = getFreshNode(node.id);
  const nodeData = (freshNode?.data || node.data) as Generate3DNodeData;

  // Determine images and text (with optional fallback to stored values)
  let images: string[];
  let promptText: string | null;

  if (useStoredFallback) {
    images = connectedImages.length > 0 ? connectedImages : nodeData.inputImages;
    promptText = connectedText ?? nodeData.inputPrompt;
  } else {
    images = connectedImages;
    const promptFromDynamic = Array.isArray(dynamicInputs.prompt)
      ? dynamicInputs.prompt[0]
      : dynamicInputs.prompt;
    promptText = connectedText || promptFromDynamic || null;
  }

  // 3D models may work with just images (image-to-3d) or just text (text-to-3d)
  if (!promptText && images.length === 0) {
    updateNodeData(node.id, {
      status: "error",
      error: "Missing text or image input",
    });
    throw new Error("Missing text or image input");
  }

  updateNodeData(node.id, {
    inputImages: images,
    inputPrompt: promptText,
    status: "loading",
    error: null,
  });

  const provider = nodeData.selectedModel?.provider || "fal";
  const headers = buildGenerateHeaders(provider, providerSettings);

  // === LIKELYFAD CUSTOM START === (upload base64 images to Supabase Storage, pass URLs to avoid 4.5MB payload limit)
  let uploadedImages = images;
  let uploadedDynamicInputs = dynamicInputs;
  try {
    const { useWorkflowStore } = await import("@/store/workflowStore");
    const workflowId = useWorkflowStore.getState().workflowId || undefined;
    if (images.length > 0) {
      uploadedImages = await Promise.all(
        images.map((img) => uploadImageForGeneration(img, workflowId))
      );
    }
    uploadedDynamicInputs = await uploadDynamicInputsForGeneration(dynamicInputs, workflowId);
  } catch (err) {
    console.error("Failed to upload images for 3d generation:", err);
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
    prompt: promptText || "",
    selectedModel: nodeData.selectedModel,
    parameters: nodeData.parameters,
    dynamicInputs: uploadedDynamicInputs,
    mediaType: "3d" as const,
  };

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

    if (result.success && result.model3dUrl) {
      updateNodeData(node.id, {
        output3dUrl: result.model3dUrl,
        status: "complete",
        error: null,
      });

      // Track cost if applicable
      if (nodeData.selectedModel?.pricing) {
        addIncurredCost(nodeData.selectedModel.pricing.amount);
      }

      // Auto-save 3D model to generations folder if configured
      if (generationsPath) {
        const savePromise = fetch("/api/save-generation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directoryPath: generationsPath,
            model3d: result.model3dUrl,
            prompt: promptText,
          }),
        })
          .then((res) => res.json())
          .then((saveResult) => {
            if (saveResult.success && saveResult.filename) {
              updateNodeData(node.id, {
                savedFilename: saveResult.filename,
                savedFilePath: saveResult.filePath,
              });
            }
          })
          .catch((err) => {
            console.error("Failed to save 3D model:", err);
          });

        trackSaveGeneration(`3d-${Date.now()}`, savePromise);
      }
    } else {
      updateNodeData(node.id, {
        status: "error",
        error: result.error || "3D generation failed",
      });
      throw new Error(result.error || "3D generation failed");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    let errorMessage = "3D generation failed";
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
