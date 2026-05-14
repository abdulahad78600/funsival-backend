const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const { AUTH_PROVIDERS, AVAILABLE_AUTH_PROVIDERS } = require('../constants/auth-providers');
const { USER_ROLES } = require('../constants/roles');

const providerLocationSchema = new mongoose.Schema(
  {
    addressLine1: {
      type: String,
      trim: true,
      default: '',
    },
    addressLine2: {
      type: String,
      trim: true,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    state: {
      type: String,
      trim: true,
      default: '',
    },
    postalCode: {
      type: String,
      trim: true,
      default: '',
    },
    country: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const deviceTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: ['ios', 'android', 'web'],
      default: 'web',
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const providerProfileSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      trim: true,
      default: '',
    },
    lastName: {
      type: String,
      trim: true,
      default: '',
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: '',
    },
    dateOfBirth: {
      type: Date,
    },
    bio: {
      type: String,
      trim: true,
      default: '',
    },
    profileImage: {
      type: String,
      trim: true,
      default: '',
    },
    businessName: {
      type: String,
      trim: true,
      default: '',
    },
    businessType: {
      type: String,
      trim: true,
      default: '',
    },
    location: {
      type: providerLocationSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
    },
    agencyName: {
      type: String,
      trim: true,
      // Agency name is now optional for all users
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    authProviders: {
      type: [String],
      enum: AVAILABLE_AUTH_PROVIDERS,
      default: [AUTH_PROVIDERS.LOCAL],
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    city: {
      type: String,
      trim: true,
      required: [
        function cityRequired() {
          return !this.authProviders || this.authProviders.includes(AUTH_PROVIDERS.LOCAL);
        },
        'City is required.',
      ],
    },
    password: {
      type: String,
      required: [
        function passwordRequired() {
          return !this.authProviders || this.authProviders.includes(AUTH_PROVIDERS.LOCAL);
        },
        'Password is required.',
      ],
      minlength: [8, 'Password must be at least 8 characters long.'],
      select: false,
    },
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpiresAt: {
      type: Date,
      select: false,
    },
    emailVerificationCode: {
      type: String,
      select: false,
    },
    emailVerificationExpiresAt: {
      type: Date,
      select: false,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorCode: {
      type: String,
      select: false,
    },
    twoFactorExpiresAt: {
      type: Date,
      select: false,
    },
    preferences: {
      amenities: { type: [String], default: [] },
      equipments: { type: [String], default: [] },
      services: { type: [String], default: [] },
    },
    providerProfile: {
      type: providerProfileSchema,
      default: undefined,
    },
    deviceTokens: {
      type: [deviceTokenSchema],
      default: [],
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (doc, returnedObject) => {
        returnedObject.id = returnedObject._id.toString();
        delete returnedObject._id;
        delete returnedObject.authProviders;
        delete returnedObject.googleId;
        delete returnedObject.password;
        delete returnedObject.isEmailVerified;
        delete returnedObject.passwordResetToken;
        delete returnedObject.passwordResetExpiresAt;
        delete returnedObject.emailVerificationCode;
        delete returnedObject.emailVerificationExpiresAt;
        delete returnedObject.twoFactorCode;
        delete returnedObject.twoFactorExpiresAt;
        delete returnedObject.deviceTokens;
        return returnedObject;
      },
    },
  }
);

userSchema.pre('save', async function hashPassword() {
  if (!this.password || !this.isModified('password')) {
    return;
  }

  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
