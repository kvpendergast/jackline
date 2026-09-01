import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import { authClient } from "@/lib/auth-client";
import { authCompleteRedirect } from "@/pages/AuthCompletePage";

function authCompleteCallback(intent: "login" | "signup" = "login") {
  return authCompleteRedirect(intent);
}

export function VerifyEmailPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const emailFromState = (location.state as { email?: string } | null)?.email;
  const email = user?.email ?? emailFromState ?? "";
  const verificationError = searchParams.get("error");

  useEffect(() => {
    if (verificationError) {
      setError("This verification link is invalid or expired. Request a new one below.");
    }
  }, [verificationError]);

  useEffect(() => {
    if (user?.emailVerified) {
      void refresh().then(() => {
        navigate("/auth/complete?intent=login", { replace: true });
      });
    }
  }, [user?.emailVerified, refresh, navigate]);

  async function onResend() {
    if (!email) {
      setError("Enter your email on the sign-in page first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: authCompleteCallback("login"),
      });
      if (result.error) {
        setError(result.error.message ?? "Failed to send verification email");
        return;
      }
      setMessage("Verification email sent. Check your inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification email");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lattice-bg flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 border border-border bg-card p-6">
        <h1 className="text-xl font-medium">Verify your email</h1>
        <p className="text-sm text-muted-foreground">
          {email
            ? `We sent a verification link to ${email}. Open it to finish signing in.`
            : "Check your inbox for a verification link to finish signing in."}
        </p>
        {message ? <p className="text-sm text-primary">{message}</p> : null}
        {error ? <p className="text-sm text-deny">{error}</p> : null}
        <Button
          type="button"
          className="w-full"
          disabled={submitting || !email}
          onClick={() => void onResend()}
        >
          {submitting ? "Sending…" : "Resend verification email"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
