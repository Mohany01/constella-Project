"use client";

import { useEffect, useRef, useState } from "react";

export default function TimelinePreview({
  tasks,
  conflictIds = new Set(),
  highlightIds = new Set(),
  onStartChange,
}) {
  const dragState = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const total = Math.max(
    1,
    ...tasks.map(
      (task) =>
        (Number.parseInt(task.start_days_from_kickoff, 10) || 0) +
        (Number.parseInt(task.duration_days, 10) || 0)
    )
  );

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragState.current || !onStartChange) return;
      const { taskId, left, width, totalDays } = dragState.current;
      const x = Math.min(Math.max(event.clientX - left, 0), width);
      const nextStart = Math.round((x / width) * totalDays);
      onStartChange(taskId, nextStart);
    };

    const handleUp = () => {
      if (dragState.current) {
        dragState.current = null;
        setDraggingId(null);
      }
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [onStartChange]);

  if (!tasks.length) {
    return <div className="planner-empty">No tasks to preview on the timeline.</div>;
  }

  return (
    <div className="timeline-preview">
      <div className="timeline-list">
        {tasks.map((task) => {
          const start = Number.parseInt(task.start_days_from_kickoff, 10) || 0;
          const duration = Number.parseInt(task.duration_days, 10) || 0;
          const end = start + duration;
          const startPercent = (start / total) * 100;
          const durationPercent = Math.max(2, (duration / total) * 100);
          return (
            <div
              key={task.id}
              className={`timeline-row${conflictIds.has(task.id) ? " is-conflict" : ""}${
                highlightIds.has(task.id) ? " is-highlighted" : ""
              }`}
            >
              <div className="timeline-row-head">
                <strong>{task.name}</strong>
                <span>
                  Day {start} -&gt; Day {end}
                </span>
              </div>
              <div
                className="timeline-track"
                style={{
                  "--start": `${startPercent}%`,
                  "--duration": `${durationPercent}%`,
                }}
              >
                <span
                  className={`timeline-bar${draggingId === task.id ? " is-dragging" : ""}`}
                  onMouseDown={(event) => {
                    if (!onStartChange) return;
                    event.preventDefault();
                    const rect = event.currentTarget.parentElement.getBoundingClientRect();
                    dragState.current = {
                      taskId: task.id,
                      left: rect.left,
                      width: rect.width,
                      totalDays: total,
                    };
                    setDraggingId(task.id);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
