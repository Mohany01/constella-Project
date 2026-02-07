"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Home, FolderKanban, Inbox, Target, Bell, Search, Settings, Star, Upload } from "lucide-react";
import DashboardBrand from "./DashboardBrand";

const STATS = [
  { label: "15 tasks completed" },
  { label: "2 tasks remaining" },
  { label: "1 contributor" },
];

const SECTIONS = [
  {
    title: "Urgent Tasks",
    items: [
      { text: "Buy new domain", time: "4:31 AM" },
      { text: "Write project brief", time: "4:31 AM" },
      { text: "Set pricing tables", time: "4:31 AM" },
    ],
  },
  {
    title: "Regular Tasks",
    items: [
      { text: "Talk to users", time: "4:31 AM" },
      { text: "Post on socials", time: "4:31 AM" },
      { text: "Check analytics", time: "4:31 AM" },
    ],
  },
  {
    title: "Urgent Tasks",
    items: [
      { text: "Buy new domain", time: "4:31 AM" },
      { text: "Write project brief", time: "4:31 AM" },
      { text: "Set pricing tables", time: "4:31 AM" },
    ],
  },
  {
    title: "Regular Tasks",
    items: [
      { text: "Talk to users", time: "4:31 AM" },
      { text: "Post on socials", time: "4:31 AM" },
      { text: "Check analytics", time: "4:31 AM" },
    ],
  },
];

const NAV_ITEMS = [
  { label: "Home", icon: Home },
  { label: "Projects", icon: FolderKanban },
  { label: "Inbox", icon: Inbox },
  { label: "Goals", icon: Target },
];

export default function DashboardPage() {
  const [activeNav, setActiveNav] = useState("Home");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [mode, setMode] = useState("upload");
  const [projectFileName, setProjectFileName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projects, setProjects] = useState([]);
  const [newProjectId, setNewProjectId] = useState(null);

  const canSubmit = useMemo(() => {
    const hasName = projectName.trim().length > 0;
    const hasDetails = mode === "upload" ? projectFileName.length > 0 : projectDescription.trim().length > 0;
    return hasName && hasDetails;
  }, [mode, projectDescription, projectFileName, projectName]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") setIsCreateOpen(false);
    };
    if (isCreateOpen) {
      document.body.classList.add("dashboard-modal-open");
      window.addEventListener("keydown", onKeyDown);
    } else {
      document.body.classList.remove("dashboard-modal-open");
    }
    return () => {
      document.body.classList.remove("dashboard-modal-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isCreateOpen]);

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) setIsCreateOpen(false);
  };

  const handleCreateProject = (event) => {
    if (event) event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    if (mode === "upload" && !projectFileName) return;
    if (mode === "description" && !projectDescription.trim()) return;
    const newProject = {
      id: Date.now(),
      name,
      type: mode === "upload" ? "PDF" : "Description",
      timestamp: Date.now(),
      fileName: mode === "upload" ? projectFileName : "",
      description: mode === "description" ? projectDescription.trim() : "",
      detail:
        mode === "upload"
          ? `PDF · ${projectFileName || "Uploaded"}`
          : projectDescription.trim().slice(0, 120),
    };
    setProjects((prev) => [newProject, ...prev]);
    setNewProjectId(newProject.id);
    setTimeout(() => setNewProjectId(null), 600);
    setIsCreateOpen(false);
    setActiveNav("Projects");
    setProjectName("");
    setProjectFileName("");
    setProjectDescription("");
    setMode("upload");
  };

  return (
    <div className="dashboard-page">
      <aside className="dashboard-sidebar">
        <DashboardBrand />

        <button className="dash-create" type="button" onClick={() => setIsCreateOpen(true)}>
          <Plus size={16} />
          Create
        </button>

        <nav className="dash-nav" aria-label="Dashboard navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.label;
            return (
              <button
                key={item.label}
                type="button"
                className={`dash-nav-item ${isActive ? "is-active" : ""}`.trim()}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveNav(item.label)}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="dash-sidebar-footer">
          <div className="dash-orb" aria-hidden />
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dash-topbar">
          <div className="dash-title">
            <p className="dash-kicker">{activeNav}</p>
          </div>
          <div className="dash-actions">
            <button className="dash-icon-btn" type="button" aria-label="Highlights">
              <Star size={16} />
            </button>
            <button className="dash-icon-btn" type="button" aria-label="Search">
              <Search size={16} />
            </button>
            <button className="dash-icon-btn" type="button" aria-label="Notifications">
              <Bell size={16} />
            </button>
            <button className="dash-icon-btn" type="button" aria-label="Settings">
              <Settings size={16} />
            </button>
            <div className="dash-avatar" aria-hidden />
          </div>
        </header>

        {activeNav !== "Projects" && (
          <>
            <section className="dash-hero">
              <p className="dash-date">Monday, October 30</p>
              <h1>Good morning, Josh</h1>
              <div className="dash-stats" role="list">
                {STATS.map((stat) => (
                  <span key={stat.label} className="dash-stat" role="listitem">
                    {stat.label}
                  </span>
                ))}
              </div>
            </section>

            <section className="dash-grid">
              {SECTIONS.map((section, index) => (
                <div key={`${section.title}-${index}`} className="dash-card">
                  <p className="dash-card-title">{section.title}</p>
                  <div className="dash-list">
                    {section.items.map((item) => (
                      <div key={item.text} className="dash-list-item">
                        <span className="dash-check" aria-hidden />
                        <span className="dash-task">{item.text}</span>
                        <span className="dash-time">{item.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}

        {activeNav === "Projects" && (
          <section className="projects-view">
            <div className="projects-header">
              <p className="dash-kicker">Projects</p>
              <p className="projects-subtitle">Track the projects you created and their next steps.</p>
            </div>
            <div className="projects-grid">
              {projects.length === 0 ? (
                <div className="projects-empty">No projects yet. Create one to get started.</div>
              ) : (
                projects.map((project) => {
                  const createdLabel = new Date(project.timestamp || project.id).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
                  const detailText =
                    project.type === "PDF"
                      ? `PDF \u00b7 ${project.fileName || "Uploaded"}`
                      : project.description || project.detail;
                  return (
                    <div
                      key={project.id}
                      className={`dash-project-card ${project.id === newProjectId ? "is-new" : ""}`.trim()}
                    >
                      <div className="dash-project-top">
                        <div className="dash-project-icon" aria-hidden>
                          <FolderKanban size={18} />
                        </div>
                        <div className="dash-project-heading">
                          <h3>{project.name}</h3>
                          <p className="dash-project-detail">{detailText}</p>
                        </div>
                        {project.id === newProjectId && <span className="dash-project-badge">New</span>}
                      </div>
                      <div className="dash-project-meta">
                        <span className="dash-project-pill">{project.type}</span>
                        <span className="dash-project-time">{createdLabel}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}
      </main>

      <div
        className={`dashboard-modal ${isCreateOpen ? "is-open" : ""}`.trim()}
        aria-hidden={!isCreateOpen}
        onClick={handleOverlayClick}
      >
        <form
          className="dashboard-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label="Create project"
          onSubmit={handleCreateProject}
        >
          <button
            className="dashboard-modal-close"
            type="button"
            aria-label="Close"
            onClick={() => setIsCreateOpen(false)}
          >
            {"\u00d7"}
          </button>

          <div className="dashboard-modal-header">
            <div className="dashboard-modal-icon" aria-hidden>
              <Upload size={22} />
            </div>
            <div>
              <h2 className="dashboard-modal-title">Create Project</h2>
              <p className="dashboard-modal-sub">
                Start by naming the project, then upload a PDF or write a quick description.
              </p>
            </div>
          </div>

          <div className="dashboard-modal-body">
            <label className="dashboard-modal-label" htmlFor="project-name">
              Project name <span className="required">*</span>
            </label>
            <input
              id="project-name"
              className="dashboard-modal-input"
              placeholder="Enter project name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
            />

            <div className="dashboard-modal-toggle" role="tablist" aria-label="Project input method">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "upload"}
                className={`dashboard-toggle-btn ${mode === "upload" ? "is-active" : ""}`.trim()}
                onClick={() => setMode("upload")}
              >
                Upload PDF
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "description"}
                className={`dashboard-toggle-btn ${mode === "description" ? "is-active" : ""}`.trim()}
                onClick={() => setMode("description")}
              >
                Write description
              </button>
            </div>

            {mode === "upload" ? (
              <label className="dashboard-modal-upload">
                <span className="upload-title">Upload project PDF</span>
                <span className="upload-subtitle">Drag and drop a file or browse from your device.</span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => setProjectFileName(event.target.files?.[0]?.name || "")}
                />
                <span className="upload-button">Browse file</span>
                {projectFileName && <span className="upload-file-name">{projectFileName}</span>}
              </label>
            ) : (
              <textarea
                className="dashboard-modal-textarea"
                placeholder="Write a short description of the project..."
                rows={5}
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
              />
            )}
          </div>

          <div className="dashboard-modal-footer">
            <button className="dashboard-modal-secondary" type="button" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </button>
            <button className="dashboard-modal-primary" type="submit" disabled={!canSubmit}>
              Create project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
