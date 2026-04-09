/**
 * Async fal.ai queue driver — Likelyfad Studio
 *
 * Vercel serverless functions have a 60s default timeout (Hobby plan).
 * Long-running fal jobs (Kling Video v2.6, etc.) take 5-10 minutes,
 * which kills the function mid-poll and loses the result.
 *
 * This route splits the fal queue lifecycle into three browser-driven calls:
 *   1. action=submit       → submits the job, returns request id + URLs (< 5s)
 *   2. action=poll         → checks status (< 2s)
 *   3. action=fetch-result → fetches the completed result (< 30s)
 *
 * The browser polls action=poll every few seconds until COMPLETED, then
 * calls action=fetch-result. Each call finishes well under any timeout.
 *
 * The fal API key never leaves the server — the browser only sees the
 * status/response URLs (which already require the key to access).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  submitToFalQueue,
  pollFalQueueStatus,
  fetchFalQueueResult,
} from "@/app/api/generate/providers/fal";
import type { GenerationInput, ModelCapability } from "@/lib/providers/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SubmitBody {
  action: "submit";
  modelId: string;
  modelName: string;
  capabilities?: string[];
  prompt?: string;
  images?: string[];
  parameters?: Record<string, unknown>;
  dynamicInputs?: Record<string, string | string[]>;
}

interface PollBody {
  action: "poll";
  statusUrl: string;
}

interface FetchResultBody {
  action: "fetch-result";
  responseUrl: string;
  modelName: string;
  capabilities: string[];
}

type Body = SubmitBody | PollBody | FetchResultBody;

function getApiKey(request: NextRequest): string | null {
  return request.headers.get("X-Fal-API-Key") || process.env.FAL_API_KEY || null;
}

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.action) {
    return NextResponse.json({ success: false, error: "Missing action" }, { status: 400 });
  }

  const apiKey = getApiKey(request);

  try {
    if (body.action === "submit") {
      if (!body.modelId || !body.modelName) {
        return NextResponse.json(
          { success: false, error: "modelId and modelName are required" },
          { status: 400 }
        );
      }

      // Filter empty values from dynamicInputs the same way /api/generate does
      let processedDynamicInputs: Record<string, string | string[]> | undefined;
      if (body.dynamicInputs) {
        processedDynamicInputs = {};
        for (const [k, v] of Object.entries(body.dynamicInputs)) {
          if (v === null || v === undefined || v === "") continue;
          processedDynamicInputs[k] = v;
        }
      }

      const genInput: GenerationInput = {
        model: {
          id: body.modelId,
          name: body.modelName,
          provider: "fal",
          capabilities: (body.capabilities as ModelCapability[]) || ["text-to-video"],
          description: null,
        },
        prompt: body.prompt || "",
        images: body.images ? [...body.images] : [],
        parameters: body.parameters,
        dynamicInputs: processedDynamicInputs,
      };

      const result = await submitToFalQueue(requestId, apiKey, genInput);
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        falRequestId: result.falRequestId,
        statusUrl: result.statusUrl,
        responseUrl: result.responseUrl,
      });
    }

    if (body.action === "poll") {
      if (!body.statusUrl) {
        return NextResponse.json({ success: false, error: "statusUrl required" }, { status: 400 });
      }
      const result = await pollFalQueueStatus(body.statusUrl, apiKey);
      if (!result.ok) {
        return NextResponse.json({ success: false, error: result.error }, { status: 500 });
      }
      return NextResponse.json({ success: true, status: result.status });
    }

    if (body.action === "fetch-result") {
      if (!body.responseUrl || !body.modelName) {
        return NextResponse.json(
          { success: false, error: "responseUrl and modelName required" },
          { status: 400 }
        );
      }
      const result = await fetchFalQueueResult(
        requestId,
        apiKey,
        body.responseUrl,
        body.modelName,
        body.capabilities || []
      );
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 500 });
      }
      const output = result.outputs?.[0];
      if (!output) {
        return NextResponse.json(
          { success: false, error: "No output in fal result" },
          { status: 500 }
        );
      }

      // Return shape mirrors /api/generate's buildMediaResponse so the
      // executor can handle the response identically.
      if (output.type === "3d") {
        return NextResponse.json({ success: true, model3dUrl: output.url, contentType: "3d" });
      }
      if (output.type === "video") {
        const isLarge = !output.data && output.url;
        return NextResponse.json({
          success: true,
          video: isLarge ? undefined : output.data,
          videoUrl: isLarge ? output.url : undefined,
          contentType: "video",
        });
      }
      if (output.type === "audio") {
        const isLarge = !output.data && output.url;
        return NextResponse.json({
          success: true,
          audio: isLarge ? undefined : output.data,
          audioUrl: isLarge ? output.url : undefined,
          contentType: "audio",
        });
      }
      return NextResponse.json({ success: true, image: output.data, contentType: "image" });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[fal-async:${requestId}] ${body.action} failed:`, err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
