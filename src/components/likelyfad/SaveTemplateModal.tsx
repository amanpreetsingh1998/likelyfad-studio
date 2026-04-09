// === LIKELYFAD CUSTOM === (Save current workflow as a reusable template)
"use client";

import { useState, useMemo, useEffect } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import {
  saveCloudTemplate,
  stripWorkflowForTemplate,
  deriveProviderTags,
} from "@/lib/likelyfad/templatesCloud";

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
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const autoTags = useMemo(() => deriveProviderTags(nodes), [nodes]);
  const nodeCount = nodes.length;

  // Initialize name from current project name when the modal opens
  useEffect(() => {
    if (isOpen && !name && workflowName) {
      setName(workflowName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (isSaving) return;
    setName("");
    setDescription("");
    setCategory("simple");
    setError(null);
    setSuccessId(null);
    onClose();
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
        tags: autoTags,
        node_count: nodeCount,
        thumbnail_url: null,
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
        className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
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

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {successId ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                  rows={3}
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

              {/* Auto-filled info */}
              <div className="pt-3 border-t border-neutral-800 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Auto-filled
                </p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Node count</span>
                  <span className="text-neutral-300">{nodeCount} nodes</span>
                </div>
                <div className="flex items-start justify-between text-xs gap-3">
                  <span className="text-neutral-500 shrink-0">Provider tags</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {autoTags.length === 0 ? (
                      <span className="text-neutral-600 italic">none detected</span>
                    ) : (
                      autoTags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-700/50 text-neutral-300"
                        >
                          {t}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-neutral-600 pt-1">
                  Note: generated images/videos and input uploads are stripped so the template is lean and shareable.
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
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-800 bg-neutral-900/50 rounded-b-xl">
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
