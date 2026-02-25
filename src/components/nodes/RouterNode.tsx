"use client";

import { memo, useMemo, useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { useWorkflowStore } from "@/store/workflowStore";
import type { WorkflowNode, RouterNodeData } from "@/types";

const ALL_HANDLE_TYPES = ["image", "text", "video", "audio", "3d", "easeCurve"] as const;

const HANDLE_COLORS: Record<(typeof ALL_HANDLE_TYPES)[number], string> = {
  image: "#3b82f6",      // blue-500
  text: "#10b981",       // emerald-500
  video: "#a855f7",      // purple-500
  audio: "#f59e0b",      // amber-500
  "3d": "#06b6d4",       // cyan-500
  easeCurve: "#ef4444",  // red-500
};

export const RouterNode = memo(({ id, data, selected }: NodeProps<WorkflowNode>) => {
  const nodeData = data as RouterNodeData;
  const edges = useWorkflowStore((state) => state.edges);
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const updateNodeInternals = useUpdateNodeInternals();

  // Derive active input types from incoming edge connections
  const activeInputTypes = useMemo(() => {
    const typeSet = new Set<(typeof ALL_HANDLE_TYPES)[number]>();

    edges
      .filter((edge) => edge.target === id)
      .forEach((edge) => {
        const handleType = edge.targetHandle;
        if (handleType && ALL_HANDLE_TYPES.includes(handleType as typeof ALL_HANDLE_TYPES[number])) {
          typeSet.add(handleType as typeof ALL_HANDLE_TYPES[number]);
        }
      });

    return Array.from(typeSet).sort();
  }, [edges, id]);

  // Notify React Flow when handle count changes so it can recalculate positions
  useEffect(() => {
    updateNodeInternals(id);
  }, [activeInputTypes.length, id, updateNodeInternals]);

  // Show generic handles when not all types are connected
  const showGenericHandles = activeInputTypes.length < ALL_HANDLE_TYPES.length;

  // Calculate handle positioning
  const handleSpacing = 24;
  const baseOffset = 20;

  // Dynamic height based on active handle count
  const minHeight = 60 + activeInputTypes.length * handleSpacing;

  return (
    <BaseNode
      title="Router"
      customTitle={nodeData.customTitle}
      comment={nodeData.comment}
      onCustomTitleChange={(customTitle) => updateNodeData(id, { customTitle })}
      onCommentChange={(comment) => updateNodeData(id, { comment })}
      selected={selected}
      minWidth={200}
      minHeight={minHeight}
      className="bg-neutral-800/50 border-neutral-600"
    >
      {/* Input handles (left) */}
      {activeInputTypes.map((type, index) => (
        <Handle
          key={`input-${type}`}
          type="target"
          position={Position.Left}
          id={type}
          data-handletype={type}
          style={{
            top: baseOffset + index * handleSpacing,
            backgroundColor: HANDLE_COLORS[type],
            width: 12,
            height: 12,
            border: "2px solid #1e1e1e",
          }}
        />
      ))}
      {showGenericHandles && (
        <Handle
          type="target"
          position={Position.Left}
          id="generic-input"
          style={{
            top: baseOffset + activeInputTypes.length * handleSpacing,
            backgroundColor: "#6b7280",
            width: 12,
            height: 12,
            border: "2px dashed #9ca3af",
          }}
        />
      )}

      {/* Output handles (right) */}
      {activeInputTypes.map((type, index) => (
        <Handle
          key={`output-${type}`}
          type="source"
          position={Position.Right}
          id={type}
          data-handletype={type}
          style={{
            top: baseOffset + index * handleSpacing,
            backgroundColor: HANDLE_COLORS[type],
            width: 12,
            height: 12,
            border: "2px solid #1e1e1e",
          }}
        />
      ))}
      {showGenericHandles && (
        <Handle
          type="source"
          position={Position.Right}
          id="generic-output"
          style={{
            top: baseOffset + activeInputTypes.length * handleSpacing,
            backgroundColor: "#6b7280",
            width: 12,
            height: 12,
            border: "2px dashed #9ca3af",
          }}
        />
      )}

      {/* Body content */}
      <div className="text-[10px] text-neutral-500 text-center py-1">
        {activeInputTypes.length > 0
          ? `${activeInputTypes.length} type${activeInputTypes.length !== 1 ? "s" : ""} routed`
          : "Drop connections here"}
      </div>
    </BaseNode>
  );
});

RouterNode.displayName = "RouterNode";
