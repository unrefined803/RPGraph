function providerAdapterKind(connection) {
  if (connection && connection.provider === 'lmstudio') {
    return 'lmstudio';
  }
  if (connection && connection.provider === 'gemini') {
    return 'gemini';
  }
  if (connection && connection.provider === 'venice') {
    return 'venice';
  }
  if (connection && connection.provider === 'ollama') {
    return 'ollama';
  }
  if (connection && connection.provider === 'openrouter') {
    return 'openrouter';
  }
  if (connection && connection.provider === 'composite') {
    return 'composite';
  }
  return 'openai-compatible';
}

module.exports = { providerAdapterKind };
