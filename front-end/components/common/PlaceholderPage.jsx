"use client";

export default function PlaceholderPage({ title, subtitle, hint }) {
  return (
    <div className="ws-shell">
      <header className="ws-header">
        <div>
          <p className="ws-kicker">{title}</p>
          <h1 className="ws-title">{subtitle}</h1>
          <p className="ws-subtitle">
            {hint || "This section is ready for your next update."}
          </p>
        </div>
      </header>

      <section className="ws-panel">
        <div className="ws-empty">No content yet. Add your data here.</div>
      </section>
    </div>
  );
}
