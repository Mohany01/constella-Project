"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import MembersPopover from "./MembersPopover";

export default function DetailsDrawer({
  isOpen,
  mode,
  task,
  assignment,
  member,
  assignmentsByMember,
  members,
  readOnly = false,
  scoreToPercent,
  getInitials,
  formatDayRange,
  onClose,
  onOpenPerson,
  onUnassignAssignment,
  onReassign,
}) {
  const assignedMembers = (task?.memberIds || [])
    .map((memberId) => members.find((item) => item.id === memberId))
    .filter(Boolean);
  const assignedDetails = useMemo(() => {
    const map = new Map();
    (task?.memberDetails || []).forEach((detail) => {
      if (detail?.memberId) {
        map.set(detail.memberId, detail);
      }
    });
    return map;
  }, [task?.memberDetails]);
  const projectMembers = useMemo(() => {
    if (members?.length) return members;
    const map = new Map();
    (task?.memberDetails || []).forEach((detail) => {
      if (detail?.memberId && !map.has(detail.memberId)) {
        map.set(detail.memberId, {
          id: detail.memberId,
          name: detail.memberName || detail.memberId,
          email: detail.memberEmail,
        });
      }
    });
    return Array.from(map.values());
  }, [members, task?.memberDetails]);
  const getEmail = (person) => {
    const email = person?.email || person?.employee_email;
    return email || "";
  };
  const getRole = (person) => person?.role || person?.employee_role || "";

  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [membersAnchor, setMembersAnchor] = useState(null);

  const scorePercent = task ? scoreToPercent(task.bestMatch || 0) : 0;
  const memberAssignments =
    mode === "person" && member
      ? assignmentsByMember.get(member.id) || []
      : [];
  const memberTaskCount = memberAssignments.length;
  const memberAverage =
    memberTaskCount > 0
      ? scoreToPercent(
          memberAssignments.reduce(
            (sum, item) => sum + (item.semantic_match_score || 0),
            0
          ) / memberTaskCount
        )
      : 0;
  const workloadAverage = (() => {
    if (!assignmentsByMember || assignmentsByMember.size === 0) return 0;
    const totals = Array.from(assignmentsByMember.values()).map(
      (list) => list.length
    );
    if (!totals.length) return 0;
    return totals.reduce((sum, value) => sum + value, 0) / totals.length;
  })();
  const workloadLabel = (() => {
    if (!memberTaskCount) return "Low";
    if (workloadAverage > 0 && memberTaskCount >= workloadAverage * 1.4) {
      return "High";
    }
    if (workloadAverage > 0 && memberTaskCount <= workloadAverage * 0.6) {
      return "Low";
    }
    return "Balanced";
  })();
  const matchBadge = (percent) => {
    if (percent >= 75) return { label: "Strong Match", tone: "strong" };
    if (percent >= 50) return { label: "Moderate Match", tone: "moderate" };
    return { label: "Weak Match", tone: "weak" };
  };

  if (!isOpen) return null;

  return (
    <aside
      className={`tb2-drawer ${isOpen ? "is-open" : ""}`}
      role="dialog"
      aria-label={mode === "person" ? "Member details" : "Task details"}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="tb2-drawer-header">
        <span className="tb2-drawer-bar-title">
          {mode === "person" ? "Member Profile" : "Task Details"}
        </span>
        <button type="button" className="tb2-icon-btn" onClick={onClose}>
          x
        </button>
      </div>

      <div className="tb2-drawer-body">
        <div className="tb2-drawer-head">
          {mode === "person" && member && (
            <div className="tb2-drawer-avatar">{getInitials(member.name)}</div>
          )}
          <div className="tb2-drawer-head-info">
            <p className="tb2-drawer-title">
              {mode === "person" ? member?.name : task?.name}
            </p>
            {mode === "task" && task && (
              <p className="tb2-drawer-subtitle">
                {formatDayRange(task.start_day, task.end_day)}
              </p>
            )}
            {mode === "person" && getEmail(member) && (
              <p className="tb2-drawer-subtitle">{getEmail(member)}</p>
            )}
            {mode === "person" && getRole(member) && (
              <span className="tb2-role-badge">{getRole(member)}</span>
            )}
          </div>
        </div>

      {mode === "task" && task && (
        <>
          <div className="tb2-drawer-score">
            <span className="tb2-score-label">Match</span>
            <span className="tb2-score-value">{scorePercent}%</span>
          </div>
          <div className="tb2-progress">
            <span
              className="tb2-progress-fill"
              style={{ width: `${scorePercent}%` }}
            />
          </div>

          <div className="tb2-drawer-section">
            <p className="tb2-section-label">Members</p>
            {assignedMembers.length ? (
              <div className="tb2-task-members">
                <div className="tb2-avatar-row">
                  {assignedMembers.slice(0, 4).map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      className="tb2-avatar tb2-avatar-btn"
                      title={getEmail(person)}
                      onClick={() => onOpenPerson(person.id)}
                    >
                      {getInitials(person.name)}
                    </button>
                  ))}
                  {assignedMembers.length > 4 && (
                    <span className="tb2-avatar tb2-avatar-extra">
                      +{assignedMembers.length - 4}
                    </span>
                  )}
                  {!readOnly ? (
                    <button
                      type="button"
                      className="tb2-add-member-btn"
                      title="Add member"
                      onClick={(event) => {
                        setMembersAnchor(event.currentTarget);
                        setIsMembersOpen(true);
                      }}
                    >
                      <Plus size={14} />
                    </button>
                  ) : null}
                </div>
                {/* email chips removed per request */}
              </div>
            ) : (
              <div className="tb2-avatar-row">
                <span className="tb2-muted">No members yet.</span>
                {!readOnly ? (
                  <button
                    type="button"
                    className="tb2-add-member-btn"
                    title="Add member"
                    onClick={(event) => {
                      setMembersAnchor(event.currentTarget);
                      setIsMembersOpen(true);
                    }}
                  >
                    <Plus size={14} />
                  </button>
                ) : null}
              </div>
            )}
          </div>

          <div className="tb2-drawer-section">
            <p className="tb2-section-label">Matched skills</p>
            {task.matchedSkills?.length ? (
              <div className="tb2-chip-row">
                {task.matchedSkills.map((skill) => (
                  <span key={`match-${task.name}-${skill}`} className="tb2-chip">
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <span className="tb2-muted">None</span>
            )}
          </div>

          <div className="tb2-drawer-section">
            <p className="tb2-section-label">Missing skills</p>
            {task.missingSkills?.length ? (
              <div className="tb2-chip-row">
                {task.missingSkills.map((skill) => (
                  <span
                    key={`missing-${task.name}-${skill}`}
                    className="tb2-chip tb2-chip-missing"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <span className="tb2-muted">None</span>
            )}
          </div>

          {!readOnly ? (
            <MembersPopover
              anchorEl={membersAnchor}
              isOpen={isMembersOpen}
              onClose={() => setIsMembersOpen(false)}
              projectMembers={projectMembers}
              assignedMemberIds={new Set(task.memberIds || [])}
              memberDetails={assignedDetails}
              onAddMember={(memberId) => {
                onReassign?.(assignment?.id, memberId);
              }}
              onRemoveMember={(memberId) => {
                const detail = assignedDetails.get(memberId);
                if (detail?.id) {
                  onUnassignAssignment?.(detail.id);
                }
              }}
            />
          ) : null}

        </>
      )}

      {mode === "person" && member && (
        <>
          <div className="tb2-drawer-section">
            <p className="tb2-section-label">Member Summary</p>
            <div className="tb2-summary-grid">
              <div>
                <span className="tb2-summary-label">Total tasks</span>
                <span className="tb2-summary-value">{memberTaskCount}</span>
              </div>
              <div>
                <span className="tb2-summary-label">Average Skill Match</span>
                <span className="tb2-summary-value">{memberAverage}%</span>
              </div>
              <div>
                <span className="tb2-summary-label">Workload</span>
                <span className="tb2-summary-value">{workloadLabel}</span>
              </div>
            </div>
          </div>

          <div className="tb2-drawer-section">
            <p className="tb2-section-label">Tasks</p>
            {memberAssignments.length ? (
              <div className="tb2-drawer-list">
                {memberAssignments.map((item) => {
                  const taskName = item.task?.name || item.task_name;
                  const percent = scoreToPercent(item.semantic_match_score || 0);
                  const badge = matchBadge(percent);
                  return (
                    <div key={item.id} className="tb2-drawer-task-row">
                      <div className="tb2-drawer-task-main">
                        <p className="tb2-drawer-item-title">{taskName}</p>
                        <p className="tb2-drawer-item-subtitle">
                          {formatDayRange(item.start_day, item.end_day)}
                        </p>
                      </div>
                      <div className="tb2-drawer-task-meta">
                        <span className="tb2-task-match">
                          Skill Match {percent}%
                        </span>
                        <span
                          className={`tb2-match-badge tb2-match-${badge.tone}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      {!readOnly ? (
                        <button
                          type="button"
                          className="tb2-remove-btn"
                          title="Remove from this task"
                          aria-label="Remove from this task"
                          onClick={() => onUnassignAssignment?.(item.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="tb2-muted">No assignments yet.</span>
            )}
          </div>
        </>
      )}
      </div>
    </aside>
  );
}
