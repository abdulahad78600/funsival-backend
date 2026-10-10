const { Country, State, City } = require('country-state-city');
const { find } = require('geo-tz');
const ApiError = require('./api-error');
const { DateTime } = require('luxon');

const zoneCache = new Map();
const countries = Country.getAllCountries();

function validTimeZone(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch { return false; }
}

// Calendar dates are stored as UTC midnight labels; slot times are local to
// the listing. Never convert those labels through the guest's browser zone.
function calendarDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function isCalendarDate(value) {
  if (!(value instanceof Date) && (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(value))) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString() === `${String(value instanceof Date ? calendarDate(value) : value).slice(0, 10)}T00:00:00.000Z`;
}

function resolveListingTimeZone(listing = {}) {
  if (validTimeZone(listing.timeZone)) return listing.timeZone;
  const location = listing.placeLocation || {};
  const key = JSON.stringify([location.latitude, location.longitude, location.country, location.state, location.city]);
  if (zoneCache.has(key)) return zoneCache.get(key);
  let zone;
  if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
      && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180) {
    zone = find(location.latitude, location.longitude)[0];
  }
  const country = countries.find(c => c.isoCode.toLowerCase() === String(location.country || '').toLowerCase()
    || c.name.toLowerCase() === String(location.country || '').toLowerCase());
  if (!zone && country) {
    const state = State.getStatesOfCountry(country.isoCode).find(s =>
      s.name.toLowerCase() === String(location.state || '').toLowerCase()
      || s.isoCode.toLowerCase() === String(location.state || '').toLowerCase());
    const cities = state ? City.getCitiesOfState(country.isoCode, state.isoCode) : City.getCitiesOfCountry(country.isoCode);
    const city = cities.find(c => c.name.toLowerCase() === String(location.city || '').toLowerCase());
    if (city?.latitude && city?.longitude) zone = find(Number(city.latitude), Number(city.longitude))[0];
    // A country alone is sufficient only when it has a single time zone.
    if (!zone && country.timezones?.length === 1) zone = country.timezones[0].zoneName;
  }
  // Existing records without a resolvable location retain the previous UTC
  // convention. An explicit IANA zone can be supplied for these locations.
  zone = zone || 'UTC';
  zoneCache.set(key, zone);
  return zone;
}

function listingClock(listing, now = new Date()) {
  const timeZone = resolveListingTimeZone(listing);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { timeZone, now: now.getTime(), date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}:${values.second}` };
}

function localBookingInstant(date, time, timeZone) {
  const label = `${calendarDate(date)}T${time}`;
  const local = DateTime.fromISO(label, { zone: timeZone });
  // Spring-forward times that do not exist must not be silently shifted.
  if (!local.isValid || local.toFormat("yyyy-MM-dd'T'HH:mm") !== label) return null;
  // Repeated times use the first occurrence consistently, never the machine's
  // current offset or the guest's zone.
  return new Date(Math.min(...local.getPossibleOffsets().map(d => d.toMillis())));
}

function isFutureStart(date, time, clock) {
  const day = calendarDate(date);
  if (day < clock.date) return false;
  if (!time) return true;
  const instant = localBookingInstant(date, time, clock.timeZone);
  return instant !== null && instant.getTime() > clock.now;
}

function assertBookingNotPast(listing, booking, now = new Date()) {
  const clock = listingClock(listing, now);
  const starts = booking.slots?.length ? booking.slots.map(s => s.startTime) : [booking.startTime];
  if (starts.some(time => !isFutureStart(booking.startDate, time, clock))) {
    throw new ApiError(400, 'The selected booking date or start time is in the past in the listing time zone.', { timeZone: clock.timeZone });
  }
}

// MongoDB uses the persisted listing zone, including daylight-saving rules,
// so pagination/counts and automatic expiry share the booking cutoff.
function upcomingAvailabilityExpression(from, until) {
  const zone = { $ifNull: ['$timeZone', 'UTC'] };
  const today = { $dateToString: { date: '$$NOW', format: '%Y-%m-%d', timezone: zone } };
  const time = { $dateToString: { date: '$$NOW', format: '%H:%M', timezone: zone } };
  const day = { $dateToString: { date: '$$slot.date', format: '%Y-%m-%d', timezone: 'UTC' } };
  return { $anyElementTrue: [{ $map: {
    input: { $ifNull: ['$availability', []] }, as: 'slot',
    in: { $and: [
      { $ne: ['$$slot.isAvailable', false] },
      ...(from ? [{ $gte: [day, calendarDate(from)] }] : []),
      ...(until ? [{ $lte: [day, calendarDate(until)] }] : []),
      { $or: [
        { $gt: [day, today] },
        { $and: [{ $eq: [day, today] }, { $gt: ['$$slot.endTime', time] }] },
      ] },
    ] },
  } }] };
}

module.exports = { validTimeZone, calendarDate, isCalendarDate, resolveListingTimeZone, listingClock, localBookingInstant, isFutureStart, assertBookingNotPast, upcomingAvailabilityExpression };
