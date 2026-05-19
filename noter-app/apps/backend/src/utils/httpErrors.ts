/**
 * Typed HTTP error hierarchy.
 *
 * Why: the codebase had a mix of `new Error('...')` and `res.status(404)...`
 * inline in route handlers. The error-handler middleware then guessed at
 * status codes from message strings, which is brittle. Throwing typed
 * errors instead gives:
 *   1. Consistent JSON shape: { message, code, details? } across all routes.
 *   2. Stable error codes the client can branch on (UNAUTHORIZED, NOT_FOUND…).
 *   3. `expose: false` for server-internal errors → we don't leak stack
 *      traces or internals to the client, only a generic 500.
 *
 * Use:
 *   throw new NotFoundError('Note not found', { code: 'NOTE_NOT_FOUND' });
 */

export interface HttpErrorOptions {
  /** Stable machine-readable code. Defaults to the class's default. */
  code?: string;
  /** Optional structured detail object — included in response when `expose` is true. */
  details?: Record<string, unknown>;
  /**
   * Whether the message+details may be returned to the client. Default depends
   * on status code: 4xx → true, 5xx → false. Override only when you've
   * audited the message for PII/internals leakage.
   */
  expose?: boolean;
  /** Original error to wrap (for cause-chains in node 16.9+). */
  cause?: Error;
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly expose: boolean;

  constructor(status: number, message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = options.code ?? this.defaultCodeForStatus(status);
    this.details = options.details;
    this.expose = options.expose ?? status < 500;
    if (options.cause) {
      // Preserve cause chain — Node 16.9+ supports `cause` natively.
      (this as Error & { cause?: Error }).cause = options.cause;
    }
    // Maintains proper prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  private defaultCodeForStatus(status: number): string {
    switch (status) {
      case 400: return 'BAD_REQUEST';
      case 401: return 'UNAUTHORIZED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 410: return 'GONE';
      case 422: return 'UNPROCESSABLE_ENTITY';
      case 429: return 'TOO_MANY_REQUESTS';
      case 500: return 'INTERNAL';
      case 503: return 'SERVICE_UNAVAILABLE';
      default: return status >= 500 ? 'INTERNAL' : 'CLIENT_ERROR';
    }
  }

  /** JSON payload that's safe to send to the client. */
  toClientJSON(): { message: string; code: string; details?: Record<string, unknown> } {
    if (!this.expose) return { message: 'Internal server error', code: this.code };
    return this.details
      ? { message: this.message, code: this.code, details: this.details }
      : { message: this.message, code: this.code };
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request', options?: HttpErrorOptions) { super(400, message, options); }
}
export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized', options?: HttpErrorOptions) { super(401, message, options); }
}
export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', options?: HttpErrorOptions) { super(403, message, options); }
}
export class NotFoundError extends HttpError {
  constructor(message = 'Not found', options?: HttpErrorOptions) { super(404, message, options); }
}
export class ConflictError extends HttpError {
  constructor(message = 'Conflict', options?: HttpErrorOptions) { super(409, message, options); }
}
export class UnprocessableEntityError extends HttpError {
  constructor(message = 'Unprocessable entity', options?: HttpErrorOptions) { super(422, message, options); }
}
export class TooManyRequestsError extends HttpError {
  constructor(message = 'Too many requests', options?: HttpErrorOptions) { super(429, message, options); }
}
export class ServiceUnavailableError extends HttpError {
  constructor(message = 'Service unavailable', options?: HttpErrorOptions) { super(503, message, options); }
}

export const isHttpError = (err: unknown): err is HttpError =>
  err instanceof Error && (err as HttpError).status !== undefined && (err as HttpError).code !== undefined;
