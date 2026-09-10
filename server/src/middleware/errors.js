import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required.') =>
  new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new HttpError(403, 'FORBIDDEN', message);
export const conflict = (message, details) => new HttpError(409, 'CONFLICT', message, details);

/**
 * Requirement 10: API responses must not reveal whether an unauthorized record
 * exists. Both "no such project" and "not your institute's project" return this
 * identical 404, with the real reason recorded in the audit log instead.
 */
export const notFoundOrDenied = () =>
  new HttpError(404, 'NOT_FOUND', 'The requested record does not exist or is not within your authorized scope.');

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export function errorHandler(error, req, res, _next) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
  }

  console.error('[error]', req.method, req.originalUrl, error);
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      details: config.isProduction ? undefined : error.message,
    },
  });
}
