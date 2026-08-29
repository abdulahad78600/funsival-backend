const asyncHandler = require('../../utils/async-handler');
const {
  listPublicFaqs,
  listFaqsForAdmin,
  createFaq,
  updateFaq,
  deleteFaq,
} = require('./faqs.service');

const listPublicFaqsHandler = asyncHandler(async (req, res) => {
  const faqs = await listPublicFaqs();
  res.status(200).json({
    success: true,
    message: 'FAQs fetched successfully.',
    data: { faqs },
  });
});

const listAdminFaqsHandler = asyncHandler(async (req, res) => {
  const faqs = await listFaqsForAdmin();
  res.status(200).json({
    success: true,
    message: 'FAQs fetched successfully.',
    data: { faqs },
  });
});

const createFaqHandler = asyncHandler(async (req, res) => {
  const faq = await createFaq(req.body);
  res.status(201).json({
    success: true,
    message: 'FAQ created successfully.',
    data: { faq },
  });
});

const updateFaqHandler = asyncHandler(async (req, res) => {
  const faq = await updateFaq(req.params.faqId, req.body);
  res.status(200).json({
    success: true,
    message: 'FAQ updated successfully.',
    data: { faq },
  });
});

const deleteFaqHandler = asyncHandler(async (req, res) => {
  const result = await deleteFaq(req.params.faqId);
  res.status(200).json({
    success: true,
    message: 'FAQ deleted successfully.',
    data: result,
  });
});

module.exports = {
  listPublicFaqsHandler,
  listAdminFaqsHandler,
  createFaqHandler,
  updateFaqHandler,
  deleteFaqHandler,
};
