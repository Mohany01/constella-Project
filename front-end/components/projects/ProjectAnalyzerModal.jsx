"use client";

import { useEffect, useRef, useState } from "react";
import { CloudUpload, X } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import GeneratedTasksModal from "./generated-tasks/GeneratedTasksModal";
import AiLoader from "../ui/ai-loader";

const MODES = [
  { id: "description", label: "Write description" },
  { id: "upload", label: "Upload PDF" },
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

export function ProjectAnalyzerModal({ open, onClose, onComplete }) {
  const [mode, setMode] = useState("description");
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [projectFile, setProjectFile] = useState(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const [isLoaderExiting, setIsLoaderExiting] = useState(false);
  const [isVisible, setIsVisible] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef(null);
  const loaderTimerRef = useRef(null);

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
    setMode("description");
    setProjectName("");
    setDescription("");
    setProjectFile(null);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setError("");
    resetForm();
    onClose?.();
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setError("");
    if (nextMode === "description") {
      setProjectFile(null);
    }
    if (nextMode === "upload") {
      setDescription("");
    }
  };

  const handleSubmit = async () => {
    setError("");
    if (!projectName.trim()) {
      setError("Project name is required.");
      return;
    }

    if (mode === "description" && !description.trim()) {
      setError("Add a brief description or switch to upload mode.");
      return;
    }

    if (mode === "upload" && !projectFile) {
      setError("Upload a project brief PDF.");
      return;
    }

    const formData = new FormData();
    formData.append("name", projectName.trim());
    if (mode === "description" && description.trim()) {
      formData.append("description", description.trim());
    }
    if (mode === "upload" && projectFile) {
      formData.append("file", projectFile);
    }

    setIsSubmitting(true);
    try {
      const data = await apiClient("/projects/analyze", {
        method: "POST",
        body: formData,
      });
      onComplete?.(data);
      resetForm();
      onClose?.();
    } catch (err) {
      setError(err?.message || "Analysis failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isVisible) return null;

  return (
    <div
      className={`ws-modal-backdrop${isClosing ? " is-closing" : " is-open"}`}
      onClick={handleClose}
    >
      <div
        className={`ws-modal${isClosing ? " is-closing" : " is-open"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ws-modal-header">
          <div>
            <p className="ws-kicker">AI Project Analyzer</p>
            <h2 className="ws-modal-title">Create a new project</h2>
            <p className="ws-modal-subtitle">
              Add the project name and either a short description or the PDF brief.
            </p>
          </div>
          <button className="ws-modal-close" onClick={handleClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="ws-modal-body">
          <label className="ws-label" htmlFor="project-name-modal">
            Project name
          </label>
          <input
            id="project-name-modal"
            className="ws-input"
            placeholder="e.g. Talent Marketplace Revamp"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            disabled={isSubmitting}
          />

          <div
            className="ws-toggle"
            style={{ "--toggle-index": mode === "description" ? 0 : 1 }}
          >
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={mode === option.id ? "is-active" : ""}
                onClick={() => handleModeChange(option.id)}
                disabled={isSubmitting}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode === "description" ? (
            <>
              <label className="ws-label" htmlFor="project-description-modal">
                Description
              </label>
              <textarea
                id="project-description-modal"
                className="ws-textarea"
                placeholder="Quick summary of goals, scope, and stakeholders."
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                disabled={isSubmitting}
              />
            </>
          ) : (
            <>
              <label className="ws-label">Project brief (PDF)</label>
              <label className="ws-upload">
                <CloudUpload size={20} />
                <span>{projectFile ? projectFile.name : "Upload project PDF"}</span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => setProjectFile(event.target.files?.[0] || null)}
                  disabled={isSubmitting}
                />
              </label>
            </>
          )}

          {error && <p className="ws-error">{error}</p>}
        </div>

        <div className="ws-modal-actions">
          <button
            className="ws-btn ws-btn-primary"
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Analyzing..." : "Analyze project"}
          </button>
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

export function ProjectAnalysisModal({ open, onClose, analysis, onSave }) {
  return (
    <GeneratedTasksModal
      open={open}
      onClose={onClose}
      onSave={onSave}
      analysis={analysis}
    />
  );
}
