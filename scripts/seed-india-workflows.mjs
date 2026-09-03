#!/usr/bin/env node
/**
 * Seed six B2B workflows for the Indian market into `public.projects`.
 *
 * Companion to scripts/seed-b2b-workflows.mjs and identical in mechanism —
 * read that file's header for why these are projects rather than quickstart
 * templates, why est_credits/models are deliberately left null, why ownership
 * is resolved from the admins table, and why every insert ignores conflicts.
 * The short version: a project row appears on /workflows, opens in the
 * studio, and can be published; a template is dead source until picked. And a
 * seed must be safe to re-run without overwriting canvas edits.
 *
 * TWO MODES
 *
 *   node scripts/seed-india-workflows.mjs           → writes the SQL file
 *   node scripts/seed-india-workflows.mjs --apply   → writes the rows directly
 *   node scripts/seed-india-workflows.mjs --verify  → reads them back
 *
 * WHY THESE SIX. The SaaS seed serves companies whose product is a screen.
 * These serve the other Indian B2B buyer: businesses whose product is a
 * *thing* — marketplace sellers, D2C brands, jewellers, restaurants — where
 * the recurring spend is product photography and regional ad creative. All
 * six use only node types the SaaS seed already proved through save/load
 * (imageInput, prompt, llmGenerate, nanoBanana, output, outputGallery); the
 * video/TTS reel workflows from workflow-ideas-b2b-india.md are deferred
 * until a template exercises those nodes end to end.
 *
 * House rules carried over from the SaaS seed, because they are what make
 * the outputs usable: the customer's product photo is evidence, not raw
 * material — reproduced exactly, never redrawn; no rendered text, logos or
 * watermarks — headlines and price stickers are set as live text later; and
 * festive art direction sticks to decorative motifs (diyas, marigolds,
 * rangoli, lanterns), never deities or religious symbols, so a card cannot
 * misfire on iconography.
 */

import fs from "node:fs";
import path from "node:path";

// ─── Node factories ─────────────────────────────────────────────────
// Same literals as seed-b2b-workflows.mjs, mirroring createDefaultNodeData().

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

const WORKFLOWS = [
  {
    id: "wf_seed_in_marketplace_pack",
    name: "Marketplace Listing Pack",
    description:
      "One phone photo of a product into a marketplace-ready set: a pure-white hero for Amazon.in/Flipkart, a lifestyle scene, and a 4:5 mobile-first shot. Upload your product photo — every prompt is written to reproduce it exactly, because a listing that redraws the product is a returns problem.",
    nodes: [
      // The seller's own photo. No sample: the whole task is THEIR product
      // surviving unaltered, and a stock stand-in would teach the opposite.
      node("imageInput-1", "imageInput", 50, 340, imageInput()),
      node("prompt-1", "prompt", 50, 40, prompt(
        "HERO — the marketplace main image.\n\n" +
        "Place the attached product on a pure white background (RGB 255,255,255), for an Amazon.in / Flipkart main listing image.\n\n" +
        "The photo is evidence, not raw material:\n" +
        "- Reproduce the product exactly — shape, colour, texture, stitching, engraving. Do not redraw, restyle or invent any part of it\n" +
        "- Every label and marking on the product must stay legible and unchanged\n\n" +
        "Frame and light:\n" +
        "- The product fills roughly 80% of the frame, centred, fully in frame\n" +
        "- Soft studio light from upper left, a faint natural contact shadow beneath — nothing else\n" +
        "- No props, no text, no logos, no watermarks, no reflections of other objects\n" +
        "- The result must read cleanly as a thumbnail in search results"
      )),
      node("prompt-2", "prompt", 50, 640, prompt(
        "LIFESTYLE — the second listing image.\n\n" +
        "Place the attached product, reproduced exactly as photographed, into one believable Indian home setting where it would actually be used — a sunlit apartment table, a tidy kitchen counter, a balcony shelf. One setting, chosen to fit the product.\n\n" +
        "- The product stays the unmistakable subject, sharp and true to the photo; the scene stays soft behind it\n" +
        "- Warm, natural late-morning light; believable, not aspirational-glossy\n" +
        "- No people's faces, no brand marks in the scene, no rendered text anywhere\n" +
        "- Composed centrally so a square crop loses nothing important"
      )),
      node("prompt-3", "prompt", 50, 940, prompt(
        "MOBILE PORTRAIT — the swipe-deck shot.\n\n" +
        "A 4:5 portrait of the attached product, reproduced exactly, shot as a tight three-quarter angle against a single flat colour that complements the product — one confident colour, no gradient, no pattern.\n\n" +
        "- Product large in frame, angled to show depth and material\n" +
        "- Soft rim light separating it from the backdrop, gentle shadow below\n" +
        "- Leave the top fifth of the frame quiet, in case a headline is set over it later\n" +
        "- No text, no logos, no props"
      )),
      node("nanoBanana-1", "nanoBanana", 450, 30, gen("1:1")),
      node("nanoBanana-2", "nanoBanana", 450, 380, gen("1:1")),
      node("nanoBanana-3", "nanoBanana", 450, 730, gen("4:5")),
      node("outputGallery-1", "outputGallery", 850, 340, gallery()),
    ],
    edges: [
      edge("imageInput-1", "image", "nanoBanana-1", "image"),
      edge("imageInput-1", "image", "nanoBanana-2", "image"),
      edge("imageInput-1", "image", "nanoBanana-3", "image"),
      edge("prompt-1", "text", "nanoBanana-1", "text"),
      edge("prompt-2", "text", "nanoBanana-2", "text"),
      edge("prompt-3", "text", "nanoBanana-3", "text"),
      edge("nanoBanana-1", "image", "outputGallery-1", "image"),
      edge("nanoBanana-2", "image", "outputGallery-1", "image"),
      edge("nanoBanana-3", "image", "outputGallery-1", "image"),
    ],
  },

  {
    id: "wf_seed_in_festive_campaign",
    name: "Festive Campaign Pack",
    description:
      "The same product re-dressed for the festive calendar — edit one line to switch Diwali for Holi, Rakhi, Eid or Onam. The LLM node turns your brief into festival art direction; the brief bans deities and rendered text outright, so every output is brand-safe and the greeting is set as live text later. Renders a 1:1 feed card and a 9:16 story.",
    nodes: [
      node("imageInput-1", "imageInput", 50, 60, imageInput()),
      node("prompt-1", "prompt", 50, 390, prompt(
        "Art-direct a festive campaign image for an Indian D2C brand.\n\n" +
        "Festival: Diwali   ← edit this line to re-run the same product for Holi, Raksha Bandhan, Eid or Onam\n" +
        "The product: whatever is attached — it must be reproduced exactly as photographed, never redrawn\n" +
        "The occasion's job: make the product feel like this festival's natural purchase or gift\n\n" +
        "Write one image prompt. Hold to these:\n" +
        "- Festive dressing through decorative motifs only — diyas, marigold strings, rangoli patterns, paper lanterns, fairy lights, gulal colour for Holi. NEVER deities, idols or religious symbols\n" +
        "- The product stays the hero, sharp and unaltered, in the front third; the festive scene glows behind it, softly out of focus\n" +
        "- Warm celebratory light appropriate to the festival named above\n" +
        "- No rendered text, no logos, no greeting — the wishes are set as live text later, so leave the upper third calm and uncluttered\n" +
        "- Rich but not gaudy: two dominant festive colours, chosen for the festival, plus the product's own\n" +
        "- Check it still reads at thumbnail size"
      )),
      node("llmGenerate-1", "llmGenerate", 430, 320, llm()),
      node("nanoBanana-1", "nanoBanana", 810, 120, gen("1:1")),
      node("nanoBanana-2", "nanoBanana", 810, 470, gen("9:16")),
      node("outputGallery-1", "outputGallery", 1210, 280, gallery()),
    ],
    edges: [
      edge("prompt-1", "text", "llmGenerate-1", "text"),
      edge("llmGenerate-1", "text", "nanoBanana-1", "text"),
      edge("llmGenerate-1", "text", "nanoBanana-2", "text"),
      edge("imageInput-1", "image", "nanoBanana-1", "image"),
      edge("imageInput-1", "image", "nanoBanana-2", "image"),
      edge("nanoBanana-1", "image", "outputGallery-1", "image"),
      edge("nanoBanana-2", "image", "outputGallery-1", "image"),
    ],
  },

  {
    id: "wf_seed_in_ab_creative_matrix",
    name: "A/B Creative Matrix (D2C)",
    description:
      "One product, three selling angles — desire, trust and value — each a separate 4:5 ad creative for a paid social test. Three deliberate prompts rather than one brief fanned out: three samples of one prompt vary by seed and test the model, not the message. Wire your product photo in once; it feeds all three.",
    nodes: [
      node("imageInput-1", "imageInput", 50, 400, imageInput()),
      node("prompt-1", "prompt", 430, 40, prompt(
        "ANGLE 1 — desire.\n\n" +
        "For a paid social test for an Indian D2C product. The attached product, reproduced exactly, staged as the object of want: dramatic single-source light against deep charcoal, shallow depth, one glinting highlight tracing its edge. Premium and unhurried — the ad equivalent of picking it up in a store.\n\n" +
        "No text, no logos, no price, no people. 4:5 feed card, lower third left quiet for a headline set later."
      )),
      node("prompt-2", "prompt", 430, 380, prompt(
        "ANGLE 2 — trust.\n\n" +
        "Same product, sold on credibility — the angle that answers \"will the real thing look like the photo?\"\n\n" +
        "The attached product, reproduced exactly, laid out plainly in bright even daylight on a clean neutral surface, straight-on and honest, every material and seam visible, nothing hidden by styling. The composition of a careful unboxing photo, elevated by perfect light.\n\n" +
        "No text, no logos, no badges or seals — trust is conveyed by clarity, never by invented marks. 4:5, lower third quiet."
      )),
      node("prompt-3", "prompt", 430, 720, prompt(
        "ANGLE 3 — value.\n\n" +
        "Same product, sold on everyday worth: the attached product, reproduced exactly, in mid-use context in an ordinary Indian household morning — surrounded by the small real things of a daily routine, warm believable light, nothing aspirational or staged-looking.\n\n" +
        "The product is the one sharp, saturated element; the routine around it is soft. No faces, no text, no logos, no invented price tags. Same 4:5 frame, lower third quiet, so the three angles read as one campaign."
      )),
      node("nanoBanana-1", "nanoBanana", 810, 30, gen("4:5")),
      node("nanoBanana-2", "nanoBanana", 810, 380, gen("4:5")),
      node("nanoBanana-3", "nanoBanana", 810, 730, gen("4:5")),
      node("outputGallery-1", "outputGallery", 1210, 350, gallery()),
    ],
    edges: [
      edge("imageInput-1", "image", "nanoBanana-1", "image"),
      edge("imageInput-1", "image", "nanoBanana-2", "image"),
      edge("imageInput-1", "image", "nanoBanana-3", "image"),
      edge("prompt-1", "text", "nanoBanana-1", "text"),
      edge("prompt-2", "text", "nanoBanana-2", "text"),
      edge("prompt-3", "text", "nanoBanana-3", "text"),
      edge("nanoBanana-1", "image", "outputGallery-1", "image"),
      edge("nanoBanana-2", "image", "outputGallery-1", "image"),
      edge("nanoBanana-3", "image", "outputGallery-1", "image"),
    ],
  },

  {
    id: "wf_seed_in_jewellery_tryon",
    name: "Jewellery Try-On + Detail",
    description:
      "A flat product shot of a piece and a model reference into a worn shot, then a macro detail crop chained off the result. Both inputs are evidence: the piece must survive stone-for-stone and the model must stay recognisably themselves — identity drift is the #1 complaint with AI jewellery shots, so both prompts spend most of their words forbidding it.",
    nodes: [
      // The piece, photographed flat.
      node("imageInput-1", "imageInput", 50, 60, imageInput()),
      // The model reference.
      node("imageInput-2", "imageInput", 50, 390, imageInput()),
      node("prompt-1", "prompt", 50, 720, prompt(
        "Composite the attached jewellery piece onto the attached model, worn naturally, for a premium catalogue shot.\n\n" +
        "Both inputs are evidence, not raw material:\n" +
        "- The piece must survive exactly — every stone, link, prong and engraving in its photographed position, its metal colour unchanged. Do not simplify, symmetrise or re-set it\n" +
        "- The model's face, skin tone and features stay recognisably their own. Do not beautify or drift their identity\n\n" +
        "Staging:\n" +
        "- Neck, ear or wrist framing as the piece dictates; the piece in tack-sharp focus, catching the key light\n" +
        "- Elegant dark neutral backdrop, jewellery-store key lighting with soft fill\n" +
        "- Natural wear: correct drape, weight and skin contact\n" +
        "- No text, no logos. 4:5 portrait"
      )),
      node("nanoBanana-1", "nanoBanana", 450, 340, gen("4:5")),
      // Chained off the worn shot, not off the flat photo: the detail crop
      // must match the light and drape of the shot it will sit beside.
      node("prompt-2", "prompt", 450, 720, prompt(
        "From the attached worn shot, a macro detail crop of the piece itself: fill the square frame with its most intricate section, same lighting, same angle of wear, background melting to soft darkness.\n\n" +
        "Reproduce the piece exactly as it appears in the input — this crop exists to prove the craftsmanship, so no invented facets, no added sparkle effects, no text."
      )),
      node("nanoBanana-2", "nanoBanana", 850, 340, gen("1:1")),
      node("outputGallery-1", "outputGallery", 1250, 320, gallery()),
    ],
    edges: [
      edge("imageInput-1", "image", "nanoBanana-1", "image"),
      edge("imageInput-2", "image", "nanoBanana-1", "image"),
      edge("prompt-1", "text", "nanoBanana-1", "text"),
      edge("nanoBanana-1", "image", "nanoBanana-2", "image"),
      edge("prompt-2", "text", "nanoBanana-2", "text"),
      edge("nanoBanana-1", "image", "outputGallery-1", "image"),
      edge("nanoBanana-2", "image", "outputGallery-1", "image"),
    ],
  },

  {
    id: "wf_seed_in_menu_glam",
    name: "Menu Glam (Restaurants)",
    description:
      "A phone photo of a dish into two listing-ready shots: a square delivery-app tile and a wide menu banner. The dish itself is reproduced exactly — a listing photo that invents garnish sells a plate the kitchen doesn't serve, which is a refunds problem, so both prompts upgrade only the plate, surface and light around it.",
    nodes: [
      node("imageInput-1", "imageInput", 50, 300, imageInput()),
      node("prompt-1", "prompt", 50, 20, prompt(
        "DELIVERY TILE — the Swiggy/Zomato listing square.\n\n" +
        "Re-stage the attached dish for a delivery-app listing photo.\n\n" +
        "The food is evidence:\n" +
        "- The dish itself — its components, quantity, colour and arrangement — must match the photo. Do not add garnish, portions or ingredients the kitchen does not serve\n\n" +
        "Upgrade only what surrounds it:\n" +
        "- A clean, appealing plate or bowl suited to the cuisine, on a warm neutral surface\n" +
        "- Soft directional daylight from the side, gentle steam if the dish is hot\n" +
        "- Shot from 45 degrees, dish filling most of the square frame\n" +
        "- Appetising and true — no text, no logos, no cutlery clutter"
      )),
      node("prompt-2", "prompt", 50, 600, prompt(
        "MENU BANNER — the wide header shot.\n\n" +
        "The same attached dish, reproduced exactly, as a 16:9 banner: dish placed in the right half of the frame on a rustic table styled sparely to match the cuisine, left half falling into soft warm bokeh where the restaurant's name will be set as live text later.\n\n" +
        "- Same rule: nothing on the plate that isn't in the photo\n" +
        "- Low warm evening light, inviting, slight top-down angle\n" +
        "- No rendered text, no logos, no people"
      )),
      node("nanoBanana-1", "nanoBanana", 450, 30, gen("1:1")),
      node("nanoBanana-2", "nanoBanana", 450, 430, gen("16:9")),
      node("outputGallery-1", "outputGallery", 850, 220, gallery()),
    ],
    edges: [
      edge("imageInput-1", "image", "nanoBanana-1", "image"),
      edge("imageInput-1", "image", "nanoBanana-2", "image"),
      edge("prompt-1", "text", "nanoBanana-1", "text"),
      edge("prompt-2", "text", "nanoBanana-2", "text"),
      edge("nanoBanana-1", "image", "outputGallery-1", "image"),
      edge("nanoBanana-2", "image", "outputGallery-1", "image"),
    ],
  },

  {
    id: "wf_seed_in_whatsapp_pack",
    name: "WhatsApp Catalogue + Status",
    description:
      "One SKU into the two images an Indian SMB actually sends: a clean 1:1 catalogue card and a 9:16 status frame. The LLM node writes matched art direction for both from one line about the product and the offer — the price and offer text are added as stickers or live text on top, never rendered into the image, so one render survives every price change.",
    nodes: [
      node("imageInput-1", "imageInput", 50, 60, imageInput()),
      node("prompt-1", "prompt", 50, 390, prompt(
        "Art-direct a two-image WhatsApp set for one product.\n\n" +
        "The product: whatever is attached — reproduced exactly as photographed, never redrawn.\n" +
        "The offer, for context only: a limited festive price. Do NOT render the offer, a price, or any text into either image — stickers and captions go on top later, and a render with baked-in text dies at the first price change.\n\n" +
        "Write ONE image prompt that works at both 1:1 and 9:16. Hold to these:\n" +
        "- The product centred and large against a single fresh, saleable backdrop colour that flatters it — flat or barely gradient, nothing competing\n" +
        "- Soft even light, crisp contact shadow, catalogue-clean\n" +
        "- Compose centrally with generous margin above and below, so the 9:16 gains calm space (for the status caption) and the 1:1 crops clean\n" +
        "- No text, no logos, no stickers, no burst shapes — those are added after\n" +
        "- It must read instantly on a low-end phone screen in sunlight: high contrast, no subtle detail carrying the message"
      )),
      node("llmGenerate-1", "llmGenerate", 430, 320, llm()),
      node("nanoBanana-1", "nanoBanana", 810, 120, gen("1:1")),
      node("nanoBanana-2", "nanoBanana", 810, 470, gen("9:16")),
      node("outputGallery-1", "outputGallery", 1210, 280, gallery()),
    ],
    edges: [
      edge("prompt-1", "text", "llmGenerate-1", "text"),
      edge("llmGenerate-1", "text", "nanoBanana-1", "text"),
      edge("llmGenerate-1", "text", "nanoBanana-2", "text"),
      edge("imageInput-1", "image", "nanoBanana-1", "image"),
      edge("imageInput-1", "image", "nanoBanana-2", "image"),
      edge("nanoBanana-1", "image", "outputGallery-1", "image"),
      edge("nanoBanana-2", "image", "outputGallery-1", "image"),
    ],
  },
];

/** The WorkflowFile the canvas loads, exactly as saveWorkflow would store it. */
function workflowJson(w) {
  return {
    version: 1,
    id: w.id,
    name: w.name,
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
-- india_b2b_workflows.sql — six ready-to-run workflows for Indian B2B buyers
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once: every row is 'on conflict do nothing', so a
-- second run adds nothing and never overwrites edits made on the canvas.
--
-- GENERATED by scripts/seed-india-workflows.mjs. Edit the script, not this
-- file. Mechanism and rules are identical to b2b_workflows.sql — ownership
-- resolved from the admins table, est_credits/est_duration_ms/est_partial/
-- models deliberately left for the server to derive from the stored graph.
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
--    where id like 'wf_seed_in_%';
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

/** Read the seeded rows back and check the graph survived the round trip. */
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
      `${mine ? "  [seeded]" : "  [other] "} ${row.name}` +
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

  // Every edge must reference a node that exists — the failure mode the
  // generated-not-hand-written rule exists to prevent.
  const dangling = [];
  for (const w of WORKFLOWS) {
    const row = rows.find((r) => r.id === w.id);
    const ids = new Set((row?.workflow_json?.nodes ?? []).map((n) => n.id));
    for (const e of row?.workflow_json?.edges ?? []) {
      if (!ids.has(e.source) || !ids.has(e.target)) dangling.push(`${w.id}:${e.id}`);
    }
  }
  if (dangling.length) {
    console.log(`\nDANGLING EDGE: ${dangling.join(", ")}`);
    process.exit(1);
  }

  console.log("\nAll six present, every graph non-empty, every edge resolves.");
}

const outPath = path.join("supabase", "seeds", "india_b2b_workflows.sql");

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
