/**
 * GenerateVideo Executor
 *
 * Unified executor for generateVideo nodes.
 * Used by both executeWorkflow and regenerateNode.
 */

import type { GenerateVideoNodeData } from "@/types";
import { buildGenerateHeaders } from "@/store/utils/buildApiHeaders";
import type { NodeExecutionContext } from "./types";
// === LIKELYFAD CUSTOM START ===
import { uploadImageForGeneration, uploadDynamicInputsForGeneration } from "@/lib/likelyfad/cloud-storage";
// === LIKELYFAD CUSTOM END ===

export interface GenerateVideoOptions {
  /** When true, falls back to stored inputImages/inputPrompt if no connections provide them. */
  useStoredFallback?: boolean;
}

export async function executeGenerateVideo(
  ctx: NodeExecutionContext,
  options: GenerateVideoOptions = {}
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
    getNodes,
    trackSaveGeneration,
  } = ctx;

  const { useStoredFallback = false } = options;

  const { images: connectedImages, text: connectedText, audio: connectedAudio, dynamicInputs } = getConnectedInputs(node.id);

  // Get fresh node data from store
  const freshNode = getFreshNode(node.id);
  const nodeData = (freshNode?.data || node.data) as GenerateVideoNodeData;

  // Determine images and text
  let images: string[];
  let text: string | null;

  if (useStoredFallback) {
    images = connectedImages.length > 0 ? connectedImages : nodeData.inputImages;
    text = connectedText ?? nodeData.inputPrompt;
    // Validate fallback inputs the same way as the regular path
    const hasPrompt = text || dynamicInputs.prompt || dynamicInputs.negative_prompt;
    const hasAudio = connectedAudio.length > 0;
    if (!hasPrompt && images.length === 0 && !hasAudio) {
      updateNodeData(node.id, {
        status: "error",
        error: "Missing required inputs",
      });
      throw new Error("Missing required inputs");
    }
  } else {
    images = connectedImages;
    text = connectedText;
    // For dynamic inputs, check if we have at least a prompt, images, or audio
    const hasPrompt = text || dynamicInputs.prompt || dynamicInputs.negative_prompt;
    const hasAudio = connectedAudio.length > 0;
    if (!hasPrompt && images.length === 0 && !hasAudio) {
      updateNodeData(node.id, {
        status: "error",
        error: "Missing required inputs",
      });
      throw new Error("Missing required inputs");
    }
  }

  if (!nodeData.selectedModel?.modelId) {
    updateNodeData(node.id, {
      status: "error",
      error: "No model selected",
    });
    throw new Error("No model selected");
  }

  updateNodeData(node.id, {
    inputImages: images,
    inputPrompt: text,
    status: "loading",
    error: null,
  });

  const provider = nodeData.selectedModel.provider;
  const headers = buildGenerateHeaders(provider, providerSettings);

  // === LIKELYFAD CUSTOM START === (upload base64 images to Supabase Storage, pass URLs to avoid 4.5MB payload limit)
  const { useWorkflowStore } = await import("@/store/workflowStore");
  const workflowId = useWorkflowStore.getState().workflowId || undefined;

  let uploadedImages = images;
  let uploadedDynamicInputs = dynamicInputs;
  try {
    if (images.length > 0) {
      uploadedImages = await Promise.all(
        images.map((img) => uploadImageForGeneration(img, workflowId))
      );
    }
    // Also upload base64 in dynamicInputs (Kling/fal video models receive image via dynamic schema fields like image_url)
    uploadedDynamicInputs = await uploadDynamicInputsForGeneration(dynamicInputs, workflowId);
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
    prompt: text,
    selectedModel: nodeData.selectedModel,
    parameters: nodeData.parameters,
    dynamicInputs: uploadedDynamicInputs,
    mediaType: "video" as const,
  };

  // === LIKELYFAD CUSTOM START === (route fal video through async submit→poll→fetch endpoint to bypass Vercel 60s function timeout for long jobs like Kling Video v2.6)
  const useFalAsync = provider === "fal";
  // === LIKELYFAD CUSTOM END ===

  try {
    // === LIKELYFAD CUSTOM START === (async fal video path)
    let response: Response;
    if (useFalAsync) {
      response = await runFalAsyncVideo({
        headers,
        signal,
        modelId: nodeData.selectedModel.modelId,
        modelName: nodeData.selectedModel.displayName || nodeData.selectedModel.modelId,
        capabilities: ["text-to-video"],
        prompt: text || "",
        images: uploadedImages,
        parameters: nodeData.parameters,
        dynamicInputs: uploadedDynamicInputs,
      });
    } else {
      response = await fetch("/api/generate", {
        method: "POST",
        headers,
        body: JSON.stringify(requestPayload),
        ...(signal ? { signal } : {}),
      });
    }
    // === LIKELYFAD CUSTOM END ===

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

    // Handle video response (video or videoUrl field)
    const videoData = result.video || result.videoUrl;
    if (result.success && (videoData || result.image)) {
      const outputContent = videoData || result.image;
      const timestamp = Date.now();
      const videoId = `${timestamp}`;

      // Add to node's video history
      const newHistoryItem = {
        id: videoId,
        timestamp,
        prompt: text || "",
        model: nodeData.selectedModel?.modelId || "",
      };
      const updatedHistory = [newHistoryItem, ...(nodeData.videoHistory || [])].slice(0, 50);

      updateNodeData(node.id, {
        outputVideo: outputContent,
        status: "complete",
        error: null,
        videoHistory: updatedHistory,
        selectedVideoHistoryIndex: 0,
      });

      // === LIKELYFAD CUSTOM START === (track cost + log 48h event + diagnostics for video)
      {
        const sel = nodeData.selectedModel;
        console.log("[cost] video generation complete", {
          nodeId: node.id,
          provider: sel?.provider,
          modelId: sel?.modelId,
          hasPricing: !!sel?.pricing,
          pricingAmount: sel?.pricing?.amount,
        });
        if (sel?.pricing) {
          const costAmount = sel.pricing.amount;
          addIncurredCost(costAmount);
          const { logCostEvent } = await import("@/lib/likelyfad/costEvents");
          const { useWorkflowStore } = await import("@/store/workflowStore");
          console.log(`[cost] +${costAmount} for video ${sel.displayName || sel.modelId}`);
          logCostEvent({
            projectId: useWorkflowStore.getState().workflowId,
            nodeId: node.id,
            nodeType: "video",
            modelName: sel.displayName || sel.modelId,
            amount: costAmount,
          });
          void useWorkflowStore.getState().saveToFile().catch(() => {});
        } else {
          console.warn(`[cost] NOT tracking video cost for ${sel?.provider}/${sel?.modelId} — no pricing`);
        }
      }
      // === LIKELYFAD CUSTOM END ===

      // Auto-save to generations folder if configured
      if (generationsPath) {
        const saveContent = videoData
          ? { video: videoData }
          : { image: result.image };

        const savePromise = fetch("/api/save-generation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directoryPath: generationsPath,
            ...saveContent,
            prompt: text,
            imageId: videoId,
          }),
        })
          .then((res) => res.json())
          .then((saveResult) => {
            if (saveResult.success && saveResult.imageId && saveResult.imageId !== videoId) {
              const currentNode = getNodes().find((n) => n.id === node.id);
              if (currentNode) {
                const currentData = currentNode.data as GenerateVideoNodeData;
                const histCopy = [...(currentData.videoHistory || [])];
                const entryIndex = histCopy.findIndex((h) => h.id === videoId);
                if (entryIndex !== -1) {
                  histCopy[entryIndex] = { ...histCopy[entryIndex], id: saveResult.imageId };
                  updateNodeData(node.id, { videoHistory: histCopy });
                }
              }
            }
          })
          .catch((err) => {
            console.error("Failed to save video generation:", err);
          });

        trackSaveGeneration(videoId, savePromise);
      }
    } else {
      updateNodeData(node.id, {
        status: "error",
        error: result.error || "Video generation failed",
      });
      throw new Error(result.error || "Video generation failed");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    let errorMessage = "Video generation failed";
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

// === LIKELYFAD CUSTOM START === (browser-driven async fal queue runner — bypasses Vercel function timeout for long video jobs)
interface RunFalAsyncVideoArgs {
  headers: Record<string, string>;
  signal?: AbortSignal;
  modelId: string;
  modelName: string;
  capabilities: string[];
  prompt: string;
  images: string[];
  parameters?: Record<string, unknown>;
  dynamicInputs?: Record<string, string | string[]>;
}

/**
 * Drives the fal queue from the browser via three short calls to /api/likelyfad/fal-async.
 * Returns a synthetic Response so callers can `await response.json()` like a normal fetch.
 *
 * Polling interval starts at 2s and stays there — fal jobs take seconds to minutes,
 * and the cost of an extra poll is negligible vs. user-perceived latency on completion.
 */
async function runFalAsyncVideo(args: RunFalAsyncVideoArgs): Promise<Response> {
  const { headers, signal, modelId, modelName, capabilities, prompt, images, parameters, dynamicInputs } = args;

  const post = async (body: Record<string, unknown>): Promise<Response> => {
    return fetch("/api/likelyfad/fal-async", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  };

  // 1. Submit
  const submitRes = await post({
    action: "submit",
    modelId,
    modelName,
    capabilities,
    prompt,
    images,
    parameters,
    dynamicInputs,
  });
  if (!submitRes.ok) {
    return submitRes;
  }
  const submitJson = await submitRes.json();
  if (!submitJson.success) {
    return new Response(JSON.stringify(submitJson), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const { statusUrl, responseUrl } = submitJson;
  console.log(`[fal-async] submitted → request id ${submitJson.falRequestId}`);

  // 2. Poll until COMPLETED or FAILED. Hard cap at 15 minutes.
  const startTime = Date.now();
  const maxWait = 15 * 60 * 1000;
  const pollInterval = 2000;
  let lastStatus = "";

  while (true) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (Date.now() - startTime > maxWait) {
      const body = { success: false, error: `${modelName}: timed out after 15 minutes` };
      return new Response(JSON.stringify(body), { status: 504, headers: { "Content-Type": "application/json" } });
    }
    await new Promise((r) => setTimeout(r, pollInterval));

    const pollRes = await post({ action: "poll", statusUrl });
    if (!pollRes.ok) {
      // Transient poll error — log and keep trying
      console.warn(`[fal-async] poll HTTP ${pollRes.status}, retrying`);
      continue;
    }
    const pollJson = await pollRes.json();
    if (!pollJson.success) {
      console.warn(`[fal-async] poll error: ${pollJson.error}, retrying`);
      continue;
    }
    if (pollJson.status !== lastStatus) {
      console.log(`[fal-async] status: ${pollJson.status}`);
      lastStatus = pollJson.status;
    }
    if (pollJson.status === "COMPLETED") break;
    if (pollJson.status === "FAILED") {
      const body = { success: false, error: `${modelName}: generation failed` };
      return new Response(JSON.stringify(body), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // 3. Fetch result
  const resultRes = await post({
    action: "fetch-result",
    responseUrl,
    modelName,
    capabilities,
  });
  return resultRes;
}
// === LIKELYFAD CUSTOM END ===
