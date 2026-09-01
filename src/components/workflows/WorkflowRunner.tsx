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
 * WHAT THIS PAGE IS NOT
 *
 * It is not an editor. A runner may fill in the inputs the workflow exposes —
 * its prompt and image nodes — and nothing else. They cannot add a node, wire
 * an edge, change a model or alter what anything costs. That is not enforced
 * by hiding controls: the workflow belongs to its owner, `projects` has no
 * update policy for anyone else, and the price of every node is decided
 * server-side from the model id, never from anything this page sends.
 *
 * SAVING IS OFF, DELIBERATELY.
 *
 * Running writes outputs into node data. On the canvas that is eventually
 * autosaved back to the workflow; here it must not be, because the workflow is
 * usually somebody else's. Autosave is switched off on mount and this page
 * mounts no save control — so a run leaves the stored graph untouched, and two
 * users running the same workflow cannot overwrite each other's outputs into
 * it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWorkflowStore, type WorkflowFile } from "@/store/workflowStore";
import type { WorkflowNode } from "@/types";

/** Nodes a runner is allowed to fill in. Everything else is the author's. */
const INPUT_TYPES = new Set(["prompt", "imageInput"]);

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
      // workflow. It is what makes the run show up in history under the right
      // name — and it is a grouping key only; it cannot affect what is billed.
      id: projectId,
      name: title,
    })
      .then(() => setReady(true))
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : "Could not load this workflow.")
      );
  }, [graph, projectId, title, loadWorkflow, setAutoSaveEnabled]);

  const inputs = useMemo(
    () => nodes.filter((n) => n.type && INPUT_TYPES.has(n.type)),
    [nodes]
  );
  const outputs = useMemo(() => collectOutputs(nodes), [nodes]);

  const run = useCallback(async () => {
    setHasRun(true);
    await executeWorkflow();
  }, [executeWorkflow]);

  if (loadError) {
    return (
      <Shell title={title} description={description}>
        <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {loadError}
        </p>
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
    <Shell title={title} description={description} isOwner={isOwner} projectId={projectId}>
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
            {inputs.map((node) => (
              <InputField
                key={node.id}
                node={node}
                disabled={isRunning}
                onChange={(data) => updateNodeData(node.id, data)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="mt-6 flex items-center gap-3 border-t border-neutral-800 pt-5">
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

      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-wide text-neutral-500">
          Output
        </h2>

        {outputs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">
            {/*
              Deliberately not "no output" — before a run there is nothing to
              have, which is a different fact from a run that produced nothing.
            */}
            {hasRun && !isRunning
              ? "This run produced no output. Check the run history for what failed."
              : "Results will appear here once you run this workflow."}
          </p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {outputs.map((item, index) => (
              <Output key={`${item.nodeId}-${index}`} item={item} />
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}

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

function InputField({
  node,
  disabled,
  onChange,
}: {
  node: WorkflowNode;
  disabled: boolean;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const data = node.data as Record<string, unknown>;
  const label = (data.label as string) || defaultLabel(node.type);

  if (node.type === "prompt") {
    return (
      <label className="block">
        <span className="text-xs text-neutral-400">{label}</span>
        <textarea
          defaultValue={(data.prompt as string) ?? ""}
          disabled={disabled}
          rows={3}
          onChange={(event) => onChange({ prompt: event.target.value })}
          className="mt-1 w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
          placeholder="Describe what you want…"
        />
      </label>
    );
  }

  // imageInput
  const current = (data.image as string) ?? null;
  return (
    <div>
      <span className="text-xs text-neutral-400">{label}</span>
      <div className="mt-1 flex items-center gap-3">
        <input
          type="file"
          accept="image/*"
          disabled={disabled}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const image = await readAsDataUrl(file);
            onChange({ image, filename: file.name });
          }}
          className="text-xs text-neutral-400 file:mr-3 file:rounded file:border file:border-neutral-700 file:bg-neutral-900 file:px-2.5 file:py-1 file:text-xs file:text-neutral-200 disabled:opacity-50"
        />
        {current && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current}
            alt=""
            className="h-12 w-12 rounded border border-neutral-800 object-cover"
          />
        )}
      </div>
    </div>
  );
}

type OutputItem = {
  nodeId: string;
  kind: "image" | "video" | "audio" | "text";
  value: string;
};

/**
 * What this run produced.
 *
 * Explicit output nodes win, because an author who placed one has said which
 * result is the point. When a workflow has none, the generation nodes' own
 * outputs are shown instead rather than an empty panel — a workflow that made
 * something and shows nothing reads as a failure.
 */
function collectOutputs(nodes: WorkflowNode[]): OutputItem[] {
  const items: OutputItem[] = [];

  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;

    if (node.type === "output") {
      push(items, node.id, "image", data.image);
      push(items, node.id, "video", data.video);
      push(items, node.id, "audio", data.audio);
    } else if (node.type === "outputGallery") {
      for (const image of asArray(data.images)) push(items, node.id, "image", image);
      for (const video of asArray(data.videos)) push(items, node.id, "video", video);
    }
  }

  if (items.length > 0) return items;

  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;
    push(items, node.id, "image", data.outputImage);
    push(items, node.id, "video", data.outputVideo);
    push(items, node.id, "audio", data.outputAudio);
    push(items, node.id, "text", data.outputText);
  }

  return items;
}

function push(
  items: OutputItem[],
  nodeId: string,
  kind: OutputItem["kind"],
  value: unknown
) {
  if (typeof value === "string" && value) items.push({ nodeId, kind, value });
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
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

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.value}
      alt=""
      className="w-full rounded border border-neutral-800"
    />
  );
}

function defaultLabel(type: string | undefined): string {
  return type === "prompt" ? "Prompt" : "Image";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}
