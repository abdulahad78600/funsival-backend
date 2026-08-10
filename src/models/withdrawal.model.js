const mongoose = require('mongoose');

const {
  AVAILABLE_WITHDRAWAL_STATUSES,
  WITHDRAWAL_STATUS,
} = require('../constants/booking');

const withdrawalSchema = new mongoose.Schema(
  {
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      required: true,
    },
    status: {
      type: String,
      enum: AVAILABLE_WITHDRAWAL_STATUSES,
      default: WITHDRAWAL_STATUS.PENDING,
      index: true,
    },
    stripeAccountId: {
      type: String,
      required: true,
    },
    stripePayoutId: {
      type: String,
      default: null,
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    arrivalDate: {
      type: Date,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (doc, returnedObject) => {
        returnedObject.id = returnedObject._id.toString();
        delete returnedObject._id;
        delete returnedObject.idempotencyKey;
        return returnedObject;
      },
    },
  }
);

withdrawalSchema.index({ host: 1, createdAt: -1 });
withdrawalSchema.index(
  { host: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);

const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

module.exports = Withdrawal;
