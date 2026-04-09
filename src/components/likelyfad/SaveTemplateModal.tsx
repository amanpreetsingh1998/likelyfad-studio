// === LIKELYFAD CUSTOM === (Save current workflow as a reusable template)
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import {
  saveCloudTemplate,
  stripWorkflowForTemplate,
  deriveProviderTags,
  deriveModelsUsed,
  estimateWorkflowCost,
  KNOWN_PROVIDERS,
} from "@/lib/likelyfad/templatesCloud";
import { fileToResizedDataUrl } from "@/lib/likelyfad/imageResize";

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SaveTemplateModal({ isOpen, onClose }: SaveTemplateModalProps) {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const edgeStyle = useWorkflowStore((s) => s.edgeStyle);
  const groups = useWorkflowStore((s) => s.groups);
  const workflowName = useWorkflowStore((s) => s.workflowName);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"simple" | "advanced">("simple");
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set());
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);
  const [hoverDataUrl, setHoverDataUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const thumbInputRef = useRef<HTMLInputElement>(null);
  const hoverInputRef = useRef<HTMLInputElement>(null);

  // Auto-detected values from the current workflow
  const autoProviders = useMemo(() => deriveProviderTags(nodes), [nodes]);
  const autoModels = useMemo(() => deriveModelsUsed(nodes), [nodes]);
  const estimatedCost = useMemo(() => estimateWorkflowCost(nodes), [nodes]);
  const nodeCount = nodes.length;

  // On modal open, pre-check everything that was auto-detected and prefill the name
  useEffect(() => {
    if (!isOpen) return;
    if (!name && workflowName) setName(workflowName);
    setSelectedProviders(new Set(autoProviders));
    setSelectedModels(new Set(autoModels));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (isSaving) return;
    setName("");
    setDescription("");
    setCategory("simple");
    setSelectedProviders(new Set());
    setSelectedModels(new Set());
    setThumbnailDataUrl(null);
    setHoverDataUrl(null);
    setError(null);
    setSuccessId(null);
    onClose();
  };

  const toggleProvider = (p: string) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const toggleModel = (m: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const handleThumbnailPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be re-selected
    if (!file) return;
    try {
      const url = await fileToResizedDataUrl(file, 400, 0.82);
      setThumbnailDataUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read image");
    }
  };

  const handleHoverPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const url = await fileToResizedDataUrl(file, 600, 0.8);
      setHoverDataUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read image");
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (nodeCount === 0) {
      setError("Canvas is empty — add nodes before saving as template");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const stripped = stripWorkflowForTemplate({
        version: 1,
        id: "",
        name: name.trim(),
        nodes,
        edges,
        edgeStyle,
        groups: groups && Object.keys(groups).length > 0 ? groups : undefined,
      });

      const id = await saveCloudTemplate({
        name: name.trim(),
        description: description.trim(),
        category,
        tags: Array.from(selectedProviders).sort(),
        node_count: nodeCount,
        thumbnail_url: thumbnailDataUrl,
        hover_url: hoverDataUrl,
        models: Array.from(selectedModels).sort(),
        estimated_cost: estimatedCost,
        workflow_json: stripped,
      });

      if (!id) {
        setError("Failed to save template. Please try again.");
        setIsSaving(false);
        return;
      }

      setSuccessId(id);
      setIsSaving(false);
    } catch (err) {
      console.error("[SaveTemplateModal] save failed:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center"
      onClick={handleClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 my-8 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 shrink-0">
          <h2 className="text-base font-semibold text-neutral-100">
            {successId ? "Template saved" : "Save as Template"}
          </h2>
          <button
            onClick={handleClose}
            disabled={isSaving}
            className="p-1 text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {successId ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                <svg className="w-5 h-5 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-green-300">
                  Template saved to the gallery. Open the Welcome screen → Templates to see it.
                </span>
              </div>
              <button
                onClick={handleClose}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Template Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Product on White Background"
                  className="w-full px-3 py-2 text-sm bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  disabled={isSaving}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this workflow do? When would you use it?"
                  rows={2}
                  className="w-full px-3 py-2 text-sm bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  disabled={isSaving}
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["simple", "advanced"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      disabled={isSaving}
                      className={`px-3 py-2 text-xs font-medium rounded-md transition-colors border ${
                        category === c
                          ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                          : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      {c === "simple" ? "Simple" : "Advanced"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Thumbnail uploads */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Primary Thumbnail
                  </label>
                  <input
                    ref={thumbInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleThumbnailPick}
                  />
                  <button
                    type="button"
                    onClick={() => thumbInputRef.current?.click()}
                    disabled={isSaving}
                    className="w-full aspect-square rounded-md border border-dashed border-neutral-700 bg-neutral-800/50 hover:bg-neutral-800 hover:border-neutral-600 transition-colors flex items-center justify-center overflow-hidden relative"
                  >
                    {thumbnailDataUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbnailDataUrl} alt="primary thumbnail" className="absolute inset-0 w-full h-full object-cover" />
                        <span className="relative z-10 px-2 py-1 rounded bg-black/70 text-[10px] text-white opacity-0 hover:opacity-100 transition-opacity">
                          Change
                        </span>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-neutral-500">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        <span className="text-[10px]">Upload image</span>
                      </div>
                    )}
                  </button>
                  {thumbnailDataUrl && (
                    <button
                      type="button"
                      onClick={() => setThumbnailDataUrl(null)}
                      className="mt-1 text-[10px] text-neutral-500 hover:text-red-400"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Hover Image
                  </label>
                  <input
                    ref={hoverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleHoverPick}
                  />
                  <button
                    type="button"
                    onClick={() => hoverInputRef.current?.click()}
                    disabled={isSaving}
                    className="w-full aspect-square rounded-md border border-dashed border-neutral-700 bg-neutral-800/50 hover:bg-neutral-800 hover:border-neutral-600 transition-colors flex items-center justify-center overflow-hidden relative"
                  >
                    {hoverDataUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={hoverDataUrl} alt="hover image" className="absolute inset-0 w-full h-full object-cover" />
                        <span className="relative z-10 px-2 py-1 rounded bg-black/70 text-[10px] text-white opacity-0 hover:opacity-100 transition-opacity">
                          Change
                        </span>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-neutral-500">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        <span className="text-[10px]">Workflow screenshot</span>
                      </div>
                    )}
                  </button>
                  {hoverDataUrl && (
                    <button
                      type="button"
                      onClick={() => setHoverDataUrl(null)}
                      className="mt-1 text-[10px] text-neutral-500 hover:text-red-400"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Providers checklist */}
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Providers{" "}
                  <span className="text-neutral-600 font-normal">
                    (auto-detected, edit as needed)
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {KNOWN_PROVIDERS.map((p) => {
                    const checked = selectedProviders.has(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => toggleProvider(p)}
                        disabled={isSaving}
                        className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md border transition-colors text-left ${
                          checked
                            ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                            : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200"
                        }`}
                      >
                        <span
                          className={`w-3.5 h-3.5 shrink-0 rounded-sm border flex items-center justify-center ${
                            checked ? "bg-blue-500 border-blue-400" : "border-neutral-600"
                          }`}
                        >
                          {checked && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <span className="truncate">{p}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Models checklist (auto-detected only — no hardcoded list) */}
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  AI Models Used{" "}
                  <span className="text-neutral-600 font-normal">
                    (auto-detected from nodes)
                  </span>
                </label>
                {autoModels.length === 0 ? (
                  <p className="text-xs text-neutral-600 italic px-2.5 py-2 rounded-md bg-neutral-800/50 border border-neutral-800">
                    No generation nodes detected in this workflow.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {autoModels.map((m) => {
                      const checked = selectedModels.has(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => toggleModel(m)}
                          disabled={isSaving}
                          className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md border transition-colors text-left ${
                            checked
                              ? "bg-purple-500/20 border-purple-500/50 text-purple-200"
                              : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200"
                          }`}
                        >
                          <span
                            className={`w-3.5 h-3.5 shrink-0 rounded-sm border flex items-center justify-center ${
                              checked ? "bg-purple-500 border-purple-400" : "border-neutral-600"
                            }`}
                          >
                            {checked && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                          <span className="truncate">{m}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Auto-filled summary */}
              <div className="pt-3 border-t border-neutral-800 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Auto-filled summary
                </p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Node count</span>
                  <span className="text-neutral-300">{nodeCount} nodes</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Estimated cost per run</span>
                  <span className="text-green-300 font-mono">
                    ${estimatedCost.toFixed(estimatedCost < 1 ? 3 : 2)}
                  </span>
                </div>
                <p className="text-[10px] text-neutral-600 pt-1">
                  Cost is the sum of pricing for each generation node (one run each).
                  Actual cost may vary for 4K output, long videos, or batched runs.
                  Generated images, videos, and input uploads are stripped from the
                  template so it stays lean.
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="p-2.5 rounded-md bg-red-500/10 border border-red-500/30">
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!successId && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-800 bg-neutral-900/50 rounded-b-xl shrink-0">
            <button
              onClick={handleClose}
              disabled={isSaving}
              className="px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
              className="px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </>
              ) : (
                "Save Template"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
