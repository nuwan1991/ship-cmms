/** Stable error codes shared by every module and the HTTP layer (CONTRACTS.md §6). */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  DUPLICATE: 409,
  NOT_OWNER: 409, // record is owned by another installation
  WORKFLOW_BLOCKED: 422, // transition or gate not satisfied
  AUTHORITY_EXPIRED: 403, // offline authority lease lapsed for this action
  DEPENDENCY_MISSING: 422, // referenced record not present on this installation
  RANGE_EXHAUSTED: 409, // no allocated numbers left; sync with hub
  SYNC_REJECTED: 422,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown>; correlationId: string };
}

export function toEnvelope(err: unknown, correlationId: string): ErrorEnvelope {
  if (err instanceof AppError) {
    return {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        correlationId,
      },
    };
  }
  // Never leak internals for unexpected errors.
  return { error: { code: 'INTERNAL', message: 'Unexpected error', correlationId } };
}
