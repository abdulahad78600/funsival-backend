const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const bookingsController = require('./bookings.controller');

const router = express.Router();

router.use(authenticate);

router.post('/', bookingsController.createBookingHandler);
router.post('/quote', bookingsController.getBookingQuoteHandler);
router.get('/', bookingsController.getMyBookingsHandler);
router.get(
  '/host',
  authorizeRoles(USER_ROLES.HOST),
  bookingsController.getHostBookingsHandler
);
router.get(
  '/host/stats',
  authorizeRoles(USER_ROLES.HOST),
  bookingsController.getHostReservationStatsHandler
);
router.get(
  '/host/export',
  authorizeRoles(USER_ROLES.HOST),
  bookingsController.exportHostBookingsHandler
);
router.get('/:bookingId', bookingsController.getBookingByIdHandler);
router.patch('/:bookingId/cancel', bookingsController.cancelBookingHandler);
router.patch('/:bookingId/accept', bookingsController.acceptBookingHandler);
router.patch('/:bookingId/decline', bookingsController.declineBookingHandler);

module.exports = router;
