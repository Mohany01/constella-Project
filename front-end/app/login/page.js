import PageWrapper from "../../components/PageWrapper";
import Card from "../../components/Card";
import Logo from "../../components/Logo";
import LoginForm from "../../components/LoginForm";
import BackgroundVideo from "../../components/BackgroundVideo";
import Link from "next/link";

export default function LoginPage() {
  return (
    <PageWrapper className="auth-page">
      <div className="auth-page-back">
        <Link href="/" className="back-button" aria-label="Go back">
          <span className="arrow" aria-hidden>
            ←
          </span>
        </Link>
      </div>
      <BackgroundVideo />
      <div className="auth-glow" aria-hidden />
      <Card className="auth-card space-y-7">
        <Logo className="auth-logo" />

        <div className="space-y-2 text-center">
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">Sign in to continue your journey with Constella.</p>
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
    </PageWrapper>
  );
}
