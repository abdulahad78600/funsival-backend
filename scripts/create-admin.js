require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../src/models/user.model');
const { USER_ROLES } = require('../src/constants/roles');
const { AUTH_PROVIDERS } = require('../src/constants/auth-providers');
const config = require('../src/config/env');

async function main() {
  const [, , emailArg, passwordArg, cityArg] = process.argv;

  if (!emailArg || !passwordArg || !cityArg) {
    console.error('Usage: node scripts/create-admin.js <email> <password> <city>');
    process.exit(1);
  }

  if (passwordArg.length < 8) {
    console.error('Password must be at least 8 characters long.');
    process.exit(1);
  }

  await mongoose.connect(config.mongoUri);

  const email = emailArg.toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (existing) {
    console.error(`A user with email ${email} already exists (role: ${existing.role}).`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const admin = await User.create({
    role: USER_ROLES.ADMIN,
    email,
    password: passwordArg,
    city: cityArg.trim(),
    authProviders: [AUTH_PROVIDERS.LOCAL],
    isEmailVerified: true,
  });

  console.log('Admin created:');
  console.log({ id: admin._id.toString(), email: admin.email, role: admin.role, city: admin.city });

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Failed to create admin:', error.message);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
