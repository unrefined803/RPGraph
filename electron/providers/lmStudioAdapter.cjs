async function chat(request, deps, abort) {
  if (!deps || typeof deps.requestLmStudioChat !== 'function') {
    throw new Error('LM Studio adapter requires requestLmStudioChat.');
  }
  return deps.requestLmStudioChat(request, abort);
}

module.exports = { chat };
