import PageWrapper from "../../components/PageWrapper";
import Card from "../../components/Card";
import Logo from "../../components/Logo";
import LoginForm from "../../components/LoginForm";
import BackgroundVideo from "../../components/BackgroundVideo";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function LoginPage() {
  return (
    <PageWrapper className="auth-page auth-split-page">
      <div className="auth-split">
        <div className="auth-split-left">
          <div className="auth-page-back auth-page-back--split">
            <Link href="/" className="back-button" aria-label="Go back">
              <ArrowLeft size={18} aria-hidden="true" />
            </Link>
          </div>

          <Card className="auth-card auth-card-split">
            <Logo className="auth-logo" />

            <div className="space-y-2 text-center">
              <h1 className="auth-title">Welcome back</h1>
              <p className="auth-subtitle">
                Sign in to continue your journey with Constella.
              </p>
            </div>

            <LoginForm className="auth-form" />

            <div className="auth-meta">
              <div className="text-sm">
                <span>New here? </span>
                <Link href="/signup" className="auth-link accent">
                  Create an account
                </Link>
              </div>
            </div>
          </Card>
        </div>

        <div className="auth-split-right" aria-hidden="true">
          <BackgroundVideo
            src="/starts%20video%20background.mp4"
            className="auth-split-video"
          />
          <div className="auth-video-title">Constella</div>
          <div className="auth-split-overlay" />
        </div>
      </div>
    </PageWrapper>
  );
}
