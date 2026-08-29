const mongoose = require('mongoose');

const Faq = require('../../models/faq.model');
const ApiError = require('../../utils/api-error');

function toObjectId(value) {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new ApiError(400, 'Invalid FAQ ID.');
  }
  return new mongoose.Types.ObjectId(String(value));
}

function validateFaqPayload(payload = {}, { partial = false } = {}) {
  const errors = {};
  const validated = {};

  const question = typeof payload.question === 'string' ? payload.question.trim() : undefined;
  const answer = typeof payload.answer === 'string' ? payload.answer.trim() : undefined;

  if (payload.question !== undefined || !partial) {
    if (!question) errors.question = 'question is required.';
    else if (question.length > 500) errors.question = 'question must be 500 characters or fewer.';
    else validated.question = question;
  }

  if (payload.answer !== undefined || !partial) {
    if (!answer) errors.answer = 'answer is required.';
    else if (answer.length > 5000) errors.answer = 'answer must be 5000 characters or fewer.';
    else validated.answer = answer;
  }

  if (payload.order !== undefined) {
    const order = Number(payload.order);
    if (!Number.isInteger(order) || order < 0) errors.order = 'order must be a non-negative integer.';
    else validated.order = order;
  }

  if (payload.isActive !== undefined) {
    if (typeof payload.isActive !== 'boolean') errors.isActive = 'isActive must be a boolean.';
    else validated.isActive = payload.isActive;
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }
  if (partial && Object.keys(validated).length === 0) {
    throw new ApiError(400, 'Validation failed.', {
      payload: 'At least one field is required to update the FAQ.',
    });
  }

  return validated;
}

// Public: only active FAQs, in display order.
async function listPublicFaqs() {
  const faqs = await Faq.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
  return faqs.map((faq) => faq.toJSON());
}

// Admin: everything, including inactive.
async function listFaqsForAdmin() {
  const faqs = await Faq.find({}).sort({ order: 1, createdAt: 1 });
  return faqs.map((faq) => faq.toJSON());
}

async function createFaq(payload) {
  const validated = validateFaqPayload(payload);
  if (validated.order === undefined) {
    const last = await Faq.findOne({}).sort({ order: -1 }).select('order');
    validated.order = last ? last.order + 1 : 0;
  }
  const faq = await Faq.create(validated);
  return faq.toJSON();
}

async function updateFaq(faqId, payload) {
  const objectId = toObjectId(faqId);
  const validated = validateFaqPayload(payload, { partial: true });
  const faq = await Faq.findByIdAndUpdate(objectId, validated, {
    new: true,
    runValidators: true,
  });
  if (!faq) {
    throw new ApiError(404, 'FAQ not found.');
  }
  return faq.toJSON();
}

async function deleteFaq(faqId) {
  const objectId = toObjectId(faqId);
  const faq = await Faq.findByIdAndDelete(objectId);
  if (!faq) {
    throw new ApiError(404, 'FAQ not found.');
  }
  return { id: String(objectId) };
}

module.exports = {
  validateFaqPayload,
  listPublicFaqs,
  listFaqsForAdmin,
  createFaq,
  updateFaq,
  deleteFaq,
};
