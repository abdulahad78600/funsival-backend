const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const bookingsController = require('./bookings.controller');

const router = express.Router();

router.use(authenticate);

router.post('/', bookingsController.createBookingHandler);
router.post('/quote', bookingsController.getBookingQuoteHandler);
router.get('/', bookingsController.getMyBookingsHandler);
router.get('/host', bookingsController.getHostBookingsHandler);
router.get('/host/stats', bookingsController.getHostReservationStatsHandler);
router.get('/:bookingId', bookingsController.getBookingByIdHandler);
router.patch('/:bookingId/cancel', bookingsController.cancelBookingHandler);
router.patch('/:bookingId/accept', bookingsController.acceptBookingHandler);
router.patch('/:bookingId/decline', bookingsController.declineBookingHandler);

module.exports = router;
