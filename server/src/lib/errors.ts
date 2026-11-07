/**
 * An expected, client-facing error. Anything else that reaches the error
 * handler is treated as an unexpected 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code || defaultCode(statusCode);
    this.details = details;
  }
}

function defaultCode(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      return 'ERROR';
  }
}

export const badRequest = (message: string, code?: string, details?: unknown) => new AppError(400, message, code, details);
export const unauthenticated = (message = 'Please sign in to continue', code?: string) => new AppError(401, message, code);
export const forbidden = (message = 'You do not have permission to do that', code?: string) => new AppError(403, message, code);
export const notFound = (message = 'Not found', code?: string) => new AppError(404, message, code);
export const conflict = (message: string, code?: string) => new AppError(409, message, code);
