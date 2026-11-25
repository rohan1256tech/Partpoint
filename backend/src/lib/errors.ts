/**
 * Errors that are safe to show to clients. Anything else becomes a generic 500.
 * `code` is a stable machine-readable identifier the apps can branch on.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Authentication required') =>
  new AppError(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have access to this resource') =>
  new AppError(403, code, message);
export const notFound = (code = 'NOT_FOUND', message = 'Not found') => new AppError(404, code, message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const tooManyRequests = (code: string, message: string) => new AppError(429, code, message);
