import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-provider";
import { authClient } from "@/lib/auth-client";
import { jacklineApi } from "@/lib/jackline-api";
import type { AuthCompleteIntent, AuthCompleteResult } from "@jackline/shared";

function authCompleteUrl(
  intent: AuthCompleteIntent,
  invite?: string,
  returnTo?: string | null,
) {
  const params = new URLSearchParams({ intent });
  if (invite) params.set("invite", invite);
  if (returnTo) params.set("return_to", returnTo);
  return `${window.location.origin}/auth/complete?${params.toString()}`;
}

export function authCompleteRedirect(
  intent: AuthCompleteIntent,
  inviteToken?: string,
  returnTo?: string | null,
): string {
  return authCompleteUrl(intent, inviteToken, returnTo);
}

export function AuthCompletePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [founderSignup, setFounderSignup] = useState(false);

  const intent = (searchParams.get("intent") ?? "login") as AuthCompleteIntent;
  const inviteToken = searchParams.get("invite") ?? undefined;
  const returnTo = searchParams.get("return_to");
  const oauthError = searchParams.get("error");

  useEffect(() => {
    if (oauthError) {
      setError("Sign-in failed or the link expired. Try again.");
      return;
    }

    let cancelled = false;
    (async () => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await jacklineApi.authComplete({
          intent,
          inviteToken,
        });
        if (cancelled) return;
        await handleResult(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Authentication failed");
        }
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, inviteToken, oauthError]);

  async function handleResult(result: AuthCompleteResult) {
    if (result.status === "require_email_verification") {
      navigate("/verify-email", { replace: true });
      return;
    }
    if (result.status === "ok") {
      await refresh();
      if (returnTo) {
        window.location.assign(returnTo);
        return;
      }
      navigate("/dashboard", { replace: true });
      return;
    }
    if (result.status === "require_sso") {
      await authClient.signOut();
      await authClient.signIn.oauth2({
        providerId: result.providerId,
        callbackURL: authCompleteUrl(intent, inviteToken, returnTo),
        errorCallbackURL: `${window.location.origin}/login`,
      });
      return;
    }
    if (result.status === "founder_signup") {
      setFounderSignup(true);
      return;
    }
    setError(result.message);
  }

  async function onCreateOrg(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await jacklineApi.signupSocial({ organizationName });
      await refresh();
      if (returnTo) {
        window.location.assign(returnTo);
        return;
      }
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setSubmitting(false);
    }
  }

  if (founderSignup) {
    return (
      <div className="lattice-bg flex min-h-svh items-center justify-center p-6">
        <form
          className="w-full max-w-md space-y-4 border border-border bg-card p-6"
          onSubmit={(e) => void onCreateOrg(e)}
        >
          <h1 className="text-xl font-medium">Name your organization</h1>
          <p className="text-sm text-muted-foreground">
            You signed in with Google. Choose an organization name to finish setup.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Organization</Label>
            <Input
              id="org-name"
              required
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-deny">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Creating…" : "Create organization"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="lattice-bg flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-sm">
      {submitting && !error ? (
        <p className="text-muted-foreground">Finishing sign-in…</p>
      ) : null}
      {error ? (
        <>
          <p className="text-deny">{error}</p>
          <Link to="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </>
      ) : null}
    </div>
  );
}
