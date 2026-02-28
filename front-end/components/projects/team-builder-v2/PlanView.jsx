"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TaskPill from "./TaskPill";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function PlanView({
  weeks,
  totalWeeks,
  weekWidth,
  dayWidth,
  pillHeight,
  rowGap,
  lanePadding,
  laneTitleHeight,
  formatDayRange,
  getInitials,
  getProgressTone,
  scoreToPercent,
  onOpenTask,
  onOpenPerson,
  membersById,
}) {
  const scrollRef = useRef(null);
  const weekRefs = useRef([]);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartScrollRef = useRef(0);
  const dragRafRef = useRef(null);
  const scrollRafRef = useRef(null);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = scrollRef.current;
      const maxScroll = container.scrollWidth - container.clientWidth;
      const percent = maxScroll > 0 ? container.scrollLeft / maxScroll : 0;
      setScrollPercent(clamp(percent, 0, 1));
    });
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    if (
      event.target?.closest?.(
        "button, input, select, textarea, .tb2-task-pill"
      )
    ) {
      return;
    }
    if (!scrollRef.current) return;
    scrollRef.current.setPointerCapture(event.pointerId);
    dragStartXRef.current = event.clientX;
    dragStartScrollRef.current = scrollRef.current.scrollLeft;
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback((event) => {
    if (!isDragging || !scrollRef.current) return;
    const delta = event.clientX - dragStartXRef.current;
    const nextScroll = dragStartScrollRef.current - delta;
    if (dragRafRef.current) return;
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      scrollRef.current.scrollLeft = nextScroll;
    });
  }, [isDragging]);

  const handlePointerUp = useCallback((event) => {
    if (!isDragging || !scrollRef.current) return;
    scrollRef.current.releasePointerCapture(event.pointerId);
    setIsDragging(false);
  }, [isDragging]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;
    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };
  }, [handleScroll]);

  const jumpToWeek = (index) => {
    const target = weekRefs.current[index];
    if (!target || !scrollRef.current) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="tb2-plan">
      <div className="tb2-plan-head">
        <div className="tb2-week-chips">
          {Array.from({ length: totalWeeks }).map((_, index) => (
            <button
              key={`week-chip-${index}`}
              type="button"
              className="tb2-week-chip"
              onClick={() => jumpToWeek(index)}
            >
              Week {index + 1}
            </button>
          ))}
        </div>
        <div className="tb2-minimap">
          <span className="tb2-minimap-label">Scroll</span>
          <div className="tb2-minimap-track">
            <span
              className="tb2-minimap-handle"
              style={{ left: `${scrollPercent * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div
        className={`tb2-lanes-scroll ${isDragging ? "is-dragging" : ""}`}
        ref={scrollRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="tb2-lanes" style={{ minWidth: weekWidth }}>
          {weeks.map((week, weekIndex) => (
            <div
              key={`week-${weekIndex}`}
              className="tb2-week-lane"
              ref={(el) => {
                weekRefs.current[weekIndex] = el;
              }}
              style={{
                height: week.containerHeight,
                width: weekWidth,
              }}
            >
              <div className="tb2-week-title">Week {weekIndex + 1}</div>
              <div
                className="tb2-week-track"
                style={{
                  height: week.laneHeight,
                  width: weekWidth,
                  "--tb2-day-width": `${dayWidth}px`,
                  "--tb2-row-height": `${pillHeight + rowGap}px`,
                }}
              >
                {week.tasks.map((entry) => (
                  <TaskPill
                    key={`${weekIndex}-${entry.task.name}-${entry.start}`}
                    task={entry.task}
                    displayStart={entry.start}
                    displayEnd={entry.end}
                    style={{
                      left: entry.offset * dayWidth,
                      top:
                        laneTitleHeight +
                        lanePadding +
                        entry.laneIndex * (pillHeight + rowGap),
                      width: entry.duration * dayWidth,
                      height: pillHeight,
                    }}
                    formatDayRange={formatDayRange}
                    getInitials={getInitials}
                    getProgressTone={getProgressTone}
                    scoreToPercent={scoreToPercent}
                    onOpenTask={() => onOpenTask(entry.task.name)}
                    onOpenPerson={onOpenPerson}
                    membersById={membersById}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
