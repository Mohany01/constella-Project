import Link from "next/link";
import Logo from "./Logo";

export default function HeroSection() {
  return (
    <section className="hero-section text-white">
      <div className="hero-backdrop">
        <div className="hero-glow hero-glow-1" />
        <div className="hero-glow hero-glow-2" />
        <div className="hero-glow hero-glow-ring" />
      </div>

      <div className="hero-header">
        <Logo className="hero-logo" showName />

        <header className="glass-nav" aria-label="Constella navigation">
          <Link
            href="/login"
            className="pill-button pill-button-ghost pill-button-sm"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="pill-button pill-button-primary pill-button-sm"
          >
            Sign up
          </Link>
        </header>
      </div>

      <div className="hero-shell hero-center">
        <div className="feature-pill" aria-label="New project management dashboard">
          <span className="pill-indicator" />
          <span className="pill-label">New</span>
          <span className="pill-separator">&bull;</span>
          <span className="pill-text">Project Management Dashboard</span>
          <span className="pill-arrow">&rarr;</span>
        </div>

        <div className="hero-stack">
          <h1 className="hero-title">
            Welcome to <span>Constella</span>
          </h1>
          <p className="hero-copy">
            Plan projects, assign tasks, track progress, and keep your team aligned &mdash; all in one place.
          </p>
        </div>
      </div>
    </section>
  );
}
