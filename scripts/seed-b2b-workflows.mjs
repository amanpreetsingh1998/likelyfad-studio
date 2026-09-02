#!/usr/bin/env node
/**
 * Seed six B2B SaaS workflows into `public.projects`.
 *
 * These are WORKFLOWS, not quickstart templates. The difference is not
 * cosmetic: a template is source code compiled into the bundle and only
 * becomes anything when a user picks it and saves; a project is a row the
 * account owns, which appears on /workflows, can be opened, run, and published
 * to every signed-in user. This script writes the second kind.
 *
 * TWO MODES
 *
 *   node scripts/seed-b2b-workflows.mjs           → writes the SQL file
 *   node scripts/seed-b2b-workflows.mjs --apply   → writes the rows directly
 *
 * The SQL path is the one that needs nothing but the Supabase dashboard, and
 * it is what to reach for by default. `--apply` needs NEXT_PUBLIC_SUPABASE_URL
 * and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *
 * WHAT THIS DELIBERATELY DOES NOT WRITE
 *
 * `est_credits`, `est_duration_ms`, `est_partial` and `models` are a cache the
 * server derives from the graph — 0013 §1 is explicit that they are never
 * accepted from a client, because anything that can write est_credits can
 * write its own price. This script is a client like any other, so it leaves
 * them at their defaults and lets `POST /api/workflows/[id]/estimate` fill
 * them in from the stored graph. The cards show no estimate until then, which
 * is the honest state rather than a number this script invented.
 *
 * OWNERSHIP IS RESOLVED, NOT HARD-CODED. The SQL takes the seat from the
 * `admins` table, the same single source `set_admin()` writes, so this cannot
 * silently seed workflows onto the wrong account or a stale email.
 *
 * RE-RUNNABLE. Every insert is `on conflict (id) do nothing`, and the ids are
 * fixed rather than timestamped, so running this twice adds nothing the second
 * time and never overwrites edits made to a seeded workflow on the canvas.
 */

import fs from "node:fs";
import path from "node:path";

// ─── Node factories ─────────────────────────────────────────────────
// Mirrors the defaults in createDefaultNodeData(). Kept literal rather than
// imported: this is a .mjs script and templates.ts is TypeScript behind an "@/"
// alias, so importing it would mean adding a transpile step to a script whose
// entire job is to emit a text file.

const DIM = {
  imageInput: { width: 300, height: 280 },
  prompt: { width: 320, height: 220 },
  llmGenerate: { width: 320, height: 360 },
  nanoBanana: { width: 300, height: 300 },
  output: { width: 320, height: 320 },
  outputGallery: { width: 420, height: 400 },
};

const imageInput = () => ({ image: null, filename: null, dimensions: null });

const prompt = (text = "") => ({ prompt: text });

const llm = () => ({
  inputPrompt: null,
  inputImages: [],
  outputText: null,
  provider: "google",
  model: "gemini-3-flash-preview",
  temperature: 0.7,
  maxTokens: 8192,
  status: "idle",
  error: null,
});

const gen = (aspectRatio = "1:1") => ({
  inputImages: [],
  inputPrompt: null,
  outputImage: null,
  aspectRatio,
  resolution: "1K",
  model: "nano-banana-pro",
  useGoogleSearch: false,
  useImageSearch: false,
  status: "idle",
  error: null,
  imageHistory: [],
  selectedHistoryIndex: 0,
});

const output = () => ({ image: null });
const gallery = () => ({ images: [], videos: [] });

const node = (id, type, x, y, data) => ({
  id,
  type,
  position: { x, y },
  data,
  style: DIM[type],
});

const edge = (source, sourceHandle, target, targetHandle) => ({
  id: `edge-${source}-${target}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

// ─── The six workflows ──────────────────────────────────────────────
//
// Why these six and not six more product shots: the studio's existing presets
// all start from a photograph of an object. A SaaS company has no object — the
// product is a screen — so its marketing images are generated from a brief.
// That is why most of these route the brief through an LLM node first: "we
// shipped scheduled reports, it saves ops teams a Monday morning" is not an
// image prompt, and converting it is the step people get wrong by hand.
//
// The two that take an image take the customer's own screenshot or headshot,
// and neither ships a sample. In the mockup workflow the whole task is getting
// THEIR pixels through the model unaltered, and a stock screenshot standing in
// for it would teach the opposite.

const WORKFLOWS = [
  {
    id: "wf_seed_feature_launch_graphic",
    name: "Feature Launch Graphic",
    description:
      "Turn a release note into an announcement image for the changelog, the in-app what's-new and the social post. Write what shipped, who it is for and the one thing it saves them; the LLM node turns that into art direction and the generator renders it at 16:9.",
    nodes: [
      node("prompt-1", "prompt", 50, 200, prompt(
        "Art-direct a launch graphic for a B2B SaaS feature announcement.\n\n" +
        "What shipped: scheduled reports — any dashboard can now email itself to a list on a recurring schedule.\n" +
        "Who it is for: ops and finance leads who currently rebuild the same export every Monday.\n" +
        "The one thing it saves them: a standing weekly meeting's worth of manual work.\n\n" +
        "Write a single image prompt. Hold to these:\n" +
        "- An abstract product-marketing illustration, not a screenshot and not a photo\n" +
        "- No text, no logos, no UI chrome — the headline is set in the CMS later\n" +
        "- One focal idea: something recurring and unattended, resolving on its own\n" +
        "- Flat vector shapes, soft gradients, generous empty space on the right for a headline\n" +
        "- Deep indigo and a warm amber accent on off-white, nothing else\n" +
        "- Read it at thumbnail size before you commit to it"
      )),
      node("llmGenerate-1", "llmGenerate", 430, 130, llm()),
      // 16:9 — a changelog header and an X card are both wide.
      node("nanoBanana-1", "nanoBanana", 810, 160, gen("16:9")),
      node("output-1", "output", 1190, 150, output()),
    ],
    edges: [
      edge("prompt-1", "text", "llmGenerate-1", "text"),
      edge("llmGenerate-1", "text", "nanoBanana-1", "text"),
      edge("nanoBanana-1", "image", "output-1", "image"),
    ],
  },

  {
    id: "wf_seed_screenshot_mockup",
    name: "Product Screenshot Mockup",
    description:
      "Drop a product screenshot into a clean browser frame on a branded backdrop, for a pricing page or a launch post. Upload your own screenshot — the prompt is written to stop the model redrawing or inventing any part of your interface.",
    nodes: [
      // The customer's own screenshot. Intentionally empty: no sample could
      // stand in for it, because the task is preserving THEIR pixels.
      node("imageInput-1", "imageInput", 50, 100, imageInput()),
      node("prompt-1", "prompt", 50, 430, prompt(
        "Place the attached product screenshot inside a clean browser window on a branded backdrop, for the top of a pricing page.\n\n" +
        "The screenshot is evidence, not raw material:\n" +
        "- Reproduce it exactly. Do not redraw, restyle, retype or invent any part of the interface\n" +
        "- Every label in it must stay legible and unchanged\n" +
        "- Do not add UI the screenshot does not contain\n\n" +
        "Around it:\n" +
        "- Minimal light browser chrome, rounded corners, no visible URL text\n" +
        "- Three-quarter perspective, tilted a few degrees, soft long shadow beneath\n" +
        "- Backdrop: a quiet indigo-to-slate gradient, no pattern competing with the screen\n" +
        "- Leave a wide empty margin on all sides so the image survives a 16:9 and a 1:1 crop"
      )),
      node("nanoBanana-1", "nanoBanana", 450, 200, gen("16:9")),
      node("output-1", "output", 850, 190, output()),
    ],
    edges: [
      edge("imageInput-1", "image", "nanoBanana-1", "image"),
      edge("prompt-1", "text", "nanoBanana-1", "text"),
      edge("nanoBanana-1", "image", "output-1", "image"),
    ],
  },

  {
    id: "wf_seed_blog_header_set",
    name: "Blog Header, Three Formats",
    description:
      "One article brief, three headers: a 16:9 blog hero, a 1:1 feed card and a 4:5 LinkedIn card. The three differ only in aspect ratio, because the placement is the ratio — re-briefing per size gives three unrelated images instead of one asset in three crops.",
    nodes: [
      node("prompt-1", "prompt", 50, 330, prompt(
        "Art-direct the header image for a B2B SaaS article.\n\n" +
        "Working title: \"Your onboarding is a migration problem, not a UX problem\"\n" +
        "The argument the piece makes: teams blame their signup flow for weak activation when the real blocker is getting existing data out of the tool they already use.\n" +
        "Who should recognise themselves in it: heads of growth at Series A/B companies who have redesigned onboarding twice and not moved the number.\n\n" +
        "Write one image prompt that will be rendered at three sizes — a 16:9 blog hero, a 1:1 social card and a 4:5 portrait card. So:\n" +
        "- Compose it centrally, with nothing important near an edge\n" +
        "- One subject, not a scene: something heavy being moved between two places, rendered abstractly\n" +
        "- No text and no logos; every placement sets its own headline\n" +
        "- Editorial illustration, flat shapes, muted teal and clay on warm off-white\n" +
        "- Check it reads at 200px wide before you commit to it"
      )),
      node("llmGenerate-1", "llmGenerate", 430, 260, llm()),
      node("nanoBanana-1", "nanoBanana", 810, 60, gen("16:9")),
      node("nanoBanana-2", "nanoBanana", 810, 400, gen("1:1")),
      node("nanoBanana-3", "nanoBanana", 810, 740, gen("4:5")),
      node("outputGallery-1", "outputGallery", 1210, 340, gallery()),
    ],
    edges: [
      edge("prompt-1", "text", "llmGenerate-1", "text"),
      edge("llmGenerate-1", "text", "nanoBanana-1", "text"),
      edge("llmGenerate-1", "text", "nanoBanana-2", "text"),
      edge("llmGenerate-1", "text", "nanoBanana-3", "text"),
      edge("nanoBanana-1", "image", "outputGallery-1", "image"),
      edge("nanoBanana-2", "image", "outputGallery-1", "image"),
      edge("nanoBanana-3", "image", "outputGallery-1", "image"),
    ],
  },

  {
    id: "wf_seed_customer_story_card",
    name: "Customer Story Card",
    description:
      "Turn a customer quote into a testimonial card for the site and socials. The quote is set as live text afterwards, so the workflow renders the backdrop and treatment only — upload the customer's headshot and it is composited in at lower right.",
    nodes: [
      node("prompt-1", "prompt", 50, 130, prompt(
        "Art-direct a testimonial card built around one customer quote.\n\n" +
        "Quote: \"We closed the quarter four days early. The reconciliation just wasn't a task any more.\"\n" +
        "Said by: a VP of Finance at a 400-person logistics company.\n" +
        "The result it points at: month-end close went from nine days to five.\n\n" +
        "Write one image prompt for the card's backdrop and treatment. Hold to these:\n" +
        "- The quote is set as live text later — do NOT render any words in the image\n" +
        "- Leave the left two thirds quiet and uncluttered for that text\n" +
        "- The attached headshot sits at lower right; keep that corner clear and lit to match\n" +
        "- A calm, credible backdrop: soft depth, a suggestion of an office interior thrown far out of focus\n" +
        "- Deep green accent against warm grey, nothing brighter than the headshot"
      )),
      // Wired straight to the generator rather than through the LLM: the
      // headshot is the one part of this card that must survive as itself.
      node("imageInput-1", "imageInput", 50, 420, imageInput()),
      node("llmGenerate-1", "llmGenerate", 430, 60, llm()),
      node("nanoBanana-1", "nanoBanana", 810, 250, gen("1:1")),
      node("output-1", "output", 1190, 240, output()),
    ],
    edges: [
      edge("prompt-1", "text", "llmGenerate-1", "text"),
      edge("llmGenerate-1", "text", "nanoBanana-1", "text"),
      edge("imageInput-1", "image", "nanoBanana-1", "image"),
      edge("nanoBanana-1", "image", "output-1", "image"),
    ],
  },

  {
    id: "wf_seed_integration_diagram",
    name: "Integration Diagram",
    description:
      "Illustrate where your product sits between the tools a team already runs — what flows in, what flows out, and the job it does in the middle. Renders an abstract diagram with empty label positions, so real logos and words are placed over it afterwards.",
    nodes: [
      node("prompt-1", "prompt", 50, 200, prompt(
        "Art-direct an illustration of where this product sits between the tools a team already runs.\n\n" +
        "The product: a revenue data layer.\n" +
        "What flows in, and from where: raw events from the CRM, the billing system and the product database.\n" +
        "What flows out, and to where: one agreed set of numbers, into the BI tool and the finance team's spreadsheets.\n" +
        "The job it does in the middle: settles which number is the real one before anybody argues about it.\n\n" +
        "Write one image prompt. Hold to these:\n" +
        "- Abstract and diagrammatic, not a real architecture diagram and not a screenshot\n" +
        "- No text, no logos, no third-party brand marks — those are placed as real assets later\n" +
        "- Three inputs converging left, one clean output leaving right; the convergence is the whole idea\n" +
        "- Flat shapes, isometric hint, a single saturated accent for the centre against cool greys\n" +
        "- Leave six empty label positions — three left, one centre, two right"
      )),
      node("llmGenerate-1", "llmGenerate", 430, 130, llm()),
      node("nanoBanana-1", "nanoBanana", 810, 160, gen("16:9")),
      node("output-1", "output", 1190, 150, output()),
    ],
    edges: [
      edge("prompt-1", "text", "llmGenerate-1", "text"),
      edge("llmGenerate-1", "text", "nanoBanana-1", "text"),
      edge("nanoBanana-1", "image", "output-1", "image"),
    ],
  },

  {
    id: "wf_seed_ad_creative_set",
    name: "Ad Creative Set",
    description:
      "One offer, three angles — pain, outcome and proof — rendered at 4:5 for a paid social test. Three separate prompts rather than one brief fanned out: three samples of a single prompt vary by seed and test the model, not the message.",
    nodes: [
      node("prompt-1", "prompt", 50, 60, prompt(
        "ANGLE 1 — the pain.\n\n" +
        "For a paid social test for an incident-response tool sold to platform teams.\n\n" +
        "An abstract illustration of a night-time escalation: too many alerts arriving at once, nobody sure which one matters. Tense, congested, effortful — conveyed through composition and colour, never through a face. No text, no logos, no UI, no fake dashboards. Flat vector with soft gradients, alarm red against deep slate. 4:5 feed card, lower third left empty for a headline."
      )),
      node("prompt-2", "prompt", 50, 400, prompt(
        "ANGLE 2 — the outcome.\n\n" +
        "Same product, sold on the after rather than the before.\n\n" +
        "An abstract illustration of one clear signal where the noise used to be: a single resolved path, everything else quiet. Open, unhurried, a night that stayed uneventful. No text, no logos, no UI, no fake dashboards. Same flat vector rendering as the pain variant, same deep slate, with the red reduced to one small settled accent so the set reads as one campaign. 4:5, lower third empty."
      )),
      node("prompt-3", "prompt", 50, 740, prompt(
        "ANGLE 3 — the proof.\n\n" +
        "Same product, sold on evidence.\n\n" +
        "An abstract illustration of several on-call teams converging on one agreed timeline of what happened. Credible and quiet rather than energetic. No text, no logos, no UI, and no invented numbers, charts or metrics. Same flat vector rendering and palette as the other two variants. 4:5, lower third empty."
      )),
      // All 4:5: the placement is fixed and the message is the variable.
      node("nanoBanana-1", "nanoBanana", 450, 30, gen("4:5")),
      node("nanoBanana-2", "nanoBanana", 450, 370, gen("4:5")),
      node("nanoBanana-3", "nanoBanana", 450, 710, gen("4:5")),
      node("outputGallery-1", "outputGallery", 850, 340, gallery()),
    ],
    edges: [
      edge("prompt-1", "text", "nanoBanana-1", "text"),
      edge("prompt-2", "text", "nanoBanana-2", "text"),
      edge("prompt-3", "text", "nanoBanana-3", "text"),
      edge("nanoBanana-1", "image", "outputGallery-1", "image"),
      edge("nanoBanana-2", "image", "outputGallery-1", "image"),
      edge("nanoBanana-3", "image", "outputGallery-1", "image"),
    ],
  },
];

/** The WorkflowFile the canvas loads, exactly as saveWorkflow would store it. */
function workflowJson(w) {
  return {
    version: 1,
    id: w.id,
    name: w.name,
    // Cloud projects have no directory; the id rides in the sentinel so the
    // media helpers can find the project. Same string saveWorkflow builds.
    directoryPath: `cloud:${w.id}`,
    nodes: w.nodes,
    edges: w.edges,
    edgeStyle: "curved",
  };
}

/** Single-quote escaping for a SQL string literal. */
function sql(value) {
  return String(value).replace(/'/g, "''");
}

function buildSql() {
  const rows = WORKFLOWS.map((w) => {
    const json = JSON.stringify(workflowJson(w));
    return `  (
    '${sql(w.id)}',
    '${sql(w.name)}',
    '${sql(w.description)}',
    ${w.nodes.length},
    '${sql(json)}'::jsonb
  )`;
  }).join(",\n");

  return `-- ===========================================================================
-- b2b_workflows.sql — six ready-to-run workflows for a B2B SaaS team
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once: every row is 'on conflict do nothing', so a
-- second run adds nothing and never overwrites edits made on the canvas.
--
-- GENERATED by scripts/seed-b2b-workflows.mjs. Edit the script, not this file.
--
-- These are workflows, not quickstart templates. They land in public.projects
-- alongside the ones already there, so they appear on /workflows, can be
-- opened in the studio, run, and published to every signed-in user.
--
-- OWNERSHIP IS RESOLVED FROM THE admins TABLE, not hard-coded. That is the
-- single seat set_admin() writes, so this cannot seed onto a stale email or
-- the wrong account. It raises rather than guessing if no admin is seeded.
--
-- WHAT IS DELIBERATELY LEFT NULL: est_credits, est_duration_ms, est_partial
-- and models. 0013 section 1 is explicit that those are a server-derived cache
-- and never accepted from a client -- anything that can write est_credits can
-- write its own price. They fill in from the stored graph the first time each
-- workflow is saved or repriced, and until then the cards show no estimate,
-- which is the truth rather than a number this file invented.
-- ===========================================================================

begin;

do $seed$
declare
  v_owner uuid;
  v_count integer;
begin
  select user_id into v_owner from public.admins where id = 1;

  if v_owner is null then
    raise exception
      'No admin seeded. Run: select public.set_admin(''you@example.com'');';
  end if;

  insert into public.projects (
    id, user_id, name, description, node_count,
    workflow_json, edge_style, incurred_cost
  )
  select
    s.id, v_owner, s.name, s.description, s.node_count,
    s.workflow_json, 'curved', 0
  from (values
${rows}
  ) as s(id, name, description, node_count, workflow_json)
  on conflict (id) do nothing;

  get diagnostics v_count = row_count;
  raise notice 'Seeded % workflow(s) for owner %.', v_count, v_owner;
end
$seed$;

commit;

-- To make these runnable by every signed-in user, publish them -- either from
-- the toggle on each card at /workflows, or here:
--
--   update public.projects
--      set is_published = true, published_at = now()
--    where id like 'wf_seed_%';
`;
}

/** Service-role connection from .env.local. Shared by --apply and --verify. */
async function connection() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error("This mode needs .env.local with the Supabase service key");
  }
  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        // Values may be quoted in .env.local; strip one matching pair.
        const value = l
          .slice(i + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, "$2");
        return [l.slice(0, i).trim(), value];
      })
  );

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }

  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

async function apply() {
  const { url, headers } = await connection();

  // Resolve the seat rather than trusting an argument, same rule as the SQL.
  const adminRes = await fetch(`${url}/rest/v1/admins?select=user_id&id=eq.1`, {
    headers,
  });
  const admins = await adminRes.json();
  const owner = Array.isArray(admins) && admins[0]?.user_id;
  if (!owner) {
    throw new Error(
      "No admin seeded. Run: select public.set_admin('you@example.com');"
    );
  }

  const payload = WORKFLOWS.map((w) => ({
    id: w.id,
    user_id: owner,
    name: w.name,
    description: w.description,
    node_count: w.nodes.length,
    workflow_json: workflowJson(w),
    edge_style: "curved",
    incurred_cost: 0,
  }));

  const res = await fetch(`${url}/rest/v1/projects`, {
    method: "POST",
    // merge-duplicates would overwrite a workflow someone had edited. Ignore
    // is the only safe resolution for a seed that may be re-run.
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Insert failed (${res.status}): ${body.slice(0, 400)}`);
  }

  const inserted = JSON.parse(body || "[]");
  console.log(`Seeded ${inserted.length} workflow(s) for owner ${owner}.`);
  for (const row of inserted) console.log(`  ${row.id}  ${row.name}`);
  if (inserted.length === 0) {
    console.log("  (nothing new — all six ids already exist)");
  }
}

/**
 * Read the seeded rows back and check the graph survived the round trip.
 *
 * Worth having rather than trusting the insert: workflow_json goes out as
 * JSON and comes back as jsonb, and a graph that arrives with no nodes would
 * open as an empty canvas — which looks like a broken workflow rather than a
 * broken seed.
 */
async function verify() {
  const { url, headers } = await connection();

  const res = await fetch(
    `${url}/rest/v1/projects?select=id,name,description,node_count,is_published,workflow_json&order=name`,
    { headers }
  );
  const rows = await res.json();
  if (!res.ok) throw new Error(`Read failed: ${JSON.stringify(rows).slice(0, 300)}`);

  const seeded = new Set(WORKFLOWS.map((w) => w.id));
  console.log(`${rows.length} project(s) on the account:\n`);

  for (const row of rows) {
    const mine = seeded.has(row.id);
    const graph = row.workflow_json ?? {};
    const nodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const edges = Array.isArray(graph.edges) ? graph.edges.length : 0;
    console.log(
      `${mine ? "  [seeded]" : "  [yours] "} ${row.name}` +
        (mine
          ? `\n             ${nodes} nodes / ${edges} edges, node_count=${row.node_count}` +
            `, published=${row.is_published === true}` +
            `\n             ${(row.description ?? "").slice(0, 72)}…`
          : "")
    );
  }

  const missing = WORKFLOWS.filter((w) => !rows.some((r) => r.id === w.id));
  if (missing.length) {
    console.log(`\nMISSING: ${missing.map((w) => w.id).join(", ")}`);
    process.exit(1);
  }
  const empty = rows.filter(
    (r) => seeded.has(r.id) && !(r.workflow_json?.nodes ?? []).length
  );
  if (empty.length) {
    console.log(`\nEMPTY GRAPH: ${empty.map((r) => r.id).join(", ")}`);
    process.exit(1);
  }
  console.log("\nAll six present, every graph non-empty.");
}

const outPath = path.join("supabase", "seeds", "b2b_workflows.sql");

if (process.argv.includes("--verify")) {
  verify().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else if (process.argv.includes("--apply")) {
  apply().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buildSql(), "utf8");
  console.log(`Wrote ${outPath} — ${WORKFLOWS.length} workflows.`);
  console.log("Paste it into the Supabase SQL editor, or re-run with --apply.");
}
