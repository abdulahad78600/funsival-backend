const AUTH_PROVIDERS = Object.freeze({
  LOCAL: 'local',
  GOOGLE: 'google',
});

module.exports = {
  AUTH_PROVIDERS,
  AVAILABLE_AUTH_PROVIDERS: Object.values(AUTH_PROVIDERS),
};
