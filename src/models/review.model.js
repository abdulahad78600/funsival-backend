const mongoose = require('mongoose');

const ratingField = {
  type: Number,
  required: true,
  min: 1,
  max: 5,
};

const reviewSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
    },
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
      index: true,
    },
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    overallRating: ratingField,
    accuracy: ratingField,
    quality: ratingField,
    communication: ratingField,
    value: ratingField,
    comment: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000,
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

reviewSchema.index({ booking: 1, reviewer: 1 }, { unique: true });
reviewSchema.index({ listing: 1, createdAt: -1 });
reviewSchema.index({ host: 1, createdAt: -1 });

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
