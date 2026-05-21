"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as ReactDOM from "react-dom";
import { CheckCircle, Loader2, RefreshCcw, X } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import TeamBuilderV2 from "./team-builder-v2/TeamBuilderV2";

const createLocalId = () => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `team-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const LOADING_PROGRESS_CAP = 94;
const LOADING_EXIT_DELAY = 900;

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeTeamOutput = (teamOutput = {}, tasks = []) => {
  const taskMap = new Map((tasks || []).map((task) => [task?.name || "", task]));
  const members = (teamOutput?.team || []).map((member, index) => ({
    id: member?.employee_id || createLocalId(),
    employee_id: member?.employee_id || null,
    email: member?.employee_email || null,
    role: member?.employee_role || member?.role || null,
    name: member?.employee_filename || `Member ${index + 1}`,
  }));

  const assignments = [];
  (teamOutput?.team || []).forEach((member, memberIndex) => {
    const memberId = members[memberIndex]?.id;
    (member?.assignments || []).forEach((assignment) => {
      const task = taskMap.get(assignment?.task_name || "");
      const start = Number.isFinite(assignment?.start_day)
        ? assignment.start_day
        : toNumber(task?.start_days_from_kickoff, 0);
      const end =
        Number.isFinite(assignment?.end_day)
          ? assignment.end_day
          : start + Math.max(1, toNumber(task?.duration_days, 1));
      assignments.push({
        id: createLocalId(),
        memberId,
        task_name: assignment?.task_name || "Untitled task",
        start_day: start,
        end_day: end,
        skills_match: Array.isArray(assignment?.skills_match)
          ? assignment.skills_match.filter(Boolean)
          : [],
        missing_skills: Array.isArray(assignment?.missing_skills)
          ? assignment.missing_skills.filter(Boolean)
          : [],
        semantic_match_score: Number.isFinite(assignment?.semantic_match_score)
          ? assignment.semantic_match_score
          : 0,
      });
    });
  });

  const assignedNames = new Set(assignments.map((item) => item.task_name));
  const unassigned = (teamOutput?.unassigned_tasks || [])
    .filter(Boolean)
    .map((name) => {
      const task = taskMap.get(name);
      const start = toNumber(task?.start_days_from_kickoff, 0);
      const end = start + Math.max(1, toNumber(task?.duration_days, 1));
      assignedNames.add(name);
      return {
        id: createLocalId(),
        task_name: name,
        start_day: start,
        end_day: end,
        skills: Array.isArray(task?.skills) ? task.skills.filter(Boolean) : [],
      };
    });

  (tasks || []).forEach((task) => {
    if (!task?.name || assignedNames.has(task.name)) return;
    const start = toNumber(task?.start_days_from_kickoff, 0);
    const end = start + Math.max(1, toNumber(task?.duration_days, 1));
    unassigned.push({
      id: createLocalId(),
      task_name: task.name,
      start_day: start,
      end_day: end,
      skills: Array.isArray(task?.skills) ? task.skills.filter(Boolean) : [],
    });
  });

  return {
    members,
    assignments,
    unassigned,
    rationale: teamOutput?.rationale || "",
  };
};

const serializeDraft = (draft) => {
  if (!draft) return null;
  const team = draft.members.map((member) => ({
    employee_id: member.employee_id || null,
    employee_email: member.email || member.employee_email || null,
    employee_filename: member.name,
    assignments: draft.assignments
      .filter((assignment) => assignment.memberId === member.id)
      .map((assignment) => ({
        task_name: assignment.task_name,
        start_day: assignment.start_day,
        end_day: assignment.end_day,
        skills_match: assignment.skills_match,
        missing_skills: assignment.missing_skills,
        semantic_match_score: assignment.semantic_match_score,
      })),
  }));
  return {
    team,
    unassigned_tasks: draft.unassigned.map((task) => task.task_name),
    rationale: draft.rationale || "",
  };
};

const serializeDraftForCompare = (draft) => {
  if (!draft) return null;
  const team = draft.members.map((member) => ({
    employee_id: member.employee_id || null,
    employee_filename: member.name,
    assignments: draft.assignments
      .filter((assignment) => assignment.memberId === member.id)
      .map((assignment) => ({
        task_name: assignment.task_name,
        start_day: assignment.start_day,
        end_day: assignment.end_day,
        skills_match: assignment.skills_match,
        missing_skills: assignment.missing_skills,
        semantic_match_score: assignment.semantic_match_score,
      })),
  }));
  return {
    team,
    unassigned_tasks: draft.unassigned.map((task) => task.task_name),
    rationale: draft.rationale || "",
  };
};

function useLockBodyScroll(isOpen) {
  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const { body } = document;
    const previous = body.style.overflow;
    body.classList.add("tb2-modal-open");
    body.style.overflow = "hidden";
    return () => {
      body.classList.remove("tb2-modal-open");
      body.style.overflow = previous;
    };
  }, [isOpen]);
}

export default function TeamBuilderModal({
  open,
  onClose,
  project,
  onSave,
  readOnly = false,
}) {
  const [teamSize, setTeamSize] = useState(3);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [alert, setAlert] = useState(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isVisible, setIsVisible] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const [isLoaderExiting, setIsLoaderExiting] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isLoaderSuccess, setIsLoaderSuccess] = useState(false);

  const closeTimerRef = useRef(null);
  const loaderTimerRef = useRef(null);
  const alertTimeoutRef = useRef(null);
  const modalRef = useRef(null);
  const emailLookupRef = useRef({ pending: false });
  const progressIntervalRef = useRef(null);

  useLockBodyScroll(isVisible);

  useEffect(() => {
    if (!isVisible) return;
    const modal = modalRef.current;
    if (!modal) return;
    const autoFocusEl = modal.querySelector("[data-autofocus='true']");
    autoFocusEl?.focus();
  }, [isVisible, draft]);

  const handleModalKeyDown = (event) => {
    if (!modalRef.current) return;
    if (event.key === "Tab") {
      const focusable = Array.from(
        modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

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

  const analysis = project?.analysis?.analysis;
  const analysisTasks = analysis?.tasks || [];
  const analysisTaskMap = useMemo(() => {
    return new Map((analysisTasks || []).map((task) => [task?.name || "", task]));
  }, [analysisTasks]);

  const handleBuild = async (overrideSize) => {
    if (readOnly) return;
    if (isBuilding) return;
    if (!analysisTasks.length) {
      setError("Run the project analysis first to generate tasks.");
      return;
    }
    const size = Number.isFinite(overrideSize) ? overrideSize : teamSize;
    setIsBuilding(true);
    setIsLoaderSuccess(false);
    setError("");
    try {
      const payload = {
        project_name: project?.name || project?.analysis?.project_name || "Project",
        analysis,
        num_employees: Math.max(1, size),
      };
      const data = await apiClient("/projects/build-team", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const teamPayload = data?.team;
      const rationale = teamPayload?.rationale || "";
      if (
        !teamPayload ||
        (Array.isArray(teamPayload?.team) &&
          teamPayload.team.length === 0 &&
          rationale.toLowerCase().includes("failed"))
      ) {
        throw new Error(rationale || "Team build failed. Please retry.");
      }
      const normalized = normalizeTeamOutput(teamPayload, analysisTasks);
      setDraft(normalized);
      setSavedSnapshot(null);
      setIsLoaderSuccess(true);
    } catch (err) {
      setError(err?.message || "Team build failed. Please try again.");
      setIsLoaderSuccess(false);
    } finally {
      setIsBuilding(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const storedTeam = project?.team;
    if (storedTeam?.team?.length || storedTeam?.unassigned_tasks?.length) {
      const normalized = normalizeTeamOutput(storedTeam, analysisTasks);
      setDraft(normalized);
      setTeamSize(storedTeam?.num_employees || Math.max(1, normalized.members.length));
      setSavedSnapshot(JSON.stringify(serializeDraftForCompare(normalized)));
      setError("");
      return;
    }
    if (readOnly) {
      setTeamSize(0);
      setDraft(null);
      setSavedSnapshot(null);
      setError("Team details are not available for this project yet.");
      return;
    }
    const suggested = Math.max(1, Math.min(5, analysisTasks.length || 3));
    setTeamSize(suggested);
    setDraft(null);
    if (analysisTasks.length) {
      setError("");
      handleBuild(suggested);
      return;
    }
    setError("Run the project analysis first to generate tasks.");
  }, [open, project?.id, project?.analysis, project?.team]);

  useEffect(() => {
    if (!draft?.members?.length) return;
    const hasMissing = draft.members.some((member) => {
      const hasKey = member?.employee_id || member?.name || member?.email;
      return hasKey && (!member?.email || !member?.role);
    });
    if (!hasMissing) return;
    let cancelled = false;
    (async () => {
      if (emailLookupRef.current.pending) return;
      emailLookupRef.current.pending = true;
      try {
        const response = await apiClient("/projects/employees", {
          method: "GET",
        });
        const employees = Array.isArray(response)
          ? response
          : response?.employees || [];
        const emailMap = new Map();
        const roleMap = new Map();
        const nameMap = new Map();
        employees.forEach((emp) => {
          if (emp?.id && emp?.email) {
            emailMap.set(String(emp.id), emp.email);
          }
          if (emp?.id && emp?.role) {
            roleMap.set(String(emp.id), emp.role);
          }
          if (emp?.name) {
            const key = String(emp.name).trim().toLowerCase();
            if (key) {
              nameMap.set(key, emp);
            }
          }
        });
        if (cancelled) return;
        setDraft((prev) => {
          if (!prev) return prev;
          const nextMembers = prev.members.map((member) => {
            const idKey = member?.employee_id
              ? String(member.employee_id)
              : null;
            const nextEmail =
              member.email ||
              (idKey ? emailMap.get(idKey) : null) ||
              null;
            const nextRole =
              member.role || (idKey ? roleMap.get(idKey) : null) || null;
            const nameKey = member?.name
              ? String(member.name).trim().toLowerCase()
              : null;
            const nameFallback = nameKey ? nameMap.get(nameKey) : null;
            const finalEmail = nextEmail || nameFallback?.email || member.email;
            const finalRole = nextRole || nameFallback?.role || member.role;
            if (!finalEmail && !finalRole) return member;
            return {
              ...member,
              email: finalEmail,
              role: finalRole,
            };
          });
          return { ...prev, members: nextMembers };
        });
      } catch (err) {
        // leave fallback labels if lookup fails
      } finally {
        emailLookupRef.current.pending = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draft?.members]);

  useEffect(() => {
    if (isBuilding) {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      setLoadingProgress(0);
      setIsLoaderSuccess(false);
      progressIntervalRef.current = setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev >= LOADING_PROGRESS_CAP) return prev;
          const remaining = LOADING_PROGRESS_CAP - prev;
          const bump = Math.max(1, Math.round(remaining * 0.12));
          return Math.min(LOADING_PROGRESS_CAP, prev + bump);
        });
      }, 260);
      if (loaderTimerRef.current) {
        clearTimeout(loaderTimerRef.current);
        loaderTimerRef.current = null;
      }
      setShowLoader(true);
      setIsLoaderExiting(false);
      return;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setLoadingProgress(100);
    if (!showLoader) return;
    loaderTimerRef.current = setTimeout(() => {
      setIsLoaderExiting(true);
      loaderTimerRef.current = setTimeout(() => {
        setShowLoader(false);
        setIsLoaderExiting(false);
        loaderTimerRef.current = null;
      }, 220);
    }, LOADING_EXIT_DELAY);
    return () => {
      if (loaderTimerRef.current) {
        clearTimeout(loaderTimerRef.current);
        loaderTimerRef.current = null;
      }
    };
  }, [isBuilding, showLoader]);

  const setTaskMembers = (taskName, nextMemberIds = []) => {
    if (readOnly) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const baseAssignment = prev.assignments.find(
        (assignment) => assignment.task_name === taskName
      );
      const baseUnassigned = prev.unassigned.find(
        (task) => task.task_name === taskName
      );
      const analysisTask = analysisTaskMap.get(taskName);
      const startDay = Number.isFinite(baseAssignment?.start_day)
        ? baseAssignment.start_day
        : Number.isFinite(baseUnassigned?.start_day)
          ? baseUnassigned.start_day
          : toNumber(analysisTask?.start_days_from_kickoff, 0);
      const duration = Math.max(1, toNumber(analysisTask?.duration_days, 1));
      const endDay = Number.isFinite(baseAssignment?.end_day)
        ? baseAssignment.end_day
        : Number.isFinite(baseUnassigned?.end_day)
          ? baseUnassigned.end_day
          : startDay + duration;
      const baseSkills = Array.isArray(baseUnassigned?.skills)
        ? baseUnassigned.skills.filter(Boolean)
        : [];
      const fallbackSkills = Array.isArray(analysisTask?.skills)
        ? analysisTask.skills.filter(Boolean)
        : [];
      const taskSkills = baseSkills.length ? baseSkills : fallbackSkills;

      const nextIds = Array.from(new Set(nextMemberIds.filter(Boolean)));
      const retained = prev.assignments.filter(
        (assignment) => assignment.task_name !== taskName
      );
      const nextAssignments = [...retained];

      nextIds.forEach((memberId) => {
        const existing = prev.assignments.find(
          (assignment) =>
            assignment.task_name === taskName && assignment.memberId === memberId
        );
        if (existing) {
          nextAssignments.push(existing);
          return;
        }
        nextAssignments.push({
          id: createLocalId(),
          memberId,
          task_name: taskName,
          start_day: startDay,
          end_day: endDay,
          skills_match: [],
          missing_skills: taskSkills,
          semantic_match_score: 0,
        });
      });

      let nextUnassigned = prev.unassigned.filter(
        (task) => task.task_name !== taskName
      );
      if (!nextIds.length) {
        nextUnassigned = [
          ...nextUnassigned,
          {
            id: baseUnassigned?.id || createLocalId(),
            task_name: taskName,
            start_day: startDay,
            end_day: endDay,
            skills: taskSkills,
          },
        ];
      }

      return {
        ...prev,
        assignments: nextAssignments,
        unassigned: nextUnassigned,
      };
    });
  };

  const handleUnassignMember = (taskName, memberId) => {
    if (readOnly) return;
    if (!taskName || !memberId || !draft) return;
    const currentIds = (draft.assignments || [])
      .filter((assignment) => assignment.task_name === taskName)
      .map((assignment) => assignment.memberId)
      .filter(Boolean);
    const nextIds = currentIds.filter((id) => id !== memberId);
    setTaskMembers(taskName, nextIds);
  };

  const handleAssignUnassigned = (taskName, memberId) => {
    if (readOnly) return;
    if (!taskName || !memberId) return;
    setTaskMembers(taskName, [memberId]);
  };


  const handleAssignmentUpdate = (assignmentId, nextMemberId) => {
    if (readOnly) return;
    if (!assignmentId || !nextMemberId) return;
    if (
      typeof assignmentId === "string" &&
      assignmentId.startsWith("unassigned::")
    ) {
      const taskName = assignmentId.replace("unassigned::", "");
      handleAssignUnassigned(taskName, nextMemberId);
      return;
    }
    const assignment = draft?.assignments?.find(
      (item) => item.id === assignmentId
    );
    if (!assignment || assignment.memberId === nextMemberId) return;
    const baseIds = (draft?.assignments || [])
      .filter((item) => item.task_name === assignment.task_name)
      .map((item) => item.memberId)
      .filter(Boolean);
    const nextIds = Array.from(
      new Set([
        ...baseIds.filter((id) => id !== assignment.memberId),
        nextMemberId,
      ])
    );
    setTaskMembers(assignment.task_name, nextIds);
  };

  const handleUnassignAssignment = (assignmentId) => {
    if (readOnly) return;
    if (
      !assignmentId ||
      (typeof assignmentId === "string" &&
        assignmentId.startsWith("unassigned::"))
    ) {
      return;
    }
    const assignment = draft?.assignments?.find(
      (item) => item.id === assignmentId
    );
    if (!assignment) return;
    handleUnassignMember(assignment.task_name, assignment.memberId);
  };

  const handleSave = () => {
    if (readOnly || !draft) return;
    const payload = serializeDraft(draft);
    setIsSaving(true);
    setError("");
    const savePromise = Promise.resolve(
      onSave?.({
        ...(payload || {}),
        num_employees: teamSize,
      })
    );
    savePromise.catch(() => {
      // Surface errors in parent (ProjectsMain). Modal closes immediately.
    });
    savePromise.finally(() => {
      setIsSaving(false);
    });
    onClose?.();
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
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  const currentSnapshot = useMemo(() => serializeDraft(draft), [draft]);
  const hasChanges = useMemo(() => {
    if (!draft) return false;
    if (!savedSnapshot) return true;
    return (
      JSON.stringify(serializeDraftForCompare(draft)) !== savedSnapshot
    );
  }, [draft, savedSnapshot]);

  const handleCloseRequest = () => {
    if (readOnly) {
      onClose?.();
      return;
    }
    if (isSaving) return;
    if (!hasChanges) {
      onClose?.();
      return;
    }
    showAlert({
      type: "confirm",
      tone: "warning",
      title: "Close without saving?",
      message: "If you close now, this team will not be saved.",
      confirmLabel: "Close anyway",
      onConfirm: () => {
        setAlert(null);
        onClose?.();
      },
    });
  };

  if (!isVisible) return null;
  const showModal = !isBuilding || Boolean(draft);
  const portalTarget = typeof document !== "undefined" ? document.body : null;
  if (!portalTarget) return null;

  const memberCount = draft?.members?.length || 0;
  const unassignedCount = draft?.unassigned?.length || 0;

  const showBuildLoader = isBuilding || showLoader;
  const loaderState = !isBuilding && isLoaderExiting ? "is-exiting" : "is-entering";

  const modalContent = (
    <>
      {showBuildLoader && (
        <div
          className={`ws-loading-overlay ${loaderState}`}
        >
          <div
            className="ws-loading-card ws-loading-card--overlay"
            role="status"
            aria-live="polite"
          >
            <div className="ws-loading-head">
              <span
                className={`ws-loading-icon ${
                  isLoaderSuccess ? "is-success" : "is-loading"
                }`}
                aria-hidden="true"
              >
                {isLoaderSuccess ? (
                  <CheckCircle size={16} />
                ) : (
                  <Loader2 size={16} />
                )}
              </span>
              <div className="ws-loading-head-text">
                <span className="ws-loading-title">Building team</span>
                <span
                  className={`ws-loading-status${
                    isLoaderSuccess ? " is-success" : ""
                  }`}
                >
                  {isLoaderSuccess ? "True" : "Working..."}
                </span>
              </div>
              <span className="ws-loading-percent">{loadingProgress}%</span>
            </div>
            <div className="ws-loading-bar" aria-hidden="true">
              <span
                className={`ws-loading-bar-fill${
                  isLoaderSuccess ? " is-success" : ""
                }`}
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <p className="ws-loading-subtitle">
              Matching skills and assigning tasks…
            </p>
          </div>
        </div>
      )}
      {showModal && (
        <div
          className={`tb2-overlay tb2-root ${
            isClosing ? "tb-is-closing" : "tb-is-open"
          }`}
          onClick={handleCloseRequest}
        >
          <div
            className={`tb2-panel ${
              isClosing ? "tb-is-closing" : "tb-is-open"
            }`}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleModalKeyDown}
          >
            <header className="tb2-header">
              <div className="tb2-head-left">
                <p className="tb2-kicker">Team Builder</p>
                <h2 className="tb2-title">
                  {project?.name || "Build a team"}
                </h2>
                <p className="tb2-subtitle">
                  {readOnly
                    ? "Review the assigned project team and task ownership."
                    : "Build a high-confidence schedule with clear ownership and timing across every task."}
                </p>
              </div>
              <div className="tb2-head-center">
                <span className="tb2-chip">Team size {memberCount}</span>
                <span className="tb2-chip tb2-chip-muted">
                  {unassignedCount} unassigned
                </span>
              </div>
              <div className="tb2-head-actions">
                {!readOnly ? (
                  <button
                    type="button"
                    className="tb2-btn tb2-btn-ghost"
                    onClick={() => handleBuild(teamSize)}
                    disabled={isBuilding || !analysisTasks.length}
                  >
                    <RefreshCcw size={16} />
                    {isBuilding ? "Building..." : "Rebuild"}
                  </button>
                ) : null}
                {!readOnly && hasChanges ? (
                  <button
                    type="button"
                    className="tb2-btn tb2-btn-primary"
                    onClick={handleSave}
                    disabled={!draft || isSaving}
                  >
                    {isSaving ? "Saving..." : "Save team"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="tb2-icon-btn"
                  onClick={handleCloseRequest}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </header>

            {error && (
              <div className="tb2-error" role="alert">
                <span>{error}</span>
              </div>
            )}

            <div className="tb2-body">
              <TeamBuilderV2
                data={draft}
                analysisTasks={analysisTasks}
                readOnly={readOnly}
                onAssignmentUpdate={handleAssignmentUpdate}
                onUnassignAssignment={handleUnassignAssignment}
              />
            </div>
          </div>

          {alert && (
            <div
              className={`tb2-alert-overlay ${
                alert.type === "confirm" ? "tb-confirm" : ""
              }`}
              onClick={(event) => {
                event.stopPropagation();
                setAlert(null);
              }}
            >
              <div
                className={`tb2-alert-card tb2-alert-${alert.tone || alert.type}`}
                onClick={(event) => event.stopPropagation()}
              >
                <span className="tb2-alert-icon">
                  <RefreshCcw size={22} />
                </span>
                {alert.title && <h3 className="tb2-alert-title">{alert.title}</h3>}
                <p className="tb2-alert-message">{alert.message}</p>
                <div className="tb2-alert-actions">
                  <button
                    type="button"
                    className="tb2-btn tb2-btn-primary"
                    onClick={() => alert.onConfirm?.()}
                  >
                    {alert.confirmLabel || "Confirm"}
                  </button>
                  <button
                    type="button"
                    className="tb2-btn tb2-btn-ghost"
                    onClick={() => setAlert(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );

  return ReactDOM.createPortal(modalContent, portalTarget);
}
