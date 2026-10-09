const { httpError } = require('./errorHandler');

function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues?.[0]?.message || 'Invalid request';
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'request',
        message: issue.message,
      }));
      return next(httpError(400, message, 'VALIDATION_ERROR', details));
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validateBody };
