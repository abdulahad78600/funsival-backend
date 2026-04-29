const mongoose = require('mongoose');

const {
  AVAILABLE_BOOKING_TYPES,
  AVAILABLE_BOOKING_STATUSES,
  AVAILABLE_PAYMENT_STATUSES,
  BOOKING_STATUS,
  PAYMENT_STATUS,
} = require('../constants/booking');

const bookingSchema = new mongoose.Schema(
  {
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
      index: true,
    },
    bookedBy: {
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
    bookingType: {
      type: String,
      enum: AVAILABLE_BOOKING_TYPES,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    startTime: {
      type: String,
      default: null,
    },
    endTime: {
      type: String,
      default: null,
    },
    numberOfGuests: {
      type: Number,
      default: null,
      min: 1,
    },
    pricePerUnit: {
      type: Number,
      required: true,
      min: 0,
    },
    unitsBooked: {
      type: Number,
      required: true,
      min: 1,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    serviceFee: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
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
    status: {
      type: String,
      enum: AVAILABLE_BOOKING_STATUSES,
      default: BOOKING_STATUS.CONFIRMED,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: AVAILABLE_PAYMENT_STATUSES,
      default: PAYMENT_STATUS.PENDING,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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

bookingSchema.index({ listing: 1, startDate: 1, endDate: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
