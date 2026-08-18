// === LIKELYFAD CUSTOM === (cloud templates API — list + create)
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/likelyfad/supabase";

// GET /api/likelyfad/templates — list all templates
export async function GET() {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("templates")
      .select("id, name, description, category, tags, node_count, thumbnail_url, hover_url, models, estimated_cost, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ templates: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST /api/likelyfad/templates — create a new template
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      description,
      category,
      tags,
      node_count,
      thumbnail_url,
      hover_url,
      models,
      estimated_cost,
      workflow_json,
    } = body;

    if (!name || !workflow_json) {
      return NextResponse.json(
        { error: "name and workflow_json are required" },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("templates")
      .insert({
        name,
        description: description ?? "",
        category: category ?? "simple",
        tags: tags ?? [],
        node_count: node_count ?? 0,
        thumbnail_url: thumbnail_url ?? null,
        hover_url: hover_url ?? null,
        models: models ?? [],
        estimated_cost: estimated_cost ?? 0,
        workflow_json,
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
