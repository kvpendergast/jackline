/**
 * Email verification bypass for instances that cannot send email.
 *
 * Password accounts must verify their email before they can sign in. When no
 * outbound email provider (Resend/SMTP) is configured, the verification link
 * can never arrive, so the first admin would be stuck on /verify-email forever.
 *
 * In that state, and only on a single-tenant instance (where public signup
 * closes after the first organization exists), a password sign-in with the
 * correct password marks the account verified. As soon as email delivery is
 * configured the bypass turns off and verification is enforced again.
 */

export type EmailVerificationBypassPolicy = () => Promise<boolean>;

let bypassPolicy: EmailVerificationBypassPolicy | null = null;

/** Register the bypass policy (called from API startup). */
export function setEmailVerificationBypassPolicy(
  policy: EmailVerificationBypassPolicy | null,
): void {
  bypassPolicy = policy;
}

/** True when email verification should be skipped right now. Fails closed. */
export async function isEmailVerificationBypassed(): Promise<boolean> {
  if (!bypassPolicy) return false;
  try {
    return (await bypassPolicy()) === true;
  } catch {
    return false;
  }
}

/**
 * Pure decision: skip verification only when email cannot be delivered AND the
 * instance is single-tenant. Multi-tenant instances keep open signup, so an
 * unverified email there must never be trusted (it would let someone claim an
 * address they don't own and later be linked to its Google account).
 */
export function shouldBypassEmailVerification(input: {
  deliveryReady: boolean;
  tenancy: "single" | "multi";
}): boolean {
  return !input.deliveryReady && input.tenancy === "single";
}

export type PasswordUserLookup = {
  user: { id: string; emailVerified: boolean | null | undefined };
  passwordHash: string | null | undefined;
};

/**
 * Before a password sign-in: if the bypass is active and the password is
 * correct, mark the account verified so Better Auth issues a session.
 * Returns true when the account was marked verified.
 */
export async function autoVerifyPasswordSignIn(
  input: { email?: unknown; password?: unknown },
  deps: {
    isBypassed: () => Promise<boolean>;
    findPasswordUser: (email: string) => Promise<PasswordUserLookup | null>;
    verifyPassword: (hash: string, password: string) => Promise<boolean>;
    markVerified: (userId: string) => Promise<void>;
  },
): Promise<boolean> {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    return false;
  }
  if (!input.email || !input.password) return false;
  if (!(await deps.isBypassed())) return false;

  const found = await deps.findPasswordUser(input.email.toLowerCase());
  if (!found || found.user.emailVerified === true || !found.passwordHash) {
    return false;
  }
  if (!(await deps.verifyPassword(found.passwordHash, input.password))) {
    return false;
  }
  await deps.markVerified(found.user.id);
  return true;
}
