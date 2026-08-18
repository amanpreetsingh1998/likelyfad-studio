import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/likelyfad/supabase";

// GET /api/likelyfad/projects/[id] — load a single project
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("projects")
      .select("id, name, workflow_json, edge_style, node_count, updated_at, incurred_cost")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ project: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// DELETE /api/likelyfad/projects/[id] — delete a project and its media
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getServiceClient();

    // Walk Storage by prefix — the media table is best-effort and may be empty
    // due to FK constraint failures during early saves. Storage is the source of truth.
    const folders = ["generations", "inputs", "generation-inputs"];
    const allPaths: string[] = [];
    for (const folder of folders) {
      const prefix = `default/${id}/${folder}`;
      const { data: files, error: listErr } = await supabase.storage
        .from("project-media")
        .list(prefix, { limit: 1000 });
      if (listErr) {
        console.warn(`[delete] list error on ${prefix}:`, listErr.message);
        continue;
      }
      for (const f of files ?? []) {
        allPaths.push(`${prefix}/${f.name}`);
      }
    }

    if (allPaths.length > 0) {
      const { error: removeErr } = await supabase.storage
        .from("project-media")
        .remove(allPaths);
      if (removeErr) {
        console.warn(`[delete] storage remove error:`, removeErr.message);
      }
    }

    // Delete media metadata rows (best-effort)
    await supabase.from("media").delete().eq("project_id", id);

    // Delete project row
    const { error } = await supabase.from("projects").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
