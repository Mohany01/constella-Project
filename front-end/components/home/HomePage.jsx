"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Workflow, ListChecks, Users } from "lucide-react";
import Logo from "../Logo";

// Better nav items (scroll sections)
const NAV_ITEMS = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "FAQ", href: "#faq" },
];

const BENEFITS = [
  {
    title: "AI Project Blueprint",
    subtitle:
      "Upload a description or PDF and get a linked task plan with time estimates in seconds.",
    actions: ["Upload brief", "Generate plan", "Export"],
    accent: "purple",
  },
  {
    title: "Skill-Based Assignment",
    subtitle:
      "Route tasks to teammates based on skills, load, and availability — with instant rebalancing.",
    actions: ["Auto-assign", "Rebalance", "Lock owners"],
    accent: "teal",
  },
];

const BENEFIT_POINTS = [
  {
    title: "From brief to plan instantly",
    text: "AI extracts tasks, dependencies, and time estimates from text or PDFs in seconds.",
  },
  {
    title: "Clear dependency graph",
    text: "Spot the critical path, unblock risks early, and coordinate handoffs with confidence.",
  },
  {
    title: "Skill-aware distribution",
    text: "Match each task to the best person using skills, current load, and expected effort.",
  },
  {
    title: "Live delivery dashboard",
    text: "One dashboard for status, risks, and alerts — so nothing surprises you.",
  },
];

const WORKFLOW_STEPS = [
  {
    title: "Upload the brief or PDF",
    text: "Drop in the project description or upload a PDF, Constella parses requirements automatically.",
  },
  {
    title: "Get an AI task graph",
    text: "Generate tasks, dependencies, time estimates, and required skills per task.",
  },
  {
    title: "Assign and deliver",
    text: "Project Managers can set owners and priorities, while Employees receive tasks matched to their skills.",
  },
];

export default function HomePage() {
  return (
    <div className="home-shell">
      <TopNav />

      <main>
        <section id="home" className="section hero-area">
          <Hero />
        </section>

        <section id="features" className="section">
          <RevealGroup>
            <SectionHeader
              kicker="Features"
              title="AI-powered planning for real teams"
              subtitle="Turn messy scope into a clear plan: tasks, dependencies, skills, and estimates — in minutes."
            />
            <BenefitShowcase />
          </RevealGroup>
        </section>

        <section id="how-it-works" className="section">
          <RevealGroup>
            <SectionHeader
              kicker="How it works"
              title="From setup to delivery, stay aligned"
              subtitle="A guided flow that keeps everyone moving — with clarity at every step."
            />
            <WorkflowGrid />
          </RevealGroup>
        </section>

        <section id="faq" className="section">
          <RevealGroup>
            <SectionHeader
              kicker="FAQ"
              title="Answers to common questions"
              subtitle="Quick clarifications about roles, projects, and how AI planning works."
            />
            <FaqList />
          </RevealGroup>
        </section>
      </main>
    </div>
  );
}

function Hero() {
  return (
    <div className="hero-grid">
      <div className="hero-left">
        <Reveal>
          <div className="pill-badge accent">
            <span className="pill-dot" />
            <Sparkles size={16} strokeWidth={2.2} />
            <span className="pill-text">Constella • AI Project Orchestration</span>
          </div>
        </Reveal>

        <Reveal delay={80}>
          <h1 className="hero-heading">
            <span className="accent-text">Plan projects</span> with AI
            <br />
            From brief to <span className="accent-underline">task graph</span> in seconds
          </h1>
        </Reveal>

        <Reveal delay={120}>
          <p className="hero-subhead">
            Constella turns any project description or PDF into linked tasks with time estimates and required skills,
            then helps teams deliver with clarity.
          </p>
        </Reveal>

        <Reveal delay={160}>
          <div className="hero-cta">
            <div className="hero-buttons">
              <Link href="/dashboard" className="pill-button pill-button-primary pill-button-lg">
                Get started
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function BenefitShowcase() {
  return (
    <div className="benefits-shell">
      <div className="benefit-primary">
        {BENEFITS.map((benefit, index) => (
          <Reveal key={benefit.title} delay={index * 80}>
            <div className={`benefit-hero benefit-${benefit.accent}`}>
              <div>
                <p className="benefit-kicker">{index === 0 ? "Blueprint" : "Assignment"}</p>
                <h3>{benefit.title}</h3>
                <p className="benefit-sub">{benefit.subtitle}</p>
              </div>
              <div className="benefit-actions">
                {benefit.actions.map((action) => (
                  <button key={action} className="chip solid" type="button">
                    {action}
                  </button>
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="benefit-grid">
        {BENEFIT_POINTS.map((point, index) => (
          <Reveal key={point.title} delay={120 + index * 60}>
            <div className="benefit-card">
              <span className="badge">{index + 1}</span>
              <h4>{point.title}</h4>
              <p>{point.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function WorkflowGrid() {
  return (
    <div className="workflow-grid">
      {WORKFLOW_STEPS.map((step, index) => (
        <Reveal key={step.title} delay={index * 80}>
          <div className="workflow-card">
            <div className="workflow-icon" aria-hidden>
              {index === 0 && <Workflow size={18} strokeWidth={2.2} />}
              {index === 1 && <ListChecks size={18} strokeWidth={2.2} />}
              {index === 2 && <Users size={18} strokeWidth={2.2} />}
            </div>
            <h4>{step.title}</h4>
            <p>{step.text}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

function TopNav() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 0);

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`home-nav ${isScrolled ? "is-scrolled" : ""}`.trim()}>
      <div className="nav-brand">
        <Logo showName variant="white" size={30} />
      </div>

      <nav aria-label="Primary navigation" className="nav-links">
        {NAV_ITEMS.map((item) => (
          <a key={item.href} href={item.href} className="nav-link">
            {item.label}
          </a>
        ))}
      </nav>

      <div className="nav-actions">
        <Link href="/login" className="pill-button pill-button-ghost pill-button-sm">
          Login
        </Link>
        <Link href="/signup" className="pill-button pill-button-primary pill-button-sm">
          Sign up
        </Link>
      </div>
    </header>
  );
}

function FaqList() {
  const items = [
    {
      q: "Who can create projects?",
      a: "Project Managers create projects. Employees receive assigned tasks matched to their skills.",
    },
    {
      q: "Can I analyze a project from a PDF?",
      a: "Yes upload a PDF brief or paste a description. The AI will generate tasks, dependencies, and estimates.",
    },
    {
      q: "Can I edit the generated tasks?",
      a: "Yes Project Managers can tweak priorities, owners, and timelines after generation.",
    },
  ];

  return (
    <div className="faq-grid">
      {items.map((it) => (
        <div key={it.q} className="faq-card">
          <h4>{it.q}</h4>
          <p>{it.a}</p>
        </div>
      ))}
    </div>
  );
}

function SectionHeader({ kicker, title, subtitle }) {
  return (
    <div className="section-head">
      <Reveal>
        <p className="section-kicker">{kicker}</p>
      </Reveal>
      <Reveal delay={60}>
        <h2 className="section-title accent-underline">{title}</h2>
      </Reveal>
      <Reveal delay={120}>
        <p className="section-subtitle">{subtitle}</p>
      </Reveal>
    </div>
  );
}

function Reveal({ children, delay = 0, className = "" }) {
  const { ref, visible } = useReveal(delay);
  return (
    <div
      ref={ref}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function RevealGroup({ children }) {
  return <div className="reveal-group">{children}</div>;
}

function useReveal(delay) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let timer;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            timer = setTimeout(() => setVisible(true), delay);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.24 }
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [delay]);

  return { ref, visible };
}
