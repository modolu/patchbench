/** Domain and HTTP error types. */

export class ValidationError extends Error {
  override name = "ValidationError";
}

/** Refresh token is unknown, revoked, or already rotated. */
export class InvalidTokenError extends Error {
  override name = "InvalidTokenError";
}

/** Refresh token exists but is past its expiry. */
export class TokenExpiredError extends Error {
  override name = "TokenExpiredError";
  readonly expiredAt: number;

  constructor(expiredAt: number) {
    super("refresh token expired");
    this.expiredAt = expiredAt;
  }
}

/** Error that already knows its HTTP representation. */
export class HttpError extends Error {
  override name = "HttpError";
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// reproduction must never touch production code
