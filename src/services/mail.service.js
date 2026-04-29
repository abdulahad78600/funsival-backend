const config = require('../config/env');
const ApiError = require('../utils/api-error');

async function sendMail({ to, subject, html, text }) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: config.mailFromName, email: config.mailFrom },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(500, `Failed to send email: ${error.message || response.statusText}`);
  }
}

module.exports = { sendMail };
