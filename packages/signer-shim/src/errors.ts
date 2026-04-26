export type SentinelErrorCode =
  | "POLICY_MISMATCH"
  | "POLICY_VIOLATION"
  | "POLICY_REVOKED"
  | "POLICY_NOT_FOUND"
  | "RATE_LIMITED"
  | "UNSUPPORTED_TX"
  | "ORACLE_UNAVAILABLE"
  | "REGISTRY_FETCH_FAILED"
  | "WEBHOOK_AUTH_FAILED"
  | "INVALID_POLICY"
  | "ESCALATION_REQUIRED";

export class SentinelError extends Error {
  readonly code: SentinelErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: SentinelErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SentinelError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isSentinelError(err: unknown): err is SentinelError {
  return err instanceof SentinelError;
}
