function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const payload = {
    error: err.code || 'INTERNAL_ERROR',
    message: status === 500 && process.env.NODE_ENV === 'production'
      ? 'Something went wrong'
      : err.message || 'Something went wrong',
  };

  if (process.env.NODE_ENV !== 'production' && status === 500) {
    payload.stack = err.stack;
  }

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json(payload);
}

function notFound(_req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found' });
}

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

module.exports = { errorHandler, notFound, httpError };
