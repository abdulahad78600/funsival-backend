const mongoose = require('mongoose');

// All fields are optional — draft can be saved at any step
const draftListingSchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // one draft per user
      index: true,
    },
    currentStep: {
      type: Number,
      min: 1,
      max: 6,
      default: 1,
    },
    category: { type: String, trim: true },
    type: { type: String, trim: true },
    basicInformation: {
      activityTitle: { type: String, trim: true },
      location: { type: String, trim: true },
      description: { type: String, trim: true },
    },
    serviceDetails: {
      difficultyLevel: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced', 'all_levels'],
      },
      duration: {
        value: { type: Number, min: 1 },
        unit: { type: String, enum: ['minutes', 'hours', 'days'] },
      },
      maxParticipants: { type: Number, min: 1 },
      instructorName: { type: String, trim: true },
      cancellationPolicy: { type: String, trim: true },
      whatsIncluded: { type: [String], default: undefined },
      requirements: { type: [String], default: undefined },
    },
    placeLocation: {
      addressLine1: { type: String, trim: true },
      addressLine2: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      latitude: { type: Number },
      longitude: { type: Number },
      googleMapsUrl: { type: String, trim: true },
    },
    photos: { type: [String], default: undefined },
    availability: {
      type: [
        {
          day: {
            type: String,
            enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
          },
          startTime: { type: String },
          endTime: { type: String },
          isAvailable: { type: Boolean, default: true },
          _id: false,
        },
      ],
      default: undefined,
    },
    price: {
      amount: { type: Number, min: 0 },
      currency: { type: String, trim: true, uppercase: true },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (doc, returnedObject) => {
        returnedObject.id = returnedObject._id.toString();
        returnedObject.createdBy = returnedObject.createdBy.toString();
        delete returnedObject._id;
        return returnedObject;
      },
    },
  }
);

const DraftListing = mongoose.model('DraftListing', draftListingSchema);

module.exports = DraftListing;
