"use client";

import { ArrowUpDown, Filter, Plus } from "lucide-react";

const TASK_COLUMNS = [
  {
    id: "todo",
    title: "To Do",
    accent: "purple",
    tasks: [
      {
        title: "Create landing page outline",
        desc: "Define hero, value props, and CTAs.",
        tag: "Design",
        progress: 25,
      },
      {
        title: "Collect stakeholder feedback",
        desc: "Sync with product and marketing.",
        tag: "Research",
        progress: 10,
      },
    ],
  },
  {
    id: "inprogress",
    title: "In Progress",
    accent: "blue",
    tasks: [
      {
        title: "User persona research",
        desc: "Interview 5 power users.",
        tag: "UX",
        progress: 55,
      },
      {
        title: "API contract draft",
        desc: "Finalize endpoints for analytics.",
        tag: "Backend",
        progress: 40,
      },
    ],
  },
  {
    id: "review",
    title: "Review",
    accent: "orange",
    tasks: [
      {
        title: "Navigation IA review",
        desc: "Validate sitemap and menus.",
        tag: "Product",
        progress: 80,
      },
    ],
  },
  {
    id: "done",
    title: "Done",
    accent: "green",
    tasks: [
      {
        title: "Project kickoff deck",
        desc: "Shared with stakeholders.",
        tag: "Planning",
        progress: 100,
      },
    ],
  },
];

export default function TasksBoard() {
  return (
    <div className="ws-shell">
      <header className="ws-header">
        <div>
          <p className="ws-kicker">My Tasks</p>
          <h1 className="ws-title">
            Organize, prioritize, and complete daily work faster.
          </h1>
          <p className="ws-subtitle">
            Keep focus with AI-suggested next steps and clear priorities.
          </p>
        </div>
        <div className="ws-actions">
          <button className="ws-btn ws-btn-ghost">
            <Filter size={16} />
            Filter
          </button>
          <button className="ws-btn ws-btn-ghost">
            <ArrowUpDown size={16} />
            Sort
          </button>
          <button className="ws-btn ws-btn-primary">
            <Plus size={16} />
            Add task
          </button>
        </div>
      </header>

      <section className="ws-board">
        {TASK_COLUMNS.map((column) => (
          <div key={column.id} className="ws-column">
            <div className="ws-column-head">
              <h2>{column.title}</h2>
              <span className={`ws-pill ws-accent-${column.accent}`}>
                {column.tasks.length}
              </span>
            </div>
            <div className="ws-column-body">
              {column.tasks.map((task) => (
                <article key={task.title} className="ws-task-card">
                  <div className="ws-task-head">
                    <span className="ws-chip">{task.tag}</span>
                    <span className="ws-progress-badge">{task.progress}%</span>
                  </div>
                  <h3>{task.title}</h3>
                  <p>{task.desc}</p>
                  <div className="ws-progress-bar">
                    <span style={{ width: `${task.progress}%` }} />
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
