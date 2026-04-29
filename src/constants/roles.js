const USER_ROLES = Object.freeze({
  USER: 'user',
  HOST: 'host',
});

module.exports = {
  USER_ROLES,
  AVAILABLE_ROLES: Object.values(USER_ROLES),
};
