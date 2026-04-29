const { OAuth2Client } = require('google-auth-library');

const config = require('../config/env');
const ApiError = require('../utils/api-error');

let oauthClient;

function getGoogleClient() {
  if (!config.googleClientId) {
    throw new ApiError(
      500,
      'Google sign-in is not configured. Add GOOGLE_CLIENT_ID to your environment.'
    );
  }

  if (!oauthClient) {
    oauthClient = new OAuth2Client(config.googleClientId);
  }

  return oauthClient;
}

async function verifyGoogleIdToken(idToken) {
  try {
    const client = getGoogleClient();
    const ticket = await client.verifyIdToken({
      idToken,
      audience: config.googleClientId,
    });
    const payload = ticket.getPayload();

    if (!payload || !payload.email || !payload.sub) {
      throw new ApiError(401, 'Invalid Google account data.');
    }

    if (!payload.email_verified) {
      throw new ApiError(401, 'Google email is not verified.');
    }

    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(401, 'Invalid Google ID token.');
  }
}

module.exports = {
  verifyGoogleIdToken,
};
