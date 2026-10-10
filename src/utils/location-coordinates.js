const { Country, State, City } = require('country-state-city');

const countries = Country.getAllCountries();
const cache = new Map();
const normalized = value => String(value || '').trim().toLowerCase();

function validCoordinate(value, limit) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return false;
  return Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;
}

// Saved map coordinates take precedence. Legacy listings can use a city
// centre from the local dataset without a network request or API key.
function resolveLocationCoordinates(location = {}) {
  location = location || {};
  if (validCoordinate(location.latitude, 90) && validCoordinate(location.longitude, 180)) {
    return { latitude: Number(location.latitude), longitude: Number(location.longitude) };
  }
  const key = JSON.stringify([location.country, location.state, location.city]);
  if (cache.has(key)) return cache.get(key);
  const country = countries.find(c => normalized(c.name) === normalized(location.country)
    || normalized(c.isoCode) === normalized(location.country));
  let result = null;
  if (country && location.city) {
    const states = State.getStatesOfCountry(country.isoCode);
    const state = states.find(s => normalized(s.name) === normalized(location.state)
      || normalized(s.isoCode) === normalized(location.state));
    const cities = state ? City.getCitiesOfState(country.isoCode, state.isoCode) : City.getCitiesOfCountry(country.isoCode);
    const matches = cities.filter(c => normalized(c.name) === normalized(location.city));
    // Avoid choosing the wrong city when its name occurs in multiple states.
    const city = matches.length === 1 ? matches[0] : null;
    if (city && validCoordinate(city.latitude, 90) && validCoordinate(city.longitude, 180)) {
      result = { latitude: Number(city.latitude), longitude: Number(city.longitude) };
    }
  }
  if (cache.size >= 2000) cache.clear();
  cache.set(key, result);
  return result;
}

module.exports = { resolveLocationCoordinates };
