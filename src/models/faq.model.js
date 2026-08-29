const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      trim: true,
      required: true,
      maxlength: 500,
    },
    answer: {
      type: String,
      trim: true,
      required: true,
      maxlength: 5000,
    },
    order: {
      type: Number,
      default: 0,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
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

const Faq = mongoose.model('Faq', faqSchema);

module.exports = Faq;
