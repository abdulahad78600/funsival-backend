const mongoose = require('mongoose');

const listingViewSchema = new mongoose.Schema(
  {
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
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

listingViewSchema.index({ host: 1, createdAt: -1 });

const ListingView = mongoose.model('ListingView', listingViewSchema);

module.exports = ListingView;
