"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Calendar, Clock3, Plus } from "lucide-react";
import {
  ProjectAnalysisModal,
  ProjectAnalyzerModal,
} from "../projects/ProjectAnalyzerModal";

const STATS = [
  { label: "Total Projects", value: "25", trend: "+8%" },
  { label: "In Progress", value: "17", trend: "+4%" },
  { label: "Completed", value: "32", trend: "+12%" },
  { label: "Overdue", value: "3", trend: "-2%" },
];

const PROJECTS = [
  {
    name: "Figma Design System",
    status: "In Progress",
    progress: 70,
    accent: "purple",
    due: "Nov 18",
    team: ["A", "J", "M"],
  },
  {
    name: "Keep React",
    status: "Planning",
    progress: 45,
    accent: "green",
    due: "Nov 27",
    team: ["S", "T"],
  },
  {
    name: "StaticMania",
    status: "In Review",
    progress: 80,
    accent: "orange",
    due: "Nov 09",
    team: ["K", "L", "P"],
  },
  {
    name: "Mobile App",
    status: "Completed",
    progress: 100,
    accent: "blue",
    due: "Oct 26",
    team: ["R", "N"],
  },
];

const ANALYTICS = [
  { label: "Total Projects", value: "100%" },
  { label: "Completed", value: "40%" },
  { label: "In Progress", value: "35%" },
  { label: "Not Started", value: "25%" },
];

export default function DashboardMain() {
  const progressDots = useMemo(() => Array.from({ length: 12 }), []);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isResultOpen, setIsResultOpen] = useState(false);

  const handleAnalysisComplete = (payload) => {
    setAnalysisResult(payload);
    setIsResultOpen(true);
  };

  return (
    <>
      <div className="ws-shell">
        <header className="ws-header">
          <div>
            <p className="ws-kicker">Dashboard</p>
            <h1 className="ws-title">
              Streamline work with intelligent AI task management.
            </h1>
            <p className="ws-subtitle">
              Boost productivity, collaboration, and delivery across every project in your
              pipeline.
            </p>
          </div>
          <div className="ws-actions">
            <button className="ws-btn ws-btn-ghost">
              <Calendar size={16} />
              This week
            </button>
            <button
              className="ws-btn ws-btn-primary"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus size={16} />
              Add project
            </button>
          </div>
        </header>

        <section className="ws-stats">
          {STATS.map((stat) => (
            <div key={stat.label} className="ws-stat-card">
              <p>{stat.label}</p>
              <div className="ws-stat-row">
                <strong>{stat.value}</strong>
                <span className="ws-stat-trend">{stat.trend}</span>
              </div>
            </div>
          ))}
        </section>

        <section className="ws-panel">
          <div className="ws-panel-head">
            <div>
              <h2>Project Overview</h2>
              <p>Quick snapshot of active initiatives and delivery pace.</p>
            </div>
            <button className="ws-btn ws-btn-ghost">
              View all
              <ArrowUpRight size={16} />
            </button>
          </div>

          <div className="ws-card-grid">
            {PROJECTS.map((project) => (
              <article
                key={project.name}
                className={`ws-project-card ws-accent-${project.accent}`}
              >
                <div className="ws-card-head">
                  <span className="ws-pill">{project.status}</span>
                  <span className="ws-date">
                    <Clock3 size={12} />
                    {project.due}
                  </span>
                </div>
                <h3>{project.name}</h3>
                <div className="ws-progress">
                  <div className="ws-dots">
                    {progressDots.map((_, idx) => (
                      <span
                        key={`${project.name}-${idx}`}
                        className={
                          idx < Math.round(project.progress / 8)
                            ? "ws-dot is-active"
                            : "ws-dot"
                        }
                      />
                    ))}
                  </div>
                  <span>{project.progress}%</span>
                </div>
                <div className="ws-team">
                  {project.team.map((member) => (
                    <span key={`${project.name}-${member}`} className="ws-avatar">
                      {member}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="ws-analytics-grid">
          <div className="ws-panel">
            <div className="ws-panel-head">
              <div>
                <h2>Project Analytics</h2>
                <p>Velocity trends for the last 6 months.</p>
              </div>
              <button className="ws-btn ws-btn-ghost">Filter</button>
            </div>
            <div className="ws-line-chart">
              <div className="ws-line-grid" />
              <div className="ws-line-lines" />
            </div>
          </div>

          <div className="ws-panel">
            <div className="ws-panel-head">
              <div>
                <h2>My Projects</h2>
                <p>Breakdown by status.</p>
              </div>
            </div>
            <div className="ws-donut">
              <div className="ws-donut-center">100%</div>
            </div>
            <div className="ws-legend">
              {ANALYTICS.map((item) => (
                <div key={item.label} className="ws-legend-item">
                  <span className="ws-legend-dot" />
                  <div>
                    <p>{item.label}</p>
                    <strong>{item.value}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <ProjectAnalyzerModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onComplete={handleAnalysisComplete}
      />
      <ProjectAnalysisModal
        open={isResultOpen}
        onClose={() => {
          setIsResultOpen(false);
          setAnalysisResult(null);
        }}
        analysis={analysisResult}
        onSave={(updated) => setAnalysisResult(updated)}
      />
    </>
  );
}
