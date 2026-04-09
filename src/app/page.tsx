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

  const handleSelectProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/likelyfad/projects/${projectId}`);
      const data = await res.json();
      if (data.project) {
        const workflow = data.project.workflow_json as WorkflowFile;
        workflow.id = data.project.id;
        workflow.name = data.project.name;
        await loadWorkflow(workflow, data.project.id);
        setWorkflowMetadata(data.project.id, data.project.name, "cloud");
        // Restore incurred cost from Supabase
        if (typeof data.project.incurred_cost === "number") {
          useWorkflowStore.setState({ incurredCost: data.project.incurred_cost });
        }
        setShowProjectList(false);
      }
    } catch (err) {
      console.error("Failed to load project:", err);
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
        />
        {/* === LIKELYFAD CUSTOM END === */}
      </div>
    </ReactFlowProvider>
  );
}
