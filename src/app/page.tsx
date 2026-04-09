"use client";

import { useEffect, useState, useCallback } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Header } from "@/components/Header";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { FloatingActionBar } from "@/components/FloatingActionBar";
import { AnnotationModal } from "@/components/AnnotationModal";
import { useWorkflowStore } from "@/store/workflowStore";
// === LIKELYFAD CUSTOM START ===
import { ProjectListModal } from "@/components/likelyfad/ProjectListModal";
import { WorkflowFile } from "@/store/workflowStore";
// === LIKELYFAD CUSTOM END ===

export default function Home() {
  const initializeAutoSave = useWorkflowStore(
    (state) => state.initializeAutoSave
  );
  const cleanupAutoSave = useWorkflowStore((state) => state.cleanupAutoSave);

  // === LIKELYFAD CUSTOM START === (cloud project list on load)
  const workflowId = useWorkflowStore((state) => state.workflowId);
  const loadWorkflow = useWorkflowStore((state) => state.loadWorkflow);
  const setWorkflowMetadata = useWorkflowStore((state) => state.setWorkflowMetadata);
  const clearWorkflow = useWorkflowStore((state) => state.clearWorkflow);
  const [showProjectList, setShowProjectList] = useState(true);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [loadingStage, setLoadingStage] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleSelectProject = useCallback(async (projectId: string) => {
    setLoadError(null);
    setLoadingProjectId(projectId);
    setLoadingStage("Fetching project...");
    console.log(`[page] selectProject: ${projectId}`);
    try {
      const res = await fetch(`/api/likelyfad/projects/${projectId}`);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? `: ${txt.substring(0, 200)}` : ""}`);
      }
      const data = await res.json();
      if (!data.project) {
        throw new Error(data.error || "Project not found in response");
      }

      const workflow = data.project.workflow_json as WorkflowFile;
      if (!workflow || typeof workflow !== "object") {
        throw new Error("Project workflow_json is missing or invalid");
      }
      workflow.id = data.project.id;
      workflow.name = data.project.name;

      const nodeCount = Array.isArray(workflow.nodes) ? workflow.nodes.length : 0;
      console.log(`[page] hydrating workflow: ${nodeCount} nodes`);
      setLoadingStage(`Loading ${nodeCount} nodes and media...`);

      await loadWorkflow(workflow, data.project.id);
      setWorkflowMetadata(data.project.id, data.project.name, "cloud");
      if (typeof data.project.incurred_cost === "number") {
        useWorkflowStore.setState({ incurredCost: data.project.incurred_cost });
      }
      console.log(`[page] project loaded successfully`);
      setShowProjectList(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load project";
      console.error("[page] Failed to load project:", err);
      setLoadError(message);
    } finally {
      setLoadingProjectId(null);
      setLoadingStage("");
    }
  }, [loadWorkflow, setWorkflowMetadata]);

  const handleNewProject = useCallback(() => {
    clearWorkflow();
    setShowProjectList(false);
  }, [clearWorkflow]);

  // Expose openProjectList for Header "Projects" button
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__openProjectList = () => setShowProjectList(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => { delete (window as any).__openProjectList; };
  }, []);
  // === LIKELYFAD CUSTOM END ===

  useEffect(() => {
    initializeAutoSave();
    return () => cleanupAutoSave();
  }, [initializeAutoSave, cleanupAutoSave]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useWorkflowStore.getState().hasUnsavedChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <ReactFlowProvider>
      <div className="h-screen flex flex-col">
        <Header />
        <WorkflowCanvas />
        <FloatingActionBar />
        <AnnotationModal />
        {/* === LIKELYFAD CUSTOM START === */}
        <ProjectListModal
          isOpen={showProjectList && !workflowId}
          onSelectProject={handleSelectProject}
          onNewProject={handleNewProject}
          onClose={() => setShowProjectList(false)}
          loadingProjectId={loadingProjectId}
          externalError={loadError}
        />
        {loadingProjectId && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 200,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.85)",
              backdropFilter: "blur(8px)",
              gap: "20px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                border: "3px solid #262626",
                borderTopColor: "#fafafa",
                borderRadius: "50%",
                animation: "lf-spin 0.8s linear infinite",
              }}
            />
            <div style={{ color: "#fafafa", fontSize: "15px", fontWeight: 500 }}>
              Loading project
            </div>
            <div style={{ color: "#a3a3a3", fontSize: "13px" }}>
              {loadingStage || "Please wait..."}
            </div>
            <style>{`@keyframes lf-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
        {/* === LIKELYFAD CUSTOM END === */}
      </div>
    </ReactFlowProvider>
  );
}
