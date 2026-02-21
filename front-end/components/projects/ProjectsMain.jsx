"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileUp, Plus, Users } from "lucide-react";
import {
  ProjectAnalysisModal,
  ProjectAnalyzerModal,
} from "./ProjectAnalyzerModal";
import TeamBuilderModal from "./TeamBuilderModal";

const INITIAL_PROJECTS = [];

const buildEmptyAnalysis = (name) => ({
  project_name: name,
  analysis: {
    tasks: [],
    original_tasks: [],
  },
});

export default function ProjectsMain() {
  const [projects, setProjects] = useState(INITIAL_PROJECTS);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [isPlannerOpen, setIsPlannerOpen] = useState(false);
  const [isTeamOpen, setIsTeamOpen] = useState(false);
  const [activeTeamProjectId, setActiveTeamProjectId] = useState(null);

  const progressDots = useMemo(() => Array.from({ length: 10 }), []);

  const handleAnalysisComplete = (payload) => {
    const projectName = payload?.project_name?.trim() || "New project";
    const projectId = Date.now();
    const analysisPayload = payload
      ? { ...payload, project_name: projectName }
      : buildEmptyAnalysis(projectName);

    setProjects((prev) => [
      {
        id: projectId,
        name: projectName,
        status: "In Review",
        progress: 12,
        accent: "purple",
        due: "New",
        analysis: analysisPayload,
      },
      ...prev,
    ]);
    setActiveProjectId(projectId);
    setIsPlannerOpen(true);
  };

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeTeamProject = projects.find(
    (project) => project.id === activeTeamProjectId
  );

  const handleOpenPlanner = (projectId) => {
    setActiveProjectId(projectId);
    setIsPlannerOpen(true);
  };

  const handleOpenTeamBuilder = (projectId) => {
    setActiveTeamProjectId(projectId);
    setIsTeamOpen(true);
  };

  return (
    <>
      <div className="ws-shell">
        <header className="ws-header">
          <div>
            <p className="ws-kicker">Projects</p>
            <h1 className="ws-title">
              Manage projects smarter with AI-powered planning.
            </h1>
            <p className="ws-subtitle">
              Create new initiatives, upload briefs, and generate task plans in seconds.
            </p>
          </div>
          <div className="ws-actions">
            <button className="ws-btn ws-btn-ghost">
              <FileUp size={16} />
              Import
            </button>
            <button
              className="ws-btn ws-btn-primary"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus size={16} />
              New project
            </button>
          </div>
        </header>

        <section className="ws-panel">
          <div className="ws-panel-head">
            <div>
              <h2>Project Portfolio</h2>
              <p>Track delivery and velocity across active initiatives.</p>
            </div>
            <button className="ws-btn ws-btn-ghost">Filter</button>
          </div>

          <div className="ws-card-grid">
            {projects.length === 0 ? (
              <div className="ws-empty">No projects yet. Create one to get started.</div>
            ) : (
              projects.map((project) => {
                const canBuildTeam = Boolean(
                  project?.analysis?.analysis?.tasks?.length
                );
                const hasTeam = Boolean(
                  project?.team?.team?.length || project?.team?.unassigned_tasks?.length
                );
                return (
                <article
                  key={project.id}
                  className={`ws-project-card ws-accent-${project.accent}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open timeline for ${project.name}`}
                  onClick={() => handleOpenPlanner(project.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleOpenPlanner(project.id);
                    }
                  }}
                >
                  <div className="ws-card-head">
                    <span className="ws-pill">{project.status}</span>
                    <span className="ws-date">{project.due}</span>
                  </div>
                  <h3>{project.name}</h3>
                  <div className="ws-progress">
                    <div className="ws-dots">
                      {progressDots.map((_, idx) => (
                        <span
                          key={`${project.id}-${idx}`}
                          className={
                            idx < Math.round(project.progress / 10)
                              ? "ws-dot is-active"
                              : "ws-dot"
                          }
                        />
                      ))}
                    </div>
                    <span>{project.progress}%</span>
                  </div>
                  <div className="ws-project-actions">
                    {hasTeam ? (
                      <>
                        <button
                          type="button"
                          className="ws-btn ws-project-action-btn is-success"
                          disabled
                          title="Team already built"
                        >
                          Team built
                        </button>
                        <button
                          type="button"
                          className="ws-btn ws-btn-ghost ws-project-action-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenTeamBuilder(project.id);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                          title="View team"
                        >
                          <Users size={16} />
                          View team
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ws-btn ws-btn-ghost ws-project-action-btn"
                        disabled={!canBuildTeam}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpenTeamBuilder(project.id);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        title={
                          canBuildTeam
                            ? "Build a team for this project"
                            : "Run project analysis first"
                        }
                      >
                        <Users size={16} />
                        Build team
                      </button>
                    )}
                    <div className="ws-project-cta">
                      <span>Open timeline</span>
                      <ChevronRight size={16} />
                    </div>
                  </div>
                </article>
              );
              })
            )}
          </div>
        </section>
      </div>

      <ProjectAnalyzerModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onComplete={handleAnalysisComplete}
      />
      <ProjectAnalysisModal
        open={isPlannerOpen}
        onClose={() => setIsPlannerOpen(false)}
        analysis={activeProject?.analysis}
        onSave={(updated) => {
          if (!activeProjectId) return;
          setProjects((prev) =>
            prev.map((project) =>
              project.id === activeProjectId
                ? { ...project, analysis: updated }
                : project
            )
          );
        }}
      />
      <TeamBuilderModal
        open={isTeamOpen}
        onClose={() => setIsTeamOpen(false)}
        project={activeTeamProject}
        onSave={(updatedTeam) => {
          if (!activeTeamProjectId) return;
          setProjects((prev) =>
            prev.map((project) =>
              project.id === activeTeamProjectId
                ? { ...project, team: updatedTeam }
                : project
            )
          );
        }}
      />
    </>
  );
}
