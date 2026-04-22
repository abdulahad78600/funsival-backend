const { Resend } = require('resend');

const config = require('../config/env');
const ApiError = require('../utils/api-error');

const resend = new Resend(config.resendApiKey);

async function sendMail({ to, subject, html, text }) {
  const { error } = await resend.emails.send({
    from: config.mailFrom || 'onboarding@resend.dev',
    to,
    subject,
    html,
    text,
  });

  if (error) {
    throw new ApiError(500, `Failed to send email: ${error.message}`);
  }
}

module.exports = { sendMail };
