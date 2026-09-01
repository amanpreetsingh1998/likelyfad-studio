/**
 * Which node data the run page reads and writes.
 *
 * Split out of the component because it is a contract with `src/types/nodes.ts`
 * rather than presentation: every entry here names a field some executor
 * actually reads or writes, and a wrong name fails silently — the form renders,
 * the run goes ahead, and the node gets nothing.
 *
 * WHY IT IS A TABLE AND NOT A SWITCH
 *
 * There are 28 node types. The first version of this page handled two of them
 * and quietly ignored the rest, so a workflow taking audio, video or a 3D model
 * showed no field for it and ran with whatever the author last saved. A table
 * makes the coverage countable, and `runnerFieldCoverage.test.ts` walks the
 * NodeType union against it so a type added later shows up as a decision to
 * make rather than a field that silently never appears.
 */

/** What the browser will accept for an upload, and what kind of control to draw. */
export type InputKind = "text" | "image" | "audio" | "video" | "model3d";

export type InputSpec = {
  kind: InputKind;
  /** The data key the executor reads this from. */
  field: string;
  /** Companion keys set alongside it, so the node stays self-consistent. */
  filenameField?: string;
  /** `accept` for the file picker. Absent for text. */
  accept?: string;
  label: string;
};

/**
 * Node types a runner may fill in.
 *
 * These are the leaves of a graph — the nodes that hold content rather than
 * derive it. Everything else (promptConstructor, array, the routers, the
 * processing nodes) transforms what these produce, and is the author's
 * business rather than the runner's.
 */
export const RUNNER_INPUTS: Record<string, InputSpec> = {
  prompt: { kind: "text", field: "prompt", label: "Prompt" },
  imageInput: {
    kind: "image",
    field: "image",
    filenameField: "filename",
    accept: "image/*",
    label: "Image",
  },
  audioInput: {
    kind: "audio",
    field: "audioFile",
    filenameField: "filename",
    accept: "audio/*",
    label: "Audio",
  },
  videoInput: {
    kind: "video",
    field: "video",
    filenameField: "filename",
    accept: "video/*",
    label: "Video",
  },
  // Loads a GLB and outputs a captured still, so from a runner's point of view
  // it is an input node even though it renders like a viewer.
  glbViewer: {
    kind: "model3d",
    field: "glbUrl",
    filenameField: "filename",
    accept: ".glb,.gltf,model/gltf-binary",
    label: "3D model",
  },
};

export type OutputKind = "image" | "video" | "audio" | "text" | "model3d";

export type OutputSpec = {
  /** Single-value fields, in the order they should be shown. */
  single?: Array<{ field: string; kind: OutputKind }>;
  /** Array-valued fields. */
  many?: Array<{ field: string; kind: OutputKind }>;
};

/**
 * Nodes whose whole purpose is to present a result.
 *
 * An author who placed one of these has said which result is the point, so
 * these win over the generation nodes' own outputs below.
 */
export const RUNNER_OUTPUTS: Record<string, OutputSpec> = {
  output: {
    single: [
      { field: "image", kind: "image" },
      { field: "video", kind: "video" },
      { field: "audio", kind: "audio" },
    ],
  },
  outputGallery: {
    many: [
      { field: "images", kind: "image" },
      { field: "videos", kind: "video" },
    ],
  },
  imageCompare: {
    single: [
      { field: "imageA", kind: "image" },
      { field: "imageB", kind: "image" },
    ],
  },
  glbViewer: {
    single: [
      { field: "capturedImage", kind: "image" },
      { field: "glbUrl", kind: "model3d" },
    ],
  },
};

/**
 * The fallback: what a generation node produced.
 *
 * Used only when a workflow has no explicit output node, because a workflow
 * that made something and shows nothing reads as a failure. Every executor
 * writes these — `outputsToNodeData` in comfyAppExecutor deliberately mirrors
 * a Comfy app's handle-keyed outputs onto the same names so the rest of the
 * app can find a result without knowing that node's handle layout.
 */
export const GENERATION_OUTPUT_FIELDS: Array<{ field: string; kind: OutputKind }> = [
  { field: "outputImage", kind: "image" },
  { field: "outputVideo", kind: "video" },
  { field: "outputAudio", kind: "audio" },
  { field: "output3dUrl", kind: "model3d" },
  // gifEncoder. Treated as an image here for the same reason
  // getConnectedInputs treats it as one: a GIF is delivered as a data URL an
  // <img> renders, and it flows down image handles.
  { field: "outputGif", kind: "image" },
  { field: "outputText", kind: "text" },
];

/**
 * Nodes that carry their own prompt.
 *
 * Every generation executor resolves its text as
 *
 *     text = connectedInputs.text ?? nodeData.inputPrompt
 *
 * so a workflow does not need a separate `prompt` node at all — the author can
 * type straight into the generation node. A run page that only offered `prompt`
 * nodes therefore showed **no text field whatsoever** for those workflows, and
 * the run failed with the executor's own words: "Missing text input - connect a
 * prompt node or set internal prompt".
 *
 * THE FIELD IS OFFERED ONLY WHEN NOTHING IS WIRED INTO IT. The connection wins
 * in that `??`, so rendering an editable box on a node fed by a prompt node
 * would be a control that silently does nothing.
 */
export const INTERNAL_PROMPT_TYPES: readonly string[] = [
  "nanoBanana",
  "generateVideo",
  "generateAudio",
  "generate3d",
  "llmGenerate",
];

/** The data key those nodes read their own prompt from. */
export const INTERNAL_PROMPT_FIELD = "inputPrompt";

/**
 * Node types that are deliberately neither an input nor an output here.
 *
 * Listed rather than left implicit so the coverage test can tell "considered
 * and excluded" from "forgotten". Every one of them derives its content from
 * upstream: a runner filling them in would be editing the workflow, not
 * running it.
 */
export const RUNNER_IGNORED: readonly string[] = [
  // Transformers over other nodes' text.
  "promptConstructor",
  "array",
  // Generation nodes: their media inputs come from the graph and their outputs
  // are read through GENERATION_OUTPUT_FIELDS. Their *text* is the exception —
  // see INTERNAL_PROMPT_TYPES, which offers `inputPrompt` when nothing is wired
  // into the node.
  "nanoBanana",
  "generateVideo",
  "generateAudio",
  "generate3d",
  "llmGenerate",
  "comfyApp",
  // Image and video processing.
  "annotation",
  "splitGrid",
  "imageResize",
  "removeBackground",
  "videoStitch",
  "videoTrim",
  "videoFrameGrab",
  "gifEncoder",
  "easeCurve",
  // Control flow.
  "router",
  "switch",
  "conditionalSwitch",
];
