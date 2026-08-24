import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-provider";
import { authClient } from "@/lib/auth-client";
import { jacklineApi } from "@/lib/jackline-api";

export function LoginPage() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [providers, setProviders] = useState<
    Array<{ providerId: string; label: string }>
  >([]);
  const [signupOpen, setSignupOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void jacklineApi
      .listSsoProviders()
      .then((page) => setProviders(page.items))
      .catch(() => setProviders([]));
    void jacklineApi
      .signupStatus()
      .then((s) => setSignupOpen(s.open))
      .catch(() => setSignupOpen(false));
  }, []);

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Sign in failed");
        return;
      }
      if (inviteToken.trim()) {
        await jacklineApi.acceptInvite(inviteToken.trim());
      }
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSso(providerId: string) {
    setError(null);
    setSubmitting(true);
    try {
      await authClient.signIn.oauth2({
        providerId,
        callbackURL: `${window.location.origin}/dashboard`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSO failed");
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen
      title="Sign in"
      subtitle="Access your Jackline control plane."
      footer={
        signupOpen ? (
          <>
            No organization yet?{" "}
            <Link to="/signup" className="text-primary hover:underline">
              Create one
            </Link>
          </>
        ) : (
          <>Need access? Ask an admin for an invite.</>
        )
      }
    >
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Invite token (optional)" htmlFor="invite">
          <Input
            id="invite"
            value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)}
            placeholder="inv_…"
          />
        </Field>
        {error ? <p className="text-sm text-deny">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {providers.length > 0 ? (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <p className="section-label">SSO</p>
          {providers.map((p) => (
            <Button
              key={p.providerId}
              type="button"
              variant="outline"
              className="w-full"
              disabled={submitting}
              onClick={() => void onSso(p.providerId)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      ) : null}
    </AuthScreen>
  );
}

export function SignupPage() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signupOpen, setSignupOpen] = useState<boolean | null>(null);

  useEffect(() => {
    void jacklineApi
      .signupStatus()
      .then((s) => setSignupOpen(s.open))
      .catch(() => setSignupOpen(false));
  }, []);

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  if (signupOpen === false) {
    return <Navigate to="/login" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await jacklineApi.signup({ name, email, password, organizationName });
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (signupOpen === null) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <AuthScreen
      title="Create organization"
      subtitle="Spin up a tenant and the first full_admin."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <Field label="Organization" htmlFor="org">
          <Input
            id="org"
            required
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
          />
        </Field>
        <Field label="Your name" htmlFor="name">
          <Input
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor="signup-email">
          <Input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="signup-password">
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? <p className="text-sm text-deny">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Creating…" : "Create organization"}
        </Button>
      </form>
    </AuthScreen>
  );
}

function AuthScreen({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="lattice-bg flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md border border-border bg-card p-6 shadow-none">
        <div className="mb-6 space-y-1">
          <p className="section-label">Jackline</p>
          <h1 className="text-2xl font-medium tracking-[-0.03em]">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
        <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
