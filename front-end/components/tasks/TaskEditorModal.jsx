"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/feedback/FeedbackProvider";
import {
  Check,
  ChevronDown,
  X,
} from "lucide-react";
import { TASK_STATUS_META } from "@/lib/permissions";

export const EMPTY_TASK_DRAFT = {
  projectId: "",
  title: "",
  description: "",
  tag: "General",
  status: "todo",
  progress: 10,
  assigneeIds: [],
};

function getInitials(name) {
  return String(name || "?")
    .split(" ")
    .map((part) => part[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getMemberMeta(member) {
  const role = String(member?.role || "").trim();
  const email = String(member?.email || "").trim();

  if (role && email) return `${role} - ${email}`;
  if (role) return role;
  if (email) return email;
  return "No email available";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSelectPosition(anchorRect, menuRect, gap = 10, padding = 16) {
  if (!anchorRect || !menuRect) return null;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const menuWidth = Math.max(anchorRect.width, Math.min(420, menuRect.width));
  let left = anchorRect.left;
  let top = anchorRect.bottom + gap;
  let placement = "bottom";

  if (top + menuRect.height > viewportHeight - padding) {
    top = anchorRect.top - menuRect.height - gap;
    placement = "top";
  }

  left = clamp(left, padding, viewportWidth - menuWidth - padding);
  top = clamp(top, padding, viewportHeight - menuRect.height - padding);

  return {
    left,
    top,
    width: menuWidth,
    placement,
  };
}

function TaskEditorSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  helper,
  error,
  disabled = false,
  className = "",
}) {
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const frameRef = useRef(null);
  const rafRef = useRef(null);
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    placement: "bottom",
  });

  const selected = useMemo(
    () => options.find((option) => String(option.value) === String(value)),
    [options, value]
  );

  useEffect(() => {
    if (!open) return undefined;

    const updatePosition = () => {
      if (!buttonRef.current || !frameRef.current) return;

      const nextPosition = getSelectPosition(
        buttonRef.current.getBoundingClientRect(),
        frameRef.current.getBoundingClientRect()
      );

      if (nextPosition) {
        setPosition(nextPosition);
      }
    };

    const schedule = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        updatePosition();
      });
    };

    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointer = (event) => {
      if (buttonRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!disabled) return undefined;
    const timeout = window.setTimeout(() => {
      setOpen(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [disabled]);

  const portalTarget =
    typeof document !== "undefined" ? document.body : null;
  const describedBy = helper ? `${selectId}-helper` : undefined;

  return (
    <div
      className={`task-editor-field${error ? " is-invalid" : ""} ${className}`.trim()}
    >
      <span id={`${selectId}-field-label`} className="task-editor-label">
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        className={`task-editor-select-trigger${open ? " is-open" : ""}${!selected ? " is-placeholder" : ""}`}
        onClick={() => {
          if (disabled) return;
          if (!open && buttonRef.current) {
            const anchorRect = buttonRef.current.getBoundingClientRect();
            setPosition((current) => ({
              ...current,
              left: anchorRect.left,
              top: anchorRect.bottom + 10,
              width: anchorRect.width,
            }));
          }
          setOpen((current) => !current);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${selectId}-field-label ${selectId}-label`}
        aria-describedby={describedBy}
        disabled={disabled}
      >
        <span className="task-editor-select-copy">
          <span id={`${selectId}-label`} className="task-editor-select-value">
            {selected?.label || placeholder}
          </span>
          {selected?.description ? (
            <small>{selected.description}</small>
          ) : null}
        </span>
        <ChevronDown size={18} className="task-editor-select-icon" />
      </button>
      {error ? (
        <small className="task-editor-field-error">{error}</small>
      ) : helper ? (
        <small id={describedBy} className="task-editor-helper">
          {helper}
        </small>
      ) : null}
      {open && portalTarget
        ? createPortal(
            <div
              ref={frameRef}
              className="task-editor-select-frame"
              style={{
                top: position.top,
                left: position.left,
                width: position.width,
              }}
            >
              <div
                ref={menuRef}
                className={`task-editor-select-menu is-${position.placement}`}
                role="listbox"
                aria-label={label}
              >
                {options.map((option) => {
                  const isSelected =
                    String(option.value) === String(value);

                  return (
                    <button
                      key={`${label}-${option.value}`}
                      type="button"
                      className={`task-editor-select-option${isSelected ? " is-selected" : ""}`}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      <span className="task-editor-select-option-copy">
                        <span>{option.label}</span>
                        {option.description ? (
                          <small>{option.description}</small>
                        ) : null}
                      </span>
                      {isSelected ? <Check size={16} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            portalTarget
          )
        : null}
    </div>
  );
}

export default function TaskEditorModal({
  open,
  mode = "create",
  draft,
  onChange,
  onClose,
  onSave,
  projects = [],
  members = [],
  isSaving = false,
  disableProjectSelection = false,
  hasSelectedProject = false,
  membersLoading = false,
  membersLoadError = "",
}) {
  const titleId = useId();
  const { showToast } = useToast();
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const title = mode === "edit" ? "Edit task" : "Add task";
  const subtitle =
    mode === "edit"
      ? "Update task details, ownership, status, and progress."
      : "Create a new task, assign team members, and track delivery progress.";

  const projectOptions = useMemo(
    () => [
      { value: "", label: "Select project" },
      ...projects.map((project) => ({
        value: String(project.project_id),
        label: project.name,
      })),
    ],
    [projects]
  );

  const statusOptions = useMemo(
    () =>
      TASK_STATUS_META.map((column) => ({
        value: column.id,
        label: column.title,
      })),
    []
  );

  if (!open) return null;

  const hasMembers = members.length > 0;
  const memberEmptyMessage = membersLoading
    ? "Loading project members..."
    : hasSelectedProject
      ? "No project members available. Add members to this project first or save as unassigned."
      : "Select a project first to assign team members.";
  const memberHelperText = membersLoading
    ? "We’re loading the selected project team."
    : hasMembers
      ? "Select one or more project members to own this task."
      : hasSelectedProject
        ? "This task can still be created without assigned members."
        : "Choose a project to load its available team members.";
  const summaryMessage = formError || membersLoadError;
  const invalidToastTitle =
    mode === "edit" ? "Update failed" : "Task creation failed";

  function clearFieldError(fieldName) {
    setFieldErrors((current) => {
      if (!current[fieldName]) return current;
      const next = { ...current };
      delete next[fieldName];
      return next;
    });
  }

  function updateDraft(fieldName, updater) {
    clearFieldError(fieldName);
    setFormError("");
    onChange(updater);
  }

  function validateDraft() {
    const nextErrors = {};

    if (!String(draft.projectId || "").trim()) {
      nextErrors.projectId = "Project is required.";
    }
    if (!String(draft.title || "").trim()) {
      nextErrors.title = "Task title is required.";
    }

    return nextErrors;
  }

  async function handleSubmit() {
    const nextErrors = validateDraft();
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setFormError("Please review the highlighted fields before saving.");
      showToast({
        type: "warning",
        title: invalidToastTitle,
        message: "Please complete the required fields and try again.",
        duration: 5200,
      });
      return;
    }

    setFieldErrors({});
    setFormError("");
    const result = await onSave?.();
    if (!result?.ok) {
      setFieldErrors(result?.fieldErrors || {});
      setFormError(result?.message || "We could not save this task.");
    }
  }

  function handleClose() {
    setFieldErrors({});
    setFormError("");
    onClose?.();
  }

  const memberSectionHelper = membersLoadError
    ? "Project members could not be loaded right now."
    : memberHelperText;

  const memberSectionMessage = membersLoadError
    ? membersLoadError
    : memberEmptyMessage;

  const fieldErrorProject = fieldErrors.projectId;
  const fieldErrorTitle = fieldErrors.title;

  return (
    <div className="task-editor-backdrop" onClick={handleClose}>
      <div
        className="task-editor-modal ws-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="task-editor-head">
          <div className="task-editor-head-copy">
            <p className="ws-kicker">Tasks</p>
            <h2 id={titleId}>{title}</h2>
            <p className="ws-subtitle">{subtitle}</p>
          </div>
          <button
            type="button"
            className="ws-modal-close task-editor-close"
            onClick={handleClose}
            aria-label="Close task editor"
          >
            <X size={16} />
          </button>
        </div>

        <div className="task-editor-body">
          {summaryMessage ? (
            <div className="task-editor-error-banner" role="alert">
              {summaryMessage}
            </div>
          ) : null}
          <div className="task-editor-grid">
            <TaskEditorSelect
              label="Project"
              value={draft.projectId}
              onChange={(nextValue) =>
                updateDraft("projectId", (current) => ({
                  ...current,
                  projectId: nextValue,
                  assigneeIds: [],
                }))
              }
              options={projectOptions}
              placeholder="Select project"
              disabled={disableProjectSelection || isSaving}
              error={fieldErrorProject}
            />

            <label className="task-editor-field">
              <span className="task-editor-label">Category</span>
              <input
                className="task-editor-control"
                value={draft.tag}
                onChange={(event) =>
                  updateDraft("tag", (current) => ({
                    ...current,
                    tag: event.target.value,
                  }))
                }
                placeholder="Design"
                disabled={isSaving}
              />
              <small className="task-editor-helper">
                Add a short label to help categorize this task.
              </small>
            </label>

            <label
              className={`task-editor-field task-editor-field-wide${
                fieldErrorTitle ? " is-invalid" : ""
              }`}
            >
              <span className="task-editor-label">Title</span>
              <input
                className="task-editor-control"
                value={draft.title}
                onChange={(event) =>
                  updateDraft("title", (current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Create landing page outline"
                disabled={isSaving}
              />
              {fieldErrorTitle ? (
                <small className="task-editor-field-error">{fieldErrorTitle}</small>
              ) : null}
            </label>

            <label className="task-editor-field task-editor-field-wide">
              <span className="task-editor-label">Description</span>
              <textarea
                className="task-editor-control task-editor-textarea"
                rows={4}
                value={draft.description}
                onChange={(event) =>
                  updateDraft("description", (current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Add scope, notes, and expected deliverables."
                disabled={isSaving}
              />
            </label>

            <TaskEditorSelect
              label="Status"
              value={draft.status}
              onChange={(nextValue) =>
                updateDraft("status", (current) => ({
                  ...current,
                  status: nextValue,
                }))
              }
              options={statusOptions}
              placeholder="Select status"
              disabled={isSaving}
            />

            <label className="task-editor-field">
              <span className="task-editor-label">Progress</span>
              <input
                className="task-editor-control"
                type="number"
                min="0"
                max="100"
                value={draft.progress}
                onChange={(event) =>
                  updateDraft("progress", (current) => ({
                    ...current,
                    progress: event.target.value,
                  }))
                }
                disabled={isSaving}
              />
              <small className="task-editor-helper">
                Use 0 to 100 to reflect current completion.
              </small>
            </label>

            <div className="task-editor-field task-editor-field-wide">
              <span className="task-editor-label">Assign members</span>
              <div className="task-editor-members">
                {membersLoading ? (
                  <div className="task-editor-empty">{memberSectionMessage}</div>
                ) : hasMembers ? (
                  members.map((member) => {
                    const checked = draft.assigneeIds.includes(member.id);
                    return (
                      <label
                        key={member.id}
                        className={`task-editor-member-card${checked ? " is-selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            updateDraft("assigneeIds", (current) => ({
                              ...current,
                              assigneeIds: checked
                                ? current.assigneeIds.filter((id) => id !== member.id)
                                : [...current.assigneeIds, member.id],
                            }))
                          }
                          disabled={isSaving}
                        />
                        <span className="task-editor-member-check">
                          <Check size={14} />
                        </span>
                        <span className="task-editor-member-avatar">
                          {getInitials(member.name)}
                        </span>
                        <span className="task-editor-member-copy">
                          <span className="task-editor-member-name">{member.name}</span>
                          <small>{getMemberMeta(member)}</small>
                        </span>
                      </label>
                    );
                  })
                ) : (
                  <div className="task-editor-empty">{memberSectionMessage}</div>
                )}
              </div>
              <small className="task-editor-helper">{memberSectionHelper}</small>
            </div>
          </div>
        </div>

        <div className="task-editor-actions">
          <button
            type="button"
            className="ws-btn ws-btn-ghost task-editor-action-btn"
            onClick={handleClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ws-btn ws-btn-primary task-editor-action-btn task-editor-action-btn-primary"
            onClick={handleSubmit}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : mode === "edit" ? "Save changes" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}
