"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  GripVertical,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import Card from "../../Card";

export default function TaskCard({
  task,
  index = 0,
  isConflict,
  draggedId,
  dragOverId,
  draggedDisabled,
  onRename,
  onStartChange,
  onEndChange,
  onDescriptionChange,
  onDependenciesChange,
  onDependencyDrop,
  onSkillsChange,
  onDelete,
  allTasks,
  onDependencyHover,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDepDrop, setIsDepDrop] = useState(false);
  const [draftName, setDraftName] = useState(task.name);
  const [skillDraft, setSkillDraft] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    setDraftName(task.name);
  }, [task.name]);

  useEffect(() => {
    setSkillDraft("");
  }, [task.id]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleCommitName = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== task.name) {
      onRename?.(task.id, trimmed);
    } else {
      setDraftName(task.name);
    }
    setIsEditing(false);
  };

  const handleCancelName = () => {
    setDraftName(task.name);
    setIsEditing(false);
  };

  const handleNameKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCommitName();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handleCancelName();
    }
  };

  const handleSkillCommit = () => {
    const cleaned = skillDraft.trim().replace(/,+$/, "");
    if (!cleaned) return;
    const existing = task.skills || [];
    const exists = existing.some(
      (skill) => skill.toLowerCase() === cleaned.toLowerCase()
    );
    if (exists) {
      setSkillDraft("");
      return;
    }
    onSkillsChange?.(task.id, [...existing, cleaned]);
    setSkillDraft("");
  };

  const handleSkillKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSkillCommit();
    }
  };

  const handleSkillRemove = (skill) => {
    const next = (task.skills || []).filter((item) => item !== skill);
    onSkillsChange?.(task.id, next);
  };

  const deps = task.depends_on || [];
  const visibleDeps = deps.slice(0, 2);
  const extraDeps = deps.length - visibleDeps.length;
  const missingDeps = task.missing_dependencies || [];
  const allSkills = task.skills || [];
  const visibleSkills = allSkills.slice(0, 3);
  const extraSkills = allSkills.length - visibleSkills.length;
  const start = Number.parseInt(task.start_days_from_kickoff, 10) || 0;
  const duration = Number.parseInt(task.duration_days, 10) || 0;
  const end = start + duration;
  const availableDependencies = (allTasks || []).filter(
    (item) => item.id !== task.id
  );

  const toggleDependency = (depName) => {
    const current = new Set(task.depends_on || []);
    if (current.has(depName)) {
      current.delete(depName);
    } else {
      current.add(depName);
    }
    onDependenciesChange?.(task.id, Array.from(current));
  };

  const noDepsChecked = deps.length === 0;
  const toggleExpanded = () => setIsExpanded((prev) => !prev);

  const handleDependencyDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDepDrop(false);
    const sourceId = event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === task.id) return;
    onDependencyDrop?.(sourceId, task.id);
  };

  return (
    <Card
      className={`task-card${dragOverId === task.id ? " is-drag-over" : ""}${
        draggedId === task.id ? " is-dragging" : ""
      }${isConflict ? " is-conflict" : ""}${isExpanded ? " is-expanded" : ""}`}
      onDragOver={(event) => onDragOver?.(event, task.id)}
      onDrop={(event) => onDrop?.(event, task.id)}
      role="listitem"
    >
      <div className="task-card-row task-card-row-main">
        <button
          className="task-drag-handle"
          type="button"
          draggable={!draggedDisabled}
          onDragStart={(event) => onDragStart?.(event, task.id)}
          onDragEnd={onDragEnd}
          aria-label="Drag to reorder"
          onClick={(event) => event.stopPropagation()}
          disabled={draggedDisabled}
        >
          <GripVertical size={16} />
        </button>

        <div className="task-name-wrap">
          <span className="task-index-badge">#{index + 1}</span>
          {isEditing ? (
            <input
              ref={inputRef}
              className="task-name-input"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={handleNameKeyDown}
              onBlur={handleCommitName}
            />
          ) : (
            <button
              type="button"
              className="task-name"
              onClick={() => setIsEditing(true)}
            >
              {task.name}
            </button>
          )}
        </div>

        <div className="task-range-inputs">
          <label className="task-range-field">
            <span>From</span>
            <input
              type="number"
              min="0"
              value={start}
              onChange={(event) => onStartChange?.(task.id, event.target.value)}
            />
          </label>
          <label className="task-range-field">
            <span>To</span>
            <input
              type="number"
              min="1"
              value={end}
              onChange={(event) =>
                onEndChange?.(task.id, event.target.value, start)
              }
            />
          </label>
        </div>

        <button
          className="task-expand-toggle"
          type="button"
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse details" : "Expand details"}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <div className="task-card-row task-card-row-meta">
        <div
          className={`task-meta-deps${isDepDrop ? " is-drop" : ""}`}
          onMouseLeave={() => onDependencyHover?.(null)}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsDepDrop(true);
          }}
          onDragLeave={() => setIsDepDrop(false)}
          onDrop={handleDependencyDrop}
        >
          {deps.length ? (
            <>
              <span className="task-meta-label">Depends on:</span>
              {visibleDeps.map((dep, index) => (
                <button
                  key={`${task.id}-dep-${dep}`}
                  type="button"
                  className="task-dep-pill"
                  onMouseEnter={() => onDependencyHover?.(dep)}
                >
                  {dep}
                  {index < visibleDeps.length - 1 ? "," : ""}
                </button>
              ))}
              {extraDeps > 0 && (
                <span className="task-meta-more">+{extraDeps}</span>
              )}
            </>
          ) : (
            <span className="task-meta-muted">No deps</span>
          )}
          {missingDeps.length > 0 && (
            <span className="task-warning">
              Missing: {missingDeps.join(", ")}
            </span>
          )}
        </div>

        <div className="task-meta-skills">
          {visibleSkills.length > 0 ? (
            <>
              {visibleSkills.map((skill) => (
                <span key={`${task.id}-${skill}`} className="task-skill-chip-small">
                  {skill}
                </span>
              ))}
              {extraSkills > 0 && (
                <span className="task-skill-more">+{extraSkills}</span>
              )}
            </>
          ) : (
            <span className="task-meta-muted">No skills</span>
          )}
        </div>

        <span className="task-meta-separator">•</span>

        <button
          type="button"
          className="task-more-button"
          onClick={toggleExpanded}
        >
          <MoreHorizontal size={16} />
          <span>More</span>
        </button>

        {onDelete && (
          <button
            type="button"
            className="task-delete-icon"
            onClick={() => onDelete?.(task.id)}
            aria-label="Delete task"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className={`task-card-details${isExpanded ? " is-expanded" : ""}`}>
        <div className="task-card-details-inner">
          <label className="task-detail-field">
            <span>Description</span>
            <textarea
              rows={3}
              value={task.description}
              placeholder="Add task context or deliverables."
              onChange={(event) =>
                onDescriptionChange?.(task.id, event.target.value)
              }
            />
          </label>

          <div className="task-dep-editor">
            <span className="task-detail-label">Dependencies</span>
            <div
              className="task-dep-list"
              onMouseLeave={() => onDependencyHover?.(null)}
            >
              <label className="task-dep-item">
                <input
                  type="checkbox"
                  checked={noDepsChecked}
                  onChange={() => onDependenciesChange?.(task.id, [])}
                />
                <span>No dependencies</span>
              </label>
              {availableDependencies.length === 0 && (
                <span className="task-dep-empty">No other tasks available.</span>
              )}
              {availableDependencies.map((dep) => (
                <label
                  key={dep.id}
                  className="task-dep-item"
                  onMouseEnter={() => onDependencyHover?.(dep.name)}
                >
                  <input
                    type="checkbox"
                    checked={(task.depends_on || []).includes(dep.name)}
                    onChange={() => toggleDependency(dep.name)}
                  />
                  <span>{dep.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="task-detail-field">
            <span>Skills</span>
            <div className="task-skill-editor">
              {allSkills.map((skill) => (
                <span key={`${task.id}-${skill}`} className="task-skill-chip">
                  {skill}
                  <button
                    type="button"
                    onClick={() => handleSkillRemove(skill)}
                    aria-label={`Remove ${skill}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                value={skillDraft}
                placeholder="+ Add skill"
                onChange={(event) => setSkillDraft(event.target.value)}
                onKeyDown={handleSkillKeyDown}
                onBlur={handleSkillCommit}
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
