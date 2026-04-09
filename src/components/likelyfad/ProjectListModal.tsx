"use client";

import { useState, useEffect, useCallback } from "react";

interface ProjectEntry {
  id: string;
  name: string;
  node_count: number;
  updated_at: string;
  created_at: string;
}

interface ProjectListModalProps {
  isOpen: boolean;
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
  onClose: () => void;
  loadingProjectId?: string | null;
  externalError?: string | null;
}

export function ProjectListModal({
  isOpen,
  onSelectProject,
  onNewProject,
  onClose,
  loadingProjectId,
  externalError,
}: ProjectListModalProps) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/likelyfad/projects");
      const data = await res.json();
      if (data.projects) {
        setProjects(data.projects);
      } else {
        setError(data.error || "Failed to load projects");
      }
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchProjects();
  }, [isOpen, fetchProjects]);

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this project? This cannot be undone.")) return;

    setDeletingId(projectId);
    try {
      const res = await fetch(`/api/likelyfad/projects/${projectId}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        setError(json.error || `Delete failed (HTTP ${res.status})`);
        // Refetch in case the row was partially deleted
        await fetchProjects();
        return;
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setDeletingId(null);
    }
  };

  if (!isOpen) return null;

  function timeAgo(dateStr: string): string {
    const seconds = Math.floor(
      (Date.now() - new Date(dateStr).getTime()) / 1000
    );
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          maxHeight: "80vh",
          background: "#171717",
          borderRadius: "12px",
          border: "1px solid #262626",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid #262626",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 600,
              color: "#fafafa",
            }}
          >
            Projects
          </h2>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={onNewProject}
              style={{
                padding: "6px 14px",
                fontSize: "13px",
                fontWeight: 500,
                background: "#fafafa",
                color: "#0a0a0a",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              + New Project
            </button>
            {projects.length > 0 && (
              <button
                onClick={onClose}
                style={{
                  padding: "6px 12px",
                  fontSize: "13px",
                  background: "transparent",
                  color: "#737373",
                  border: "1px solid #404040",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "12px", overflowY: "auto", flex: 1 }}>
          {loading ? (
            <p
              style={{
                textAlign: "center",
                color: "#737373",
                fontSize: "14px",
                padding: "40px 0",
              }}
            >
              Loading projects...
            </p>
          ) : error ? (
            <p
              style={{
                textAlign: "center",
                color: "#ef4444",
                fontSize: "14px",
                padding: "40px 0",
              }}
            >
              {error}
            </p>
          ) : projects.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 0",
                color: "#737373",
              }}
            >
              <p style={{ fontSize: "14px", margin: "0 0 4px 0" }}>
                No projects yet
              </p>
              <p style={{ fontSize: "12px", margin: 0 }}>
                Click &quot;+ New Project&quot; to get started
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {externalError && (
                <div
                  style={{
                    padding: "10px 12px",
                    marginBottom: "8px",
                    background: "#450a0a",
                    border: "1px solid #7f1d1d",
                    borderRadius: "6px",
                    color: "#fecaca",
                    fontSize: "12px",
                    lineHeight: 1.4,
                  }}
                >
                  <strong style={{ color: "#fca5a5" }}>Failed to load:</strong>{" "}
                  {externalError}
                </div>
              )}
              {projects.map((project) => {
                const isLoadingThis = loadingProjectId === project.id;
                const isDisabled = !!loadingProjectId && !isLoadingThis;
                return (
                <button
                  key={project.id}
                  onClick={() => !loadingProjectId && onSelectProject(project.id)}
                  disabled={!!loadingProjectId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    background: isLoadingThis ? "#1a1a1a" : "#0a0a0a",
                    border: `1px solid ${isLoadingThis ? "#525252" : "#262626"}`,
                    borderRadius: "8px",
                    cursor: loadingProjectId ? "wait" : "pointer",
                    textAlign: "left",
                    width: "100%",
                    transition: "border-color 0.15s",
                    opacity: isDisabled ? 0.4 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!loadingProjectId) e.currentTarget.style.borderColor = "#404040";
                  }}
                  onMouseLeave={(e) => {
                    if (!loadingProjectId) e.currentTarget.style.borderColor = "#262626";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {isLoadingThis && (
                      <div
                        style={{
                          width: "16px",
                          height: "16px",
                          border: "2px solid #404040",
                          borderTopColor: "#fafafa",
                          borderRadius: "50%",
                          animation: "lf-pl-spin 0.8s linear infinite",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div>
                      <div
                        style={{
                          fontSize: "14px",
                          fontWeight: 500,
                          color: "#fafafa",
                        }}
                      >
                        {project.name}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: isLoadingThis ? "#a3a3a3" : "#737373",
                          marginTop: "2px",
                        }}
                      >
                        {isLoadingThis
                          ? "Loading..."
                          : `${project.node_count} nodes \u00b7 ${timeAgo(project.updated_at)}`}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, project.id)}
                    disabled={deletingId === project.id}
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      color: "#737373",
                      background: "transparent",
                      border: "1px solid transparent",
                      borderRadius: "4px",
                      cursor: "pointer",
                      opacity: deletingId === project.id ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "#ef4444";
                      e.currentTarget.style.borderColor = "#ef444444";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "#737373";
                      e.currentTarget.style.borderColor = "transparent";
                    }}
                    title="Delete project"
                  >
                    {deletingId === project.id ? "..." : "Delete"}
                  </button>
                </button>
                );
              })}
              <style>{`@keyframes lf-pl-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
