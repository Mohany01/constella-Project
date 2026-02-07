"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileText, Users, Clock, CheckCircle2 } from "lucide-react";

const META = [
  { icon: FileText, label: "Brief ready" },
  { icon: Users, label: "3 contributors" },
  { icon: Clock, label: "Due in 14 days" },
];

const TASKS = [
  { label: "Define scope and milestones", status: "In progress" },
  { label: "Upload requirements brief", status: "Pending" },
  { label: "Confirm timeline with stakeholders", status: "Pending" },
];

export default function ProjectPage() {
  const searchParams = useSearchParams();
  const projectName = searchParams.get("name") || "New Project";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`project-page ${ready ? "is-ready" : ""}`.trim()}>
      <div className="project-shell">
        <header className="project-header">
          <p className="project-kicker">Project</p>
          <h1 className="project-title">{projectName}</h1>
          <p className="project-sub">
            Review the brief, track progress, and align your team on the next steps.
          </p>
          <div className="project-meta">
            {META.map((item) => {
              const Icon = item.icon;
              return (
                <span key={item.label} className="project-pill">
                  <Icon size={14} />
                  {item.label}
                </span>
              );
            })}
          </div>
        </header>

        <section className="project-grid">
          <div className="project-card">
            <h2 className="project-card-title">Overview</h2>
            <p className="project-card-text">
              Keep everything in one place — requirements, scope, and delivery checkpoints.
            </p>
            <div className="project-stat">
              <span>Planning status</span>
              <strong>In review</strong>
            </div>
          </div>

          <div className="project-card">
            <h2 className="project-card-title">Next actions</h2>
            <div className="project-list">
              {TASKS.map((task) => (
                <div key={task.label} className="project-list-item">
                  <span className="project-list-icon" aria-hidden>
                    <CheckCircle2 size={14} />
                  </span>
                  <div>
                    <p>{task.label}</p>
                    <span>{task.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
