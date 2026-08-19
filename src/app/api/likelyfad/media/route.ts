import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { mediaObjectPath } from "@/lib/likelyfad/storagePaths";

const MEDIA_BUCKET = "project-media";

// POST /api/likelyfad/media — upload media to Supabase Storage
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, mediaId, imageData, folder } = body;

    if (!projectId || !mediaId || !imageData) {
      return NextResponse.json(
        { error: "projectId, mediaId, and imageData are required" },
        { status: 400 }
      );
    }

    // Parse data URL
    const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json(
        { error: "Invalid base64 data URL" },
        { status: 400 }
      );
    }

    const mimeType = match[1];
    const rawBase64 = match[2];
    const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const mediaFolder = folder || "inputs";
    const auth = await getAuthedContext();
    if (!auth) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const { supabase, user } = auth;

    const storagePath = mediaObjectPath(user.id, projectId, mediaFolder, mediaId, ext);

    // Decode base64
    const binary = Buffer.from(rawBase64, "base64");

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, binary, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Upsert metadata
    await supabase.from("media").upsert(
      {
        id: `${projectId}/${mediaFolder}/${mediaId}`,
        project_id: projectId,
        user_id: user.id,
        storage_path: storagePath,
        mime_type: mimeType,
        size_bytes: binary.length,
      },
      { onConflict: "id" }
    );

    return NextResponse.json({ success: true, mediaId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// GET /api/likelyfad/media?projectId=...&mediaId=...&type=image
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const mediaId = searchParams.get("mediaId");
    const mediaType = searchParams.get("type") || "image";

    if (!projectId || !mediaId) {
      return NextResponse.json(
        { error: "projectId and mediaId are required" },
        { status: 400 }
      );
    }

    const auth = await getAuthedContext();
    if (!auth) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const { supabase, user } = auth;

    const folders = ["generations", "inputs"];
    const extensions =
      mediaType === "image"
        ? ["png", "jpg", "jpeg", "webp"]
        : mediaType === "video"
          ? ["mp4", "webm"]
          : ["mp3", "wav", "ogg", "m4a"];

    for (const folder of folders) {
      for (const ext of extensions) {
        const storagePath = mediaObjectPath(user.id, projectId, folder, mediaId, ext);
        const { data, error } = await supabase.storage
          .from(MEDIA_BUCKET)
          .download(storagePath);

        if (!error && data) {
          const buffer = Buffer.from(await data.arrayBuffer());
          const base64 = buffer.toString("base64");
          const mime =
            ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : `${mediaType}/${ext}`;
          return NextResponse.json({
            success: true,
            image: `data:${mime};base64,${base64}`,
          });
        }
      }
    }

    return NextResponse.json({ success: false, error: "Media not found" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
