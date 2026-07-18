export const ErrorCode = {
    UNAUTHORIZED: "UNAUTHORIZED",
    FORBIDDEN: "FORBIDDEN",
    NOT_FOUND: "NOT_FOUND",
    BAD_REQUEST: "BAD_REQUEST",
    TENANT_LIMIT_REACHED: "TENANT_LIMIT_REACHED",
    INTERNAL: "INTERNAL",
  } as const;
  
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class MeshError extends Error {
    readonly code: ErrorCode;
    readonly statusCode: number;

    constructor(code: ErrorCode, message: string, statusCode = 500) {
        super(message);
        this.name = "MeshError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

export class UnauthorizedError extends MeshError {
    constructor(message = "Unauthorized") {
        super(ErrorCode.UNAUTHORIZED, message, 401);
        this.name = "UnauthorizedError";
    }
}

export class ForbiddenError extends MeshError {
    constructor(message = "Forbidden") {
        super(ErrorCode.FORBIDDEN, message, 403);
        this.name = "ForbiddenError";
    }
}

export class NotFoundError extends MeshError {
    constructor(message = "Not Found") {
        super(ErrorCode.NOT_FOUND, message, 404);
        this.name = "NotFoundError";
    }
}

export class BadRequestError extends MeshError {
    constructor(message = "Bad Request") {
        super(ErrorCode.BAD_REQUEST, message, 400);
        this.name = "BadRequestError";
    }
}

export class TenantLimitReachedError extends MeshError {
    constructor(message = "Single-tenant mode allows only one organization") {
        super(ErrorCode.TENANT_LIMIT_REACHED, message, 409);
        this.name = "TenantLimitReachedError";
    }
}

export class SetupError extends MeshError {
    constructor(message = "Setup failed") {
        super(ErrorCode.INTERNAL, message, 500);
        this.name = "SetupError";
    }
}

export class NotImplementedError extends MeshError {
    constructor(message = "Not Implemented") {
        super(ErrorCode.INTERNAL, message, 501);
        this.name = "NotImplementedError";
    }
}

export class EncryptionError extends MeshError {
    constructor(message: string) {
        super(ErrorCode.INTERNAL, message, 500);
        this.name = "EncryptionError";
    }
}