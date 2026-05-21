"use client";

import { AlertTriangle, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import MembersPopover from "./MembersPopover";

export default function TasksView({
  tasks,
  members,
  membersById,
  readOnly = false,
  scoreToPercent,
  getProgressTone,
  formatDayRange,
  onOpenTask,
  onOpenPerson,
  onAssignmentUpdate,
  onUnassignAssignment,
}) {
  const [query, setQuery] = useState("");
  const [membersAnchor, setMembersAnchor] = useState(null);
  const [popoverTaskName, setPopoverTaskName] = useState(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return tasks;
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => task.name.toLowerCase().includes(needle));
  }, [tasks, query]);

  const tasksByName = useMemo(
    () => new Map(tasks.map((task) => [task.name, task])),
    [tasks]
  );

  const popoverTask = popoverTaskName
    ? tasksByName.get(popoverTaskName)
    : null;
  const assignedDetails = useMemo(() => {
    const map = new Map();
    (popoverTask?.memberDetails || []).forEach((detail) => {
      if (detail?.memberId) {
        map.set(detail.memberId, detail);
      }
    });
    return map;
  }, [popoverTask?.memberDetails]);

  return (
    <div className="tb2-tasks">
      <div className="tb2-tasks-head">
        <div className="tb2-search">
          <span className="tb2-search-icon" aria-hidden="true">
            <Search size={14} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
          />
        </div>
        <span className="tb2-muted">{filtered.length} tasks</span>
      </div>

      <div className="tb2-table">
        <div className="tb2-table-head">
          <span>Task</span>
          <span>Range</span>
          <span className="tb2-table-head-col">
            <span>Match Score</span>
            <span className="tb2-head-sub">Not progress</span>
          </span>
          <span>Members</span>
          <span>Status</span>
        </div>
        <div className="tb2-table-body">
          {filtered.map((task) => {
            const scorePercent = scoreToPercent(task.bestMatch || 0);
            const tone = getProgressTone(scorePercent);
            const assignedMembers = (task.memberIds || [])
              .map((memberId) => membersById.get(memberId))
              .filter(Boolean);
            const assignedCount = assignedMembers.length;
            const isUnassigned = assignedCount === 0;
            const visibleMembers = assignedMembers.slice(0, 3);
            const extraMembers = Math.max(
              0,
              assignedMembers.length - visibleMembers.length
            );

            const getEmail = (person) => {
              const email = person?.email || person?.employee_email;
              return email || "";
            };

            return (
              <div
                key={task.primaryAssignmentId}
                className={`tb2-table-row tb-interactive ${
                  isUnassigned ? "is-unassigned" : ""
                }`}
                role="button"
                tabIndex={0}
                onClick={() => onOpenTask(task.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenTask(task.name);
                  }
                }}
              >
                <span className="tb2-table-title" title={task.name}>
                  <span className="tb2-table-task">
                    {isUnassigned && (
                      <span
                        className="tb2-warning-icon"
                        title="Needs assignment"
                        aria-hidden="true"
                      >
                        <AlertTriangle size={14} />
                      </span>
                    )}
                    <span className="tb2-table-task-text">{task.name}</span>
                  </span>
                </span>
                <span className="tb2-table-range">
                  {formatDayRange(task.start_day, task.end_day)}
                </span>
                <span className="tb2-table-match">
                  <span className="tb2-table-match-text">
                    Match Score {scorePercent}%
                  </span>
                  <span className="tb2-table-bar">
                    <span
                      className={`tb2-progress-fill tb2-progress-${tone}`}
                      style={{ width: `${scorePercent}%` }}
                    />
                  </span>
                </span>
                <span className="tb2-table-assigned">
                  {assignedCount ? (
                    <>
                      <span className="tb2-avatar-stack">
                        {visibleMembers.map((member) => (
                          <button
                            key={`${task.name}-${member.id}`}
                            type="button"
                            className="tb2-avatar tb2-avatar-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenPerson(member.id);
                            }}
                            title={getEmail(member)}
                            aria-label={`Open profile for ${
                              getEmail(member) || member.name || "member"
                            }`}
                          >
                            {member.name?.[0] || getEmail(member)?.[0] || "?"}
                          </button>
                        ))}
                        {extraMembers > 0 && (
                          <span className="tb2-avatar tb2-avatar-extra">
                            +{extraMembers}
                          </span>
                        )}
                      </span>
                      {!readOnly ? (
                        <button
                          type="button"
                          className="tb2-add-member-btn tb-interactive"
                          title="Add member"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMembersAnchor(event.currentTarget);
                            setPopoverTaskName(task.name);
                          }}
                        >
                          <Plus size={14} />
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <div className="tb2-add-members-inline">
                      <span className="tb2-no-members">No members</span>
                      {!readOnly ? (
                        <button
                          type="button"
                          className="tb2-add-members-btn tb-interactive"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMembersAnchor(event.currentTarget);
                            setPopoverTaskName(task.name);
                          }}
                        >
                          <Plus size={14} />
                          <span>Add members</span>
                        </button>
                      ) : null}
                    </div>
                  )}
                </span>
                <span className="tb2-table-status">
                  {assignedCount ? (
                    <span className="tb2-status-badge tb2-status-assigned">
                      Assigned • {assignedCount}{" "}
                      {assignedCount === 1 ? "member" : "members"}
                    </span>
                  ) : (
                    <span className="tb2-status-badge tb2-status-unassigned">
                      Needs assignment
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {!readOnly ? (
        <MembersPopover
          anchorEl={membersAnchor}
          isOpen={Boolean(popoverTask)}
          onClose={() => setPopoverTaskName(null)}
          projectMembers={members}
          assignedMemberIds={new Set(popoverTask?.memberIds || [])}
          memberDetails={assignedDetails}
          onAddMember={(memberId) => {
            if (!popoverTask) return;
            onAssignmentUpdate?.(popoverTask.primaryAssignmentId, memberId);
          }}
          onRemoveMember={(memberId) => {
            const detail = assignedDetails.get(memberId);
            if (detail?.id) {
              onUnassignAssignment?.(detail.id);
            }
          }}
        />
      ) : null}
    </div>
  );
}
