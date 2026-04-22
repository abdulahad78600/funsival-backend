const mongoose = require('mongoose');

const durationSchema = new mongoose.Schema(
  {
    value: {
      type: Number,
      required: true,
      min: 1,
    },
    unit: {
      type: String,
      enum: ['minutes', 'hours', 'days'],
      required: true,
    },
  },
  { _id: false }
);

const serviceDetailsSchema = new mongoose.Schema(
  {
    difficultyLevel: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced', 'all_levels'],
      required: true,
    },
    duration: {
      type: durationSchema,
      required: true,
    },
    maxParticipants: {
      type: Number,
      required: true,
      min: 1,
    },
    instructorName: {
      type: String,
      trim: true,
      required: true,
    },
    cancellationPolicy: {
      type: String,
      trim: true,
      required: true,
    },
    whatsIncluded: {
      type: [String],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'At least one included item is required.',
      },
    },
    requirements: {
      type: [String],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'At least one requirement is required.',
      },
    },
  },
  { _id: false }
);

const basicInformationSchema = new mongoose.Schema(
  {
    activityTitle: {
      type: String,
      trim: true,
      required: true,
    },
    location: {
      type: String,
      trim: true,
      required: true,
    },
    description: {
      type: String,
      trim: true,
      required: true,
    },
  },
  { _id: false }
);

const placeLocationSchema = new mongoose.Schema(
  {
    addressLine1: {
      type: String,
      trim: true,
      required: true,
    },
    addressLine2: {
      type: String,
      trim: true,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      required: true,
    },
    state: {
      type: String,
      trim: true,
      default: '',
    },
    country: {
      type: String,
      trim: true,
      required: true,
    },
    postalCode: {
      type: String,
      trim: true,
      default: '',
    },
    latitude: {
      type: Number,
    },
    longitude: {
      type: Number,
    },
    googleMapsUrl: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const availabilitySlotSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const priceSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
      default: 'USD',
    },
  },
  { _id: false }
);

const listingSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },
    type: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },
    basicInformation: {
      type: basicInformationSchema,
      required: true,
    },
    serviceDetails: {
      type: serviceDetailsSchema,
      required: true,
    },
    placeLocation: {
      type: placeLocationSchema,
      required: true,
    },
    photos: {
      type: [String],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'At least one photo is required.',
      },
    },
    availability: {
      type: [availabilitySlotSchema],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'At least one availability slot is required.',
      },
    },
    price: {
      type: priceSchema,
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
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

const Listing = mongoose.model('Listing', listingSchema);

module.exports = Listing;
