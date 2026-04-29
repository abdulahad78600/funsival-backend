function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTimeRange(startTime, endTime) {
  if (!startTime || !endTime) {
    return '';
  }
  return `${startTime} - ${endTime}`;
}

function buildNewBookingHostEmail({ booking, listing, guest }) {
  const listingTitle = listing?.basicInformation?.activityTitle || 'your listing';
  const guestEmail = guest?.email || 'a guest';
  const dateRange =
    booking.startDate.toString() === booking.endDate.toString()
      ? formatDate(booking.startDate)
      : `${formatDate(booking.startDate)} - ${formatDate(booking.endDate)}`;
  const timeRange = formatTimeRange(booking.startTime, booking.endTime);
  const totalAmount = `${booking.currency} ${booking.totalAmount}`;

  const subject = `New booking on ${listingTitle}`;
  const text = [
    `You have a new booking on ${listingTitle}.`,
    `Guest: ${guestEmail}`,
    `Dates: ${dateRange}`,
    timeRange ? `Time: ${timeRange}` : null,
    booking.numberOfGuests ? `Guests: ${booking.numberOfGuests}` : null,
    `Total: ${totalAmount}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2>New booking on ${listingTitle}</h2>
      <p>You have a new booking from <strong>${guestEmail}</strong>.</p>
      <ul>
        <li><strong>Dates:</strong> ${dateRange}</li>
        ${timeRange ? `<li><strong>Time:</strong> ${timeRange}</li>` : ''}
        ${booking.numberOfGuests ? `<li><strong>Guests:</strong> ${booking.numberOfGuests}</li>` : ''}
        <li><strong>Total:</strong> ${totalAmount}</li>
      </ul>
      <p>Log in to your dashboard to view the booking details.</p>
    </div>
  `;

  return { subject, text, html };
}

module.exports = {
  buildNewBookingHostEmail,
};
