"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw, Users, X } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import AiLoader from "../ui/ai-loader";

const createLocalId = () => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `team-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeTeamOutput = (teamOutput = {}, tasks = []) => {
  const taskMap = new Map(
    (tasks || []).map((task) => [task?.name || "", task])
  );
  const members = (teamOutput?.team || []).map((member, index) => ({
    id: createLocalId(),
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
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);
}

export default function TeamBuilderModal({ open, onClose, project, onSave }) {
  const [teamSize, setTeamSize] = useState(3);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [isVisible, setIsVisible] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const [isLoaderExiting, setIsLoaderExiting] = useState(false);
  const closeTimerRef = useRef(null);
  const loaderTimerRef = useRef(null);

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

  const analysis = project?.analysis?.analysis;
  const analysisTasks = analysis?.tasks || [];

  const handleBuild = async (overrideSize) => {
    if (!analysisTasks.length) {
      setError("Run the project analysis first to generate tasks.");
      return;
    }
    const size = Number.isFinite(overrideSize) ? overrideSize : teamSize;
    setIsBuilding(true);
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
      const normalized = normalizeTeamOutput(data?.team, analysisTasks);
      setDraft(normalized);
    } catch (err) {
      setError(err?.message || "Team build failed. Please try again.");
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
      setError("");
      return;
    }
    const suggested = Math.max(1, Math.min(5, analysisTasks.length || 3));
    setTeamSize(suggested);
    setDraft(null);
    if (analysisTasks.length) {
      setError("");
      handleBuild(suggested);
    } else {
      setError("Run the project analysis first to generate tasks.");
    }
  }, [open, project?.id, project?.analysis, project?.team]);

  useEffect(() => {
    if (isBuilding) {
      if (loaderTimerRef.current) {
        clearTimeout(loaderTimerRef.current);
        loaderTimerRef.current = null;
      }
      setShowLoader(true);
      setIsLoaderExiting(false);
      return;
    }
    if (!showLoader) return;
    setIsLoaderExiting(true);
    loaderTimerRef.current = setTimeout(() => {
      setShowLoader(false);
      setIsLoaderExiting(false);
      loaderTimerRef.current = null;
    }, 220);
    return () => {
      if (loaderTimerRef.current) {
        clearTimeout(loaderTimerRef.current);
        loaderTimerRef.current = null;
      }
    };
  }, [isBuilding, showLoader]);

  const summary = useMemo(() => {
    const members = draft?.members?.length || 0;
    const assigned = draft?.assignments?.length || 0;
    const unassigned = draft?.unassigned?.length || 0;
    return { members, assigned, unassigned };
  }, [draft]);

  const handleAssignmentUpdate = (assignmentId, updater) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        assignments: prev.assignments.map((assignment) =>
          assignment.id === assignmentId ? updater(assignment) : assignment
        ),
      };
    });
  };

  const handleUnassign = (assignmentId) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const target = prev.assignments.find((assignment) => assignment.id === assignmentId);
      if (!target) return prev;
      return {
        ...prev,
        assignments: prev.assignments.filter((assignment) => assignment.id !== assignmentId),
        unassigned: [
          ...prev.unassigned,
          {
            id: target.id,
            task_name: target.task_name,
            start_day: target.start_day,
            end_day: target.end_day,
            skills: target.missing_skills,
          },
        ],
      };
    });
  };

  const handleAssignUnassigned = (taskId, memberId) => {
    if (!memberId) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const target = prev.unassigned.find((task) => task.id === taskId);
      if (!target) return prev;
      return {
        ...prev,
        unassigned: prev.unassigned.filter((task) => task.id !== taskId),
        assignments: [
          ...prev.assignments,
          {
            id: target.id,
            memberId,
            task_name: target.task_name,
            start_day: target.start_day,
            end_day: target.end_day,
            skills_match: [],
            missing_skills: target.skills || [],
            semantic_match_score: 0,
          },
        ],
      };
    });
  };

  const handleSave = () => {
    if (!draft) return;
    const payload = serializeDraft(draft);
    onSave?.({
      ...(payload || {}),
      num_employees: teamSize,
    });
    onClose?.();
  };

  if (!isVisible) return null;
  const showModal = !isBuilding || Boolean(draft);

  return (
    <>
      {showLoader && (
        <AiLoader
          label="Building team"
          size="lg"
          state={isLoaderExiting ? "success" : "loading"}
          className={`ai-loader-overlay ${isLoaderExiting ? "is-exiting" : "is-entering"}`}
        />
      )}
      {showModal && (
        <div
          className={`ws-modal-backdrop${isClosing ? " is-closing" : " is-open"}`}
          onClick={onClose}
        >
          <div
            className={`planner-modal${isClosing ? " is-closing" : " is-open"}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="planner-header team-builder-header">
              <div>
                <p className="ws-kicker">Team Builder</p>
                <div className="planner-title-row">
                  <h2 className="planner-title">
                    {project?.name || "Build a team"}
                  </h2>
                </div>
                <p className="planner-subtitle">
                  Match people to project tasks, review coverage, and fine-tune
                  assignments.
                </p>
              </div>

              <div className="planner-actions">
                <div className="team-size-pill">
                  Team size: {summary.members || 0}
                </div>
                <button
                  type="button"
                  className="ws-btn ws-btn-ghost"
                  onClick={() => handleBuild(teamSize)}
                  disabled={isBuilding || !analysisTasks.length}
                >
                  <RefreshCcw size={16} />
                  {isBuilding ? "Building..." : "Rebuild"}
                </button>
                <button
                  type="button"
                  className="ws-btn ws-btn-primary"
                  onClick={handleSave}
                  disabled={!draft}
                >
                  Save team
                </button>
                <button
                  type="button"
                  className="ws-modal-close"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </header>

            {error && <div className="team-alert">{error}</div>}

            <div className="team-builder-grid">
              <section className="team-panel">
                <div className="team-panel-header">
                  <h3>Assignments</h3>
                  <div className="team-panel-meta">
                    <span>
                      <Users size={14} /> {summary.assigned} assigned
                    </span>
                    <span>{summary.unassigned} unassigned</span>
                  </div>
                </div>
                <div className="team-panel-scroll">
                  {isBuilding ? (
                    <div className="team-loading">
                      Building team recommendations...
                    </div>
                  ) : !draft?.assignments?.length ? (
                    <div className="team-empty">
                      No assignments yet. Run the builder to generate a team.
                    </div>
                  ) : (
                    draft.assignments.map((assignment, index) => (
                      <article
                        key={assignment.id}
                        className="team-assignment-card"
                        style={{ "--i": index }}
                      >
                        <div className="team-assignment-main">
                          <div>
                            <p className="team-task-name">
                              {assignment.task_name}
                            </p>
                            <span className="team-task-range">
                              Day {assignment.start_day} {"->"}{" "}
                              {assignment.end_day}
                            </span>
                          </div>
                          <span className="team-score-pill">
                            Match{" "}
                            {Math.round(
                              (assignment.semantic_match_score || 0) * 100
                            )}
                            %
                          </span>
                        </div>
                        <div className="team-assignment-actions">
                          <label className="team-field">
                            <span>Assigned to</span>
                            <select
                              value={assignment.memberId || ""}
                              onChange={(event) =>
                                handleAssignmentUpdate(assignment.id, (prev) => ({
                                  ...prev,
                                  memberId: event.target.value,
                                }))
                              }
                            >
                              {draft.members.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="team-unassign"
                            onClick={() => handleUnassign(assignment.id)}
                          >
                            Unassign
                          </button>
                        </div>
                        <div className="team-skill-row">
                          <span>Matched skills</span>
                          <div className="team-skill-chips">
                            {assignment.skills_match?.length ? (
                              assignment.skills_match.map((skill) => (
                                <span
                                  key={`${assignment.id}-match-${skill}`}
                                  className="team-skill-chip is-match"
                                >
                                  {skill}
                                </span>
                              ))
                            ) : (
                              <span className="team-skill-muted">None</span>
                            )}
                          </div>
                        </div>
                        <div className="team-skill-row">
                          <span>Missing skills</span>
                          <div className="team-skill-chips">
                            {assignment.missing_skills?.length ? (
                              assignment.missing_skills.map((skill) => (
                                <span
                                  key={`${assignment.id}-missing-${skill}`}
                                  className="team-skill-chip is-missing"
                                >
                                  {skill}
                                </span>
                              ))
                            ) : (
                              <span className="team-skill-muted">None</span>
                            )}
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>

              <aside className="team-panel">
                <div className="team-panel-header">
                  <h3>Team summary</h3>
                  <div className="team-panel-meta">
                    <span>{summary.members} members</span>
                    <span>{summary.assigned} tasks</span>
                  </div>
                </div>
                <div className="team-panel-scroll">
                  <div className="team-summary-card">
                    <h4>Coverage</h4>
                    <p>
                      {summary.assigned} tasks assigned - {summary.unassigned}{" "}
                      pending placement.
                    </p>
                  </div>

                  <div className="team-summary-card">
                    <h4>Members</h4>
                    <div className="team-member-list">
                      {draft?.members?.length ? (
                        draft.members.map((member) => (
                          <div key={member.id} className="team-member-row">
                            <span>{member.name}</span>
                            <span>
                              {
                                draft.assignments.filter(
                                  (assignment) =>
                                    assignment.memberId === member.id
                                ).length
                              }{" "}
                              tasks
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="team-muted">No members yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="team-summary-card">
                    <h4>Unassigned tasks</h4>
                    {draft?.unassigned?.length ? (
                      <div className="team-unassigned-list">
                        {draft.unassigned.map((task) => (
                          <div key={task.id} className="team-unassigned-row">
                            <div>
                              <p>{task.task_name}</p>
                              <span>
                                Day {task.start_day} {"->"} {task.end_day}
                              </span>
                            </div>
                            <select
                              value=""
                              onChange={(event) =>
                                handleAssignUnassigned(
                                  task.id,
                                  event.target.value
                                )
                              }
                            >
                              <option value="" disabled>
                                Assign to...
                              </option>
                              {draft.members.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="team-muted">All tasks are assigned.</p>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
