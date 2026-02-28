"use client";

export default function TaskPill({
  task,
  displayStart,
  displayEnd,
  style,
  formatDayRange,
  getInitials,
  getProgressTone,
  scoreToPercent,
  onOpenTask,
  onOpenPerson,
  membersById,
}) {
  const scorePercent = scoreToPercent(task.bestMatch || 0);
  const progressTone = getProgressTone(scorePercent);
  const assignedMembers = (task.memberIds || [])
    .map((memberId) => membersById.get(memberId))
    .filter(Boolean);
  const visibleMembers = assignedMembers.slice(0, 3);
  const extraMembers = Math.max(0, assignedMembers.length - visibleMembers.length);

  return (
    <div
      className="tb2-task-pill"
      style={style}
      role="button"
      tabIndex={0}
      onClick={onOpenTask}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenTask?.();
        }
      }}
    >
      <div className="tb2-task-pill-head">
        <span className="tb2-task-pill-title" title={task.name}>
          {task.name}
        </span>
        <span className="tb2-task-pill-score">{scorePercent}%</span>
      </div>
      <span className="tb2-task-pill-range">
        {formatDayRange(
          Number.isFinite(displayStart) ? displayStart : task.start_day,
          Number.isFinite(displayEnd) ? displayEnd : task.end_day
        )}
      </span>
      <div className="tb2-progress">
        <span
          className={`tb2-progress-fill tb2-progress-${progressTone}`}
          style={{ width: `${scorePercent}%` }}
        />
      </div>
      <div className="tb2-task-pill-foot">
        <div className="tb2-avatar-stack">
          {visibleMembers.map((member) => (
            <button
              key={`${task.name}-${member.id}`}
              type="button"
              className="tb2-avatar"
              onClick={(event) => {
                event.stopPropagation();
                onOpenPerson?.(member.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenPerson?.(member.id);
                }
              }}
              aria-label={`Open profile for ${member.name}`}
            >
              {getInitials(member.name)}
            </button>
          ))}
          {extraMembers > 0 && (
            <span className="tb2-avatar tb2-avatar-extra">+{extraMembers}</span>
          )}
        </div>
      </div>
    </div>
  );
}
