"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  Filter,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { apiClient } from "@/lib/apiClient";
import { useSessionUser } from "@/lib/auth-client";
import { useConfirm, useToast } from "@/components/feedback/FeedbackProvider";
import {
  addProjectTask,
  buildBoardTasks,
  buildTeamPayloadFromTasks,
  extractTasksFromProject,
  getProjectMemberOptions,
  removeProjectTask,
  replaceProjectTask,
} from "@/lib/task-board";
import {
  TASK_STATUS,
  TASK_STATUS_META,
  canManageTasks,
  canMoveTask,
  canViewTask,
  clampProgress,
  filterProjectsByAccess,
  normalizeTaskStatus,
  statusToDatabaseValue,
} from "@/lib/permissions";
import TaskEditorModal, { EMPTY_TASK_DRAFT } from "./TaskEditorModal";

const STATUS_PROGRESS = {
  [TASK_STATUS.TODO]: 10,
  [TASK_STATUS.IN_PROGRESS]: 55,
  [TASK_STATUS.REVIEW]: 80,
  [TASK_STATUS.DONE]: 100,
};

function getTaskInitials(name) {
  return String(name || "?")
    .split(" ")
    .map((part) => part[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getVisibleAssignees(assignees = []) {
  return assignees.slice(0, 3);
}

function getAssigneeSummary(assignees = []) {
  if (!assignees.length) {
    return "Unassigned";
  }
  if (assignees.length === 1) {
    return assignees[0]?.name || "Assigned";
  }
  const firstName = assignees[0]?.name || "Assigned";
  return `${firstName} +${assignees.length - 1}`;
}

function getDefaultDraft(projects = []) {
  return {
    ...EMPTY_TASK_DRAFT,
    projectId: String(projects[0]?.project_id || ""),
  };
}

function updateTaskInProjects(projects, taskRef, updater) {
  return projects.map((project) => {
    if (String(project.project_id) !== String(taskRef.projectId)) {
      return project;
    }

    const projectTasks = Array.isArray(project.tasks) ? project.tasks : [];
    const nextTasks = projectTasks.map((projectTask) => {
      if (
        String(projectTask.task_id ?? projectTask.id ?? "") !==
        String(taskRef.rawTaskId)
      ) {
        return projectTask;
      }

      return typeof updater === "function"
        ? updater(projectTask)
        : { ...projectTask, ...updater };
    });

    return {
      ...project,
      tasks: nextTasks,
    };
  });
}

export default function TasksBoard() {
  const { user, isLoading: isUserLoading } = useSessionUser({ requireAuth: true });
  const { openConfirm } = useConfirm();
  const { showToast } = useToast();
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("create");
  const [draft, setDraft] = useState(EMPTY_TASK_DRAFT);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sortMode, setSortMode] = useState("status");
  const [memberLoadState, setMemberLoadState] = useState({});
  const [editorSessionKey, setEditorSessionKey] = useState(0);

  const isManager = canManageTasks(user);
  const headerKicker = isManager ? "PROJECT MANAGER BOARD" : "MY TASKS";
  const headerTitle = isManager
    ? "Manage every project task from one command board."
    : "Organize, prioritize, and complete your assigned work.";
  const headerSubtitle = isManager
    ? "Track assignments, priorities, progress, and delivery status across all active projects."
    : "View your assigned tasks and update progress as work moves forward.";

  function isAccessDeniedMessage(message = "") {
    const normalized = String(message || "").trim().toLowerCase();
    return (
      normalized.includes("access denied") ||
      normalized.includes("permission") ||
      normalized.includes("only project manager") ||
      normalized.includes("only project managers") ||
      normalized.includes("unauthorized")
    );
  }

  function showAccessDeniedToast() {
    showToast({
      type: "error",
      title: "Access denied",
      message: "You do not have permission to perform this action.",
    });
  }

  function showActionFailureToast(title, message, err) {
    if (isAccessDeniedMessage(err?.message)) {
      showAccessDeniedToast();
      return;
    }

    showToast({
      type: "error",
      title,
      message,
    });
  }

  function projectHasEmbeddedMembers(project) {
    if (!project) return false;
    return [
      "assignedUsers",
      "members",
      "projectMembers",
      "employees",
      "teamMembers",
      "assignedEmployees",
    ].some((key) => Array.isArray(project?.[key]));
  }

  useEffect(() => {
    if (!user) return undefined;

    let cancelled = false;

    async function loadProjects() {
      setIsLoading(true);
      setPageError("");
      try {
        const data = await apiClient("/projects", { method: "GET" });
        if (cancelled) return;
        const items = Array.isArray(data?.projects) ? data.projects : [];
        setProjects(filterProjectsByAccess(user, items));
      } catch (err) {
        if (!cancelled) {
          const message = err?.message || "Unable to load tasks.";
          setPageError(message);
          showToast({
            type: "error",
            title: "Tasks could not be loaded",
            message: "We could not load the task board. Please try again.",
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadProjects();
    return () => {
      cancelled = true;
    };
  }, [showToast, user]);

  const selectedProjectId = String(draft.projectId || "");
  const selectedMemberLoadState = selectedProjectId
    ? memberLoadState[selectedProjectId] || null
    : null;

  const projectMap = useMemo(
    () =>
      new Map(projects.map((project) => [String(project.project_id), project])),
    [projects]
  );

  const allBoardTasks = useMemo(() => buildBoardTasks(projects), [projects]);

  const visibleTasks = useMemo(() => {
    const filtered = allBoardTasks.filter((task) =>
      canViewTask(user, task, projectMap.get(task.projectId))
    );

    if (sortMode === "alphabetical") {
      return [...filtered].sort((left, right) =>
        left.title.localeCompare(right.title)
      );
    }

    return filtered;
  }, [allBoardTasks, projectMap, sortMode, user]);

  const columns = useMemo(
    () =>
      TASK_STATUS_META.map((column) => ({
        ...column,
        tasks: visibleTasks.filter((task) => task.status === column.id),
      })),
    [visibleTasks]
  );

  const activeTask = useMemo(
    () => allBoardTasks.find((task) => task.id === editingTaskId) || null,
    [allBoardTasks, editingTaskId]
  );

  const selectedProject = useMemo(
    () =>
      projects.find(
        (project) => String(project.project_id) === String(draft.projectId)
      ) || null,
    [draft.projectId, projects]
  );

  const selectedProjectMembers = useMemo(
    () => (selectedProject ? getProjectMemberOptions(selectedProject) : []),
    [selectedProject]
  );

  useEffect(() => {
    if (!isEditorOpen) return undefined;
    if (!selectedProjectId) return undefined;
    if (selectedProjectMembers.length > 0) {
      return undefined;
    }
    if (
      projectHasEmbeddedMembers(selectedProject) &&
      selectedMemberLoadState?.status !== "error"
    ) {
      return undefined;
    }
    if (
      selectedMemberLoadState?.status === "loading" ||
      selectedMemberLoadState?.status === "ready"
    ) {
      return undefined;
    }

    let cancelled = false;
    setMemberLoadState((current) => ({
      ...current,
      [selectedProjectId]: { status: "loading", message: "" },
    }));

    async function loadProjectMembers() {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, 12000);

      try {
        const projectData = await apiClient(`/projects/${selectedProjectId}`, {
          method: "GET",
          signal: controller.signal,
        });
        if (cancelled) return;
        const projectPayload =
          projectData && typeof projectData === "object"
            ? projectData.project || projectData
            : null;

        if (!projectPayload || typeof projectPayload !== "object") {
          throw new Error("Project members could not be loaded.");
        }

        setProjects((current) =>
          current.map((project) =>
            String(project.project_id) === selectedProjectId
              ? { ...project, ...projectPayload }
              : project
          )
        );
        setMemberLoadState((current) => ({
          ...current,
          [selectedProjectId]: { status: "ready", message: "" },
        }));
      } catch (err) {
        if (cancelled) return;
        setMemberLoadState((current) => ({
          ...current,
          [selectedProjectId]: {
            status: "error",
            message:
              err?.name === "AbortError"
                ? "Project members took too long to load. Please try again."
                : err?.message || "We could not load project members.",
          },
        }));
        showToast({
          type: "error",
          title: "Members unavailable",
          message: "We could not load project members for this task.",
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    loadProjectMembers();
    return () => {
      cancelled = true;
    };
  }, [
    isEditorOpen,
    selectedProjectMembers.length,
    selectedMemberLoadState?.status,
    selectedProject,
    selectedProjectId,
    showToast,
  ]);

  async function persistProject(nextProject) {
    await apiClient("/projects/save", {
      method: "POST",
      body: JSON.stringify({
        project_id: nextProject.project_id,
        name: nextProject.name,
        description: nextProject.description || "",
        budget: nextProject.budget ?? null,
        tasks: Array.isArray(nextProject.tasks) ? nextProject.tasks : [],
      }),
    });

    if (Array.isArray(nextProject?.team?.team)) {
      const teamPayload = buildTeamPayloadFromTasks(
        nextProject,
        extractTasksFromProject(nextProject)
      );

      await apiClient("/projects/save-team", {
        method: "POST",
        body: JSON.stringify({
          project_id: nextProject.project_id,
          team: teamPayload.team || [],
          unassigned_tasks: teamPayload.unassigned_tasks || [],
          num_employees: teamPayload.num_employees || null,
        }),
      });
    }
  }

  async function commitProjectUpdate(projectId, updater) {
    const currentProject = projectMap.get(String(projectId));
    if (!currentProject?.project_id) {
      throw new Error("Project details are missing for this task.");
    }

    const nextProject = updater(currentProject);
    const previousProjects = projects;

    setProjects((current) =>
      current.map((project) =>
        String(project.project_id) === String(projectId) ? nextProject : project
      )
    );

    try {
      await persistProject(nextProject);
    } catch (err) {
      setProjects(previousProjects);
      throw err;
    }
  }

  function closeEditor() {
    setIsEditorOpen(false);
    setEditorMode("create");
    setEditingTaskId(null);
    setDraft(getDefaultDraft(projects));
  }

  function openCreateModal() {
    if (!isManager) {
      showAccessDeniedToast();
      return;
    }
    setEditorMode("create");
    setEditingTaskId(null);
    setDraft(getDefaultDraft(projects));
    setEditorSessionKey((current) => current + 1);
    setIsEditorOpen(true);
  }

  function openEditModal(task) {
    if (!isManager) {
      showAccessDeniedToast();
      return;
    }
    setEditorMode("edit");
    setEditingTaskId(task.id);
    setDraft({
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      tag: task.tag,
      status: task.status,
      progress: task.progress,
      assigneeIds: task.assigneeIds,
    });
    setEditorSessionKey((current) => current + 1);
    setIsEditorOpen(true);
  }

  async function handleSaveDraft() {
    if (!isManager) {
      showAccessDeniedToast();
      return {
        ok: false,
        message: "You do not have permission to perform this action.",
      };
    }

    const title = draft.title.trim();
    const projectId = draft.projectId;
    const status = normalizeTaskStatus(draft.status);

    if (!projectId) {
      return {
        ok: false,
        message: "Project is required.",
        fieldErrors: {
          projectId: "Project is required.",
        },
      };
    }
    if (!title) {
      return {
        ok: false,
        message: "Task title is required.",
        fieldErrors: {
          title: "Task title is required.",
        },
      };
    }

    const targetProject = projectMap.get(projectId);
    if (!targetProject) {
      return {
        ok: false,
        message: "The selected project could not be found.",
      };
    }

    const members = getProjectMemberOptions(targetProject);
    const assignees = members.filter((member) =>
      draft.assigneeIds.includes(member.id)
    );

    const baseTask = activeTask;
    const successTitle = editorMode === "edit" ? "Task updated" : "Task created";
    const successMessage =
      editorMode === "edit"
        ? "Your changes have been saved."
        : "The task was added to the board.";
    const nextTask = {
      ...(baseTask || {}),
      projectId,
      projectName: targetProject.name,
      title,
      projectTaskName: title,
      description: draft.description.trim(),
      tag: draft.tag.trim() || "General",
      status,
      progress: clampProgress(draft.progress, status),
      assigneeIds: assignees.map((member) => member.id),
      assignees,
      rawTask: baseTask?.rawTask || {},
      taskIndex:
        editorMode === "edit" && baseTask
          ? baseTask.taskIndex
          : Array.isArray(targetProject.tasks)
            ? targetProject.tasks.length
            : 0,
    };

    setIsSaving(true);

    try {
      if (editorMode === "edit" && baseTask) {
        await commitProjectUpdate(projectId, (project) =>
          replaceProjectTask(project, nextTask)
        );
      } else {
        await commitProjectUpdate(projectId, (project) =>
          addProjectTask(project, nextTask)
        );
      }
      closeEditor();
      showToast({
        type: "success",
        title: successTitle,
        message: successMessage,
      });
      return { ok: true };
    } catch (err) {
      showActionFailureToast(
        editorMode === "edit" ? "Update failed" : "Task creation failed",
        editorMode === "edit"
          ? "We could not save this task."
          : "Please check the task details and try again.",
        err
      );
      return {
        ok: false,
        message: err?.message ||
          (editorMode === "edit"
            ? "We could not save this task."
            : "Please check the task details and try again."),
      };
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteTask(task) {
    if (!isManager) {
      showAccessDeniedToast();
      throw new Error("Access denied");
    }

    setIsSaving(true);
    try {
      await commitProjectUpdate(task.projectId, (project) =>
        removeProjectTask(project, task)
      );
      showToast({
        type: "success",
        title: "Task deleted",
        message: "The task was removed from the board.",
      });
    } catch (err) {
      showActionFailureToast(
        "Delete failed",
        "We could not delete this task.",
        err
      );
      throw err;
    } finally {
      setIsSaving(false);
    }
  }

  function requestDeleteTask(task) {
    if (!isManager) {
      showAccessDeniedToast();
      return;
    }

    openConfirm({
      tone: "danger",
      title: "Delete task?",
      message: "This action cannot be undone.",
      details: task?.title || task?.projectTaskName || "",
      confirmLabel: "Delete task",
      pendingLabel: "Deleting...",
      onConfirm: async () => {
        await handleDeleteTask(task);
      },
    });
  }

  async function moveTaskToStatus(task, nextStatus) {
    const targetProject = projectMap.get(task.projectId);
    if (!canMoveTask(user, task, targetProject)) {
      showAccessDeniedToast();
      return;
    }
    if (!task.rawTaskId) {
      showToast({
        type: "error",
        title: "Status update failed",
        message: "This task could not be updated because its task id is missing.",
      });
      return;
    }

    const normalizedStatus = normalizeTaskStatus(nextStatus);
    if (task.status === normalizedStatus) return;
    const nextDatabaseStatus = statusToDatabaseValue(normalizedStatus);

    const nextProgress =
      normalizedStatus === TASK_STATUS.DONE
        ? 100
        : normalizedStatus === TASK_STATUS.TODO && task.progress >= 100
          ? STATUS_PROGRESS[normalizedStatus]
          : task.progress;
    const optimisticProgress = clampProgress(nextProgress, normalizedStatus);
    const previousStatus =
      task.rawTask?.status ?? statusToDatabaseValue(task.status);
    const previousProgress = clampProgress(
      task.rawTask?.progress ?? task.rawTask?.progress_percent ?? task.progress,
      task.status
    );

    setIsSaving(true);
    setProjects((current) =>
      updateTaskInProjects(current, task, {
        status: nextDatabaseStatus,
        progress: optimisticProgress,
        progress_percent: optimisticProgress,
      })
    );

    try {
      const response = await apiClient(`/projects/tasks/${task.rawTaskId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextDatabaseStatus }),
      });
      setProjects((current) =>
        updateTaskInProjects(current, task, (projectTask) => ({
          ...projectTask,
          ...response?.task,
          status: response?.task?.status ?? nextDatabaseStatus,
          progress:
            response?.task?.progress ??
            response?.task?.progress_percent ??
            optimisticProgress,
          progress_percent:
            response?.task?.progress_percent ??
            response?.task?.progress ??
            optimisticProgress,
        }))
      );
    } catch (err) {
      setProjects((current) =>
        updateTaskInProjects(current, task, {
          status: previousStatus,
          progress: previousProgress,
          progress_percent: previousProgress,
        })
      );
      showActionFailureToast(
        "Status update failed",
        "We could not update this task status.",
        err
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleDragStart(event, task) {
    const project = projectMap.get(task.projectId);
    if (!canMoveTask(user, task, project)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    setDraggingTaskId(task.id);
  }

  function handleDragEnd() {
    setDraggingTaskId(null);
  }

  async function handleColumnDrop(event, columnId) {
    event.preventDefault();
    const taskId = draggingTaskId || event.dataTransfer.getData("text/plain");
    setDraggingTaskId(null);
    if (!taskId) return;

    const task = allBoardTasks.find((item) => item.id === taskId);
    if (!task) return;
    await moveTaskToStatus(task, columnId);
  }

  return (
    <>
      <div className="ws-shell ws-shell-wide ws-shell-tasks">
        <header className="ws-header ws-header-panel">
          <div className="ws-header-copy">
            <p className="ws-kicker">{headerKicker}</p>
            <h1 className="ws-title">{headerTitle}</h1>
            <p className="ws-subtitle">{headerSubtitle}</p>
          </div>
          <div className="ws-actions ws-actions-tasks">
            <button className="ws-btn ws-btn-ghost ws-btn-soft" type="button">
              <Filter size={16} />
              {isManager ? "All Tasks" : "Assigned"}
            </button>
            <button
              className="ws-btn ws-btn-ghost ws-btn-soft"
              type="button"
              onClick={() =>
                setSortMode((current) =>
                  current === "status" ? "alphabetical" : "status"
                )
              }
            >
              <ArrowUpDown size={16} />
              {sortMode === "status" ? "Board Sort" : "A-Z"}
            </button>
            {isManager ? (
              <button
                className="ws-btn ws-btn-primary"
                type="button"
                onClick={openCreateModal}
              >
                <Plus size={16} />
                Add task
              </button>
            ) : null}
          </div>
        </header>

        {pageError ? <p className="ws-error">{pageError}</p> : null}

        {isLoading || isUserLoading ? (
          <section className="ws-panel">
            <div className="ws-empty">Loading tasks...</div>
          </section>
        ) : (
          <div className="ws-board-shell">
            <section className="ws-board">
              {columns.map((column) => (
                <div key={column.id} className="ws-column">
                  <div className="ws-column-head">
                    <h2>{column.title}</h2>
                    <span className={`ws-pill ws-accent-${column.accent}`}>
                      {column.tasks.length}
                    </span>
                  </div>

                  <div
                    className="ws-column-body"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleColumnDrop(event, column.id)}
                  >
                    {column.tasks.length === 0 ? (
                      <div className="ws-task-empty">
                        No tasks in this stage.
                      </div>
                    ) : null}

                    {column.tasks.map((task) => {
                      const project = projectMap.get(task.projectId);
                      const canMove = canMoveTask(user, task, project);

                      return (
                        <article
                          key={task.id}
                          className={`ws-task-card${draggingTaskId === task.id ? " is-dragging" : ""}${!isManager ? " is-readonly" : ""}`}
                          draggable={canMove}
                          onDragStart={(event) => handleDragStart(event, task)}
                          onDragEnd={handleDragEnd}
                        >
                          <div className="ws-task-head">
                            <span className="ws-chip" title={task.projectName}>
                              {task.projectName || "No Project"}
                            </span>
                            <span className="ws-progress-badge">{task.progress}%</span>
                          </div>

                          <h3>{task.title}</h3>
                          <p>{task.description || "No description provided."}</p>

                          <div className="ws-task-meta-row">
                            <div className="ws-task-assignee-group">
                              <div className="ws-task-assignees">
                                {task.assignees.length ? (
                                  <>
                                    <div className="ws-avatar-stack">
                                      {getVisibleAssignees(task.assignees).map((member) => (
                                        <span
                                          key={`${task.id}-${member.id}`}
                                          className="ws-avatar"
                                          title={member.name}
                                        >
                                          {getTaskInitials(member.name)}
                                        </span>
                                      ))}
                                    </div>
                                    {task.assignees.length > 3 ? (
                                      <span
                                        className="ws-avatar-more"
                                        title={`${task.assignees.length - 3} more assignees`}
                                      >
                                        +{task.assignees.length - 3}
                                      </span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="ws-task-unassigned">Unassigned</span>
                                )}
                              </div>
                              <span
                                className={`ws-task-assignee-label${
                                  task.assignees.length ? "" : " is-muted"
                                }`}
                                title={getAssigneeSummary(task.assignees)}
                              >
                                {getAssigneeSummary(task.assignees)}
                              </span>
                            </div>
                            {!isManager && canMove ? (
                              <span className="ws-task-own-badge">Assigned to you</span>
                            ) : null}
                          </div>

                          <div className="ws-progress-bar">
                            <span style={{ width: `${task.progress}%` }} />
                          </div>

                          {isManager ? (
                            <div className="ws-task-actions-row">
                              <button
                                type="button"
                                className="ws-btn ws-btn-ghost ws-task-action-btn"
                                onClick={() => openEditModal(task)}
                                disabled={isSaving}
                              >
                                <Pencil size={14} />
                                Edit
                              </button>
                              <button
                                type="button"
                                className="ws-btn ws-btn-ghost ws-task-action-btn is-danger"
                                onClick={() => requestDeleteTask(task)}
                                disabled={isSaving}
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}
      </div>

      <TaskEditorModal
        key={`task-editor-${editorSessionKey}`}
        open={isEditorOpen}
        mode={editorMode}
        draft={draft}
        onChange={setDraft}
        onClose={closeEditor}
        onSave={handleSaveDraft}
        projects={projects}
        members={selectedProjectMembers}
        isSaving={isSaving}
        disableProjectSelection={editorMode === "edit"}
        hasSelectedProject={Boolean(selectedProject)}
        membersLoading={
          selectedMemberLoadState?.status === "loading" &&
          selectedProjectMembers.length === 0
        }
        membersLoadError={
          selectedMemberLoadState?.status === "error" &&
          selectedProjectMembers.length === 0
            ? selectedMemberLoadState.message
            : ""
        }
      />
    </>
  );
}
