const asyncHandler = require('../../utils/async-handler');
const {
  validateUserSignupPayload,
  validateHostSignupPayload,
  validateLoginPayload,
  validateGoogleAuthPayload,
  validateVerifyEmailPayload,
  validateResendVerificationCodePayload,
  validateForgotPasswordPayload,
  validateResetPasswordPayload,
  validateChangePasswordPayload,
  validateDeleteAccountPayload,
} = require('./auth.validation');
const {
  registerUserAccount,
  registerHostAccount,
  verifyEmailAddress,
  resendEmailVerificationCode,
  loginAccount,
  googleAuthenticate,
  getProfileDetails,
  requestPasswordReset,
  isPasswordResetTokenValid,
  resetPasswordAccount,
  changeAccountPassword,
  deleteAccount,
  enableTwoFactor,
  disableTwoFactor,
  verifyTwoFactorLogin,
  resendTwoFactorCode,
} = require('./auth.service');
const { buildResetPasswordPage } = require('./auth.templates');

const signupUser = asyncHandler(async (req, res) => {
  const payload = validateUserSignupPayload(req.body);
  const signupData = await registerUserAccount(payload);

  res.status(201).json({
    success: true,
    message: 'Verification OTP sent to your email.',
    data: signupData,
  });
});

const signupHost = asyncHandler(async (req, res) => {
  const payload = validateHostSignupPayload(req.body);
  const signupData = await registerHostAccount(payload);

  res.status(201).json({
    success: true,
    message: 'Verification OTP sent to your email.',
    data: signupData,
  });
});

const verifyEmail = asyncHandler(async (req, res) => {
  const payload = validateVerifyEmailPayload(req.body);
  const verificationResult = await verifyEmailAddress(payload);

  res.status(200).json({
    success: true,
    message: verificationResult.message,
    data: verificationResult.data,
  });
});

const resendVerificationCode = asyncHandler(async (req, res) => {
  const payload = validateResendVerificationCodePayload(req.body);
  await resendEmailVerificationCode(payload);

  res.status(200).json({
    success: true,
    message: 'If an unverified account exists for this email, a verification code has been sent.',
  });
});

const googleSignIn = asyncHandler(async (req, res) => {
  const payload = validateGoogleAuthPayload(req.body);
  const authData = await googleAuthenticate(payload);

  res.status(200).json({
    success: true,
    message: 'Google sign-in successful.',
    data: authData,
  });
});

const login = asyncHandler(async (req, res) => {
  const payload = validateLoginPayload(req.body);
  const authData = await loginAccount(payload);

  if (authData.twoFactorRequired) {
    res.status(200).json({
      success: true,
      message: 'Two-factor authentication code sent to your email.',
      data: authData,
    });
    return;
  }

  res.status(200).json({
    success: true,
    message: 'Login successful.',
    data: authData,
  });
});

const getProfile = asyncHandler(async (req, res) => {
  const user = await getProfileDetails(req.user.id);

  res.status(200).json({
    success: true,
    message: 'Profile fetched successfully.',
    data: {
      user,
    },
  });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const payload = validateForgotPasswordPayload(req.body);
  await requestPasswordReset(payload);

  res.status(200).json({
    success: true,
    message: 'If an account exists for this email, a password reset link has been sent.',
  });
});

const renderResetPasswordPage = asyncHandler(async (req, res) => {
  const isTokenValid = await isPasswordResetTokenValid(req.params.token);

  res.status(isTokenValid ? 200 : 400).send(buildResetPasswordPage({ isTokenValid }));
});

const resetPassword = asyncHandler(async (req, res) => {
  const payload = validateResetPasswordPayload(req.body);
  await resetPasswordAccount(req.params.token, payload);

  res.status(200).json({
    success: true,
    message: 'Password reset successful. You can now log in with your new password.',
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const payload = validateChangePasswordPayload(req.body);
  await changeAccountPassword(req.user.id, payload);

  res.status(200).json({
    success: true,
    message: 'Password changed successfully.',
  });
});

const deleteOwnAccount = asyncHandler(async (req, res) => {
  const payload = validateDeleteAccountPayload(req.body);
  await deleteAccount(req.user.id, payload);

  res.status(200).json({
    success: true,
    message: 'Account deleted successfully.',
  });
});

const enableTwoFactorAuth = asyncHandler(async (req, res) => {
  const result = await enableTwoFactor(req.user.id);

  res.status(200).json({
    success: true,
    message: 'Two-factor authentication enabled.',
    data: result,
  });
});

const disableTwoFactorAuth = asyncHandler(async (req, res) => {
  const result = await disableTwoFactor(req.user.id);

  res.status(200).json({
    success: true,
    message: 'Two-factor authentication disabled.',
    data: result,
  });
});

const verifyTwoFactor = asyncHandler(async (req, res) => {
  const payload = validateVerifyEmailPayload(req.body);
  const authData = await verifyTwoFactorLogin(payload);

  res.status(200).json({
    success: true,
    message: 'Login successful.',
    data: authData,
  });
});

const resendTwoFactor = asyncHandler(async (req, res) => {
  const payload = validateResendVerificationCodePayload(req.body);
  await resendTwoFactorCode(payload);

  res.status(200).json({
    success: true,
    message:
      'If two-factor authentication is enabled for this email, a verification code has been sent.',
  });
});

module.exports = {
  signupUser,
  signupHost,
  verifyEmail,
  resendVerificationCode,
  googleSignIn,
  login,
  getProfile,
  forgotPassword,
  renderResetPasswordPage,
  resetPassword,
  changePassword,
  deleteOwnAccount,
  enableTwoFactorAuth,
  disableTwoFactorAuth,
  verifyTwoFactor,
  resendTwoFactor,
};
