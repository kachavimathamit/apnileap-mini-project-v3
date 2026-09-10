import { badRequest } from './errors.js';

/**
 * Requirement 7: input validation on every endpoint. Handlers read the parsed,
 * type-checked value from req.valid rather than the raw body.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      }));
      return next(badRequest('Some of the information supplied is not valid.', details));
    }
    req.valid = result.data;
    next();
  };
}
