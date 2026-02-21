"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2, X } from "lucide-react";

export default function TaskDrawer({
  task,
  isOpen = false,
  tasks,
  onClose,
  onRename,
  onDescriptionChange,
  onDurationChange,
  onDependenciesChange,
  onSkillsChange,
  onDelete,
}) {
  const [skillDraft, setSkillDraft] = useState("");

  useEffect(() => {
    setSkillDraft("");
  }, [task?.id]);

  const availableDependencies = useMemo(
    () => tasks.filter((item) => item.id !== task?.id),
    [task?.id, tasks]
  );

  if (!task) return null;

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

  const toggleDependency = (depName) => {
    const current = new Set(task.depends_on || []);
    if (current.has(depName)) {
      current.delete(depName);
    } else {
      current.add(depName);
    }
    onDependenciesChange?.(task.id, Array.from(current));
  };

  const noDepsChecked = (task.depends_on || []).length === 0;

  return (
    <div
      className={`drawer-overlay${isOpen ? " is-open" : ""}`}
      onClick={onClose}
    >
      <aside
        className={`task-drawer${isOpen ? " is-open" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <p className="drawer-kicker">Task details</p>
            <h3>{task.name}</h3>
          </div>
          <button
            className="drawer-close"
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <X size={16} />
          </button>
        </div>

        <label className="drawer-field">
          <span>Task name</span>
          <input
            value={task.name}
            onChange={(event) => onRename?.(task.id, event.target.value)}
          />
        </label>

        <label className="drawer-field">
          <span>Description</span>
          <textarea
            rows={4}
            value={task.description}
            placeholder="Add context, deliverables, or key notes."
            onChange={(event) => onDescriptionChange?.(task.id, event.target.value)}
          />
        </label>

        <label className="drawer-field">
          <span>Duration (days)</span>
          <input
            type="number"
            min="1"
            value={task.duration_days}
            onChange={(event) =>
              onDurationChange?.(task.id, event.target.value)
            }
          />
        </label>

        <div className="drawer-field">
          <span>Depends on</span>
          <div className="drawer-dep-list">
            <label className="drawer-dep-item">
              <input
                type="checkbox"
                checked={noDepsChecked}
                onChange={() => onDependenciesChange?.(task.id, [])}
              />
              <span>No dependencies</span>
            </label>
            {availableDependencies.length === 0 && (
              <span className="drawer-empty-mini">No other tasks available.</span>
            )}
            {availableDependencies.map((dep) => (
              <label key={dep.id} className="drawer-dep-item">
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

        <div className="drawer-field">
          <span>Skills</span>
          <div className="drawer-skill-editor">
            {(task.skills || []).map((skill) => (
              <span key={`${task.id}-${skill}`} className="drawer-skill-chip">
                {skill}
                <button
                  type="button"
                  onClick={() => handleSkillRemove(skill)}
                  aria-label={`Remove ${skill}`}
                >
                  x
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

        <button
          type="button"
          className="drawer-danger"
          onClick={() => onDelete?.(task.id)}
        >
          <Trash2 size={16} />
          Delete task
        </button>
      </aside>
    </div>
  );
}
