"use client";

import { useState } from "react";
import PageWrapper from "../../components/PageWrapper";
import SignupForm from "../../components/SignupForm";
import Link from "next/link";
import Logo from "../../components/Logo";

export default function SignupPage() {
  const [step, setStep] = useState(1);
  const progressValue = step === 1 ? 50 : 100;
  const isStepOne = step === 1;

  return (
    <PageWrapper className="signup-bg">
      <div className="auth-page-back">
        <Link href="/" className="back-button" aria-label="Go back">
          <span className="arrow" aria-hidden>
            ←
          </span>
        </Link>
      </div>
      <div
        className={`signup-container ${
          step === 2 ? "signup-step-two" : "signup-step-one"
        }`}
      >
        {/* Left progress */}
        <aside className="progress-card progress-hero">
          <div className="progress-accent" aria-hidden />
          <div className="progress-accent soft" aria-hidden />
          <div className="progress-veil" aria-hidden />

          <Logo className="progress-logo-img" showName />

          <div className="progress-head center">
            {/* <p className="progress-kicker">Onboarding</p> */}
            <h2>Get Started with Constella</h2>
            <p className="progress-sub">
              Complete these easy steps to register your account.
            </p>
          </div>

          <div className="progress-steps stacked">
            <div className={`progress-step pill ${step === 1 ? "active" : ""}`}>
              <span className="bullet number">1</span>
              <div className="label">
                <p className="label-title">Sign up your account</p>
              </div>
              {step === 1 && <span className="pulse" aria-hidden />}
            </div>
            <div className={`progress-step pill ${step === 2 ? "active" : ""}`}>
              <span className="bullet number">2</span>
              <div className="label">
                <p className="label-title">Set up your profile</p>
              </div>
            </div>
          </div>

          <div
            className="progress-bar"
            role="progressbar"
            aria-valuenow={progressValue}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Signup progress"
          >
            <span
              className="progress-bar-fill"
              style={{ width: `${progressValue}%` }}
            />
          </div>
        </aside>

        {/* Right form */}
        <section className="form-card">
          <div className="form-head">
            <p className="progress-kicker small">Step {step} of 2</p>
            <h1>{isStepOne ? "Sign Up Account" : "Set up your profile"}</h1>
            <p>
              {isStepOne
                ? "Enter your personal data to create your account."
                : "Tell us more so we can personalize your workspace."}
            </p>
          </div>

          <SignupForm step={step} setStep={setStep} />

          {isStepOne && (
            <div className="form-footer">
              <span>Already have an account?</span>{" "}
              <Link href="/login" className="footer-link">
                Log in
              </Link>
            </div>
          )}
        </section>
      </div>
    </PageWrapper>
  );
}
