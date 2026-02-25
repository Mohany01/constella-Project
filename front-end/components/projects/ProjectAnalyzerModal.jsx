"use client";

import { useEffect, useRef, useState } from "react";
import { CloudUpload, FileText, X } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import GeneratedTasksModal from "./generated-tasks/GeneratedTasksModal";
import AiLoader from "../ui/ai-loader";

const STEP_TOTAL = 3;

const DURATION_PRESETS = [
  { label: "1 wk", value: 7 },
  { label: "2 wk", value: 14 },
  { label: "1 mo", value: 30 },
  { label: "2 mo", value: 60 },
];

const BRIEF_OPTIONS = [
  {
    id: "text",
    title: "Write description",
    helper: "Summarize goals, scope, and stakeholders for the agent.",
    icon: FileText,
  },
  {
    id: "pdf",
    title: "Upload PDF",
    helper: "Drop a PDF brief for faster extraction.",
    icon: CloudUpload,
  },
];

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

function StepIndicator({ step }) {
  const progress = Math.round((step / STEP_TOTAL) * 100);
  return (
    <div className="ws-stepper" aria-label={`Step ${step} of ${STEP_TOTAL}`}>
      <span className="ws-step-label" aria-live="polite">
        Step {step} of {STEP_TOTAL}
      </span>
      <div
        className="ws-progress-bar"
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={1}
        aria-valuemax={STEP_TOTAL}
        aria-valuenow={step}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function StepPanel({ isActive, children }) {
  return (
    <div
      className={`ws-step-panel${isActive ? " is-active" : ""}`}
      aria-hidden={!isActive}
    >
      {children}
    </div>
  );
}

function BriefTypeCards({ value, onChange, disabled }) {
  return (
    <div
      className="ws-brief-grid"
      role="radiogroup"
      aria-label="Brief type selection"
    >
      {BRIEF_OPTIONS.map((option) => {
        const selected = value === option.id;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.title}
            className={`ws-brief-card${selected ? " is-active" : ""}`}
            onClick={() => onChange(option.id)}
            disabled={disabled}
          >
            <span className="ws-brief-icon">
              <Icon size={18} />
            </span>
            <span className="ws-brief-copy">
              <span className="ws-brief-title">{option.title}</span>
              <span className="ws-brief-text">{option.helper}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PdfUploader({ file, onFileSelect, disabled }) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = (nextFile) => {
    if (disabled) return;
    if (!nextFile) return;
    if (nextFile.type !== "application/pdf") return;
    onFileSelect(nextFile);
  };

  return (
    <label
      className={`ws-upload ws-upload-drop${isDragging ? " is-dragging" : ""}${
        disabled ? " is-disabled" : ""
      }`}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (disabled) return;
        event.preventDefault();
        setIsDragging(false);
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setIsDragging(false);
        const dropped = event.dataTransfer.files?.[0];
        handleFile(dropped);
      }}
    >
      <CloudUpload size={22} />
      <span className="ws-upload-title">
        {file ? file.name : "Drop PDF here or click to upload"}
      </span>
      <span className="ws-upload-subtitle">PDF only, up to 10MB</span>
      <input
        className="sr-only"
        type="file"
        accept="application/pdf"
        onChange={(event) => handleFile(event.target.files?.[0])}
        aria-label="Upload PDF brief"
        disabled={disabled}
      />
    </label>
  );
}

function DurationSelector({
  mode,
  onModeChange,
  durationDays,
  onDurationChange,
  onPreset,
  disabled,
}) {
  const durationValue = Number.parseInt(durationDays, 10);
  return (
    <div className="ws-duration-wrap">
      <div className="ws-duration-options" role="radiogroup" aria-label="Timeline options">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "auto"}
          className={`ws-duration-option${mode === "auto" ? " is-active" : ""}`}
          onClick={() => onModeChange("auto")}
          disabled={disabled}
        >
          <div className="ws-duration-option-title">
            <span>Let the agent decide</span>
            <span className="ws-pill ws-pill-soft ws-pill-mini">Recommended</span>
          </div>
          <p className="ws-duration-option-text">Best for new projects.</p>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "fixed"}
          className={`ws-duration-option${mode === "fixed" ? " is-active" : ""}`}
          onClick={() => onModeChange("fixed")}
          disabled={disabled}
        >
          <div className="ws-duration-option-title">
            <span>Set duration</span>
          </div>
          <p className="ws-duration-option-text">Choose a target number of days.</p>
        </button>
      </div>

      <div
        className={`ws-duration-config${mode === "fixed" ? " is-active" : ""}`}
        aria-hidden={mode !== "fixed"}
      >
        <div className="ws-duration-row">
          <div className="ws-duration-input">
            <input
              className="ws-duration-input-field"
              type="number"
              min="1"
              placeholder="45"
              value={durationDays}
              onChange={(event) => onDurationChange(event.target.value)}
              disabled={disabled}
              aria-label="Project duration in days"
            />
            <span className="ws-duration-unit">days</span>
          </div>
          <div className="ws-duration-chips">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={`ws-duration-chip${
                  durationValue === preset.value ? " is-active" : ""
                }`}
                onClick={() => onPreset(preset.value)}
                disabled={disabled}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectAnalyzerModal({ open, onClose, onComplete }) {
  const [step, setStep] = useState(1);
  const [briefType, setBriefType] = useState("text");
  const [projectName, setProjectName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [durationMode, setDurationMode] = useState("auto");
  const [durationDays, setDurationDays] = useState("");
  const [projectFile, setProjectFile] = useState(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const [isLoaderExiting, setIsLoaderExiting] = useState(false);
  const [isVisible, setIsVisible] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);
  const closeTimerRef = useRef(null);
  const loaderTimerRef = useRef(null);
  const modalRef = useRef(null);
  const bodyRef = useRef(null);
  const isUploadMode = briefType === "pdf";
  const descriptionPlaceholder = isUploadMode
    ? "Short summary to complement the PDF brief."
    : "Quick summary of goals, scope, and stakeholders.";

  useLockBodyScroll(isVisible);

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

  useEffect(() => {
    if (isSubmitting) {
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
    }, 200);
    return () => {
      if (loaderTimerRef.current) {
        clearTimeout(loaderTimerRef.current);
        loaderTimerRef.current = null;
      }
    };
  }, [isSubmitting, showLoader]);

  const resetForm = () => {
    setStep(1);
    setBriefType("text");
    setProjectName("");
    setAgentDescription("");
    setShortDescription("");
    setDurationMode("auto");
    setDurationDays("");
    setProjectFile(null);
    setError("");
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setError("");
    resetForm();
    onClose?.();
  };

  const handleBriefTypeChange = (nextType) => {
    setBriefType(nextType);
    setError("");
  };

  const handleDurationPreset = (value) => {
    setDurationMode("fixed");
    setDurationDays(String(value));
  };

  const handleDurationModeChange = (modeValue) => {
    setDurationMode(modeValue);
    if (modeValue === "auto") {
      setDurationDays("");
    }
  };

  const isProjectNameValid = projectName.trim().length > 0;
  const isAgentDescriptionValid = agentDescription.trim().length > 0;
  const isShortDescriptionValid = shortDescription.trim().length > 0;
  const hasPdfFile = Boolean(projectFile);
  const isStep2Valid = isUploadMode
    ? hasPdfFile && isShortDescriptionValid
    : isAgentDescriptionValid;
  const durationValue = Number.parseInt(durationDays, 10);
  const isDurationValid =
    durationMode === "auto" ||
    (Number.isFinite(durationValue) && durationValue > 0);
  const canProceed =
    step === 1 ? isProjectNameValid : step === 2 ? isStep2Valid : isDurationValid;

  const handleNext = () => {
    if (step === 1 && !isProjectNameValid) {
      setError("Project name is required.");
      return;
    }
    if (step === 2 && !isStep2Valid) {
      setError(
        isUploadMode
          ? "Upload a PDF and add a short description."
          : "Add a description for the agent."
      );
      return;
    }
    setError("");
    setStep((prev) => Math.min(prev + 1, STEP_TOTAL));
  };

  const handleBack = () => {
    setError("");
    setStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    setError("");
    if (!isProjectNameValid || !isStep2Valid || !isDurationValid) {
      setError("Please complete the required fields.");
      return;
    }

    const formData = new FormData();
    const wizardPayload = {
      name: projectName.trim(),
      briefType,
      agentDescription: agentDescription.trim(),
      pdfFile: projectFile,
      shortDescription: shortDescription.trim(),
      durationMode,
      durationDays: Number.isFinite(durationValue) ? durationValue : null,
    };

    formData.append("name", wizardPayload.name);
    const resolvedDescription =
      wizardPayload.briefType === "pdf"
        ? wizardPayload.shortDescription
        : wizardPayload.agentDescription;
    if (resolvedDescription) {
      formData.append("description", resolvedDescription);
    }
    if (
      wizardPayload.durationMode === "fixed" &&
      Number.isFinite(wizardPayload.durationDays) &&
      wizardPayload.durationDays > 0
    ) {
      formData.append("project_deadline_days", String(wizardPayload.durationDays));
    }
    if (wizardPayload.briefType === "pdf" && wizardPayload.pdfFile) {
      formData.append("file", wizardPayload.pdfFile);
    }

    setIsSubmitting(true);
    try {
      const data = await apiClient("/projects/analyze", {
        method: "POST",
        body: formData,
      });
      onComplete?.({
        ...data,
        description: resolvedDescription,
      });
      resetForm();
      onClose?.();
    } catch (err) {
      setError(err?.message || "Analysis failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isVisible) return;
    const modal = modalRef.current;
    if (!modal) return;
    const autoFocusEl = modal.querySelector("[data-autofocus='true']");
    autoFocusEl?.focus();
  }, [isVisible, step, briefType]);

  useEffect(() => {
    if (!isVisible) return;
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      const activePanel = body.querySelector(".ws-step-panel.is-active");
      if (!activePanel) {
        setIsScrollable(false);
        return;
      }
      const activeHeight = activePanel.getBoundingClientRect().height;
      const bodyHeight = body.clientHeight;
      const needsScroll = activeHeight > bodyHeight + 8;
      setIsScrollable(needsScroll);
    };

    const frame = requestAnimationFrame(measure);
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(measure);
    });
    resizeObserver.observe(body);
    const activePanel = body.querySelector(".ws-step-panel.is-active");
    if (activePanel) {
      resizeObserver.observe(activePanel);
    }
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isVisible, step, briefType, durationMode, error, projectFile]);

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

    if (event.key === "Enter" && !event.shiftKey) {
      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "textarea" || target?.type === "file") return;
      if (tag === "button") return;
      if (!canProceed) return;
      event.preventDefault();
      if (step === STEP_TOTAL) {
        handleSubmit();
      } else {
        handleNext();
      }
    }
  };

  if (!isVisible) return null;

  return (
    <div
      className={`ws-modal-backdrop${isClosing ? " is-closing" : " is-open"}`}
      onClick={handleClose}
    >
      <div
        className={`ws-modal ws-modal-form${isClosing ? " is-closing" : " is-open"}`}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-modal-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleModalKeyDown}
      >
        <div className="ws-modal-header">
          <div>
            <p className="ws-kicker">AI Project Analyzer</p>
            <h2 className="ws-modal-title" id="project-modal-title">
              Create a new project
            </h2>
            <p className="ws-modal-subtitle">
              Add the project name and a short description. You can also upload the PDF brief.
            </p>
            <StepIndicator step={step} />
          </div>
          <button className="ws-modal-close" onClick={handleClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div
          className={`ws-modal-body${isScrollable ? " is-scrollable" : ""}`}
          ref={bodyRef}
        >
          <div className="ws-step-container">
            <StepPanel isActive={step === 1}>
              <div className="ws-wizard-stack">
                <div className="ws-wizard-card">
                  <label
                    className="ws-label"
                    htmlFor="project-name-modal"
                  >
                    Project name
                  </label>
                  <p className="ws-wizard-help">
                    Give this project a clear, memorable title.
                  </p>
                  <input
                    id="project-name-modal"
                    className="ws-input"
                    placeholder="e.g. Talent Marketplace Revamp"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    disabled={isSubmitting}
                    data-autofocus="true"
                  />
                </div>
              </div>
            </StepPanel>

            <StepPanel isActive={step === 2}>
              <div className="ws-wizard-stack">
                <div className="ws-wizard-header">
                  <p className="ws-wizard-title">Brief for the agent</p>
                  <p className="ws-wizard-subtitle">
                    Choose how you want to share the project brief.
                  </p>
                </div>

                <BriefTypeCards
                  value={briefType}
                  onChange={handleBriefTypeChange}
                  disabled={isSubmitting}
                />

                <div className="ws-brief-container">
                  <div
                    className={`ws-brief-panel${
                      briefType === "text" ? " is-active" : ""
                    }`}
                    aria-hidden={briefType !== "text"}
                  >
                    <label
                      className="ws-label"
                      htmlFor="agent-description-modal"
                    >
                      Agent description
                    </label>
                    <textarea
                      id="agent-description-modal"
                      className="ws-textarea"
                      placeholder={descriptionPlaceholder}
                      value={agentDescription}
                      onChange={(event) => setAgentDescription(event.target.value)}
                      rows={4}
                      disabled={isSubmitting}
                      data-autofocus={step === 2 && briefType === "text"}
                    />
                  </div>

                  <div
                    className={`ws-brief-panel${
                      briefType === "pdf" ? " is-active" : ""
                    }`}
                    aria-hidden={briefType !== "pdf"}
                  >
                    <div className="ws-wizard-stack">
                      <PdfUploader
                        file={projectFile}
                        onFileSelect={setProjectFile}
                        disabled={isSubmitting}
                      />
                      <div>
                        <label
                          className="ws-label"
                          htmlFor="short-description-modal"
                        >
                          Short description
                        </label>
                        <textarea
                          id="short-description-modal"
                          className="ws-textarea"
                          placeholder="Short summary to complement the PDF brief."
                          value={shortDescription}
                          onChange={(event) => setShortDescription(event.target.value)}
                          rows={3}
                          disabled={isSubmitting}
                          data-autofocus={step === 2 && briefType === "pdf"}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </StepPanel>

            <StepPanel isActive={step === 3}>
              <div className="ws-wizard-stack">
                <div className="ws-wizard-header">
                  <p className="ws-wizard-title">Timeline</p>
                  <p className="ws-wizard-subtitle">
                    Optional: set a duration or let the agent decide.
                  </p>
                </div>
                <DurationSelector
                  mode={durationMode}
                  onModeChange={handleDurationModeChange}
                  durationDays={durationDays}
                  onDurationChange={(value) => {
                    setDurationMode("fixed");
                    setDurationDays(value);
                  }}
                  onPreset={handleDurationPreset}
                  disabled={isSubmitting}
                />
              </div>
            </StepPanel>
          </div>

          {error && (
            <p className="ws-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="ws-modal-actions ws-modal-actions-sticky">
          <div className="ws-modal-actions-row">
            <button
              className="ws-btn ws-btn-ghost"
              type="button"
              onClick={handleBack}
              disabled={step === 1 || isSubmitting}
            >
              Back
            </button>
            <button
              className="ws-btn ws-btn-primary"
              type="button"
              onClick={step === STEP_TOTAL ? handleSubmit : handleNext}
              disabled={isSubmitting || !canProceed}
            >
              {step === STEP_TOTAL
                ? isSubmitting
                  ? "Analyzing..."
                  : "Analyze project"
                : "Next"}
            </button>
          </div>
        </div>
      </div>
      {showLoader && (
        <AiLoader
          label="Generating tasks"
          size="lg"
          state={isLoaderExiting ? "success" : "loading"}
          className={`ai-loader-overlay ${isLoaderExiting ? "is-exiting" : "is-entering"}`}
        />
      )}
    </div>
  );
}

export function ProjectAnalysisModal({ open, onClose, analysis, onSave, isSaved }) {
  return (
    <GeneratedTasksModal
      open={open}
      onClose={onClose}
      onSave={onSave}
      analysis={analysis}
      isSaved={isSaved}
    />
  );
}
