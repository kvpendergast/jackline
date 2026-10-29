export const ErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  EMAIL_NOT_CONFIGURED: "EMAIL_NOT_CONFIGURED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  RATE_LIMITED: "RATE_LIMITED",
  TENANT_LIMIT_REACHED: "TENANT_LIMIT_REACHED",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  INTERNAL: "INTERNAL",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND"
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Domain error — no HTTP status. Map to HTTP at the API edge. */
export class JacklineError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "JacklineError";
    this.code = code;
  }
}

export class UnauthorizedError extends JacklineError {
  constructor(message = "Unauthorized") {
    super(ErrorCode.UNAUTHORIZED, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends JacklineError {
  constructor(message = "Forbidden") {
    super(ErrorCode.FORBIDDEN, message);
    this.name = "ForbiddenError";
  }
}

export class EmailNotVerifiedError extends JacklineError {
  constructor(message = "Email address is not verified") {
    super(ErrorCode.EMAIL_NOT_VERIFIED, message);
    this.name = "EmailNotVerifiedError";
  }
}

export class EmailNotConfiguredError extends JacklineError {
  constructor(
    message = "Outbound email is not configured. Set a Resend or SMTP connector before sending mail.",
  ) {
    super(ErrorCode.EMAIL_NOT_CONFIGURED, message);
    this.name = "EmailNotConfiguredError";
  }
}

export class NotFoundError extends JacklineError {
  constructor(message = "Not Found") {
    super(ErrorCode.NOT_FOUND, message);
    this.name = "NotFoundError";
  }
}

export class BadRequestError extends JacklineError {
  constructor(message = "Bad Request") {
    super(ErrorCode.BAD_REQUEST, message);
    this.name = "BadRequestError";
  }
}

export class RateLimitedError extends JacklineError {
  readonly retryAfterSeconds: number;

  constructor(message = "Rate limit exceeded", retryAfterSeconds = 60) {
    super(ErrorCode.RATE_LIMITED, message);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
  }
}

export class TenantLimitReachedError extends JacklineError {
  constructor(message = "Single-tenant mode allows only one organization") {
    super(ErrorCode.TENANT_LIMIT_REACHED, message);
    this.name = "TenantLimitReachedError";
  }
}

export class SetupError extends JacklineError {
  constructor(message = "Setup failed") {
    super(ErrorCode.INTERNAL, message);
    this.name = "SetupError";
  }
}

export class NotImplementedError extends JacklineError {
  constructor(message = "Not Implemented") {
    super(ErrorCode.NOT_IMPLEMENTED, message);
    this.name = "NotImplementedError";
  }
}

export class EncryptionError extends JacklineError {
  constructor(message: string) {
    super(ErrorCode.INTERNAL, message);
    this.name = "EncryptionError";
  }
}
