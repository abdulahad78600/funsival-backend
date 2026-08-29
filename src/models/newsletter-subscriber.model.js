const mongoose = require('mongoose');

const newsletterSubscriberSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    source: {
      type: String,
      trim: true,
      default: 'landing',
    },
    unsubscribedAt: {
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
        return returnedObject;
      },
    },
  }
);

const NewsletterSubscriber = mongoose.model('NewsletterSubscriber', newsletterSubscriberSchema);

module.exports = NewsletterSubscriber;
