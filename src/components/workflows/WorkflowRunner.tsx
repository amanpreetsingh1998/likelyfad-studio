"use client";

/**
 * Run a workflow without the canvas.
 *
 * The graph is loaded into workflowStore and executed with the SAME
 * `executeWorkflow()` the studio calls. Nothing about money is re-implemented
 * here: the credit gate, the pending charges, the run row, the generation log
 * and settlement all behave exactly as they do on the canvas, because they are
 * the same code. A second execution path would be a second thing to keep
 * correct about billing, and the first one to drift out of step.
 *
 * WHICH FIELDS APPEAR
 *
 * From `runnerFields.ts`, not from a switch here. The first version of this
 * page handled `prompt` and `imageInput` and silently ignored the other 26
 * node types, so a workflow taking audio, video or a 3D model showed no field
 * for it and ran with whatever the author last saved — which looks exactly
 * like a broken workflow. The table is walked by a coverage test, so a node
 * type added later surfaces as a decision rather than an absence.
 *
 * WHAT THIS PAGE IS NOT
 *
 * It is not an editor. A runner may fill in the inputs the workflow exposes
 * and nothing else — no node, edge, model or price. That is not enforced by
 * hiding controls: the workflow belongs to its owner, `projects` has no update
 * policy for anyone else, and every price is derived server-side from the
 * model id, never from anything this page sends.
 *
 * SAVING IS OFF, DELIBERATELY.
 *
 * Running writes outputs into node data. On the canvas that is eventually
 * autosaved back to the workflow; here it must not be, because the workflow is
 * usually somebody else's. Autosave is switched off before the graph is loaded
 * — not after — and this page mounts no save control, so a run leaves the
 * stored graph untouched and two users cannot overwrite each other's outputs
 * into it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWorkflowStore, type WorkflowFile } from "@/store/workflowStore";
import type { WorkflowEdge, WorkflowNode } from "@/types";
import {
  GENERATION_OUTPUT_FIELDS,
  INTERNAL_PROMPT_FIELD,
  INTERNAL_PROMPT_TYPES,
  RUNNER_INPUTS,
  RUNNER_OUTPUTS,
  type InputSpec,
  type OutputKind,
} from "./runnerFields";

export function WorkflowRunner({
  projectId,
  title,
  description,
  graph,
  isOwner,
}: {
  projectId: string;
  title: string;
  description: string | null;
  graph: Record<string, unknown>;
  isOwner: boolean;
}) {
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const setAutoSaveEnabled = useWorkflowStore((s) => s.setAutoSaveEnabled);
  const executeWorkflow = useWorkflowStore((s) => s.executeWorkflow);
  const stopWorkflow = useWorkflowStore((s) => s.stopWorkflow);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const nodeList = Array.isArray(graph.nodes) ? graph.nodes : null;
    if (!nodeList) {
      setLoadError("This workflow has no graph saved against it.");
      return;
    }

    // Switched off BEFORE the graph lands, so no timer can fire against
    // somebody else's workflow in the gap.
    setAutoSaveEnabled(false);

    void loadWorkflow({
      ...(graph as unknown as WorkflowFile),
      // The stored id, so the run row this execution opens attributes to this
      // workflow. A grouping key only; it cannot affect what is billed.
      id: projectId,
      name: title,
    })
      .then(() => setReady(true))
      .catch((err: unknown) =>
        setLoadError(
          err instanceof Error ? err.message : "Could not load this workflow."
        )
      );
  }, [graph, projectId, title, loadWorkflow, setAutoSaveEnabled]);

  const inputs = useMemo(() => collectInputs(nodes, edges), [nodes, edges]);
  const outputs = useMemo(() => collectOutputs(nodes), [nodes]);
  const errors = useMemo(
    () =>
      nodes
        .map((n) => (n.data as Record<string, unknown>).error)
        .filter((e): e is string => typeof e === "string" && e.length > 0),
    [nodes]
  );

  const run = useCallback(async () => {
    setHasRun(true);
    await executeWorkflow();
  }, [executeWorkflow]);

  if (loadError) {
    return (
      <Shell title={title} description={description}>
        <Failed>{loadError}</Failed>
      </Shell>
    );
  }

  if (!ready) {
    return (
      <Shell title={title} description={description}>
        <p className="py-10 text-center text-sm text-neutral-500">Loading…</p>
      </Shell>
    );
  }

  return (
    <Shell
      title={title}
      description={description}
      isOwner={isOwner}
      projectId={projectId}
    >
      <section className="mt-6">
        <h2 className="text-[11px] uppercase tracking-wide text-neutral-500">
          Inputs
        </h2>

        {inputs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">
            This workflow takes no inputs — press Run to execute it as its
            author built it.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {inputs.map(({ node, spec, label }) => (
              <InputField
                key={node.id}
                node={node}
                spec={spec}
                label={label}
                disabled={isRunning}
                onChange={(data) => updateNodeData(node.id, data)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-5">
        {isRunning ? (
          <>
            <button
              type="button"
              onClick={stopWorkflow}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
            >
              Stop
            </button>
            <span className="text-xs text-neutral-500">
              Running… nodes that have already reached a provider are charged
              even if you stop.
            </span>
          </>
        ) : (
          <button
            type="button"
            onClick={run}
            className="rounded bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white"
          >
            {hasRun ? "Run again" : "Run"}
          </button>
        )}
      </div>

      {/* A node that failed says so here. Without this the page would show an
          empty Output panel and no reason for it, which reads as "nothing
          happened" rather than "this went wrong". */}
      {errors.length > 0 && !isRunning && (
        <div className="mt-4 space-y-2">
          {errors.map((message, index) => (
            <Failed key={index}>{message}</Failed>
          ))}
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-wide text-neutral-500">
          Output
        </h2>

        {outputs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">
            {/*
              Before a run there is nothing to have, which is a different fact
              from a run that produced nothing.
            */}
            {hasRun && !isRunning
              ? "This run produced no output. Any errors are shown above; the run history has the rest."
              : "Results will appear here once you run this workflow."}
          </p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {outputs.map((item, index) => (
              <Output key={`${item.nodeId}-${item.field}-${index}`} item={item} />
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}

// ─── inputs ────────────────────────────────────────────────────────────────

type ResolvedInput = { node: WorkflowNode; spec: InputSpec; label: string };

/**
 * The fields to draw, in graph order.
 *
 * Labelled from the node's own `label` where the author set one, because they
 * named it for a reason. Otherwise the type's name, numbered when a workflow
 * has more than one of a kind — "Prompt" twice with no way to tell them apart
 * is worse than "Prompt 1" and "Prompt 2".
 */
export function collectInputs(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[] = []
): ResolvedInput[] {
  const specFor = (node: WorkflowNode): InputSpec | null => {
    if (!node.type) return null;

    const direct = RUNNER_INPUTS[node.type];
    if (direct) return direct;

    // A generation node that carries its own prompt, with nothing wired into
    // it. The executor resolves `connected ?? inputPrompt`, so this field is
    // the only text the run will get — and offering it on a node that IS fed
    // would be a control that silently does nothing.
    if (
      INTERNAL_PROMPT_TYPES.includes(node.type) &&
      !hasIncomingText(node.id, edges)
    ) {
      return {
        kind: "text",
        field: INTERNAL_PROMPT_FIELD,
        label: labelForGenerationNode(node.type),
      };
    }

    return null;
  };

  const counts = new Map<string, number>();
  for (const node of nodes) {
    const spec = specFor(node);
    if (spec) counts.set(spec.label, (counts.get(spec.label) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const out: ResolvedInput[] = [];

  for (const node of nodes) {
    const spec = specFor(node);
    if (!spec) continue;

    const data = node.data as Record<string, unknown>;
    const index = (seen.get(spec.label) ?? 0) + 1;
    seen.set(spec.label, index);

    const authored =
      typeof data.label === "string" && data.label.trim()
        ? data.label.trim()
        : typeof data.customTitle === "string" && data.customTitle.trim()
        ? data.customTitle.trim()
        : null;

    const label =
      authored ??
      ((counts.get(spec.label) ?? 0) > 1 ? `${spec.label} ${index}` : spec.label);

    out.push({ node, spec, label });
  }

  return out;
}

/**
 * Is any text already flowing into this node?
 *
 * Matched on the handle names rather than the source node's type, because a
 * router or switch relays text under the same `text` handle it received it on
 * — so following types would miss a prompt that reaches the node through one.
 */
function hasIncomingText(nodeId: string, edges: WorkflowEdge[]): boolean {
  return edges.some(
    (edge) =>
      edge.target === nodeId &&
      (isTextHandle(edge.sourceHandle) || isTextHandle(edge.targetHandle))
  );
}

function isTextHandle(handle: string | null | undefined): boolean {
  return typeof handle === "string" && handle.toLowerCase().startsWith("text");
}

/** "Prompt" for whatever this node generates, so the field reads as an input. */
function labelForGenerationNode(type: string): string {
  switch (type) {
    case "generateVideo":
      return "Video prompt";
    case "generateAudio":
      return "Audio prompt";
    case "generate3d":
      return "3D prompt";
    case "llmGenerate":
      return "Text prompt";
    default:
      return "Prompt";
  }
}

function InputField({
  node,
  spec,
  label,
  disabled,
  onChange,
}: {
  node: WorkflowNode;
  spec: InputSpec;
  label: string;
  disabled: boolean;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const data = node.data as Record<string, unknown>;
  const current = data[spec.field];
  const optional = data.isOptional === true;

  if (spec.kind === "text") {
    return (
      <label className="block">
        <FieldLabel label={label} optional={optional} />
        <textarea
          defaultValue={typeof current === "string" ? current : ""}
          disabled={disabled}
          rows={3}
          onChange={(event) => onChange({ [spec.field]: event.target.value })}
          className="mt-1 w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
          placeholder="Describe what you want…"
        />
      </label>
    );
  }

  const filename = typeof data[spec.filenameField ?? ""] === "string"
    ? (data[spec.filenameField ?? ""] as string)
    : null;

  return (
    <div>
      <FieldLabel label={label} optional={optional} />
      <div className="mt-1 flex items-center gap-3">
        <input
          type="file"
          accept={spec.accept}
          disabled={disabled}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const value = await readAsDataUrl(file);
            onChange({
              [spec.field]: value,
              ...(spec.filenameField ? { [spec.filenameField]: file.name } : {}),
              // A freshly uploaded file replaces whatever the author stored, so
              // the external reference to their copy has to go with it — left
              // behind, it would win on the next load and silently undo this.
              ...refFieldsFor(spec.field),
            });
          }}
          className="min-w-0 flex-1 text-xs text-neutral-400 file:mr-3 file:rounded file:border file:border-neutral-700 file:bg-neutral-900 file:px-2.5 file:py-1 file:text-xs file:text-neutral-200 disabled:opacity-50"
        />
        <Preview kind={spec.kind} value={current} filename={filename} />
      </div>
    </div>
  );
}

function FieldLabel({ label, optional }: { label: string; optional: boolean }) {
  return (
    <span className="text-xs text-neutral-400">
      {label}
      {optional && <span className="ml-1 text-neutral-600">(optional)</span>}
    </span>
  );
}

/**
 * Clear the external reference that shadows a replaced file.
 *
 * A saved workflow stores media as `<field>Ref` pointing into storage, with the
 * inline value stripped. Setting only the inline value would leave the ref in
 * place to be re-hydrated later — so the user's upload appears to take, then
 * does not.
 */
function refFieldsFor(field: string): Record<string, undefined> {
  return { [`${field}Ref`]: undefined };
}

function Preview({
  kind,
  value,
  filename,
}: {
  kind: string;
  value: unknown;
  filename: string | null;
}) {
  if (typeof value !== "string" || !value) return null;

  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={value}
        alt=""
        className="h-12 w-12 shrink-0 rounded border border-neutral-800 object-cover"
      />
    );
  }

  // Audio, video and GLB have no cheap thumbnail, so the filename is the
  // confirmation that something is loaded.
  return (
    <span className="shrink-0 truncate text-[11px] text-neutral-500" title={filename ?? ""}>
      {filename ?? "loaded"}
    </span>
  );
}

// ─── outputs ───────────────────────────────────────────────────────────────

type OutputItem = {
  nodeId: string;
  field: string;
  kind: OutputKind;
  value: string;
};

/**
 * What this run produced.
 *
 * Explicit output nodes come first, because an author who placed one has said
 * which result is the point. Everything else a node produced follows, deduped
 * by value — so a result that is wired into an output node appears once, and a
 * result that is wired to nothing still appears at all. A workflow that made
 * something and shows nothing reads as a failure.
 */
export function collectOutputs(nodes: WorkflowNode[]): OutputItem[] {
  const items: OutputItem[] = [];

  for (const node of nodes) {
    if (!node.type) continue;
    const spec = RUNNER_OUTPUTS[node.type];
    if (!spec) continue;

    const data = node.data as Record<string, unknown>;

    for (const { field, kind } of spec.single ?? []) {
      push(items, node.id, field, kind, data[field]);
    }
    for (const { field, kind } of spec.many ?? []) {
      for (const value of asArray(data[field])) {
        push(items, node.id, field, kind, value);
      }
    }
  }

  // Then everything else that was produced, EXCEPT what is already on screen.
  //
  // The earlier rule was "an explicit output node wins, full stop", which hid
  // real results: a workflow with an output node showing an image and a
  // videoStitch producing a clip that was not wired into it displayed the
  // image and silently dropped the video. Deduping by value instead means an
  // output node fed by a generation node shows that result once, and a result
  // nothing is wired to still shows.
  const seen = new Set(items.map((item) => item.value));

  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;
    for (const { field, kind } of GENERATION_OUTPUT_FIELDS) {
      const value = data[field];
      if (typeof value !== "string" || !value || seen.has(value)) continue;
      seen.add(value);
      push(items, node.id, field, kind, value);
    }
  }

  return items;
}

function push(
  items: OutputItem[],
  nodeId: string,
  field: string,
  kind: OutputKind,
  value: unknown
) {
  if (typeof value === "string" && value) {
    items.push({ nodeId, field, kind, value });
  }
}

function asArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function Output({ item }: { item: OutputItem }) {
  if (item.kind === "text") {
    return (
      <p className="whitespace-pre-wrap rounded border border-neutral-800 bg-neutral-900/40 p-3 text-sm text-neutral-200">
        {item.value}
      </p>
    );
  }

  if (item.kind === "video") {
    return (
      <video
        src={item.value}
        controls
        className="w-full rounded border border-neutral-800"
      />
    );
  }

  if (item.kind === "audio") {
    return <audio src={item.value} controls className="w-full" />;
  }

  if (item.kind === "model3d") {
    // No viewer here on purpose: the canvas has a Three.js one, and pulling
    // that whole dependency onto a page that mostly shows pictures is a poor
    // trade. A download is the useful thing anyway — the model is the artefact.
    return (
      <a
        href={item.value}
        download
        className="flex items-center justify-center rounded border border-dashed border-neutral-700 px-3 py-6 text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100"
      >
        Download 3D model
      </a>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.value}
      alt=""
      className="w-full rounded border border-neutral-800"
    />
  );
}

// ─── chrome ────────────────────────────────────────────────────────────────

function Shell({
  title,
  description,
  isOwner,
  projectId,
  children,
}: {
  title: string;
  description: string | null;
  isOwner?: boolean;
  projectId?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <header className="mb-2 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href="/workflows"
            className="text-xs text-neutral-500 transition-colors hover:text-neutral-300"
          >
            ← All workflows
          </Link>
          <h1 className="mt-1 truncate text-lg font-semibold text-neutral-100">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-sm text-neutral-500">{description}</p>
          )}
        </div>

        {/* Only the author can open the canvas; for anyone else it is refused
            by the proxy, so the link is not offered. */}
        {isOwner && projectId && (
          <Link
            href={`/?project=${encodeURIComponent(projectId)}`}
            className="shrink-0 rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            Edit in studio
          </Link>
        )}
      </header>
      {children}
    </div>
  );
}

function Failed({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
      {children}
    </p>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}
