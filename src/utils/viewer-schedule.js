const { DateTime } = require('luxon');
const { validTimeZone, calendarDate, localBookingInstant, resolveListingTimeZone } = require('./booking-clock');

function sourceTimeZone(booking) {
  if (validTimeZone(booking.timeZone)) return booking.timeZone;
  if (booking.listing && (booking.listing.timeZone || booking.listing.placeLocation)) {
    return resolveListingTimeZone(booking.listing);
  }
  return validTimeZone(booking.listingSnapshot?.timeZone) ? booking.listingSnapshot.timeZone : null;
}

function localSchedule(booking, viewerTimeZone) {
  const zone = sourceTimeZone(booking);
  if (!zone || !validTimeZone(viewerTimeZone) || !booking.startDate) return null;
  const ranges = (booking.slots?.length ? booking.slots : [booking]).flatMap(slot => {
    const startDate = calendarDate(slot.sourceDate || booking.startDate);
    const endDate = calendarDate(slot.sourceDate || booking.endDate || booking.startDate);
    if (!slot.startTime && !slot.endTime) {
      return [{ startDate, endDate, startTime: null, endTime: null,
        label: startDate === endDate ? startDate : `${startDate} – ${endDate}` }];
    }
    const startAt = localBookingInstant(startDate, slot.startTime || slot.endTime, zone);
    const endAt = localBookingInstant(endDate, slot.endTime || slot.startTime, zone);
    if (!startAt || !endAt) return [];
    const start = DateTime.fromJSDate(startAt, { zone: viewerTimeZone });
    const end = DateTime.fromJSDate(endAt, { zone: viewerTimeZone });
    const label = value => value.toFormat('MMM d, yyyy · h:mm a');
    return [{ startAt: startAt.toISOString(), endAt: endAt.toISOString(),
      startDate: start.toISODate(), endDate: end.toISODate(),
      startTime: start.toFormat('HH:mm'), endTime: end.toFormat('HH:mm'),
      label: startAt.getTime() === endAt.getTime() ? label(start)
        : `${label(start)} – ${start.toISODate() === end.toISODate() ? end.toFormat('h:mm a') : label(end)}`,
    }];
  });
  return { timeZone: viewerTimeZone, ranges };
}

function presentBooking(booking, viewerTimeZone) {
  return { ...booking, localSchedule: localSchedule(booking, viewerTimeZone) };
}

function presentBookingResult(result, viewerTimeZone) {
  if (Array.isArray(result.bookings)) return { ...result, bookings: result.bookings.map(b => presentBooking(b, viewerTimeZone)) };
  if (result.booking) return { ...result, booking: presentBooking(result.booking, viewerTimeZone) };
  return presentBooking(result, viewerTimeZone);
}

function localAvailabilityDates(listing, viewerTimeZone, now = Date.now()) {
  const dates = {};
  if (!validTimeZone(viewerTimeZone)) return dates;
  const zone = resolveListingTimeZone(listing);
  for (const window of listing.availability || []) {
    if (window.isAvailable === false || !window.date) continue;
    const start = localBookingInstant(window.date, window.startTime, zone);
    const end = localBookingInstant(window.date, window.endTime, zone);
    if (!start || !end || end.getTime() <= now) continue;
    const first = DateTime.fromMillis(Math.max(start.getTime(), now), { zone: viewerTimeZone }).startOf('day');
    const last = DateTime.fromMillis(end.getTime() - 1, { zone: viewerTimeZone }).startOf('day');
    for (let day = first; day <= last; day = day.plus({ days: 1 })) {
      const key = day.toISODate();
      dates[key] = [...new Set([...(dates[key] || []), calendarDate(window.date)])].sort();
    }
  }
  return dates;
}

function dailyAvailabilityOptions(listing, viewerTimeZone, now = Date.now()) {
  if (!validTimeZone(viewerTimeZone)) return { starts: [], ends: [] };
  const timeZone = resolveListingTimeZone(listing);
  const windows = (listing.availability || []).filter(window => window.isAvailable !== false && window.date);
  const starts = new Map();
  const ends = new Map();
  const option = (sourceDate, startTime) => {
    const schedule = localSchedule({ startDate: sourceDate, startTime, timeZone }, viewerTimeZone);
    const range = schedule?.ranges[0];
    if (!range?.startAt) return null;
    return { sourceDate, startTime, localDate: range.startDate, localTime: range.startTime,
      startAt: range.startAt, label: DateTime.fromISO(range.startAt, { zone: viewerTimeZone }).toFormat('h:mm a') };
  };
  for (const window of windows) {
    const entry = option(calendarDate(window.date), window.startTime);
    if (entry && Date.parse(entry.startAt) > now) starts.set(`${entry.sourceDate}|${entry.startTime}`, entry);
  }
  // Daily return dates use the selected listing-local pickup time, including
  // the offset on the return date rather than the current/start-date offset.
  for (const sourceDate of new Set(windows.map(window => calendarDate(window.date)))) {
    for (const startTime of new Set([...starts.values()].map(entry => entry.startTime))) {
      const entry = option(sourceDate, startTime);
      if (entry && Date.parse(entry.startAt) > now) ends.set(`${sourceDate}|${startTime}`, entry);
    }
  }
  const sort = values => [...values].sort((a, b) => a.startAt.localeCompare(b.startAt));
  return { starts: sort(starts.values()), ends: sort(ends.values()) };
}

function activityAvailabilityOptions(listing, viewerTimeZone, now = Date.now()) {
  if (!validTimeZone(viewerTimeZone)) return [];
  const timeZone = resolveListingTimeZone(listing);
  const options = new Map();
  const minutes = time => {
    if (!/^\d{2}:\d{2}$/.test(time || '')) return NaN;
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
  };
  const time = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  for (const window of listing.availability || []) {
    if (window.isAvailable === false || !window.date) continue;
    const first = minutes(window.startTime);
    const last = minutes(window.endTime);
    if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) continue;
    const sourceDate = calendarDate(window.date);
    const count = Math.max(1, Math.floor((last - first) / 60));
    for (let index = 0; index < count; index += 1) {
      const startTime = time(first + index * 60);
      const endTime = time(Math.min(first + (index + 1) * 60, last));
      const schedule = localSchedule({ startDate: sourceDate, startTime, endTime, timeZone }, viewerTimeZone);
      const range = schedule?.ranges[0];
      if (!range?.startAt || Date.parse(range.startAt) <= now) continue;
      options.set(`${sourceDate}|${startTime}|${endTime}`, {
        sourceDate, startTime, endTime, localDate: range.startDate,
        localTime: range.startTime, startAt: range.startAt, localSchedule: schedule,
        label: DateTime.fromISO(range.startAt, { zone: viewerTimeZone }).toFormat('h:mm a'),
      });
    }
  }
  return [...options.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

module.exports = { localSchedule, presentBooking, presentBookingResult, localAvailabilityDates, dailyAvailabilityOptions, activityAvailabilityOptions };
