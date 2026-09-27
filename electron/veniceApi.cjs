const veniceDefaultBaseUrl = 'https://api.venice.ai/api/v1';

function veniceModelEntries(result) {
  return Array.isArray(result?.data) ? result.data : [];
}

function veniceModelCapabilities(model) {
  return model?.model_spec && typeof model.model_spec === 'object' &&
    model.model_spec.capabilities && typeof model.model_spec.capabilities === 'object'
    ? model.model_spec.capabilities
    : {};
}

function veniceNormalizedModel(model) {
  const id = typeof model?.id === 'string' ? model.id.trim() : '';
  if (!id) {
    return null;
  }
  const type = typeof model?.type === 'string' ? model.type : 'text';
  const spec = model?.model_spec && typeof model.model_spec === 'object' ? model.model_spec : {};
  const capabilities = veniceModelCapabilities(model);
  const inputModalities = ['text'];
  const outputModalities = [];
  const text = type === 'text';
  const vision = capabilities.supportsVision === true;
  const image = type === 'image';
  const voice = type === 'tts';
  if (vision) {
    inputModalities.push('image');
  }
  if (text) {
    outputModalities.push('text');
  }
  if (image) {
    outputModalities.push('image');
  }
  if (voice) {
    outputModalities.push('audio');
  }
  return {
    id,
    name: typeof spec.name === 'string' && spec.name.trim() ? spec.name.trim() : id,
    type,
    text,
    vision,
    image,
    voice,
    inputModalities,
    outputModalities,
    supportedVoices: voice ? veniceTtsVoices() : [],
    supportedParameters: voice ? ['temperature'] : [],
    contextLength: Number.isFinite(spec.availableContextTokens) ? spec.availableContextTokens : undefined,
    pricing: spec.pricing,
  };
}

function veniceEndpoint(connection, route) {
  const baseUrl = typeof connection?.baseUrl === 'string' && connection.baseUrl.trim()
    ? connection.baseUrl.trim()
    : veniceDefaultBaseUrl;
  return `${baseUrl.replace(/\/+$/, '')}/${route}`;
}

function veniceReasoningOptions(connection) {
  const effort = connection?.reasoningEffort;
  if (effort === 'none') {
    return {
      venice_parameters: {
        include_venice_system_prompt: false,
        disable_thinking: true,
        strip_thinking_response: true,
      },
    };
  }
  if (['minimal', 'low', 'medium', 'high'].includes(effort)) {
    return {
      reasoning_effort: effort,
      venice_parameters: {
        include_venice_system_prompt: false,
        strip_thinking_response: true,
      },
    };
  }
  return {
    venice_parameters: {
      include_venice_system_prompt: false,
      strip_thinking_response: true,
    },
  };
}

function veniceSamplingOptions(request) {
  const options = {};
  if (typeof request.temperature === 'number' && Number.isFinite(request.temperature)) {
    options.temperature = request.temperature;
  }
  if (typeof request.topP === 'number' && Number.isFinite(request.topP)) {
    options.top_p = request.topP;
  }
  if (typeof request.presencePenalty === 'number' && Number.isFinite(request.presencePenalty)) {
    options.presence_penalty = request.presencePenalty;
  }
  if (typeof request.frequencyPenalty === 'number' && Number.isFinite(request.frequencyPenalty)) {
    options.frequency_penalty = request.frequencyPenalty;
  }
  return options;
}

function veniceChatBody(request, stream = false) {
  return {
    model: request.connection.model,
    messages: [{ role: 'user', content: request.images?.length ? [
      { type: 'text', text: request.prompt },
      ...request.images
        .filter((image) => image && typeof image.dataUrl === 'string' && image.dataUrl)
        .map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
    ] : request.prompt }],
    ...veniceSamplingOptions(request),
    ...(Number.isInteger(request.maxTokens) && request.maxTokens > 0
      ? { max_tokens: request.maxTokens }
      : {}),
    ...veniceReasoningOptions(request.connection),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
}

function textFromChatContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content.map((part) => {
    if (!part || typeof part !== 'object') {
      return '';
    }
    return typeof part.text === 'string'
      ? part.text
      : typeof part.content === 'string'
        ? part.content
        : '';
  }).join('');
}

function veniceResponseText(result) {
  const choice = result?.choices?.[0];
  return textFromChatContent(choice?.message?.content) ||
    textFromChatContent(choice?.delta?.content) ||
    (typeof choice?.text === 'string' ? choice.text : '');
}

function veniceTtsVoices() {
  return [
    'af_sky',
    'af_bella',
    'af_nicole',
    'am_adam',
    'am_michael',
    'bf_emma',
    'bf_isabella',
    'bm_george',
    'bm_lewis',
  ];
}

module.exports = {
  veniceChatBody,
  veniceDefaultBaseUrl,
  veniceEndpoint,
  veniceModelEntries,
  veniceNormalizedModel,
  veniceResponseText,
};
