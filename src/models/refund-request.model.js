const mongoose = require('mongoose');

const {
  AVAILABLE_REFUND_REQUEST_STATUSES,
  REFUND_REQUEST_STATUS,
} = require('../constants/booking');

const refundRequestSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      default: 'USD',
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: AVAILABLE_REFUND_REQUEST_STATUSES,
      default: REFUND_REQUEST_STATUS.PENDING,
      index: true,
    },
    payoutEligibleAt: {
      type: Date,
      required: true,
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    decisionNote: {
      type: String,
      default: null,
      trim: true,
      maxlength: 2000,
    },
    processingAction: {
      type: String,
      enum: ['approve', 'reject', null],
      default: null,
    },
    processingAt: {
      type: Date,
      default: null,
    },
    stripeRefundId: {
      type: String,
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
        return returnedObject;
      },
    },
  }
);

refundRequestSchema.index(
  { booking: 1 },
  {
    unique: true,
    partialFilterExpression: { status: REFUND_REQUEST_STATUS.PENDING },
  }
);

const RefundRequest = mongoose.model('RefundRequest', refundRequestSchema);

module.exports = RefundRequest;
