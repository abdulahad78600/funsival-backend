function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    res.status(400).json({
      success: false,
      message: 'Invalid JSON payload.',
    });
    return;
  }

  if (error.code === 11000) {
    res.status(409).json({
      success: false,
      message: 'An account with this email already exists.',
    });
    return;
  }

  if (error.name === 'ValidationError') {
    const validationErrors = Object.entries(error.errors).reduce((accumulator, [field, value]) => {
      accumulator[field] = value.message;
      return accumulator;
    }, {});

    res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: validationErrors,
    });
    return;
  }

  if (error.name === 'MulterError') {
    const uploadErrorMessages = {
      LIMIT_FILE_COUNT: 'You can upload up to 10 listing images at a time.',
      LIMIT_FILE_SIZE: 'Each listing image must be 5 MB or smaller.',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field. Use the `images` field for uploads.',
    };

    res.status(400).json({
      success: false,
      message: uploadErrorMessages[error.code] || 'Listing image upload failed.',
    });
    return;
  }

  if (error.name === 'CastError') {
    res.status(400).json({
      success: false,
      message: 'Invalid request value.',
      errors: {
        [error.path]: `Invalid ${error.path}.`,
      },
    });
    return;
  }

  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: error.message || 'Something went wrong.',
    ...(error.details ? { errors: error.details } : {}),
  });
}

module.exports = errorHandler;
