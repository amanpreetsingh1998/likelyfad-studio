/**
 * The run page is the only surface a non-admin has, so the failure that
 * matters is a workflow that appears to run and quietly does nothing —
 * an input with no field to fill, or a result with nowhere to appear.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { WorkflowNode } from "@/types";

const { state, mockLoadWorkflow, mockExecute, mockStop, mockUpdate, mockSetAutoSave } =
  vi.hoisted(() => {
    const mockLoadWorkflow = vi.fn().mockResolvedValue(undefined);
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockStop = vi.fn();
    const mockUpdate = vi.fn();
    const mockSetAutoSave = vi.fn();
    return {
      mockLoadWorkflow,
      mockExecute,
      mockStop,
      mockUpdate,
      mockSetAutoSave,
      state: {
        nodes: [] as WorkflowNode[],
        edges: [] as Array<Record<string, unknown>>,
        isRunning: false,
        loadWorkflow: mockLoadWorkflow,
        executeWorkflow: mockExecute,
        stopWorkflow: mockStop,
        updateNodeData: mockUpdate,
        setAutoSaveEnabled: mockSetAutoSave,
      },
    };
  });

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import { WorkflowRunner, collectInputs, collectOutputs } from "../WorkflowRunner";

function node(type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return {
    id: `${type}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    position: { x: 0, y: 0 },
    data,
  } as unknown as WorkflowNode;
}

async function renderRunner(
  nodes: WorkflowNode[],
  isOwner = false,
  edges: Array<Record<string, unknown>> = []
) {
  state.nodes = nodes;
  state.edges = edges;
  const result = render(
    <WorkflowRunner
      projectId="wf_1_abc"
      title="Product shot"
      description={null}
      graph={{ version: 1, nodes, edges: [] }}
      isOwner={isOwner}
    />
  );
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.nodes = [];
  state.edges = [];
  state.isRunning = false;
  mockLoadWorkflow.mockResolvedValue(undefined);
});

describe("loading the workflow", () => {
  // The ordering is load bearing: a timer firing between the load and the
  // disable would autosave somebody else's workflow under the runner's name.
  it("disables autosave before the graph is loaded, not after", async () => {
    await renderRunner([node("prompt", { prompt: "" })]);
    const disableOrder = mockSetAutoSave.mock.invocationCallOrder[0];
    const loadOrder = mockLoadWorkflow.mock.invocationCallOrder[0];
    expect(mockSetAutoSave).toHaveBeenCalledWith(false);
    expect(disableOrder).toBeLessThan(loadOrder);
  });

  it("keeps the stored id so the run attributes to this workflow", async () => {
    await renderRunner([node("prompt", { prompt: "" })]);
    expect(mockLoadWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wf_1_abc", name: "Product shot" })
    );
  });

  it("says so rather than rendering an empty form when there is no graph", async () => {
    render(
      <WorkflowRunner
        projectId="wf_1_abc"
        title="Product shot"
        description={null}
        graph={{}}
        isOwner={false}
      />
    );
    expect(await screen.findByText(/no graph saved/i)).toBeTruthy();
  });

  it("offers the studio only to the owner", async () => {
    await renderRunner([node("prompt", {})], false);
    expect(screen.queryByText("Edit in studio")).toBeNull();
  });
});

describe("the input fields", () => {
  // The reported bug: only prompt and imageInput had fields, so a workflow
  // wanting audio, video or a model ran with whatever the author last saved.
  it("renders a field for every kind of input node", async () => {
    await renderRunner([
      node("prompt", { prompt: "" }),
      node("imageInput", { image: null }),
      node("audioInput", { audioFile: null }),
      node("videoInput", { video: null }),
      node("glbViewer", { glbUrl: null }),
    ]);

    expect(screen.getByText("Prompt")).toBeTruthy();
    expect(screen.getByText("Image")).toBeTruthy();
    expect(screen.getByText("Audio")).toBeTruthy();
    expect(screen.getByText("Video")).toBeTruthy();
    expect(screen.getByText("3D model")).toBeTruthy();
  });

  // Transformers and control flow derive their content from upstream; a runner
  // filling them in would be editing the workflow rather than running it.
  // (Generation nodes are the one exception, and only for their own prompt —
  // see the internal-prompt suite below.)
  it("does not offer fields for nodes the author owns", async () => {
    await renderRunner([
      node("router", {}),
      node("switch", {}),
      node("promptConstructor", { template: "x" }),
      node("array", { inputText: "a,b" }),
      node("imageResize", {}),
      node("comfyApp", {}),
    ]);
    expect(screen.getByText(/takes no inputs/i)).toBeTruthy();
  });

  it("prefers the label the author gave a node", async () => {
    await renderRunner([node("prompt", { prompt: "", label: "Subject" })]);
    expect(screen.getByText("Subject")).toBeTruthy();
    expect(screen.queryByText("Prompt")).toBeNull();
  });

  // "Prompt" twice with no way to tell them apart is worse than numbering.
  it("numbers repeated fields of the same kind", async () => {
    await renderRunner([
      node("prompt", { prompt: "" }),
      node("prompt", { prompt: "" }),
    ]);
    expect(screen.getByText("Prompt 1")).toBeTruthy();
    expect(screen.getByText("Prompt 2")).toBeTruthy();
  });

  it("does not number a field that appears once", async () => {
    await renderRunner([node("prompt", { prompt: "" })]);
    expect(screen.getByText("Prompt")).toBeTruthy();
  });

  it("marks an optional input as optional", async () => {
    await renderRunner([node("imageInput", { image: null, isOptional: true })]);
    expect(screen.getByText("(optional)")).toBeTruthy();
  });

  it("pre-fills what the author saved", async () => {
    await renderRunner([node("prompt", { prompt: "a red chair" })]);
    expect(screen.getByDisplayValue("a red chair")).toBeTruthy();
  });

  it("writes an edited prompt to the field the executor reads", async () => {
    await renderRunner([node("prompt", { prompt: "" })]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "a blue chair" },
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ prompt: "a blue chair" })
    );
  });

  it("accepts only the right file type per input", async () => {
    const { container } = await renderRunner([
      node("imageInput", {}),
      node("audioInput", {}),
      node("videoInput", {}),
    ]);
    const accepts = [...container.querySelectorAll("input[type=file]")].map((el) =>
      el.getAttribute("accept")
    );
    expect(accepts).toEqual(["image/*", "audio/*", "video/*"]);
  });
});

describe("the output panel", () => {
  it("distinguishes 'not run yet' from 'produced nothing'", async () => {
    await renderRunner([node("prompt", {})]);
    expect(screen.getByText(/will appear here once you run/i)).toBeTruthy();
  });

  it("surfaces a node's error instead of an unexplained empty panel", async () => {
    await renderRunner([
      node("prompt", {}),
      node("nanoBanana", { error: "Provider refused the request" }),
    ]);
    expect(screen.getByText("Provider refused the request")).toBeTruthy();
  });
});

describe("collectOutputs", () => {
  // The explicit output leads, because the author placed it to say which
  // result is the point — but a generation the author did not wire up is still
  // shown rather than dropped. See "outputs no longer hide each other".
  it("puts an explicit output node first", () => {
    const items = collectOutputs([
      node("nanoBanana", { outputImage: "data:image/png;base64,GEN" }),
      node("output", { image: "data:image/png;base64,OUT" }),
    ]);
    expect(items[0].value).toContain("OUT");
  });

  it("reads all three of an output node's content fields", () => {
    const items = collectOutputs([
      node("output", { image: "i", video: "v", audio: "a" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["image", "video", "audio"]);
  });

  it("flattens a gallery's arrays", () => {
    const items = collectOutputs([
      node("outputGallery", { images: ["a", "b"], videos: ["c"] }),
    ]);
    expect(items).toHaveLength(3);
  });

  it("reads both sides of an image comparison", () => {
    const items = collectOutputs([node("imageCompare", { imageA: "a", imageB: "b" })]);
    expect(items).toHaveLength(2);
  });

  // The regression: a 3D generation produced nothing visible at all.
  it("falls back to a 3D model output", () => {
    const items = collectOutputs([
      node("generate3d", { output3dUrl: "https://example.test/model.glb" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("model3d");
  });

  it("falls back to each generation output a Comfy app can write", () => {
    const items = collectOutputs([
      node("comfyApp", {
        outputImage: "i",
        outputVideo: "v",
        outputAudio: "a",
        outputText: "t",
        output3dUrl: "m",
      }),
    ]);
    expect(items.map((i) => i.kind).sort()).toEqual(
      ["audio", "image", "model3d", "text", "video"].sort()
    );
  });

  it("ignores empty values rather than rendering blank tiles", () => {
    expect(
      collectOutputs([node("output", { image: "", video: null, audio: undefined })])
    ).toHaveLength(0);
  });

  it("returns nothing for a graph that has produced nothing", () => {
    expect(collectOutputs([node("prompt", { prompt: "x" })])).toHaveLength(0);
  });
});

/**
 * A workflow does not need a `prompt` node at all: every generation executor
 * resolves `connectedInputs.text ?? nodeData.inputPrompt`, so the author can
 * type straight into the generation node. Those workflows previously showed no
 * text field whatsoever and failed with the executor's own message.
 */
describe("generation nodes that carry their own prompt", () => {
  it("offers a text field when nothing is wired into the node", async () => {
    await renderRunner([node("nanoBanana", { inputPrompt: "a red chair" })]);
    expect(screen.getByDisplayValue("a red chair")).toBeTruthy();
  });

  it("writes to the field the executor actually reads", async () => {
    await renderRunner([node("nanoBanana", { inputPrompt: "" })]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "a blue chair" },
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ inputPrompt: "a blue chair" })
    );
  });

  // The connection wins in that `??`, so an editable box here would be a
  // control that silently does nothing.
  it("offers no field when a prompt node is already feeding it", async () => {
    const gen = node("nanoBanana", { inputPrompt: "ignored" });
    const prompt = node("prompt", { prompt: "the real one" });
    await renderRunner(
      [prompt, gen],
      false,
      [{ source: prompt.id, target: gen.id, sourceHandle: "text", targetHandle: "text" }]
    );
    // Only the prompt node's own field.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByDisplayValue("the real one")).toBeTruthy();
  });

  // A router relays text on the same handle, so following node types rather
  // than handles would miss it.
  it("counts text arriving through a router as wired", async () => {
    const gen = node("generateVideo", { inputPrompt: "x" });
    await renderRunner(
      [gen],
      false,
      [{ source: "router-1", target: gen.id, sourceHandle: "text", targetHandle: "text" }]
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("names the prompt after what the node generates", async () => {
    await renderRunner([
      node("generateVideo", { inputPrompt: "" }),
      node("generateAudio", { inputPrompt: "" }),
      node("llmGenerate", { inputPrompt: "" }),
      node("generate3d", { inputPrompt: "" }),
    ]);
    expect(screen.getByText("Video prompt")).toBeTruthy();
    expect(screen.getByText("Audio prompt")).toBeTruthy();
    expect(screen.getByText("Text prompt")).toBeTruthy();
    expect(screen.getByText("3D prompt")).toBeTruthy();
  });

  it("numbers two internal prompts of the same kind", async () => {
    await renderRunner([
      node("nanoBanana", { inputPrompt: "" }),
      node("nanoBanana", { inputPrompt: "" }),
    ]);
    expect(screen.getByText("Prompt 1")).toBeTruthy();
    expect(screen.getByText("Prompt 2")).toBeTruthy();
  });
});

describe("collectInputs", () => {
  it("treats an unwired generation node as a text input", () => {
    const inputs = collectInputs([node("nanoBanana", { inputPrompt: "" })], []);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].spec.field).toBe("inputPrompt");
  });

  it("ignores a generation node fed by an image only", () => {
    const gen = node("nanoBanana", { inputPrompt: "" });
    const inputs = collectInputs(
      [gen],
      [{ source: "img-1", target: gen.id, sourceHandle: "image", targetHandle: "image" }] as never
    );
    // An image edge is not text, so the prompt is still the runner's to give.
    expect(inputs).toHaveLength(1);
  });

  it("ignores comfyApp, whose inputs are its own settings", () => {
    expect(collectInputs([node("comfyApp", {})], [])).toHaveLength(0);
  });
});

/**
 * The old rule was "an explicit output node wins, full stop", which hid real
 * results — an image on an output node and a stitched clip wired to nothing
 * showed the image and silently dropped the video.
 */
describe("outputs no longer hide each other", () => {
  it("shows a result that is wired to no output node", () => {
    const items = collectOutputs([
      node("output", { image: "IMG" }),
      node("videoStitch", { outputVideo: "VID" }),
    ]);
    expect(items.map((i) => i.value).sort()).toEqual(["IMG", "VID"]);
  });

  it("shows a result once when it is wired into an output node", () => {
    const items = collectOutputs([
      node("generateVideo", { outputVideo: "SAME" }),
      node("output", { video: "SAME" }),
    ]);
    expect(items).toHaveLength(1);
  });

  it("keeps the explicit output first, because the author said it is the point", () => {
    const items = collectOutputs([
      node("nanoBanana", { outputImage: "GEN" }),
      node("output", { image: "OUT" }),
    ]);
    expect(items[0].value).toBe("OUT");
  });

  // The other reported gap: a GIF had no output field at all.
  it("shows an encoded GIF", () => {
    const items = collectOutputs([node("gifEncoder", { outputGif: "GIF" })]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("image");
  });

  it("shows every stage of a video pipeline that ends in no output node", () => {
    const items = collectOutputs([
      node("videoTrim", { outputVideo: "TRIM" }),
      node("easeCurve", { outputVideo: "EASE" }),
      node("videoStitch", { outputVideo: "STITCH" }),
    ]);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.kind === "video")).toBe(true);
  });
});
