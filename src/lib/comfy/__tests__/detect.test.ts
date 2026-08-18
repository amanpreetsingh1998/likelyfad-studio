import { describe, it, expect } from "vitest";

import { isComfyWorkflow, isLikelyfadStudioWorkflow } from "../detect";

/** A Likelyfad Studio save, trimmed to the fields the canvas checks. */
const ourWorkflow = {
  version: 1,
  name: "Product shots",
  nodes: [{ id: "prompt-1", type: "prompt", position: { x: 0, y: 0 }, data: {} }],
  edges: [],
  edgeStyle: "bezier",
};

/** A ComfyUI editor save — what the Save button writes. */
const editorSave = {
  id: "9c1e…",
  last_node_id: 12,
  last_link_id: 18,
  nodes: [{ id: 4, type: "CheckpointLoaderSimple", widgets_values: ["sd.safetensors"] }],
  links: [[1, 4, 0, 6, 0, "MODEL"]],
  extra: {},
};

/** A ComfyUI API export — node ids mapped to executable nodes. */
const apiExport = {
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd.safetensors" } },
  "9": { class_type: "SaveImage", inputs: { images: ["8", 0] } },
};

describe("isLikelyfadStudioWorkflow", () => {
  it("recognises our own save", () => {
    expect(isLikelyfadStudioWorkflow(ourWorkflow)).toBe(true);
  });

  it("rejects both ComfyUI formats", () => {
    expect(isLikelyfadStudioWorkflow(editorSave)).toBe(false);
    expect(isLikelyfadStudioWorkflow(apiExport)).toBe(false);
  });

  it("rejects a partial file rather than half-loading it", () => {
    const { edges: _edges, ...noEdges } = ourWorkflow;
    expect(isLikelyfadStudioWorkflow(noEdges)).toBe(false);
  });
});

describe("isComfyWorkflow", () => {
  it("recognises an editor save", () => {
    expect(isComfyWorkflow(editorSave)).toBe(true);
  });

  it("recognises an API export", () => {
    expect(isComfyWorkflow(apiExport)).toBe(true);
  });

  it("recognises an API export inside a prompt envelope", () => {
    expect(isComfyWorkflow({ prompt: apiExport })).toBe(true);
  });

  it("never claims one of our own workflows", () => {
    // Both formats keep their nodes under `nodes`; mistaking ours for Comfy's
    // would swap a whole canvas for a single node that cannot run.
    expect(isComfyWorkflow(ourWorkflow)).toBe(false);
  });

  it("rejects JSON that is neither", () => {
    expect(isComfyWorkflow(null)).toBe(false);
    expect(isComfyWorkflow("a string")).toBe(false);
    expect(isComfyWorkflow([1, 2, 3])).toBe(false);
    expect(isComfyWorkflow({})).toBe(false);
    expect(isComfyWorkflow({ name: "my-package", dependencies: {} })).toBe(false);
  });

  it("rejects a node list with no editor bookkeeping", () => {
    // Some other tool's export, not something ComfyUI wrote.
    expect(isComfyWorkflow({ nodes: [{ id: 1, type: "Thing" }] })).toBe(false);
  });
});
