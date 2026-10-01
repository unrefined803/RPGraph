const { chatgptError } = require('../chatgptErrors.cjs');

const { chatgptModelReasoning, chatgptReasoningEffort } = require('../../shared/chatgptCapabilities.cjs');

const baseUrl = 'https://api.openai.com/v1';

async function listModels(auth, root, profileId, signal, fetchRequest = fetch) {
  const token = await auth.accessToken(root, profileId, signal);
  const response = await fetchRequest(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw chatgptError(response.status, data, response.headers.get('x-request-id'));
  if (!Array.isArray(data?.models)) throw new Error('ChatGPT returned an invalid model catalog.');
  return data.models.filter(model => model.visibility === 'list' && typeof model.slug === 'string' && model.slug)
    .map(model => {
      const reasoning = chatgptModelReasoning(model);
      return { id: model.slug, name: typeof model.display_name === 'string' ? model.display_name : model.slug,
        ...(reasoning ? { reasoning } : {}) };
    });
}

async function chat(auth, root, request, signal, onDelta, fetchRequest = fetch) {
  const token = await auth.accessToken(root, request.connection.chatgptProfileId, signal);
  if (!request.connection.model?.trim()) throw new Error('Select a ChatGPT model first.');
  // This route accepts only a subset of Responses fields. Do not forward generic
  // sampling, token-limit or provider URL settings to it.
  const response = await fetchRequest(`${baseUrl}/responses`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    redirect: 'error', signal,
    body: JSON.stringify({ model: request.connection.model, store: false, stream: true,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: request.prompt },
        ...(request.images ?? []).map(image => ({ type: 'input_image', image_url: image.dataUrl })),
      ] }],
      reasoning: { effort: chatgptReasoningEffort(request.connection.reasoningEffort, request.connection.reasoningCapabilities) } }),
  });
  if (!response.ok) {
    throw chatgptError(response.status, await response.json().catch(() => null), response.headers.get('x-request-id'));
  }
  if (!response.body) throw new Error('ChatGPT returned an empty response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let completed = false;
  let usage;
  let receivedBytes = 0;
  const consume = block => {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let event;
    try { event = JSON.parse(data); }
    catch { throw new Error('ChatGPT returned an invalid stream event. Please retry.'); }
    if (!event || typeof event !== 'object') return;
    if (event.type === 'response.failed' || event.type === 'error') {
      throw chatgptError(undefined, event.type === 'error' ? { error: event } : event.response,
        response.headers.get('x-request-id'));
    }
    if (event.type === 'response.incomplete') {
      const reason = event.response?.incomplete_details?.reason;
      throw new Error(`The ChatGPT response was incomplete${/^[a-z_]{1,60}$/.test(reason) ? ` (${reason})` : ''}. Please retry.`);
    }
    if (event.type === 'response.output_text.delta' && !completed && typeof event.delta === 'string') {
      text += event.delta;
      onDelta?.(event.delta);
    }
    if (event.type === 'response.completed') {
      completed = true;
      usage = event.response?.usage;
      if (!text) {
        text = (event.response?.output ?? []).flatMap(item => item.content ?? [])
          .filter(item => item.type === 'output_text').map(item => item.text ?? '').join('');
      }
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      receivedBytes += value?.byteLength ?? 0;
      if (receivedBytes > 32 * 1024 * 1024) throw new Error('The ChatGPT response exceeded the 32 MB safety limit.');
      buffer += decoder.decode(value, { stream: !done });
      // Normalize after decoding so CRLF boundaries can span chunks.
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
    signal.throwIfAborted();
    if (!completed) throw new Error('The ChatGPT stream ended before the response completed.');
    if (!text.trim()) throw new Error('The completed ChatGPT response did not contain text.');
    return { text, usage };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

module.exports = { listModels, chat };
