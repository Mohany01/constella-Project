"use client";

export default function PersonCard({
  member,
  assignments = [],
  scoreToPercent,
  getProgressTone,
  formatDayRange,
  onOpenPerson,
  onOpenTask,
}) {
  const assignmentCount = assignments.length;
  const averageScore = assignmentCount
    ? assignments.reduce(
        (sum, assignment) => sum + (assignment.semantic_match_score || 0),
        0
      ) / assignmentCount
    : 0;
  const averagePercent = scoreToPercent(averageScore);
  const tone = getProgressTone(averagePercent);
  const getEmail = (person) => {
    const email = person?.email || person?.employee_email;
    if (email) return email;
    const fallback = person?.employee_id || person?.id;
    return fallback ? String(fallback).slice(0, 8) : "";
  };
  const getMatchBadge = (percent) => {
    if (percent >= 75) return { label: "Strong Match", tone: "strong" };
    if (percent >= 50) return { label: "Moderate Match", tone: "moderate" };
    return { label: "Weak Match", tone: "weak" };
  };

  return (
    <div
      className="tb2-member-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpenPerson(member.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenPerson(member.id);
        }
      }}
    >
      <div className="tb2-member-head">
        <div className="tb2-member-avatar">
          {member.name?.[0] || getEmail(member)?.[0] || "?"}
          <span
            className={`tb2-member-status ${
              assignmentCount > 0 ? "is-active" : "is-idle"
            }`}
          />
        </div>
        <div>
          <p className="tb2-member-name">{member.name}</p>
          {getEmail(member) && (
            <p className="tb2-member-id">Email: {getEmail(member)}</p>
          )}
        </div>
        <span className="tb2-badge">{assignmentCount} assignments</span>
      </div>

      <div className="tb2-member-section">
        <span className="tb2-section-title">Skill Match Overview</span>
        <div className="tb2-member-progress">
          <span className="tb2-muted">Average Skill Match</span>
          <span className="tb2-member-score">{averagePercent}%</span>
          <div className="tb2-progress tb2-progress-compact">
            <span
              className={`tb2-progress-fill tb2-progress-${tone}`}
              style={{ width: `${averagePercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="tb2-member-section">
        <span className="tb2-section-title">Tasks</span>
        <div className="tb2-member-tasks">
        {assignments.length ? (
          assignments.map((assignment) => {
            const taskName = assignment.task?.name || assignment.task_name;
            const scorePercent = scoreToPercent(
              assignment.semantic_match_score || 0
            );
            const taskTone = getProgressTone(scorePercent);
            const badge = getMatchBadge(scorePercent);
            return (
              <button
                type="button"
                key={assignment.id}
                className="tb2-member-task"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenTask(taskName);
                }}
              >
                <div className="tb2-member-task-row">
                  <span className="tb2-member-task-title" title={taskName}>
                    {taskName}
                  </span>
                  <span className="tb2-member-task-scoreline">
                    <span className="tb2-member-task-score-label">
                      Match Score:
                    </span>
                    <span className="tb2-member-task-score">
                      {scorePercent}%
                    </span>
                    <span
                      className={`tb2-match-badge tb2-match-${badge.tone}`}
                    >
                      {badge.label}
                    </span>
                  </span>
                </div>
                <span className="tb2-member-task-range">
                  {formatDayRange(
                    assignment.start_day,
                    assignment.end_day
                  )}
                </span>
                <div className="tb2-match-bar">
                  <span className="tb2-match-label">Match Score</span>
                  <div className="tb2-progress tb2-progress-compact">
                    <span
                      className={`tb2-progress-fill tb2-progress-${taskTone}`}
                      style={{ width: `${scorePercent}%` }}
                    />
                  </div>
                  <div className="tb2-match-scale">
                    <span>Low</span>
                    <span>Medium</span>
                    <span>High</span>
                  </div>
                </div>
              </button>
            );
          })
        ) : (
          <span className="tb2-muted">No assignments yet.</span>
        )}
        </div>
      </div>
    </div>
  );
}
