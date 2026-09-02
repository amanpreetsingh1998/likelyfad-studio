import { WorkflowFile } from "@/store/workflowStore";
import { TemplateCategory, TemplateMetadata } from "@/types/quickstart";
import type { AspectRatio } from "@/types/models";

export type ContentLevel = "empty" | "minimal" | "full";

export interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // SVG path or emoji
  category: TemplateCategory;
  tags: string[]; // Provider tags (e.g., "Gemini", "Replicate")
  workflow: Omit<WorkflowFile, "id">;
}

// Sample images from public/sample-images folder
export const SAMPLE_IMAGES = {
  // Products
  appleWatch: "/sample-images/apple-watch.jpg",
  watch: "/sample-images/watch.jpg",
  cosmetics: "/sample-images/cosmetics.jpg",
  skincare: "/sample-images/skincare.jpg",
  nikeShoe: "/sample-images/nike-shoe.jpg",
  shoes: "/sample-images/shoes.jpg",
  rayban: "/sample-images/rayban.jpg",
  // Models
  model: "/sample-images/model.png",
  model2: "/sample-images/model-2.jpg",
  model3: "/sample-images/model-3.jpg",
  model4: "/sample-images/model-4.jpg",
  model5: "/sample-images/model-5.jpg",
  model6: "/sample-images/model-6.jpg",
  model7: "/sample-images/model-7.jpg",
  // Scenes
  buildingSide: "/sample-images/building-side.jpg",
  desert: "/sample-images/desert.jpg",
  greenWallStreet: "/sample-images/green-wall-street.jpg",
  houseLake: "/sample-images/house-lake.jpg",
  nyStreet: "/sample-images/ny-street.jpg",
  nyStreet2: "/sample-images/ny-street-2.jpg",
  streetScene: "/sample-images/street-scene.jpg",
  streetScene1: "/sample-images/street-scene-1.jpg",
  streetScene2: "/sample-images/street-scene-2.jpg",
  // Colors/Textures
  colorPaint: "/sample-images/color-paint.jpg",
  colorPastel: "/sample-images/color-pastel.jpg",
  colorWall: "/sample-images/color-wall.jpg",
  // Animals
  donkey: "/sample-images/donkey.jpg",
  owl: "/sample-images/owl.jpg",
  // Reference images for templates
  newBgModelProduct: "/sample-images/new-bg-model-product.png",
  styleTransferReference: "/sample-images/style-transfer-reference.png",
};

// Default node dimensions for consistent layouts
const NODE_DIMENSIONS = {
  imageInput: { width: 300, height: 280 },
  annotation: { width: 300, height: 280 },
  prompt: { width: 320, height: 220 },
  nanoBanana: { width: 300, height: 300 },
  llmGenerate: { width: 320, height: 360 },
  output: { width: 320, height: 320 },
  outputGallery: { width: 420, height: 400 },
};

// Default node data factories
const createImageInputData = (imageUrl: string | null = null, filename: string | null = null) => ({
  image: imageUrl,
  filename: filename,
  dimensions: imageUrl ? { width: 800, height: 600 } : null,
});

const createPromptData = (prompt: string = "") => ({
  prompt,
});

const createNanoBananaData = (aspectRatio: AspectRatio = "1:1") => ({
  inputImages: [],
  inputPrompt: null,
  outputImage: null,
  aspectRatio,
  resolution: "1K" as const,
  model: "nano-banana-pro" as const,
  useGoogleSearch: false,
  useImageSearch: false,
  status: "idle" as const,
  error: null,
  imageHistory: [],
  selectedHistoryIndex: 0,
});

const createLLMGenerateData = () => ({
  inputPrompt: null,
  inputImages: [],
  outputText: null,
  provider: "google" as const,
  model: "gemini-3-flash-preview" as const,
  temperature: 0.7,
  maxTokens: 8192,
  status: "idle" as const,
  error: null,
});

const createAnnotationData = () => ({
  sourceImage: null,
  annotations: [],
  outputImage: null,
});

const createOutputData = () => ({
  image: null,
});

const createOutputGalleryData = () => ({
  images: [],
  videos: [],
});

// Content for each template at each level
interface TemplateContent {
  prompts: Record<string, string>; // nodeId -> prompt content
  images: Record<string, { url: string; filename: string }>; // nodeId -> image info
}

const TEMPLATE_CONTENT: Record<string, Record<ContentLevel, TemplateContent>> = {
  "product-shot": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Place the product in the scene shown in the reference image.\n\nConsider:\n- Match the lighting direction and quality\n- Maintain realistic scale and perspective\n- Blend shadows naturally\n- Keep product details sharp and clear",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Place the Nike shoe on the desert sand dunes. Match the warm golden hour lighting from the desert scene. Position the shoe at a dynamic angle showing the sole and side profile. Add subtle sand particles around the shoe and soft shadows that match the desert lighting direction. The final image should look like a professional outdoor product shoot.",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.nikeShoe, filename: "nike-shoe.jpg" },
        "imageInput-2": { url: SAMPLE_IMAGES.desert, filename: "desert.jpg" },
      },
    },
  },
  "model-product": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Show the model wearing or using the product.\n\nConsider:\n- Natural pose and interaction with product\n- Consistent lighting between model and product\n- Realistic scale and proportions\n- Professional fashion/lifestyle photography style",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Create a fashion advertisement showing the model wearing the Ray-Ban sunglasses. The model should be in a confident, stylish pose with the sunglasses naturally positioned. Use the urban street scene as the background. Match the lighting to create a cohesive lifestyle shot. The result should look like a high-end eyewear campaign photo.",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.model, filename: "model.png" },
        "imageInput-2": { url: SAMPLE_IMAGES.rayban, filename: "rayban.jpg" },
        "imageInput-3": { url: SAMPLE_IMAGES.newBgModelProduct, filename: "new-bg-model-product.png" },
      },
    },
  },
  "color-variations": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Generate color variations of the product using the color palette from the reference images.\n\nConsider:\n- Extract dominant colors from each reference\n- Apply colors naturally to the product\n- Maintain product shape and details\n- Keep realistic material properties",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Create a new version of the Apple Watch using the vibrant color palette from the paint and pastel reference images. Apply a gradient or color-blocked design inspired by these colors. Keep the watch's shape, screen, and details intact. The result should look like a special edition colorway that could be part of a product line expansion.",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.appleWatch, filename: "apple-watch.jpg" },
        "imageInput-2": { url: SAMPLE_IMAGES.colorPaint, filename: "color-paint.jpg" },
        "imageInput-3": { url: SAMPLE_IMAGES.colorPastel, filename: "color-pastel.jpg" },
      },
    },
  },
  "background-swap": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Place the subject from the first image into the new background scene.\n\nConsider:\n- Extract subject cleanly from original\n- Match perspective and scale to new scene\n- Adjust lighting to match background\n- Blend edges naturally",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Place the model in front of the colorful wall background. Adjust the lighting on the model to match the soft, diffused light in the wall scene. Position the model naturally as if they were photographed in this location. Ensure smooth edge blending and consistent color temperature throughout the composite.",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.model3, filename: "model-3.jpg" },
        "imageInput-2": { url: SAMPLE_IMAGES.colorWall, filename: "color-wall.jpg" },
      },
    },
  },
  "style-transfer": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Apply the visual style from the first image to the content of the second image.\n\nConsider:\n- Extract color palette and mood\n- Apply texture and lighting style\n- Maintain subject recognizability\n- Create cohesive final result",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Transform the uploaded owl photo into a soft watercolor children's book illustration, matching a delicate hand-painted storybook style. Show me only the owl with no background",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.styleTransferReference, filename: "style-transfer-reference.png" },
        "imageInput-2": { url: SAMPLE_IMAGES.owl, filename: "owl.jpg" },
      },
    },
  },
  "scene-composite": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Combine elements from multiple scene images into a cohesive new scene.\n\nConsider:\n- Select complementary elements from each\n- Unify lighting direction and quality\n- Create natural depth and composition\n- Blend atmospheres seamlessly",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Create a new urban scene that combines the architectural elements from the NY street views with the greenery and plants from the green wall street image. Imagine a futuristic eco-city where nature has reclaimed urban spaces. Vines and plants grow on building facades, green walls line the streets, but the classic NY architecture remains visible. Unify the lighting to suggest late afternoon golden hour.",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.nyStreet, filename: "ny-street.jpg" },
        "imageInput-2": { url: SAMPLE_IMAGES.nyStreet2, filename: "ny-street-2.jpg" },
        "imageInput-3": { url: SAMPLE_IMAGES.greenWallStreet, filename: "green-wall-street.jpg" },
      },
    },
  },

  // =========================================================================
  // B2B SaaS
  //
  // The six templates above are product photography: a thing exists, put it
  // somewhere else. A SaaS company has no thing to photograph — the product is
  // a screen — so its marketing images are generated from a brief rather than
  // composited from a shot. That is why these lean on an llmGenerate node the
  // originals do not need: the brief a PMM actually has ("we shipped scheduled
  // reports, it saves ops teams a Monday morning") is not an image prompt, and
  // turning it into one is the step people get wrong by hand.
  //
  // NONE OF THEM SET A `full` IMAGE, and that is not an oversight. The only
  // image these workflows take is the customer's own screenshot, headshot or
  // logo. There is no sample that could stand in for it: a stock screenshot in
  // a mockup template teaches the wrong lesson, because the whole task is
  // getting THEIR pixels through the model unaltered. `full` here means a
  // finished prompt, and the image slot stays theirs to fill.
  // =========================================================================

  "feature-launch-graphic": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Art-direct a launch graphic for a B2B SaaS feature announcement.\n\nWhat shipped:\nWho it is for:\nThe one thing it saves them:\n\nWrite a single image prompt. Hold to these:\n- An abstract product-marketing illustration, not a screenshot and not a photo\n- No text, no logos, no UI chrome — the headline is set in the CMS later\n- One focal idea. A launch card gets under a second in a feed\n- Flat vector shapes, soft gradients, generous empty space on the right for a headline\n- Two brand colours and one neutral, nothing else",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Art-direct a launch graphic for a B2B SaaS feature announcement.\n\nWhat shipped: scheduled reports — any dashboard can now email itself to a list on a recurring schedule.\nWho it is for: ops and finance leads who currently rebuild the same export every Monday.\nThe one thing it saves them: a standing weekly meeting's worth of manual work.\n\nWrite a single image prompt. Hold to these:\n- An abstract product-marketing illustration, not a screenshot and not a photo\n- No text, no logos, no UI chrome — the headline is set in the CMS later\n- One focal idea: something recurring and unattended, resolving on its own\n- Flat vector shapes, soft gradients, generous empty space on the right for a headline\n- Deep indigo and a warm amber accent on off-white, nothing else\n- Read it at thumbnail size before you commit to it",
      },
      images: {},
    },
  },

  "screenshot-mockup": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Place the attached product screenshot inside a clean browser window on a branded backdrop.\n\nThe screenshot is evidence, not raw material:\n- Reproduce it exactly. Do not redraw, restyle, retype or invent any part of the interface\n- Every label in it must stay legible and unchanged\n- Do not add UI the screenshot does not contain\n\nAround it:\n- A minimal browser chrome, no visible URL text\n- Soft shadow, slight perspective, floating on a plain gradient backdrop\n- Empty margin around the frame so the image survives being cropped",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Place the attached product screenshot inside a clean browser window on a branded backdrop, for the top of a pricing page.\n\nThe screenshot is evidence, not raw material:\n- Reproduce it exactly. Do not redraw, restyle, retype or invent any part of the interface\n- Every label in it must stay legible and unchanged\n- Do not add UI the screenshot does not contain\n\nAround it:\n- Minimal light browser chrome, rounded corners, no visible URL text\n- Three-quarter perspective, tilted a few degrees, soft long shadow beneath\n- Backdrop: a quiet indigo-to-slate gradient, no pattern competing with the screen\n- Leave a wide empty margin on all sides so the image survives a 16:9 and a 1:1 crop",
      },
      images: {},
    },
  },

  "blog-header-set": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Art-direct the header image for a B2B SaaS article.\n\nWorking title:\nThe argument the piece makes:\nWho should recognise themselves in it:\n\nWrite one image prompt that will be rendered at three sizes — a 16:9 blog hero, a 1:1 social card and a 4:5 portrait card. So:\n- Compose it centrally, with nothing important near an edge\n- One subject, not a scene. A busy composition dies in the square crop\n- No text and no logos; every placement sets its own headline\n- Editorial illustration, flat shapes, restrained palette",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Art-direct the header image for a B2B SaaS article.\n\nWorking title: \"Your onboarding is a migration problem, not a UX problem\"\nThe argument the piece makes: teams blame their signup flow for weak activation when the real blocker is getting existing data out of the tool they already use.\nWho should recognise themselves in it: heads of growth at Series A/B companies who have redesigned onboarding twice and not moved the number.\n\nWrite one image prompt that will be rendered at three sizes — a 16:9 blog hero, a 1:1 social card and a 4:5 portrait card. So:\n- Compose it centrally, with nothing important near an edge\n- One subject, not a scene: something heavy being moved between two places, rendered abstractly\n- No text and no logos; every placement sets its own headline\n- Editorial illustration, flat shapes, muted teal and clay on warm off-white\n- Check it reads at 200px wide before you commit to it",
      },
      images: {},
    },
  },

  "customer-story-card": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Art-direct a testimonial card built around one customer quote.\n\nQuote:\nSaid by (name, role, company):\nThe result it points at:\n\nWrite one image prompt for the card's backdrop and treatment. Hold to these:\n- The quote is set as live text later — do NOT render any words in the image\n- Leave the left two thirds quiet and uncluttered for that text\n- The attached headshot sits at lower right; keep that corner clear and lit to match\n- A calm, credible backdrop. This is a proof asset, not an ad\n- One accent colour against a neutral",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Art-direct a testimonial card built around one customer quote.\n\nQuote: \"We closed the quarter four days early. The reconciliation just wasn't a task any more.\"\nSaid by: a VP of Finance at a 400-person logistics company.\nThe result it points at: month-end close went from nine days to five.\n\nWrite one image prompt for the card's backdrop and treatment. Hold to these:\n- The quote is set as live text later — do NOT render any words in the image\n- Leave the left two thirds quiet and uncluttered for that text\n- The attached headshot sits at lower right; keep that corner clear and lit to match\n- A calm, credible backdrop: soft depth, a suggestion of an office interior thrown far out of focus\n- Deep green accent against warm grey, nothing brighter than the headshot",
      },
      images: {},
    },
  },

  "integration-diagram": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Art-direct an illustration of where this product sits between the tools a team already runs.\n\nThe product:\nWhat flows in, and from where:\nWhat flows out, and to where:\nThe job it does in the middle:\n\nWrite one image prompt. Hold to these:\n- Abstract and diagrammatic, not a real architecture diagram and not a screenshot\n- No text, no logos, no third-party brand marks — those are placed as real assets later\n- Direction has to be legible at a glance: in from one side, out to the other\n- Flat shapes, one accent colour for the product and a neutral for everything it connects to\n- Leave labelled positions obvious and empty",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Art-direct an illustration of where this product sits between the tools a team already runs.\n\nThe product: a revenue data layer.\nWhat flows in, and from where: raw events from the CRM, the billing system and the product database.\nWhat flows out, and to where: one agreed set of numbers, into the BI tool and the finance team's spreadsheets.\nThe job it does in the middle: settles which number is the real one before anybody argues about it.\n\nWrite one image prompt. Hold to these:\n- Abstract and diagrammatic, not a real architecture diagram and not a screenshot\n- No text, no logos, no third-party brand marks — those are placed as real assets later\n- Three inputs converging left, one clean output leaving right; the convergence is the whole idea\n- Flat shapes, isometric hint, a single saturated accent for the centre against cool greys\n- Leave six empty label positions — three left, one centre, two right",
      },
      images: {},
    },
  },

  "ad-creative-set": {
    empty: {
      prompts: {
        "prompt-1": "",
        "prompt-2": "",
        "prompt-3": "",
      },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "ANGLE 1 — the pain.\n\nAn abstract illustration of the problem this product removes, before anything is fixed. Tense, congested, effortful. No text, no logos, no UI. Flat vector, one accent against a neutral. Composed for a 4:5 feed card with the lower third left empty for a headline.",
        "prompt-2": "ANGLE 2 — the outcome.\n\nThe same product, sold on the after rather than the before: an abstract illustration of the calm state once the problem is gone. Open, resolved, unhurried. No text, no logos, no UI. Same palette and rendering style as the pain variant so the set reads as one campaign. 4:5, lower third empty.",
        "prompt-3": "ANGLE 3 — the proof.\n\nThe same product, sold on evidence: an abstract illustration of many teams converging on one agreed result. Credible and quiet rather than energetic. No text, no logos, no UI, and no invented numbers or charts. Same palette and rendering style as the other two. 4:5, lower third empty.",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "ANGLE 1 — the pain.\n\nFor a paid social test for an incident-response tool sold to platform teams.\n\nAn abstract illustration of a night-time escalation: too many alerts arriving at once, nobody sure which one matters. Tense, congested, effortful — conveyed through composition and colour, never through a face. No text, no logos, no UI, no fake dashboards. Flat vector with soft gradients, alarm red against deep slate. 4:5 feed card, lower third left empty for a headline.",
        "prompt-2": "ANGLE 2 — the outcome.\n\nSame product, sold on the after rather than the before.\n\nAn abstract illustration of one clear signal where the noise used to be: a single resolved path, everything else quiet. Open, unhurried, a night that stayed uneventful. No text, no logos, no UI, no fake dashboards. Same flat vector rendering as the pain variant, same deep slate, with the red reduced to one small settled accent so the set reads as one campaign. 4:5, lower third empty.",
        "prompt-3": "ANGLE 3 — the proof.\n\nSame product, sold on evidence.\n\nAn abstract illustration of several on-call teams converging on one agreed timeline of what happened. Credible and quiet rather than energetic. No text, no logos, no UI, and no invented numbers, charts or metrics. Same flat vector rendering and palette as the other two variants. 4:5, lower third empty.",
      },
      images: {},
    },
  },
};

// Preset templates
export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: "product-shot",
    name: "Product Shot",
    description: "Place product in a new scene or environment",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Product Shot",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 100 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 430 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 760 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "model-product",
    name: "Model + Product",
    description: "Combine model, product, and scene",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Model + Product",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 50 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 380 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-3",
          type: "imageInput",
          position: { x: 50, y: 710 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 450, y: 650 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-3-nanoBanana-1",
          source: "imageInput-3",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "color-variations",
    name: "Color Variations",
    description: "Generate product color variants from references",
    icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Color Variations",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 50 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 380 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-3",
          type: "imageInput",
          position: { x: 50, y: 710 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 450, y: 650 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-3-nanoBanana-1",
          source: "imageInput-3",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "background-swap",
    name: "Background Swap",
    description: "Place subject in a new background",
    icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Background Swap",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 100 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 430 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 760 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "style-transfer",
    name: "Style Transfer",
    description: "Apply style from one image to another",
    icon: "M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Style Transfer",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 100 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 430 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 760 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "scene-composite",
    name: "Scene Composite",
    description: "Combine elements from multiple scenes",
    icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Scene Composite",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 50 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 380 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-3",
          type: "imageInput",
          position: { x: 50, y: 710 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 450, y: 650 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-3-nanoBanana-1",
          source: "imageInput-3",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },

  // ==========================================================================
  // B2B SaaS
  //
  // Shapes, and why they differ from the six above. Those all run
  // imageInput + prompt -> nanoBanana -> output, because they start from a
  // photograph. These mostly start from a brief, so the chain gains an
  // llmGenerate node that turns "we shipped scheduled reports" into something
  // a diffusion model can actually render.
  //
  // Two of them take an image, and it is always the customer's own: a product
  // screenshot, or a headshot. Neither has a sample, deliberately — see the
  // note in TEMPLATE_CONTENT.
  // ==========================================================================

  {
    id: "feature-launch-graphic",
    name: "Feature Launch Graphic",
    description: "Turn a release note into an announcement image for the changelog and socials",
    // Heroicons: sparkles
    icon: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Feature Launch Graphic",
      edgeStyle: "curved",
      nodes: [
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 200 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "llmGenerate-1",
          type: "llmGenerate",
          position: { x: 430, y: 130 },
          data: createLLMGenerateData(),
          style: NODE_DIMENSIONS.llmGenerate,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          // 16:9 — a changelog header and an X card are both wide.
          position: { x: 810, y: 160 },
          data: createNanoBananaData("16:9"),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 1190, y: 150 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-prompt-1-llmGenerate-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "llmGenerate-1",
          targetHandle: "text",
        },
        {
          id: "edge-llmGenerate-1-nanoBanana-1",
          source: "llmGenerate-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "screenshot-mockup",
    name: "Product Screenshot Mockup",
    description: "Drop a product screenshot into a device frame on a branded backdrop",
    // Heroicons: desktop-computer
    icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Product Screenshot Mockup",
      edgeStyle: "curved",
      nodes: [
        {
          // The customer's own screenshot. No sample ships for it: the whole
          // task is getting THEIR pixels through unaltered, and a stock screen
          // would teach the opposite.
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 100 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 430 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 200 },
          data: createNanoBananaData("16:9"),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 190 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "blog-header-set",
    name: "Blog Header, Three Formats",
    description: "One article brief, headers sized for the blog, the feed and LinkedIn",
    // Heroicons: photograph
    icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    category: "advanced",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Blog Header, Three Formats",
      edgeStyle: "curved",
      nodes: [
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 330 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "llmGenerate-1",
          type: "llmGenerate",
          position: { x: 430, y: 260 },
          data: createLLMGenerateData(),
          style: NODE_DIMENSIONS.llmGenerate,
        },
        // One prompt, three placements. The aspect ratio IS the placement, so
        // the three differ only in that — re-briefing per size would produce
        // three unrelated images rather than one asset in three crops.
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 810, y: 60 },
          data: createNanoBananaData("16:9"),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "nanoBanana-2",
          type: "nanoBanana",
          position: { x: 810, y: 400 },
          data: createNanoBananaData("1:1"),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "nanoBanana-3",
          type: "nanoBanana",
          position: { x: 810, y: 740 },
          data: createNanoBananaData("4:5"),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "outputGallery-1",
          type: "outputGallery",
          position: { x: 1210, y: 340 },
          data: createOutputGalleryData(),
          style: NODE_DIMENSIONS.outputGallery,
        },
      ],
      edges: [
        {
          id: "edge-prompt-1-llmGenerate-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "llmGenerate-1",
          targetHandle: "text",
        },
        {
          id: "edge-llmGenerate-1-nanoBanana-1",
          source: "llmGenerate-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-llmGenerate-1-nanoBanana-2",
          source: "llmGenerate-1",
          sourceHandle: "text",
          target: "nanoBanana-2",
          targetHandle: "text",
        },
        {
          id: "edge-llmGenerate-1-nanoBanana-3",
          source: "llmGenerate-1",
          sourceHandle: "text",
          target: "nanoBanana-3",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-outputGallery-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "outputGallery-1",
          targetHandle: "image",
        },
        {
          id: "edge-nanoBanana-2-outputGallery-1",
          source: "nanoBanana-2",
          sourceHandle: "image",
          target: "outputGallery-1",
          targetHandle: "image",
        },
        {
          id: "edge-nanoBanana-3-outputGallery-1",
          source: "nanoBanana-3",
          sourceHandle: "image",
          target: "outputGallery-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "customer-story-card",
    name: "Customer Story Card",
    description: "Turn a customer quote into a testimonial card for the site and socials",
    // Heroicons: chat-alt-2
    icon: "M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z",
    category: "advanced",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Customer Story Card",
      edgeStyle: "curved",
      nodes: [
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 130 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          // The customer's headshot, wired straight to the generator rather
          // than through the LLM: it is the one part of this card that must
          // survive as itself.
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 420 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "llmGenerate-1",
          type: "llmGenerate",
          position: { x: 430, y: 60 },
          data: createLLMGenerateData(),
          style: NODE_DIMENSIONS.llmGenerate,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 810, y: 250 },
          data: createNanoBananaData("1:1"),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 1190, y: 240 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-prompt-1-llmGenerate-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "llmGenerate-1",
          targetHandle: "text",
        },
        {
          id: "edge-llmGenerate-1-nanoBanana-1",
          source: "llmGenerate-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "integration-diagram",
    name: "Integration Diagram",
    description: "Illustrate where your product sits between the tools a team already runs",
    // Heroicons: puzzle
    icon: "M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Integration Diagram",
      edgeStyle: "curved",
      nodes: [
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 200 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "llmGenerate-1",
          type: "llmGenerate",
          position: { x: 430, y: 130 },
          data: createLLMGenerateData(),
          style: NODE_DIMENSIONS.llmGenerate,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 810, y: 160 },
          data: createNanoBananaData("16:9"),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 1190, y: 150 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-prompt-1-llmGenerate-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "llmGenerate-1",
          targetHandle: "text",
        },
        {
          id: "edge-llmGenerate-1-nanoBanana-1",
          source: "llmGenerate-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "ad-creative-set",
    name: "Ad Creative Set",
    description: "One offer, three angles — pain, outcome and proof — to test against each other",
    // Heroicons: view-grid
    icon: "M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z",
    category: "advanced",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Ad Creative Set",
      edgeStyle: "curved",
      nodes: [
        // Three prompts, not one brief fanned out. A creative test needs three
        // genuinely different arguments; three samples of one prompt vary only
        // by seed, which tests the model rather than the message.
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 60 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "prompt-2",
          type: "prompt",
          position: { x: 50, y: 400 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "prompt-3",
          type: "prompt",
          position: { x: 50, y: 740 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        // All 4:5: the placement is fixed and the message is the variable.
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 30 },
          data: createNanoBananaData("4:5"),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "nanoBanana-2",
          type: "nanoBanana",
          position: { x: 450, y: 370 },
          data: createNanoBananaData("4:5"),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "nanoBanana-3",
          type: "nanoBanana",
          position: { x: 450, y: 710 },
          data: createNanoBananaData("4:5"),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "outputGallery-1",
          type: "outputGallery",
          position: { x: 850, y: 340 },
          data: createOutputGalleryData(),
          style: NODE_DIMENSIONS.outputGallery,
        },
      ],
      edges: [
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-prompt-2-nanoBanana-2",
          source: "prompt-2",
          sourceHandle: "text",
          target: "nanoBanana-2",
          targetHandle: "text",
        },
        {
          id: "edge-prompt-3-nanoBanana-3",
          source: "prompt-3",
          sourceHandle: "text",
          target: "nanoBanana-3",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-outputGallery-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "outputGallery-1",
          targetHandle: "image",
        },
        {
          id: "edge-nanoBanana-2-outputGallery-1",
          source: "nanoBanana-2",
          sourceHandle: "image",
          target: "outputGallery-1",
          targetHandle: "image",
        },
        {
          id: "edge-nanoBanana-3-outputGallery-1",
          source: "nanoBanana-3",
          sourceHandle: "image",
          target: "outputGallery-1",
          targetHandle: "image",
        },
      ],
    },
  },
];

/**
 * Get a preset template with content adjusted for the specified level
 */
export function getPresetTemplate(
  templateId: string,
  contentLevel: ContentLevel
): WorkflowFile {
  const template = PRESET_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const content = TEMPLATE_CONTENT[templateId]?.[contentLevel];
  if (!content) {
    throw new Error(`Content not found for ${templateId} at level ${contentLevel}`);
  }

  // Clone the workflow and apply content
  const workflow: WorkflowFile = {
    ...template.workflow,
    id: `wf_${Date.now()}_${templateId}`,
    nodes: template.workflow.nodes.map((node) => {
      const clonedNode = { ...node, data: { ...node.data } };

      // Apply prompt content
      if (node.type === "prompt" && content.prompts[node.id] !== undefined) {
        clonedNode.data = {
          ...clonedNode.data,
          prompt: content.prompts[node.id],
        };
      }

      // Apply image content for "full" level
      if (node.type === "imageInput" && content.images[node.id]) {
        const imageInfo = content.images[node.id];
        clonedNode.data = {
          ...clonedNode.data,
          image: imageInfo.url,
          filename: imageInfo.filename,
          dimensions: { width: 800, height: 600 },
        };
      }

      return clonedNode;
    }),
    edges: template.workflow.edges.map((edge) => ({ ...edge })),
  };

  return workflow;
}

/**
 * Get all preset templates for display
 */
export function getAllPresets(): Pick<PresetTemplate, "id" | "name" | "description" | "icon" | "category" | "tags">[] {
  return PRESET_TEMPLATES.map(({ id, name, description, icon, category, tags }) => ({
    id,
    name,
    description,
    icon,
    category,
    tags,
  }));
}

/**
 * Get metadata for a template, extracting node count from workflow
 */
export function getTemplateMetadata(template: PresetTemplate): TemplateMetadata {
  return {
    nodeCount: template.workflow.nodes.length,
    category: template.category,
    tags: template.tags,
  };
}

/**
 * Get a preset template with full data including metadata
 */
export function getPresetWithMetadata(templateId: string): (PresetTemplate & { metadata: TemplateMetadata }) | null {
  const template = PRESET_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return null;
  }
  return {
    ...template,
    metadata: getTemplateMetadata(template),
  };
}

/**
 * Export template content for use in API route (for fetching images)
 */
export function getTemplateContent(templateId: string, contentLevel: ContentLevel): TemplateContent | null {
  return TEMPLATE_CONTENT[templateId]?.[contentLevel] || null;
}