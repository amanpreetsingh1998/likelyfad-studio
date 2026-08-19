// === LIKELYFAD CUSTOM START === (cost events — 48h rolling log per project)
import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";

// POST /api/likelyfad/cost-events
// Body: { projectId, nodeId?, nodeType?, modelName?, amount }
// Inserts an event and trims anything older than 48h for this project.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, nodeId, nodeType, modelName, amount } = body ?? {};

    if (!projectId || typeof amount !== "number" || !isFinite(amount)) {
      return NextResponse.json(
        { error: "projectId and numeric amount are required" },
        { status: 400 }
      );
    }

    const auth = await getAuthedContext();
    if (!auth) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const { supabase, user } = auth;

    // Insert the new event
    const { error: insertErr } = await supabase.from("cost_events").insert({
      project_id: projectId,
      user_id: user.id,
      node_id: nodeId ?? null,
      node_type: nodeType ?? null,
      model_name: modelName ?? null,
      amount,
    });

    if (insertErr) {
      console.warn("[cost-events] insert failed:", insertErr.message);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // Cleanup: delete anything older than 48h for THIS project only.
    // Cheap because of the (project_id, created_at desc) index.
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { error: cleanupErr } = await supabase
      .from("cost_events")
      .delete()
      .eq("project_id", projectId)
      .lt("created_at", cutoff);

    if (cleanupErr) {
      // Non-fatal — the insert already succeeded.
      console.warn("[cost-events] cleanup failed:", cleanupErr.message);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// GET /api/likelyfad/cost-events?projectId=xxx
// Returns all events for this project from the last 48h, newest first.
export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const auth = await getAuthedContext();
    if (!auth) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const { supabase } = auth;

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("cost_events")
      .select("id, node_id, node_type, model_name, amount, created_at")
      .eq("project_id", projectId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
// === LIKELYFAD CUSTOM END ===
