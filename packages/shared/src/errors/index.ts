export const ErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  TENANT_LIMIT_REACHED: "TENANT_LIMIT_REACHED",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Domain error — no HTTP status. Map to HTTP at the API edge. */
export class MeshError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "MeshError";
    this.code = code;
  }
}

export class UnauthorizedError extends MeshError {
  constructor(message = "Unauthorized") {
    super(ErrorCode.UNAUTHORIZED, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends MeshError {
  constructor(message = "Forbidden") {
    super(ErrorCode.FORBIDDEN, message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends MeshError {
  constructor(message = "Not Found") {
    super(ErrorCode.NOT_FOUND, message);
    this.name = "NotFoundError";
  }
}

export class BadRequestError extends MeshError {
  constructor(message = "Bad Request") {
    super(ErrorCode.BAD_REQUEST, message);
    this.name = "BadRequestError";
  }
}

export class TenantLimitReachedError extends MeshError {
  constructor(message = "Single-tenant mode allows only one organization") {
    super(ErrorCode.TENANT_LIMIT_REACHED, message);
    this.name = "TenantLimitReachedError";
  }
}

export class SetupError extends MeshError {
  constructor(message = "Setup failed") {
    super(ErrorCode.INTERNAL, message);
    this.name = "SetupError";
  }
}

export class NotImplementedError extends MeshError {
  constructor(message = "Not Implemented") {
    super(ErrorCode.NOT_IMPLEMENTED, message);
    this.name = "NotImplementedError";
  }
}

export class EncryptionError extends MeshError {
  constructor(message: string) {
    super(ErrorCode.INTERNAL, message);
    this.name = "EncryptionError";
  }
}
