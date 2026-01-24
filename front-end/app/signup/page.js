import PageWrapper from "../../components/PageWrapper";
import Card from "../../components/Card";
import Logo from "../../components/Logo";
import SignupForm from "../../components/SignupForm";
import BackgroundVideo from "../../components/BackgroundVideo";
import Link from "next/link";

export default function SignupPage() {
  return (
    <PageWrapper className="auth-page">
      <BackgroundVideo />
      <div className="auth-glow" aria-hidden />
      <Card className="auth-card space-y-6">
        <Logo className="auth-logo" />

        <div className="space-y-2 text-center">
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-subtitle">Join Constella to unlock your dashboard and keep everything in sync.</p>
        </div>

        <SignupForm className="auth-form" />

        <div className="auth-meta">
          <div className="text-sm">
            <span>Already have an account? </span>
            <Link href="/login" className="auth-link">
              Sign in
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
