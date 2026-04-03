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
      .select("id, name, workflow_json, edge_style, node_count, updated_at")
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

    // Get media storage paths before deleting
    const { data: mediaRows } = await supabase
      .from("media")
      .select("storage_path")
      .eq("project_id", id);

    // Delete storage files
    if (mediaRows && mediaRows.length > 0) {
      const paths = mediaRows.map((r) => r.storage_path);
      await supabase.storage.from("project-media").remove(paths);
    }

    // Delete project (cascades to media table)
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
