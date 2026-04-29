const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const bookingsController = require('./bookings.controller');

const router = express.Router();

router.use(authenticate);

router.post('/', bookingsController.createBookingHandler);
router.get('/', bookingsController.getMyBookingsHandler);
router.get('/host', bookingsController.getHostBookingsHandler);
router.get('/:bookingId', bookingsController.getBookingByIdHandler);
router.patch('/:bookingId/cancel', bookingsController.cancelBookingHandler);

module.exports = router;
