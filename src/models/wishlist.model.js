const mongoose = require('mongoose');

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

// One wishlist entry per user + listing; newest-first listing per user.
wishlistSchema.index({ user: 1, listing: 1 }, { unique: true });
wishlistSchema.index({ user: 1, createdAt: -1 });

const Wishlist = mongoose.model('Wishlist', wishlistSchema);

module.exports = Wishlist;
