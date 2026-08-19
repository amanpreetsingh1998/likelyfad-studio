"use client";

import { useCallback, useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Header } from "@/components/Header";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { FloatingActionBar } from "@/components/FloatingActionBar";
import { AnnotationModal } from "@/components/AnnotationModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useWorkflowStore } from "@/store/workflowStore";
import { FTUXModal } from "@/components/onboarding/FTUXModal";
import { getFTUXCompleted, setFTUXCompleted } from "@/store/utils/localStorage";
import { useFTUXStore } from "@/store/ftuxStore";
import { migrateLegacyStorageKeys } from "@/store/utils/storageMigration";
// === LIKELYFAD CUSTOM START === (cloud project list)
import { ProjectListModal } from "@/components/likelyfad/ProjectListModal";
import { loadProject } from "@/lib/likelyfad/cloud-storage";
import type { WorkflowFile } from "@/store/workflowStore";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { SignInModal } from "@/components/auth/SignInModal";
import { requireAuth } from "@/store/authGateStore";
// === LIKELYFAD CUSTOM END ===

// Runs before any component reads storage, so the rename keeps existing data.
migrateLegacyStorageKeys();

/**
 * The studio renders for everyone. Signing in is asked for at the point an
 * action needs an account — running a graph, saving, reaching cloud projects —
 * via requireAuth(), which raises <SignInModal> over the canvas rather than
 * replacing it. See src/store/authGateStore.ts.
 */
export default function Home() {
  return (
    <AuthProvider>
      <Studio />
      <SignInModal />
    </AuthProvider>
  );
}

function Studio() {
  const initializeAutoSave = useWorkflowStore(
    (state) => state.initializeAutoSave
  );
  const cleanupAutoSave = useWorkflowStore((state) => state.cleanupAutoSave);
  const setShowQuickstart = useWorkflowStore((state) => state.setShowQuickstart);
  const [showFTUX, setShowFTUX] = useState(false);

  // === LIKELYFAD CUSTOM START === (cloud project list)
  const loadWorkflow = useWorkflowStore((state) => state.loadWorkflow);
  const clearWorkflow = useWorkflowStore((state) => state.clearWorkflow);
  const [showProjectList, setShowProjectList] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  // Header's Projects button reaches the modal through this bridge, so the
  // upstream Header stays free of app-level state.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    const openProjectList = () => {
      setProjectError(null);
      setShowProjectList(true);
    };
    w.__openProjectList = () => {
      // The list reads the caller's Supabase rows, so it is empty by
      // definition while signed out. Gating here covers every entry point
      // rather than the Header button alone.
      if (!requireAuth("reach your projects", openProjectList)) return;
      openProjectList();
    };
    return () => {
      delete w.__openProjectList;
    };
  }, []);

  const handleSelectProject = useCallback(
    async (projectId: string) => {
      setLoadingProjectId(projectId);
      setProjectError(null);
      try {
        const project = await loadProject(projectId);
        if (!project) {
          setProjectError("Project not found");
          return;
        }
        const workflow = {
          ...(project.workflow_json as unknown as WorkflowFile),
          id: projectId,
          name: project.name,
        };
        await loadWorkflow(workflow, `cloud:${projectId}`);
        setShowQuickstart(false);
        setShowProjectList(false);
      } catch (err) {
        setProjectError(
          err instanceof Error ? err.message : "Failed to load project"
        );
      } finally {
        setLoadingProjectId(null);
      }
    },
    [loadWorkflow, setShowQuickstart]
  );

  const handleNewProject = useCallback(() => {
    clearWorkflow();
    setShowProjectList(false);
    setShowQuickstart(true);
  }, [clearWorkflow, setShowQuickstart]);
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

  // Client-side only FTUX check (SSR-safe)
  useEffect(() => {
    if (!getFTUXCompleted()) {
      setShowFTUX(true);
    }
  }, []);

  const handleFTUXComplete = () => {
    setShowFTUX(false);
    setFTUXCompleted(true);
  };

  const handleStartTutorial = () => {
    setShowFTUX(false);
    setFTUXCompleted(true);
    setShowQuickstart(false); // Close WelcomeModal if open
    useFTUXStore.getState().startTutorial();
  };

  return (
    <ReactFlowProvider>
      <div className="h-screen flex flex-col">
        <Header />
        <ErrorBoundary
          label="Canvas"
          onError={(error, info) =>
            console.error("Canvas crashed:", error, info)
          }
          fallback={(error, reset) => (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="text-sm font-semibold text-red-400">
                The canvas hit an unexpected error
              </div>
              <div className="text-xs text-neutral-400 max-w-md break-words">
                {error.message || "Unexpected render error"}
              </div>
              <div className="text-xs text-neutral-500 max-w-md">
                Your workflow is still in memory. Try recovering the canvas, or
                reload the page.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-1.5 text-xs rounded-md border border-red-500 text-red-300 hover:bg-red-500/10"
                >
                  Try to recover
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="px-3 py-1.5 text-xs rounded-md border border-neutral-600 text-neutral-300 hover:bg-neutral-700/40"
                >
                  Reload page
                </button>
              </div>
            </div>
          )}
        >
          <WorkflowCanvas />
        </ErrorBoundary>
        <FloatingActionBar />
        <AnnotationModal />
        {showFTUX && (
          <FTUXModal
            onComplete={handleFTUXComplete}
            onStartTutorial={handleStartTutorial}
          />
        )}
        {/* === LIKELYFAD CUSTOM START === (cloud project list) */}
        <ProjectListModal
          isOpen={showProjectList}
          onSelectProject={handleSelectProject}
          onNewProject={handleNewProject}
          onClose={() => setShowProjectList(false)}
          loadingProjectId={loadingProjectId}
          externalError={projectError}
        />
        {/* === LIKELYFAD CUSTOM END === */}
      </div>
    </ReactFlowProvider>
  );
}
