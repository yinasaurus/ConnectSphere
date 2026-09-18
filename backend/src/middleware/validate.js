const { httpError } = require('./errorHandler');

function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues?.[0]?.message || 'Invalid request';
      return next(httpError(400, message, 'VALIDATION_ERROR'));
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validateBody };
