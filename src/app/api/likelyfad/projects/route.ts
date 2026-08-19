import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";

// GET /api/likelyfad/projects — list all projects
export async function GET() {
  try {
    const auth = await getAuthedContext();
    if (!auth) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const { supabase } = auth;

    // RLS restricts this to the caller's own rows.
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, node_count, updated_at, created_at")
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ projects: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST /api/likelyfad/projects — upsert a project
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, workflow_json, edge_style, node_count } = body;

    if (!id || !name) {
      return NextResponse.json(
        { error: "id and name are required" },
        { status: 400 }
      );
    }

    const auth = await getAuthedContext();
    if (!auth) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const { supabase, user } = auth;

    const { error } = await supabase.from("projects").upsert(
      {
        id,
        name,
        workflow_json: workflow_json ?? {},
        edge_style: edge_style ?? "angular",
        node_count: node_count ?? 0,
        user_id: user.id,
      },
      { onConflict: "id" }
    );

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
