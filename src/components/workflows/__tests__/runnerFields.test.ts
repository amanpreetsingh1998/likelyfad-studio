/**
 * The run page silently ignored 26 of the 28 node types on its first version.
 * A workflow taking audio, video or a 3D model showed no field for it and ran
 * with whatever the author last saved — which is indistinguishable, from the
 * outside, from a workflow that is simply broken.
 *
 * This file exists so that cannot recur quietly. It walks the NodeType union
 * against the tables and fails on any type that is in neither, so a node added
 * later arrives as a decision to make rather than a field nobody notices is
 * missing.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  GENERATION_OUTPUT_FIELDS,
  RUNNER_IGNORED,
  RUNNER_INPUTS,
  RUNNER_OUTPUTS,
} from "../runnerFields";

/**
 * The union, read from the source rather than duplicated here.
 *
 * A hand-copied list would drift from `src/types/nodes.ts` and the drift would
 * be invisible — which is the exact failure this test is about.
 */
function nodeTypesFromSource(): string[] {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/types/nodes.ts"),
    "utf8"
  );
  const match = source.match(/export type NodeType =([\s\S]*?);/);
  if (!match) throw new Error("Could not find the NodeType union");
  return [...match[1].matchAll(/"([a-zA-Z0-9]+)"/g)].map((m) => m[1]);
}

const NODE_TYPES = nodeTypesFromSource();

describe("the NodeType union is fully accounted for", () => {
  it("reads a plausible union from source", () => {
    // A guard on the parser itself: if the regex stops matching, every
    // assertion below would pass vacuously against an empty list.
    expect(NODE_TYPES.length).toBeGreaterThan(20);
    expect(NODE_TYPES).toContain("nanoBanana");
    expect(NODE_TYPES).toContain("comfyApp");
  });

  it.each(NODE_TYPES)("accounts for %s", (type) => {
    const handled =
      type in RUNNER_INPUTS ||
      type in RUNNER_OUTPUTS ||
      RUNNER_IGNORED.includes(type);

    expect(
      handled,
      `Node type "${type}" is in neither RUNNER_INPUTS, RUNNER_OUTPUTS nor ` +
        `RUNNER_IGNORED. Decide which it is in runnerFields.ts — leaving it out ` +
        `means the run page silently drops it.`
    ).toBe(true);
  });

  it("names no type that does not exist", () => {
    const declared = [
      ...Object.keys(RUNNER_INPUTS),
      ...Object.keys(RUNNER_OUTPUTS),
      ...RUNNER_IGNORED,
    ];
    for (const type of declared) {
      expect(NODE_TYPES, `"${type}" is not a NodeType`).toContain(type);
    }
  });

  // Ignoring something AND handling it is a contradiction, and the table order
  // would decide which won — silently.
  it("does not both handle and ignore the same type", () => {
    for (const type of RUNNER_IGNORED) {
      expect(type in RUNNER_INPUTS).toBe(false);
      expect(type in RUNNER_OUTPUTS).toBe(false);
    }
  });
});

describe("the input table matches what the executors read", () => {
  // Each of these is the field name an executor actually reads. A wrong name
  // fails silently: the form renders, the run goes ahead, the node gets
  // nothing. Pinned against src/types/nodes.ts.
  it.each([
    ["prompt", "prompt"],
    ["imageInput", "image"],
    ["audioInput", "audioFile"],
    ["videoInput", "video"],
    ["glbViewer", "glbUrl"],
  ])("%s writes to data.%s", (type, field) => {
    expect(RUNNER_INPUTS[type].field).toBe(field);
  });

  it("covers every node type whose job is to hold user content", () => {
    // The four "Inputs" the docs list as user-supplied, plus the GLB loader.
    expect(Object.keys(RUNNER_INPUTS).sort()).toEqual(
      ["audioInput", "glbViewer", "imageInput", "prompt", "videoInput"].sort()
    );
  });

  it("gives every upload field a filename companion and an accept filter", () => {
    for (const [type, spec] of Object.entries(RUNNER_INPUTS)) {
      if (spec.kind === "text") continue;
      expect(spec.accept, `${type} has no accept filter`).toBeTruthy();
      expect(spec.filenameField, `${type} has no filename field`).toBeTruthy();
    }
  });
});

describe("the output table matches what the executors write", () => {
  it("reads the output node's three content fields", () => {
    const fields = RUNNER_OUTPUTS.output.single?.map((s) => s.field);
    expect(fields).toEqual(["image", "video", "audio"]);
  });

  it("reads both of the gallery's arrays", () => {
    const fields = RUNNER_OUTPUTS.outputGallery.many?.map((s) => s.field);
    expect(fields).toEqual(["images", "videos"]);
  });

  // The regression that prompted this file: a 3D generation produced nothing
  // visible, because output3dUrl was not in the fallback list.
  it("includes the 3D output that generate3d and comfyApp write", () => {
    expect(GENERATION_OUTPUT_FIELDS.map((f) => f.field)).toContain("output3dUrl");
  });

  it("covers every field outputsToNodeData mirrors for a Comfy app", () => {
    // comfyAppExecutor writes exactly these typed mirrors so the rest of the
    // app can find a result without knowing the app's handle layout.
    for (const field of [
      "outputImage",
      "outputVideo",
      "outputAudio",
      "outputText",
      "output3dUrl",
    ]) {
      expect(GENERATION_OUTPUT_FIELDS.map((f) => f.field)).toContain(field);
    }
  });
});
