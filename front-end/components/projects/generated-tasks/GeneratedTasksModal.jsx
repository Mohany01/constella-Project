"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, X } from "lucide-react";
import TaskList from "./TaskList";
import TimelinePreview from "./TimelinePreview";
import {
  computeSchedule,
  detectCycleDetails,
  normalizeTasks,
} from "../../../lib/planning";

const createLocalId = () => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const moveTask = (tasks, sourceId, targetId) => {
  if (!sourceId || !targetId || sourceId === targetId) return tasks;
  const sourceIndex = tasks.findIndex((task) => task.id === sourceId);
  const targetIndex = tasks.findIndex((task) => task.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return tasks;
  const updated = [...tasks];
  const [moved] = updated.splice(sourceIndex, 1);
  updated.splice(targetIndex, 0, moved);
  return updated;
};

const applyOrderDependencies = (ordered) =>
  ordered.map((task, index) => {
    if (index === 0) {
      return { ...task, depends_on: [], start_days_from_kickoff: 0 };
    }
    return {
      ...task,
      depends_on: [ordered[index - 1].name],
      start_days_from_kickoff: 0,
    };
  });

const ensureUniqueName = (tasks, desired, currentId) => {
  const base = desired.trim() || "Untitled task";
  let candidate = base;
  let counter = 1;
  while (tasks.some((task) => task.name === candidate && task.id !== currentId)) {
    candidate = `${base} ${counter}`;
    counter += 1;
  }
  return candidate;
};

const sanitizeTasksForSave = (tasks) =>
  tasks.map(
    ({
      name,
      description,
      depends_on,
      skills,
      start_days_from_kickoff,
      duration_days,
    }) => ({
      name,
      description,
      depends_on,
      skills,
      start_days_from_kickoff,
      duration_days,
    })
  );

function useLockBodyScroll(isOpen) {
  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const { body } = document;
    const previous = body.style.overflow;
    body.classList.add("app-modal-open");
    body.style.overflow = "hidden";
    return () => {
      body.classList.remove("app-modal-open");
      body.style.overflow = previous;
    };
  }, [isOpen]);
}

export default function GeneratedTasksModal({
  open,
  onClose,
  onSave,
  analysis,
  isSaved = false,
}) {
  const [tasks, setTasks] = useState([]);
  const [originalTasks, setOriginalTasks] = useState([]);
  const [hoveredDependency, setHoveredDependency] = useState(null);
  const [alert, setAlert] = useState(null);
  const alertTimeoutRef = useRef(null);
  const modalRef = useRef(null);
  const [isVisible, setIsVisible] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const closeTimerRef = useRef(null);

  useLockBodyScroll(isVisible);

  useEffect(() => {
    if (open) {
      setIsVisible(true);
      setIsClosing(false);
      return;
    }
    if (!isVisible) return;
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setIsClosing(false);
      setIsVisible(false);
    }, 220);
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, [open, isVisible]);

  const scheduledTasks = useMemo(() => computeSchedule(tasks), [tasks]);
  const originalScheduled = useMemo(
    () => computeSchedule(originalTasks),
    [originalTasks]
  );
  const cycleDetails = useMemo(() => detectCycleDetails(tasks), [tasks]);
  const cycleWarning = cycleDetails.hasCycle
    ? "Schedule conflict: circular dependency detected."
    : "";
  const conflictIds = useMemo(() => {
    if (!cycleDetails.hasCycle) return new Set();
    const ids = new Set();
    tasks.forEach((task) => {
      if (cycleDetails.cycleNodes.has(task.name)) {
        ids.add(task.id);
      }
    });
    return ids;
  }, [cycleDetails, tasks]);

  const dependencyHighlightIds = useMemo(() => {
    if (!hoveredDependency) return new Set();
    const ids = new Set();
    scheduledTasks.forEach((task) => {
      if (task.name === hoveredDependency) {
        ids.add(task.id);
      }
    });
    return ids;
  }, [hoveredDependency, scheduledTasks]);

  const currentSnapshot = useMemo(
    () => sanitizeTasksForSave(scheduledTasks),
    [scheduledTasks]
  );
  const originalSnapshot = useMemo(
    () => sanitizeTasksForSave(originalScheduled),
    [originalScheduled]
  );
  const hasChanges = useMemo(
    () => JSON.stringify(currentSnapshot) !== JSON.stringify(originalSnapshot),
    [currentSnapshot, originalSnapshot]
  );
  const showSaveButton = !isSaved || hasChanges;

  useEffect(() => {
    if (!open) return;
    const sourceTasks = analysis?.analysis?.tasks || [];
    const originalSource =
      analysis?.analysis?.original_tasks || analysis?.analysis?.tasks || [];
    const normalizedOriginal = normalizeTasks(originalSource);
    const normalizedCurrent = normalizeTasks(
      sourceTasks.length ? sourceTasks : originalSource
    );
    setOriginalTasks(normalizedOriginal);
    setTasks(normalizedCurrent);
    setAlert(null);
    setHoveredDependency(null);
  }, [analysis, open]);

  const handleCloseRequest = () => {
    if (isSaving) return;
    if (!showSaveButton) {
      onClose?.();
      return;
    }
    showAlert({
      type: "confirm",
      tone: "warning",
      title: "Close without saving?",
      message: "If you close now, this project will not be saved.",
      confirmLabel: "Close anyway",
      onConfirm: () => {
        setAlert(null);
        onClose?.({ discard: true });
      },
    });
  };

  useEffect(() => {
    if (!open) return;
    const modal = modalRef.current;
    if (!modal) return;
    const focusable = modal.querySelectorAll(
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        handleCloseRequest();
      }
      if (event.key === "Tab" && focusable.length > 0) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    first?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const handleRename = (taskId, nextName) => {
    setTasks((prev) => {
      const target = prev.find((task) => task.id === taskId);
      if (!target) return prev;
      const unique = ensureUniqueName(prev, nextName, taskId);
      return prev.map((task) => {
        if (task.id === taskId) {
          return { ...task, name: unique };
        }
        if (task.depends_on?.includes(target.name)) {
          return {
            ...task,
            depends_on: task.depends_on.map((dep) =>
              dep === target.name ? unique : dep
            ),
          };
        }
        return task;
      });
    });
  };

  const handleStartChange = (taskId, nextStart) => {
    const parsed = Number.parseInt(nextStart, 10);
    const safeStart = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, start_days_from_kickoff: safeStart }
          : task
      )
    );
  };

  const handleEndChange = (taskId, nextEnd, currentStart) => {
    const parsedEnd = Number.parseInt(nextEnd, 10);
    const parsedStart = Number.parseInt(currentStart, 10);
    const safeEnd = Number.isFinite(parsedEnd) ? Math.max(0, parsedEnd) : 0;
    const safeStart = Number.isFinite(parsedStart) ? Math.max(0, parsedStart) : 0;
    const nextDuration = Math.max(1, safeEnd - safeStart);
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, duration_days: nextDuration } : task
      )
    );
  };

  const handleDescriptionChange = (taskId, value) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, description: value } : task
      )
    );
  };

  const handleDependenciesChange = (taskId, nextDepends) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, depends_on: nextDepends } : task
      )
    );
  };

  const handleDependencyDrop = (sourceId, targetId) => {
    if (sourceId === targetId) return;
    setTasks((prev) => {
      const sourceTask = prev.find((task) => task.id === sourceId);
      const targetTask = prev.find((task) => task.id === targetId);
      if (!sourceTask || !targetTask) return prev;
      const nextDepends = new Set(sourceTask.depends_on || []);
      nextDepends.add(targetTask.name);
      return prev.map((task) =>
        task.id === sourceId
          ? { ...task, depends_on: Array.from(nextDepends) }
          : task
      );
    });
  };

  const handleSkillsChange = (taskId, nextSkills) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, skills: nextSkills } : task
      )
    );
  };


  const handleReorder = (sourceId, targetId) => {
    setTasks((prev) => applyOrderDependencies(moveTask(prev, sourceId, targetId)));
  };

  const handleAddTask = () => {
    const newTask = {
      id: createLocalId(),
      name: ensureUniqueName(tasks, "New task"),
      description: "",
      depends_on: [],
      skills: [],
      start_days_from_kickoff: 0,
      duration_days: 1,
      meta: { source: "custom", originalIndex: tasks.length },
    };
    setTasks((prev) => [...prev, newTask]);
  };

  const handleDeleteTask = (taskId) => {
    setTasks((prev) => {
      const removed = prev.find((task) => task.id === taskId);
      const next = prev
        .filter((task) => task.id !== taskId)
        .map((task) => {
          if (!removed?.name) return task;
          if (task.depends_on?.includes(removed.name)) {
            return {
              ...task,
              depends_on: task.depends_on.filter((dep) => dep !== removed.name),
            };
          }
          return task;
        });
      return next;
    });
  };

  const showAlert = (nextAlert) => {
    if (alertTimeoutRef.current) {
      clearTimeout(alertTimeoutRef.current);
      alertTimeoutRef.current = null;
    }
    setAlert(nextAlert);
    if (nextAlert && nextAlert.type !== "confirm") {
      alertTimeoutRef.current = setTimeout(() => {
        setAlert(null);
        alertTimeoutRef.current = null;
      }, 2600);
    }
  };

  useEffect(() => {
    return () => {
      if (alertTimeoutRef.current) {
        clearTimeout(alertTimeoutRef.current);
      }
    };
  }, []);

  const handleDeleteRequest = (taskId) => {
    const target = tasks.find((task) => task.id === taskId);
    showAlert({
      type: "confirm",
      tone: "danger",
      title: "Delete task",
      message: `Delete "${target?.name || "this task"}"?`,
      confirmLabel: "Delete",
      onConfirm: () => {
        setAlert(null);
        handleDeleteTask(taskId);
        showAlert({
          type: "success",
          tone: "success",
          title: "Deleted",
          message: "Task deleted.",
        });
      },
    });
  };

  const handleSave = async () => {
    if (!analysis) {
      onClose?.();
      return;
    }
    const cleaned = sanitizeTasksForSave(scheduledTasks);
    const originalPayload =
      analysis?.analysis?.original_tasks || sanitizeTasksForSave(originalTasks);
    const updated = {
      ...analysis,
      analysis: {
        ...(analysis?.analysis || {}),
        tasks: cleaned,
        original_tasks: originalPayload,
      },
    };
    try {
      setIsSaving(true);
      await onSave?.(updated);
      onClose?.();
    } catch (err) {
      showAlert({
        type: "error",
        tone: "danger",
        title: "Save failed",
        message: err?.message || "Unable to save project right now.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToAgent = () => {
    if (!originalTasks.length) return;
    showAlert({
      type: "confirm",
      tone: "warning",
      title: "Reset plan",
      message: "Reset to agent output?",
      confirmLabel: "Reset",
      onConfirm: () => {
        setAlert(null);
        setTasks(originalTasks);
        setHoveredDependency(null);
        showAlert({
          type: "success",
          tone: "success",
          title: "Reset",
          message: "Plan reset.",
        });
      },
    });
  };

  if (!isVisible) return null;

  return (
    <div className={`ws-modal-backdrop${isClosing ? " is-closing" : " is-open"}`}>
      <div
        className={`planner-modal${isClosing ? " is-closing" : " is-open"}`}
        ref={modalRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="planner-header">
          <div>
            <div className="planner-title-row">
              <h2 className="planner-title">
                {analysis?.project_name || "Generated tasks"}
              </h2>
              <span className="planner-count-badge">
                {scheduledTasks.length} Tasks
              </span>
            </div>
            <p className="planner-subtitle">
              Review and edit tasks before saving to your project.
            </p>
          </div>
          <div className="planner-actions">
            <button
              className="ws-btn ws-btn-ghost"
              type="button"
              onClick={handleResetToAgent}
              disabled={!originalTasks.length}
            >
              Reset to agent
            </button>
            {showSaveButton && (
              <button
                className="ws-btn ws-btn-primary"
                type="button"
                onClick={handleSave}
                disabled={cycleDetails.hasCycle || isSaving}
              >
                {isSaving ? "Saving..." : "Save tasks"}
              </button>
            )}
            <button
              className="ws-modal-close"
              type="button"
              onClick={handleCloseRequest}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {alert && (
          <div
            className="planner-alert-overlay"
            onClick={() => setAlert(null)}
          >
            <div
              className={`planner-alert-modal planner-alert-${alert.tone || alert.type}`}
              onClick={(event) => event.stopPropagation()}
            >
              <span className="planner-alert-icon">
                {alert.tone === "danger" && <ShieldAlert size={22} />}
                {alert.tone === "warning" && <AlertTriangle size={22} />}
                {alert.type === "success" && <CheckCircle2 size={22} />}
                {!alert.tone && alert.type === "confirm" && (
                  <AlertTriangle size={22} />
                )}
              </span>
              {alert.title && <h3 className="planner-alert-title">{alert.title}</h3>}
              <p className="planner-alert-message">{alert.message}</p>
              {alert.type === "confirm" ? (
                <div className="planner-alert-actions">
                  <button
                    type="button"
                    className={`ws-btn ${
                      alert.tone === "danger"
                        ? "ws-btn-danger"
                        : alert.tone === "warning"
                          ? "ws-btn-warning"
                          : "ws-btn-primary"
                    }`}
                    onClick={() => alert.onConfirm?.()}
                  >
                    {alert.confirmLabel || "Confirm"}
                  </button>
                  <button
                    type="button"
                    className="ws-btn ws-btn-ghost"
                    onClick={() => setAlert(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="planner-alert-actions">
                  <button
                    type="button"
                    className={`ws-btn ${
                      alert.tone === "success"
                        ? "ws-btn-success"
                        : alert.tone === "warning"
                          ? "ws-btn-warning"
                          : "ws-btn-ghost"
                    }`}
                    onClick={() => setAlert(null)}
                  >
                    OK
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="planner-content">
          <section className="task-list-panel">
            <TaskList
              tasks={scheduledTasks}
              conflictIds={conflictIds}
              allTasks={scheduledTasks}
              onRename={handleRename}
              onStartChange={handleStartChange}
              onEndChange={handleEndChange}
              onDescriptionChange={handleDescriptionChange}
              onDependenciesChange={handleDependenciesChange}
              onDependencyDrop={handleDependencyDrop}
              onSkillsChange={handleSkillsChange}
              onDelete={handleDeleteRequest}
              onDependencyHover={setHoveredDependency}
              onReorder={handleReorder}
            />
            <button
              className="task-add-button"
              type="button"
              onClick={handleAddTask}
            >
              + Add task
            </button>
          </section>

          <aside className="timeline-panel">
            {cycleWarning && (
              <div className="planner-inline-alert">
                <AlertTriangle size={16} />
                <span>{cycleWarning}</span>
              </div>
            )}
            <TimelinePreview
              tasks={scheduledTasks}
              conflictIds={conflictIds}
              highlightIds={dependencyHighlightIds}
              onStartChange={handleStartChange}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
