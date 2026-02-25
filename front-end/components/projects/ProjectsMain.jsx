"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileUp, Plus, Users } from "lucide-react";
import {
  ProjectAnalysisModal,
  ProjectAnalyzerModal,
} from "./ProjectAnalyzerModal";
import TeamBuilderModal from "./TeamBuilderModal";
import { apiClient } from "../../lib/apiClient";
import { computeSchedule } from "../../lib/planning";

const INITIAL_PROJECTS = [];

const buildEmptyAnalysis = (name) => ({
  project_name: name,
  analysis: {
    tasks: [],
    original_tasks: [],
  },
});

const formatDateLabel = (value) => {
  if (!value) return "New";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().split("T")[0];
};

const getProjectDurationDays = (analysis) => {
  const sourceTasks =
    analysis?.analysis?.tasks || analysis?.analysis?.original_tasks || [];
  if (!sourceTasks.length) return 1;
  const scheduled = computeSchedule(sourceTasks);
  const maxEnd = scheduled.reduce(
    (acc, task) =>
      Math.max(acc, task.start_days_from_kickoff + task.duration_days),
    0
  );
  return Math.max(1, Math.ceil(maxEnd));
};

const HOURS_PER_DAY = Number.parseInt(
  process.env.NEXT_PUBLIC_TASK_HOURS_PER_DAY || "8",
  10
);

const toNumber = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const mapDbTaskToAnalysis = (task) => {
  const startOffset = Math.max(0, toNumber(task.start_days_from_kickoff, 0));
  let duration = toNumber(task.duration_days, null);
  if (!Number.isFinite(duration)) {
    const estimatedHours = toNumber(task.estimated_hours, null);
    if (Number.isFinite(estimatedHours)) {
      duration = Math.max(1, Math.ceil(estimatedHours / HOURS_PER_DAY));
    } else {
      duration = 1;
    }
  }
  return {
    name: task.name?.trim() || "Untitled task",
    description: task.description || "",
    depends_on: Array.isArray(task.depends_on)
      ? task.depends_on.filter(Boolean)
      : [],
    skills: Array.isArray(task.skills) ? task.skills.filter(Boolean) : [],
    start_days_from_kickoff: startOffset,
    duration_days: Math.max(1, duration),
  };
};

const mapDbProjectToCard = (project) => {
  const deadline = project?.deadline || project?.end_date;
  const analysisTasks = Array.isArray(project?.tasks)
    ? project.tasks.map(mapDbTaskToAnalysis)
    : [];
  return {
    id: project.project_id,
    dbId: project.project_id,
    name: project.name,
    description: project.description || "",
    status: project.start_date ? "In Progress" : "Not Started",
    progress: project.start_date ? 12 : 0,
    accent: "purple",
    due: formatDateLabel(deadline),
    startDate: project.start_date,
    endDate: project.end_date,
    deadline: project.deadline,
    analysis: {
      project_name: project.name,
      analysis: {
        tasks: analysisTasks,
        original_tasks: analysisTasks,
      },
    },
  };
};

export default function ProjectsMain() {
  const [projects, setProjects] = useState(INITIAL_PROJECTS);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [isPlannerOpen, setIsPlannerOpen] = useState(false);
  const [isTeamOpen, setIsTeamOpen] = useState(false);
  const [activeTeamProjectId, setActiveTeamProjectId] = useState(null);
  const [actionError, setActionError] = useState("");

  const progressDots = useMemo(() => Array.from({ length: 10 }), []);

  useEffect(() => {
    let isMounted = true;
    const loadProjects = async () => {
      try {
        const data = await apiClient("/projects", { method: "GET" });
        const items = Array.isArray(data?.projects) ? data.projects : [];
        if (!isMounted) return;
        setProjects(items.map(mapDbProjectToCard));
      } catch (err) {
        if (!isMounted) return;
        setActionError(err?.message || "Unable to load projects.");
      }
    };
    loadProjects();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleAnalysisComplete = (payload) => {
    const projectName = payload?.project_name?.trim() || "New project";
    const projectDescription = payload?.description?.trim() || "";
    const projectId = Date.now();
    const analysisPayload = payload
      ? { ...payload, project_name: projectName }
      : buildEmptyAnalysis(projectName);

    setProjects((prev) => [
      {
        id: projectId,
        name: projectName,
        description: projectDescription,
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

  const handleSaveTeam = async (updatedTeam) => {
    if (!activeTeamProjectId) return;
    const target = projects.find((project) => project.id === activeTeamProjectId);
    if (!target?.dbId) {
      const message = "Save the project before saving the team.";
      setActionError(message);
      throw new Error(message);
    }

    setActionError("");
    const payload = {
      project_id: target.dbId,
      team: updatedTeam?.team || [],
      unassigned_tasks: updatedTeam?.unassigned_tasks || [],
      num_employees: updatedTeam?.num_employees || null,
    };

    try {
      await apiClient("/projects/save-team", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setProjects((prev) =>
        prev.map((project) =>
          project.id === activeTeamProjectId
            ? { ...project, team: updatedTeam }
            : project
        )
      );
    } catch (err) {
      const message = err?.message || "Unable to save team.";
      setActionError(message);
      throw err;
    }
  };

  const handleSaveProject = async (updated) => {
    if (!activeProjectId) return;
    const target = projects.find((project) => project.id === activeProjectId);
    if (!target) return;

    setActionError("");
    const payload = {
      project_id: target.dbId,
      name: target.name,
      description: target.description || "",
      budget: target.budget ?? null,
      tasks: updated?.analysis?.tasks || [],
    };

    try {
      const saved = await apiClient("/projects/save", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setProjects((prev) =>
        prev.map((project) =>
          project.id === activeProjectId
            ? {
                ...project,
                analysis: updated,
                dbId: saved?.project_id ?? project.dbId,
                startDate: saved?.start_date ?? project.startDate,
                endDate: saved?.end_date ?? project.endDate,
                deadline: saved?.deadline ?? project.deadline,
                due: saved?.deadline ? formatDateLabel(saved.deadline) : project.due,
              }
            : project
        )
      );
    } catch (err) {
      const message = err?.message || "Unable to save project.";
      setActionError(message);
      throw err;
    }
  };

  const handleStartProject = async (projectId) => {
    const target = projects.find((project) => project.id === projectId);
    if (!target?.dbId) {
      setActionError("Save the project before starting it.");
      return;
    }

    setActionError("");
    const durationDays = getProjectDurationDays(target.analysis);
    try {
      const updated = await apiClient("/projects/start", {
        method: "POST",
        body: JSON.stringify({
          project_id: target.dbId,
          duration_days: durationDays,
        }),
      });
      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId
            ? {
                ...project,
                status: "In Progress",
                startDate: updated?.start_date ?? project.startDate,
                endDate: updated?.end_date ?? project.endDate,
                deadline: updated?.deadline ?? project.deadline,
                due: updated?.deadline ? formatDateLabel(updated.deadline) : project.due,
              }
            : project
        )
      );
    } catch (err) {
      setActionError(err?.message || "Unable to start project.");
    }
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
          {actionError && <p className="ws-error">{actionError}</p>}

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
                    <button
                      type="button"
                      className="ws-btn ws-project-action-btn is-start"
                      disabled={!project.dbId}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleStartProject(project.id);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      title={
                        project.dbId ? "Start project" : "Save the project first"
                      }
                    >
                      Start project
                    </button>
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
        onClose={(payload) => {
          setIsPlannerOpen(false);
          if (!payload?.discard || !activeProjectId) {
            return;
          }
          setProjects((prev) => {
            const target = prev.find((project) => project.id === activeProjectId);
            if (!target) return prev;
            if (target.dbId) return prev;
            return prev.filter((project) => project.id !== activeProjectId);
          });
          setActiveProjectId(null);
        }}
        analysis={activeProject?.analysis}
        onSave={handleSaveProject}
        isSaved={Boolean(activeProject?.dbId)}
      />
      <TeamBuilderModal
        open={isTeamOpen}
        onClose={() => setIsTeamOpen(false)}
        project={activeTeamProject}
        onSave={handleSaveTeam}
      />
    </>
  );
}
