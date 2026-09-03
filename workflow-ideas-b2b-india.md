# Workflow Analysis + New B2B-India Workflow Ideas

Analysis of the nine workflows that ship with Likelyfad Studio today, and
proposals for new templates aimed at Indian B2B buyers — every one buildable
with the existing 28 node types and seven providers, no engine changes needed.

---

## 1. What exists today

### The six quickstart templates (`src/lib/quickstart/templates.ts`)

| Template | Shape | What it sells |
|---|---|---|
| Product Shot | 2× imageInput + prompt → nanoBanana → output | Product in a new scene |
| Model + Product | 3× imageInput + prompt → nanoBanana → output | Model wearing/holding product |
| Color Variations | 3× imageInput + prompt → nanoBanana → output | SKU colour variants |
| Background Swap | 2× imageInput + prompt → nanoBanana → output | New background |
| Style Transfer | 2× imageInput + prompt → nanoBanana → output | Style from reference |
| Scene Composite | 3× imageInput + prompt → nanoBanana → output | Multi-image composite |

### The three examples (`examples/`)

- **Image-Prompt-Generate-Output** — the minimal composite (same shape as the templates).
- **Loop-Iterative-Refinement** — a loop edge feeding nanoBanana's output back
  through itself, collecting passes in `outputGallery`. The only workflow using
  loops.
- **Parametric Prompt Engine (Seedance)** — the most sophisticated one: an
  `llmGenerate` (claude-opus) acts as a prompt engineer, `promptConstructor`
  assembles system + user intent, character `imageInput`s feed `generateVideo`.
  The only workflow touching video or LLMs.

### The honest read

**Every template is the same one-step image composite** — n images + a prompt
into a single nano-banana call. That was the right way to launch, but it means:

- **One output per run.** No template produces a *pack* (the thing a business
  actually needs: hero + lifestyle + 9:16 + square, in one click).
- **Nine of 28 node types are used.** Never used anywhere: `generateAudio`
  (TTS), `generate3d`/`glbViewer`, `videoStitch`/`videoTrim`/`videoFrameGrab`,
  `gifEncoder`, `splitGrid`, `array` (fan-out!), `removeBackground`,
  `imageResize`, `annotation`, `router`/`switch`/`conditionalSwitch`,
  `audioInput`/`videoInput`, `imageCompare`, `comfyApp`.
- **Video exists only in an example**, not as a purchasable template — yet
  Likelyfad's pitch is AI video/UGC/static ads.
- **No language dimension anywhere.** Prompts and outputs are English-only.
- **The `array` node is the biggest untapped lever**: it turns any
  single-output template into a batch machine (one graph, 20 SKUs), which is
  exactly the B2B economics — businesses buy throughput, not one image.

The Seedance example is the architectural pattern the new templates should
copy: **LLM as prompt engineer + promptConstructor for parameters** means a
business user fills in three plain-language fields and the workflow writes the
expert prompt itself.

---

## 2. New workflows for Indian B2B buyers

Ordered by (buyer demand in India × buildability today). Node graphs use only
existing node types; models named are already in the catalogue (nano-banana /
nano-banana-pro for image, Seedance-class via `generateVideo`, TTS via
`generateAudio` on fal, LLMs via `llmGenerate`).

### Tier 1 — build these first

**W1. Marketplace Listing Pack (Amazon.in / Flipkart / Meesho)**
The single most common paid job for Indian D2C sellers: turn one phone photo
into a compliant listing set — white-background hero, 2–3 lifestyle scenes,
and marketplace-sized crops.
`imageInput → removeBackground → [nanoBanana ×3 with scene prompts] →
imageResize (per-marketplace specs: 2000×2000 hero, 1:1, 3:4) → outputGallery`.
Fan it over `array` for multi-SKU catalogues. Why it sells: every seller needs
it monthly, photoshoots cost ₹15–40k/day, and the output is judged against a
hard spec (white background, fill ratio) rather than taste — easy to satisfy,
easy to retain.

**W2. Festive Campaign Pack (Diwali / Holi / Raksha Bandhan / Eid / Onam)**
`prompt (product + brand tone) + imageInput → llmGenerate (writes the festival
scene prompt + ad copy, parameterized by festival & language via
promptConstructor) → nanoBanana ×N festive scenes → outputGallery`.
India's ad calendar is festival-driven; brands re-shoot the *same* products
five times a year. One workflow with a festival parameter is a **recurring
seasonal retainer**, not a one-off sale. Diwali '26 alone justifies it.

**W3. Multilingual UGC Reel Factory**
The flagship — it uses the video+audio stack nothing exposes today:
`imageInput (product) + prompt (offer, audience, language) → llmGenerate
(script in Hindi/Tamil/Telugu/Bengali/…) → promptConstructor → generateVideo
(UGC-style presenter clips) → generateAudio (TTS voiceover in the same
language) → videoStitch → output`. Meta/Instagram performance ads in regional
languages are where Indian D2C spend is going; agencies pay per-reel today.
This is the Parametric Prompt Engine example, productized.

**W4. A/B Creative Matrix**
`array (3 hooks) × llmGenerate (copy variants) → nanoBanana (scene per
variant) → outputGallery` — a labelled grid of 9–12 ad variants from one
brief. Performance-marketing agencies (the most natural B2B channel partner)
buy variants by the dozen for creative testing; nobody sells them a one-click
matrix. Also the best showcase for the credit system: one run, many billable
nodes, one settled charge.

### Tier 2 — high value, slightly more graph work

**W5. Jewellery & Ethnic-wear Virtual Try-On**
`imageInput (flat jewellery/saree) + imageInput (model) → nanoBanana try-on
composite → splitGrid (detail crops of the piece) → nanoBanana zoom-enhance →
outputGallery`. Jewellery and ethnic wear are enormous Indian categories where
model shoots are the #1 cost and identity-consistency across shots is the #1
complaint — the templates' existing "keep the subject's identity" prompt
discipline is the moat here.

**W6. Restaurant / Cloud-Kitchen Menu Glam**
`array (dish photos) → removeBackground → nanoBanana (premium plating,
consistent table/lighting per brand) → imageResize (Swiggy/Zomato listing
specs) → outputGallery`. Tens of thousands of cloud kitchens, all with phone
photos, all knowing listing images move orders. Low credit cost per unit →
price it as a per-menu pack.

**W7. Real-Estate Virtual Staging + Teaser**
`array (room photos) → nanoBanana (stage empty rooms: furniture, decor,
brightness) → generateVideo (slow pans per room) → videoStitch + generateAudio
(voiceover from an llmGenerate-written script) → output` — a 30-second
project teaser from a site visit's phone photos. Builders and brokerages are
classic Indian B2B buyers with per-project budgets; label outputs as
virtually staged.

**W8. WhatsApp Catalogue & Status Pack**
`array (SKUs) → nanoBanana (clean card scene) → annotation (price tag / offer
sticker overlay) → imageResize (1:1 catalogue + 9:16 status) → outputGallery`.
WhatsApp is *the* Indian SMB sales channel; nobody's photoshoot pipeline
targets it. Cheap runs → sell as a monthly subscription pack.

### Tier 3 — differentiators once Tier 1 earns

**W9. 3D Product Spin** — `imageInput ×2 → generate3d → glbViewer frames →
gifEncoder / generateVideo turntable`. Premium listings (electronics,
furniture, jewellery) pay for spins; uses the completely idle 3D stack.

**W10. Before/After Creative** — `imageInput ×2 → nanoBanana (consistent
framing) → imageCompare → output` for salons, detailing, renovation, cleaning
services. (Keep it to visible services; skip medical/clinic claims.)

**W11. Topical-Moment Creative** — a W2 variant with a free-text "moment"
parameter (cricket season, budget day, monsoon sale) and an `llmGenerate` step
instructed to keep output unbranded/generic — fast turnaround topical ads
without touching team logos or celebrity likenesses, which stay out of scope.

---

## 3. Implementation notes

- **Ship each as a quickstart template**: an entry in `QUICKSTART_TEMPLATES`
  with sample images, exactly like the existing six (use the `add-node-type`
  count discipline — a template referencing a node the canvas half-registers
  will "look fine and quietly fail"). W1/W2/W4 are template work only. W3/W7
  need `generateVideo`/`generateAudio`/`videoStitch` wired into a template for
  the first time — verify those nodes' handles round-trip through save/load.
- **Language as a first-class parameter** via `promptConstructor` +
  `llmGenerate`, following the Seedance example's pattern. No engine change.
- **Every fal model in these graphs must price** — unpriced models 409
  (`unpriced_model`); check the TTS and video endpoints against the recorded
  pricing before shipping a template that uses them (`credits-pricing` skill).
- **These templates are what the workflow-history feature displays.** Cost of
  one successful run + estimated time per template (from
  `prd-workflow-history.md`) become sales copy: "Listing Pack: ~40 credits,
  ~3 min." Build W1–W4 first and the `/workflows` page launches with history
  entries worth looking at.
- One caution from your own codebase's history: W3/W7 chain many billable
  nodes per run, so they lean hardest on settlement — land Phase 0 of the PRD
  (apply 0011/0012) before promoting multi-node workflows to paying users.
