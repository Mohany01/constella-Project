import PageWrapper from "../../components/PageWrapper";
import Card from "../../components/Card";
import Logo from "../../components/Logo";
import LoginForm from "../../components/LoginForm";
import BackgroundVideo from "../../components/BackgroundVideo";
import Link from "next/link";

export default function LoginPage() {
  return (
    <PageWrapper className="auth-page">
      <BackgroundVideo />
      <div className="auth-glow" aria-hidden />
      <Card className="auth-card space-y-6">
        <Logo className="auth-logo" />

        <div className="space-y-2 text-center">
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">Sign in to continue your journey with Constella.</p>
        </div>

        <LoginForm className="auth-form" />

        <div className="auth-meta">
          <div className="text-sm">
            <span>New here? </span>
            <Link href="/signup" className="auth-link">
              Create an account
            </Link>
          </div>

          <div className="text-xs">
            <Link href="/" className="auth-link subtle">
              Back to home
            </Link>
          </div>
        </div>
      </Card>
    </PageWrapper>
  );
}
