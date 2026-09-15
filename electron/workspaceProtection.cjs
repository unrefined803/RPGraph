function createWorkspaceProtection() {
  let password = '';
  return {
    activate(value) {
      if (typeof value !== 'string') throw new Error('Invalid workspace protection.');
      password = value;
    },
    require(request) {
      if (password && (request?.protection !== 'encrypted' || request.password !== password)) {
        throw new Error('This game is protected. Save with encryption and the same game password.');
      }
    },
    get required() { return !!password; },
  };
}
module.exports = { createWorkspaceProtection };
