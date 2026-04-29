function buildEmailVerificationTemplate({ code, expiryMinutes }) {
  return {
    subject: 'Verify your Funsival email',
    text: `Your Funsival verification code is ${code}. This code will expire in ${expiryMinutes} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
        <h2>Verify your Funsival email</h2>
        <p>Use this verification code to activate your account:</p>
        <div style="display: inline-block; font-size: 28px; font-weight: 700; letter-spacing: 8px; padding: 14px 20px; background: #f6faf3; border: 1px solid #dbe6d1; border-radius: 12px;">
          ${code}
        </div>
        <p style="margin-top: 20px;">This code will expire in <strong>${expiryMinutes} minutes</strong>.</p>
        <p>If you did not create this account, you can ignore this email.</p>
      </div>
    `,
  };
}

function buildTwoFactorLoginTemplate({ code, expiryMinutes }) {
  return {
    subject: 'Your Funsival login code',
    text: `Your Funsival login verification code is ${code}. This code will expire in ${expiryMinutes} minutes. If you did not try to log in, please change your password immediately.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
        <h2>Your Funsival login code</h2>
        <p>Use this code to complete your login:</p>
        <div style="display: inline-block; font-size: 28px; font-weight: 700; letter-spacing: 8px; padding: 14px 20px; background: #f6faf3; border: 1px solid #dbe6d1; border-radius: 12px;">
          ${code}
        </div>
        <p style="margin-top: 20px;">This code will expire in <strong>${expiryMinutes} minutes</strong>.</p>
        <p>If you did not try to log in, please change your password immediately.</p>
      </div>
    `,
  };
}

function buildPasswordResetEmailTemplate({ resetLink, expiryMinutes }) {
  return {
    subject: 'Reset your Funsival password',
    text: `We received a request to reset your password. Open this link within ${expiryMinutes} minutes: ${resetLink}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
        <h2>Reset your Funsival password</h2>
        <p>We received a request to reset your password.</p>
        <p>This link will expire in <strong>${expiryMinutes} minutes</strong>.</p>
        <p>
          <a
            href="${resetLink}"
            style="display: inline-block; padding: 12px 20px; background: #f9b233; color: #111; text-decoration: none; border-radius: 8px; font-weight: 600;"
          >
            Reset Password
          </a>
        </p>
        <p>If the button does not work, use this link:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `,
  };
}

function buildResetPasswordPage({ isTokenValid }) {
  if (!isTokenValid) {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Reset Password</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6faf3; color: #222; display: grid; place-items: center; min-height: 100vh; margin: 0; }
            .card { width: min(92vw, 480px); background: white; border-radius: 20px; padding: 32px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.08); }
            h1 { margin-top: 0; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Reset Link Invalid</h1>
            <p>This password reset link is invalid or has expired. Please request a new password reset email.</p>
          </div>
        </body>
      </html>
    `;
  }

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Reset Password</title>
        <style>
          body { font-family: Arial, sans-serif; background: linear-gradient(180deg, #f6faf3, #ffffff); color: #222; display: grid; place-items: center; min-height: 100vh; margin: 0; }
          .card { width: min(92vw, 480px); background: white; border-radius: 20px; padding: 32px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.08); }
          h1 { margin-top: 0; margin-bottom: 12px; }
          p { color: #666; margin-bottom: 24px; }
          label { display: block; margin-bottom: 8px; font-weight: 600; }
          input { width: 100%; box-sizing: border-box; padding: 14px 16px; border: 1px solid #ddd; border-radius: 12px; margin-bottom: 18px; font-size: 16px; }
          button { width: 100%; padding: 14px 16px; border: 0; border-radius: 12px; background: #f9b233; color: #111; font-weight: 700; font-size: 16px; cursor: pointer; }
          button:disabled { opacity: 0.7; cursor: wait; }
          .message { margin-top: 16px; font-size: 14px; }
          .message.error { color: #c62828; }
          .message.success { color: #2e7d32; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Reset Password</h1>
          <p>Enter your new password below.</p>
          <form id="reset-form">
            <label for="password">New Password</label>
            <input id="password" name="password" type="password" minlength="8" required />

            <label for="confirmPassword">Confirm Password</label>
            <input id="confirmPassword" name="confirmPassword" type="password" minlength="8" required />

            <button id="submit-button" type="submit">Reset Password</button>
            <div id="message" class="message"></div>
          </form>
        </div>

        <script>
          const form = document.getElementById('reset-form');
          const message = document.getElementById('message');
          const submitButton = document.getElementById('submit-button');

          form.addEventListener('submit', async (event) => {
            event.preventDefault();

            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            message.textContent = '';
            message.className = 'message';
            submitButton.disabled = true;

            try {
              const response = await fetch(window.location.pathname, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password, confirmPassword })
              });

              const data = await response.json();

              if (!response.ok) {
                const validationMessage = data.errors ? Object.values(data.errors).join(' ') : '';
                throw new Error(validationMessage || data.message || 'Unable to reset password.');
              }

              message.textContent = data.message || 'Password reset successful.';
              message.classList.add('success');
              form.reset();
            } catch (error) {
              message.textContent = error.message;
              message.classList.add('error');
            } finally {
              submitButton.disabled = false;
            }
          });
        </script>
      </body>
    </html>
  `;
}

module.exports = {
  buildEmailVerificationTemplate,
  buildPasswordResetEmailTemplate,
  buildResetPasswordPage,
  buildTwoFactorLoginTemplate,
};
