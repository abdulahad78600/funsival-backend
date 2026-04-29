const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const authController = require('./auth.controller');

const router = express.Router();

router.post('/signup/user', authController.signupUser);
router.post('/signup/host', authController.signupHost);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification-code', authController.resendVerificationCode);
router.post('/google', authController.googleSignIn);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.get('/reset-password/:token', authController.renderResetPasswordPage);
router.post('/reset-password/:token', authController.resetPassword);
router.get('/profile', authenticate, authController.getProfile);
router.post('/change-password', authenticate, authController.changePassword);
router.delete('/account', authenticate, authController.deleteOwnAccount);
router.post('/2fa/enable', authenticate, authController.enableTwoFactorAuth);
router.post('/2fa/disable', authenticate, authController.disableTwoFactorAuth);
router.post('/2fa/verify-login', authController.verifyTwoFactor);
router.post('/2fa/resend-code', authController.resendTwoFactor);

module.exports = router;
