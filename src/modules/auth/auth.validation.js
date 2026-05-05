const ApiError = require('../../utils/api-error');
const { AVAILABLE_ROLES } = require('../../constants/roles');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateCommonSignupFields(payload) {
  const email = normalizeString(payload.email).toLowerCase();
  const city = normalizeString(payload.city);
  const password = typeof payload.password === 'string' ? payload.password : '';
  const confirmPassword =
    typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';
  const errors = {};

  if (!email) {
    errors.email = 'Email is required.';
  } else if (!isValidEmail(email)) {
    errors.email = 'Email must be a valid email address.';
  }

  if (!city) {
    errors.city = 'City is required.';
  } else if (city.length < 2) {
    errors.city = 'City must be at least 2 characters long.';
  }

  if (!password) {
    errors.password = 'Password is required.';
  } else if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters long.';
  }

  if (!confirmPassword) {
    errors.confirmPassword = 'Confirm password is required.';
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Password and confirm password must match.';
  }

  return {
    data: {
      email,
      city,
      password,
    },
    errors,
  };
}

function validateUserSignupPayload(payload = {}) {
  const { data, errors } = validateCommonSignupFields(payload);

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return data;
}

function validateHostSignupPayload(payload = {}) {
  const { data, errors } = validateCommonSignupFields(payload);
  const agencyName = normalizeString(payload.agencyName);

  if (agencyName && agencyName.length < 2) {
    errors.agencyName = 'Agency name must be at least 2 characters long.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    ...data,
    ...(agencyName ? { agencyName } : {}),
  };
}

function validateLoginPayload(payload = {}) {
  const email = normalizeString(payload.email).toLowerCase();
  const password = typeof payload.password === 'string' ? payload.password : '';
  const errors = {};

  if (!email) {
    errors.email = 'Email is required.';
  } else if (!isValidEmail(email)) {
    errors.email = 'Email must be a valid email address.';
  }

  if (!password) {
    errors.password = 'Password is required.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    email,
    password,
  };
}

function validateForgotPasswordPayload(payload = {}) {
  const email = normalizeString(payload.email).toLowerCase();
  const errors = {};

  if (!email) {
    errors.email = 'Email is required.';
  } else if (!isValidEmail(email)) {
    errors.email = 'Email must be a valid email address.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    email,
  };
}

function validateChangePasswordPayload(payload = {}) {
  const currentPassword =
    typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
  const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
  const confirmNewPassword =
    typeof payload.confirmNewPassword === 'string' ? payload.confirmNewPassword : '';
  const errors = {};

  if (!currentPassword) {
    errors.currentPassword = 'Current password is required.';
  }

  if (!newPassword) {
    errors.newPassword = 'New password is required.';
  } else if (newPassword.length < 8) {
    errors.newPassword = 'New password must be at least 8 characters long.';
  }

  if (!confirmNewPassword) {
    errors.confirmNewPassword = 'Confirm new password is required.';
  } else if (newPassword !== confirmNewPassword) {
    errors.confirmNewPassword = 'New password and confirm new password must match.';
  }

  if (
    currentPassword &&
    newPassword &&
    newPassword.length >= 8 &&
    currentPassword === newPassword
  ) {
    errors.newPassword = 'New password must be different from current password.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    currentPassword,
    newPassword,
  };
}

function validateDeleteAccountPayload(payload = {}) {
  const password = typeof payload.password === 'string' ? payload.password : '';
  const confirm = normalizeString(payload.confirm);

  return {
    password,
    confirm,
  };
}

function validateResetPasswordPayload(payload = {}) {
  const password = typeof payload.password === 'string' ? payload.password : '';
  const confirmPassword =
    typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';
  const errors = {};

  if (!password) {
    errors.password = 'Password is required.';
  } else if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters long.';
  }

  if (!confirmPassword) {
    errors.confirmPassword = 'Confirm password is required.';
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Password and confirm password must match.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    password,
  };
}

function validateVerifyEmailPayload(payload = {}) {
  const email = normalizeString(payload.email).toLowerCase();
  const code = normalizeString(payload.code).replace(/\s+/g, '');
  const errors = {};

  if (!email) {
    errors.email = 'Email is required.';
  } else if (!isValidEmail(email)) {
    errors.email = 'Email must be a valid email address.';
  }

  if (!code) {
    errors.code = 'Verification code is required.';
  } else if (!/^\d{6}$/.test(code)) {
    errors.code = 'Verification code must be a 6-digit code.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    email,
    code,
  };
}

function validateResendVerificationCodePayload(payload = {}) {
  const email = normalizeString(payload.email).toLowerCase();
  const errors = {};

  if (!email) {
    errors.email = 'Email is required.';
  } else if (!isValidEmail(email)) {
    errors.email = 'Email must be a valid email address.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    email,
  };
}

function validateGoogleAuthPayload(payload = {}) {
  const idToken = normalizeString(payload.idToken);
  const role = normalizeString(payload.role).toLowerCase();
  const city = normalizeString(payload.city);
  const agencyName = normalizeString(payload.agencyName);
  const errors = {};

  if (!idToken) {
    errors.idToken = 'Google ID token is required.';
  }

  if (role && !AVAILABLE_ROLES.includes(role)) {
    errors.role = `Role must be one of: ${AVAILABLE_ROLES.join(', ')}.`;
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    idToken,
    ...(role ? { role } : {}),
    ...(city ? { city } : {}),
    ...(agencyName ? { agencyName } : {}),
  };
}

module.exports = {
  validateUserSignupPayload,
  validateHostSignupPayload,
  validateLoginPayload,
  validateGoogleAuthPayload,
  validateForgotPasswordPayload,
  validateResetPasswordPayload,
  validateVerifyEmailPayload,
  validateResendVerificationCodePayload,
  validateChangePasswordPayload,
  validateDeleteAccountPayload,
};
