"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw, X } from "lucide-react";
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
    id: member?.employee_id || createLocalId(),
    employee_id: member?.employee_id || null,
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

const getInitials = (name = "") =>
  name
    .split(" ")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

const getMatchTone = (score = 0) => {
  if (score >= 0.75) return "is-good";
  if (score >= 0.5) return "is-mid";
  return "is-low";
};

const formatDayRange = (startDay, endDay) => `Day ${startDay} - ${endDay}`;

function MatchBadge({ score }) {
  const tone = getMatchTone(score);
  return (
    <span className={`team-match-badge ${tone}`}>
      Match {Math.round((score || 0) * 100)}%
    </span>
  );
}

function MemberAvatar({ name, className = "" }) {
  return (
    <span
      className={`team-member-avatar ${className}`}
    >
      {getInitials(name)}
    </span>
  );
}

function SummaryCard({ title, children }) {
  return (
    <div className="team-viz-card team-summary-card">
      <div>
        <p className="team-label">{title}</p>
      </div>
      {children}
    </div>
  );
}

function TimelineTaskBlock({ assignment, onSelect, isSelected, style, blockRef }) {
  const missingCount = assignment.missing_skills?.length || 0;
  return (
    <button
      ref={blockRef}
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`team-task-block ${isSelected ? "is-selected" : ""}`}
      style={style}
    >
      <div className="team-task-meta">
        <p className="team-task-title">{assignment.task_name}</p>
        <p className="team-task-range">
          {formatDayRange(assignment.start_day, assignment.end_day)}
        </p>
      </div>
      <MatchBadge score={assignment.semantic_match_score} />
      {missingCount > 0 && (
        <span className="team-task-warning" />
      )}
    </button>
  );
}

function AssignmentPopover({
  assignment,
  members = [],
  onUnassign,
  onReassign,
  style,
  popoverRef,
  isVisible,
}) {
  if (!assignment) return null;
  const matched = assignment.skills_match || [];
  const missing = assignment.missing_skills || [];
  return (
    <div
      ref={popoverRef}
      style={style}
      className={`team-popover ${isVisible ? "is-visible" : ""}`}
      role="dialog"
      aria-label={`Assignment details for ${assignment.task_name}`}
    >
      <div className="team-popover-header">
        <div>
          <p className="team-popover-title">{assignment.task_name}</p>
          <p className="team-popover-range">
            {formatDayRange(assignment.start_day, assignment.end_day)}
          </p>
        </div>
        <MatchBadge score={assignment.semantic_match_score} />
      </div>

      <div className="team-popover-section">
        <p className="team-label">Matched skills</p>
        <div className="team-chip-row">
          {matched.length ? (
            matched.map((skill) => (
              <span
                key={`match-${assignment.id}-${skill}`}
                className="team-chip team-chip--match"
              >
                {skill}
              </span>
            ))
          ) : (
            <span className="team-muted">None</span>
          )}
        </div>
      </div>

      <div className="team-popover-section">
        <p className="team-label">Missing skills</p>
        <div className="team-chip-row">
          {missing.length ? (
            missing.map((skill) => (
              <span
                key={`missing-${assignment.id}-${skill}`}
                className="team-chip team-chip--missing"
              >
                {skill}
              </span>
            ))
          ) : (
            <span className="team-muted">None</span>
          )}
        </div>
      </div>

      <div className="team-popover-actions">
        <button
          type="button"
          className="team-btn team-btn--danger"
          onClick={onUnassign}
        >
          Unassign
        </button>
        <select
          className="team-select"
          value={assignment.memberId || ""}
          onChange={(event) => onReassign(event.target.value)}
        >
          <option value="" disabled>
            Reassign to
          </option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default function TeamBuilderModal({ open, onClose, project, onSave }) {
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
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const [popoverVisible, setPopoverVisible] = useState(false);
  const closeTimerRef = useRef(null);
  const loaderTimerRef = useRef(null);
  const alertTimeoutRef = useRef(null);
  const modalRef = useRef(null);
  const timelineScrollRef = useRef(null);
  const popoverRef = useRef(null);
  const assignmentRefs = useRef(new Map());

  useLockBodyScroll(isVisible);

  useEffect(() => {
    if (!isVisible) return;
    const modal = modalRef.current;
    if (!modal) return;
    const autoFocusEl = modal.querySelector("[data-autofocus='true']");
    autoFocusEl?.focus();
  }, [isVisible, draft]);

  // Focus trap: keep keyboard navigation within the modal.
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
    return new Map(
      (analysisTasks || []).map((task) => [task?.name || "", task])
    );
  }, [analysisTasks]);

  const taskItems = useMemo(() => {
    if (!draft) return [];
    const map = new Map();

    const ensureItem = (name) => {
      if (!map.has(name)) {
        map.set(name, {
          name,
          memberIds: [],
          memberDetails: [],
          start_day: Number.POSITIVE_INFINITY,
          end_day: 0,
          taskSkills: [],
          missingSkills: [],
          bestMatch: 0,
        });
      }
      return map.get(name);
    };

    draft.assignments.forEach((assignment) => {
      if (!assignment?.task_name) return;
      const item = ensureItem(assignment.task_name);
      if (assignment.memberId) {
        item.memberIds.push(assignment.memberId);
      }
      item.memberDetails.push(assignment);
      const startDay = Number.isFinite(assignment.start_day)
        ? assignment.start_day
        : toNumber(assignment.start_day, 0);
      const endDay = Number.isFinite(assignment.end_day)
        ? assignment.end_day
        : toNumber(assignment.end_day, startDay + 1);
      item.start_day = Math.min(item.start_day, startDay);
      item.end_day = Math.max(item.end_day, endDay);
    });

    draft.unassigned.forEach((task) => {
      if (!task?.task_name) return;
      const item = ensureItem(task.task_name);
      const startDay = Number.isFinite(task.start_day)
        ? task.start_day
        : toNumber(task.start_day, 0);
      const endDay = Number.isFinite(task.end_day)
        ? task.end_day
        : toNumber(task.end_day, startDay + 1);
      item.start_day = Math.min(item.start_day, startDay);
      item.end_day = Math.max(item.end_day, endDay);
      if (Array.isArray(task.skills) && task.skills.length) {
        const merged = new Set([...(item.taskSkills || []), ...task.skills]);
        item.taskSkills = Array.from(merged);
      }
    });

    analysisTasks.forEach((task) => {
      if (!task?.name) return;
      const item = ensureItem(task.name);
      if (!item.taskSkills.length && Array.isArray(task.skills)) {
        item.taskSkills = task.skills.filter(Boolean);
      }
      if (!Number.isFinite(item.start_day) || item.start_day === Number.POSITIVE_INFINITY) {
        item.start_day = toNumber(task.start_days_from_kickoff, 0);
      }
      if (!Number.isFinite(item.end_day) || item.end_day === 0) {
        const duration = Math.max(1, toNumber(task.duration_days, 1));
        item.end_day = item.start_day + duration;
      }
    });

    const items = Array.from(map.values()).map((item) => {
      const detailMap = new Map();
      item.memberDetails.forEach((detail) => {
        if (detail?.memberId && !detailMap.has(detail.memberId)) {
          detailMap.set(detail.memberId, detail);
        }
      });
      const memberDetails = Array.from(detailMap.values());
      const memberIds = Array.from(new Set(item.memberIds.filter(Boolean)));
      let start = item.start_day;
      if (!Number.isFinite(start) || start === Number.POSITIVE_INFINITY) {
        start = 0;
      }
      let end = item.end_day;
      if (!Number.isFinite(end) || end <= start) {
        const analysisTask = analysisTaskMap.get(item.name);
        const duration = Math.max(1, toNumber(analysisTask?.duration_days, 1));
        end = start + duration;
      }
      const missing = new Set();
      memberDetails.forEach((detail) => {
        (detail.missing_skills || []).forEach((skill) => missing.add(skill));
      });
      if (!memberDetails.length && item.taskSkills?.length) {
        item.taskSkills.forEach((skill) => missing.add(skill));
      }
      const bestMatch = memberDetails.reduce(
        (max, detail) =>
          Math.max(
            max,
            Number.isFinite(detail.semantic_match_score)
              ? detail.semantic_match_score
              : 0
          ),
        0
      );
      return {
        ...item,
        memberIds,
        memberDetails,
        start_day: start,
        end_day: end,
        missingSkills: Array.from(missing),
        bestMatch,
      };
    });

    return items.sort((a, b) =>
      a.start_day === b.start_day
        ? a.name.localeCompare(b.name)
        : a.start_day - b.start_day
    );
  }, [draft, analysisTasks, analysisTaskMap]);

  const maxDay = useMemo(() => {
    const values = [];
    (draft?.assignments || []).forEach((assignment) => {
      if (Number.isFinite(assignment?.end_day)) {
        values.push(assignment.end_day);
      }
    });
    (draft?.unassigned || []).forEach((task) => {
      if (Number.isFinite(task?.end_day)) {
        values.push(task.end_day);
      }
    });
    return values.length ? Math.max(...values) : 0;
  }, [draft]);

  const dayTicks = useMemo(
    () => Array.from({ length: maxDay + 1 }, (_, index) => index),
    [maxDay]
  );

  const dayGridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${dayTicks.length}, var(--day-width))`,
      minWidth: `calc(${dayTicks.length} * var(--day-width))`,
    }),
    [dayTicks.length]
  );

  const assignmentsByMember = useMemo(() => {
    const map = new Map();
    (draft?.members || []).forEach((member) => map.set(member.id, []));
    (draft?.assignments || []).forEach((assignment) => {
      if (!assignment?.memberId) return;
      if (!map.has(assignment.memberId)) {
        map.set(assignment.memberId, []);
      }
      map.get(assignment.memberId).push(assignment);
    });
    map.forEach((list) =>
      list.sort((a, b) => (a?.start_day || 0) - (b?.start_day || 0))
    );
    return map;
  }, [draft]);

  const selectedAssignment = useMemo(() => {
    if (!selectedAssignmentId) return null;
    return (
      draft?.assignments?.find(
        (assignment) => assignment.id === selectedAssignmentId
      ) || null
    );
  }, [draft, selectedAssignmentId]);

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
    const assigned = taskItems.filter((task) => task.memberIds.length).length;
    const unassigned = taskItems.filter((task) => !task.memberIds.length).length;
    return { members, assigned, unassigned };
  }, [draft, taskItems]);

  const unassignedTasks = useMemo(
    () => taskItems.filter((task) => !task.memberIds.length),
    [taskItems]
  );

  const memberStats = useMemo(() => {
    const counts = new Map();
    draft?.members?.forEach((member) => counts.set(member.id, 0));
    taskItems.forEach((task) => {
      task.memberIds.forEach((memberId) => {
        counts.set(memberId, (counts.get(memberId) || 0) + 1);
      });
    });
    const max = Math.max(1, ...Array.from(counts.values()));
    return { counts, max };
  }, [draft, taskItems]);

  useEffect(() => {
    if (!selectedAssignmentId) return;
    setPopoverVisible(false);
    const frame = requestAnimationFrame(() => {
      setPopoverVisible(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedAssignmentId]);

  const setTaskMembers = (taskName, nextMemberIds = []) => {
    setDraft((prev) => {
      if (!prev) return prev;
      // Update assignments for a task while preserving existing details when possible.
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
    const task = taskItems.find((item) => item.name === taskName);
    const nextIds = (task?.memberIds || []).filter((id) => id !== memberId);
    setTaskMembers(taskName, nextIds);
  };

  const handleAssignUnassigned = (taskName, memberId) => {
    if (!taskName || !memberId) return;
    setTaskMembers(taskName, [memberId]);
  };

  const handleAssignmentUpdate = (assignmentId, nextMemberId) => {
    if (!assignmentId || !nextMemberId) return;
    const assignment = draft?.assignments?.find(
      (item) => item.id === assignmentId
    );
    if (!assignment || assignment.memberId === nextMemberId) return;
    const task = taskItems.find((item) => item.name === assignment.task_name);
    const baseIds = task?.memberIds || [];
    const nextIds = Array.from(
      new Set([
        ...baseIds.filter((id) => id !== assignment.memberId),
        nextMemberId,
      ])
    );
    setTaskMembers(assignment.task_name, nextIds);
    setSelectedAssignmentId(null);
  };

  const handleUnassignAssignment = (assignmentId) => {
    const assignment = draft?.assignments?.find(
      (item) => item.id === assignmentId
    );
    if (!assignment) return;
    handleUnassignMember(assignment.task_name, assignment.memberId);
    setSelectedAssignmentId(null);
  };

  const positionPopover = useCallback((assignmentId, anchorEl) => {
    const container = timelineScrollRef.current;
    const anchor =
      anchorEl || assignmentRefs.current.get(assignmentId) || null;
    if (!container || !anchor) return;
    const containerRect = container.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    const popoverWidth = 320;
    const popoverHeight = 260;
    const padding = 12;

    let left = anchorRect.left - containerRect.left + scrollLeft;
    const minLeft = scrollLeft + padding;
    const maxLeft =
      scrollLeft + containerRect.width - popoverWidth - padding;
    left = Math.min(Math.max(left, minLeft), maxLeft);

    let top = anchorRect.top - containerRect.top + scrollTop + anchorRect.height + 10;
    const maxTop = scrollTop + containerRect.height - popoverHeight - padding;
    if (top > maxTop) {
      top = anchorRect.top - containerRect.top + scrollTop - popoverHeight - 10;
    }
    const minTop = scrollTop + padding;
    if (top < minTop) {
      top = minTop;
    }

    setPopoverPosition({ top, left });
  }, []);

  const handleAssignmentClick = (assignmentId, event) => {
    if (selectedAssignmentId === assignmentId) {
      setSelectedAssignmentId(null);
      return;
    }
    setSelectedAssignmentId(assignmentId);
    positionPopover(assignmentId, event?.currentTarget);
  };

  useEffect(() => {
    if (!selectedAssignmentId) return;
    positionPopover(selectedAssignmentId);
    const handleResize = () => positionPopover(selectedAssignmentId);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [selectedAssignmentId]);

  useEffect(() => {
    if (!selectedAssignmentId) return;
    const handleClick = (event) => {
      const popoverEl = popoverRef.current;
      const anchorEl = assignmentRefs.current.get(selectedAssignmentId);
      if (popoverEl && popoverEl.contains(event.target)) return;
      if (anchorEl && anchorEl.contains(event.target)) return;
      setSelectedAssignmentId(null);
    };
    const handleKey = (event) => {
      if (event.key === "Escape") {
        setSelectedAssignmentId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [selectedAssignmentId]);

  useEffect(() => {
    setSelectedAssignmentId(null);
  }, [draft]);

  const handleSave = () => {
    if (!draft) return;
    const payload = serializeDraft(draft);
    setIsSaving(true);
    setError("");
    Promise.resolve(
      onSave?.({
        ...(payload || {}),
        num_employees: teamSize,
      })
    )
      .then(() => {
        onClose?.();
      })
      .catch((err) => {
        setError(err?.message || "Unable to save team right now.");
      })
      .finally(() => {
        setIsSaving(false);
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

  const currentSnapshot = useMemo(() => serializeDraft(draft), [draft]);
  const originalSnapshot = useMemo(() => {
    if (!project?.team) return null;
    const { num_employees, ...rest } = project.team || {};
    return rest;
  }, [project?.team]);
  const hasChanges = useMemo(() => {
    if (!draft) return false;
    if (!originalSnapshot) return true;
    return JSON.stringify(currentSnapshot) !== JSON.stringify(originalSnapshot);
  }, [currentSnapshot, originalSnapshot, draft]);

  const handleCloseRequest = () => {
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
          onClick={handleCloseRequest}
        >
          <div
            className={`planner-modal p-7${isClosing ? " is-closing" : " is-open"}`}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleModalKeyDown}
          >
            <header className="planner-header team-builder-header">
              <div>
                <p className="ws-kicker">Team Builder</p>
                <div className="planner-title-row">
                  <h2 className="planner-title text-2xl font-semibold tracking-tight">
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
                  className="ws-btn ws-btn-ghost rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-100"
                  onClick={() => handleBuild(teamSize)}
                  disabled={isBuilding || !analysisTasks.length}
                >
                  <RefreshCcw size={16} />
                  {isBuilding ? "Building..." : "Rebuild"}
                </button>
                <button
                  type="button"
                  className="ws-btn ws-btn-primary rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700"
                  onClick={handleSave}
                  disabled={!draft || isSaving}
                >
                  {isSaving ? "Saving..." : "Save team"}
                </button>
                <button
                  type="button"
                  className="ws-modal-close"
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
                    <RefreshCcw size={22} />
                  </span>
                  {alert.title && (
                    <h3 className="planner-alert-title">{alert.title}</h3>
                  )}
                  <p className="planner-alert-message">{alert.message}</p>
                  <div className="planner-alert-actions">
                    <button
                      type="button"
                      className="ws-btn ws-btn-warning"
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
                </div>
              </div>
            )}

            {error && <div className="team-alert">{error}</div>}

            <div className="team-viz-scroll">
            <div className="team-builder-grid team-viz">
              <section className="team-viz-panel">
                <div className="team-viz-panel-inner">
                  <div>
                    <h3 className="team-title">Timeline</h3>
                    <p className="team-subtext">
                      Swimlanes by member with day-by-day coverage.
                    </p>
                  </div>
                  <div className="team-viz-card team-viz-card--scroll">
                    <div
                      className="team-timeline-scroll"
                      ref={timelineScrollRef}
                      data-autofocus="true"
                      tabIndex={0}
                    >
                      <div className="team-timeline-shell">
                        <div
                          className="team-timeline-header"
                          style={{ gridTemplateColumns: "var(--label-width) 1fr" }}
                        >
                          <div className="team-timeline-label">
                            <p className="team-label">Members</p>
                          </div>
                          <div className="team-timeline-days">
                            <div className="team-timeline-day-grid" style={dayGridStyle}>
                              {dayTicks.map((day) => (
                                <div key={day} className="team-timeline-day">
                                  {day === 0 ? `Day ${day}` : day}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="team-timeline-rows">
                          {draft?.members?.length ? (
                            draft.members.map((member) => {
                              const assignments = assignmentsByMember.get(member.id) || [];
                              return (
                                <div
                                  key={member.id}
                                  className="team-timeline-row"
                                  style={{ gridTemplateColumns: "var(--label-width) 1fr" }}
                                >
                                  <div className="team-timeline-lane">
                                    <MemberAvatar
                                      name={member.name}
                                      className="is-accent"
                                    />
                                    <div>
                                      <p className="team-member-name">{member.name}</p>
                                      <p className="team-subtext">
                                        {assignments.length} tasks
                                      </p>
                                    </div>
                                  </div>
                                  <div
                                    className="team-timeline-grid"
                                    style={{
                                      backgroundImage:
                                        "linear-gradient(to right, rgba(148, 163, 184, 0.25) 1px, transparent 1px)",
                                      backgroundSize: "var(--day-width) 100%",
                                    }}
                                  >
                                    <div
                                      className="team-timeline-track"
                                      style={dayGridStyle}
                                    >
                                      {assignments.length ? (
                                        assignments.map((assignment) => {
                                          const start = Number.isFinite(assignment.start_day)
                                            ? assignment.start_day
                                            : 0;
                                          const end = Number.isFinite(assignment.end_day)
                                            ? assignment.end_day
                                            : start + 1;
                                          const span = Math.max(1, end - start + 1);
                                          const gridStyle = {
                                            gridColumn: `${start + 1} / ${start + span + 1}`,
                                          };
                                          return (
                                            <TimelineTaskBlock
                                              key={assignment.id}
                                              assignment={assignment}
                                              isSelected={selectedAssignmentId === assignment.id}
                                              onSelect={(event) =>
                                                handleAssignmentClick(assignment.id, event)
                                              }
                                              style={gridStyle}
                                              blockRef={(el) => {
                                                if (!el) {
                                                  assignmentRefs.current.delete(assignment.id);
                                                  return;
                                                }
                                                assignmentRefs.current.set(assignment.id, el);
                                              }}
                                            />
                                          );
                                        })
                                      ) : (
                                        <div className="team-muted team-timeline-empty">
                                          No tasks assigned.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="team-muted team-timeline-empty">
                              No assignments yet. Run the builder to populate the timeline.
                            </div>
                          )}
                        </div>
                      </div>

                      <AssignmentPopover
                        assignment={selectedAssignment}
                        members={draft?.members || []}
                        onUnassign={() => handleUnassignAssignment(selectedAssignment?.id)}
                        onReassign={(memberId) =>
                          handleAssignmentUpdate(selectedAssignment?.id, memberId)
                        }
                        style={{ top: popoverPosition.top, left: popoverPosition.left }}
                        popoverRef={popoverRef}
                        isVisible={popoverVisible}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <aside className="team-viz-panel">
                <div className="team-viz-panel-inner">
                  <div>
                    <h3 className="team-title">Summary</h3>
                    <p className="team-subtext">
                      Coverage, workload, and unassigned tasks.
                    </p>
                  </div>

                  <div className="team-stack">
                    <SummaryCard title="Coverage">
                      <div className="team-progress">
                        <span
                          className="team-progress-bar"
                          style={{
                            width: `${
                              summary.assigned + summary.unassigned
                                ? Math.round(
                                    (summary.assigned /
                                      (summary.assigned + summary.unassigned)) *
                                      100
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                      <p className="team-subtext">
                        {summary.assigned} assigned &bull; {summary.unassigned} unassigned
                      </p>
                    </SummaryCard>

                    <SummaryCard title="Workload">
                      <div className="team-list">
                        {draft?.members?.length ? (
                          draft.members.map((member) => {
                            const count = memberStats.counts.get(member.id) || 0;
                            const percent = Math.round((count / memberStats.max) * 100);
                            return (
                              <div
                                key={member.id}
                                className="team-workload-row"
                              >
                                <div className="team-workload-meta">
                                  <MemberAvatar
                                    name={member.name}
                                    className="is-accent"
                                  />
                                  <div>
                                    <p className="team-member-name">{member.name}</p>
                                    <span className="team-muted">{count} tasks</span>
                                  </div>
                                </div>
                                <div className="team-workload-bar">
                                  <div className="team-progress team-progress--thin">
                                    <span
                                      className="team-progress-bar team-progress-bar--violet"
                                      style={{ width: `${percent}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <p className="team-muted">No members yet.</p>
                        )}
                      </div>
                    </SummaryCard>

                    <SummaryCard title="Unassigned tasks">
                      {unassignedTasks.length ? (
                        <div className="team-list">
                          {unassignedTasks.map((task) => (
                            <div
                              key={task.name}
                              className="team-unassigned-row"
                            >
                              <div>
                                <p className="team-task-title">{task.name}</p>
                                <p className="team-subtext">
                                  {formatDayRange(task.start_day, task.end_day)}
                                </p>
                              </div>
                              <select
                                className="team-select"
                                defaultValue=""
                                onChange={(event) =>
                                  handleAssignUnassigned(task.name, event.target.value)
                                }
                                disabled={!draft?.members?.length}
                              >
                                <option value="" disabled>
                                  Assign
                                </option>
                                {draft?.members?.map((member) => (
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
                    </SummaryCard>
                  </div>
                </div>
              </aside>
            </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
