import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import { ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { jacklineApi } from "@/lib/jackline-api";
import { authCompleteRedirect } from "@/pages/AuthCompletePage";

function authCompleteCallback(intent: "login" | "signup" = "login") {
  return authCompleteRedirect(intent);
}

const NOT_CONFIGURED_MESSAGE =
  "Outbound email is not configured on this Jackline instance. An operator must set Resend (or SMTP) via Settings → Email or Secret Manager (EMAIL_FROM + RESEND_API_KEY), then redeploy.";

export function VerifyEmailPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deliveryReady, setDeliveryReady] = useState<boolean | null>(null);

  const emailFromState = (location.state as { email?: string } | null)?.email;
  const email = user?.email ?? emailFromState ?? "";
  const verificationError = searchParams.get("error");

  useEffect(() => {
    let cancelled = false;
    void jacklineApi
      .getEmailDeliveryStatus()
      .then((status) => {
        if (cancelled) return;
        setDeliveryReady(status.deliveryReady);
        if (!status.deliveryReady) {
          setError(NOT_CONFIGURED_MESSAGE);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDeliveryReady(false);
          setError(NOT_CONFIGURED_MESSAGE);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (deliveryReady === false) {
      setError(NOT_CONFIGURED_MESSAGE);
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const status = await jacklineApi.getEmailDeliveryStatus();
      setDeliveryReady(status.deliveryReady);
      if (!status.deliveryReady) {
        setError(NOT_CONFIGURED_MESSAGE);
        return;
      }

      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: authCompleteCallback("login"),
      });
      if (result.error) {
        setError(result.error.message ?? "Failed to send verification email");
        return;
      }
      setMessage("Verification email sent. Check your inbox (and spam).");
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_CONFIGURED") {
        setDeliveryReady(false);
        setError(NOT_CONFIGURED_MESSAGE);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to send verification email");
    } finally {
      setSubmitting(false);
    }
  }

  const waitingOnStatus = deliveryReady === null;
  const canResend = Boolean(email) && deliveryReady === true && !submitting;

  return (
    <div className="lattice-bg flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 border border-border bg-card p-6">
        <h1 className="text-xl font-medium">Verify your email</h1>
        {waitingOnStatus ? (
          <p className="text-sm text-muted-foreground">Checking email delivery…</p>
        ) : deliveryReady ? (
          <p className="text-sm text-muted-foreground">
            {email
              ? `We sent a verification link to ${email}. Open it to finish signing in.`
              : "Check your inbox for a verification link to finish signing in."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {email
              ? `Your account (${email}) must verify email before signing in, but this instance cannot send mail yet.`
              : "Email verification is required, but this instance cannot send mail yet."}
          </p>
        )}
        {message ? <p className="text-sm text-primary">{message}</p> : null}
        {error ? <p className="text-sm text-deny">{error}</p> : null}
        <Button
          type="button"
          className="w-full"
          disabled={!canResend}
          onClick={() => void onResend()}
        >
          {submitting
            ? "Sending…"
            : deliveryReady === false
              ? "Email delivery unavailable"
              : "Resend verification email"}
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
