const compositeDefaultBaseUrl = 'https://composite.lucidity.sh/v1';

function compositeModelEntries(result) {
  return Array.isArray(result?.data) ? result.data : [];
}

function compositeEndpoint(connection, route) {
  const baseUrl = typeof connection?.baseUrl === 'string' && connection.baseUrl.trim()
    ? connection.baseUrl.trim()
    : compositeDefaultBaseUrl;
  return `${baseUrl.replace(/\/+$/, '')}/${route}`;
}

function compositeNormalizedModel(model) {
  const id = typeof model?.id === 'string' ? model.id.trim() : '';
  if (!id) return null;
  const name = typeof model?.name === 'string' && model.name.trim()
    ? model.name.trim()
    : id;
  const pricing = model?.pricing && typeof model.pricing === 'object' ? model.pricing : undefined;
  const description = typeof model?.description === 'string' ? model.description.toLowerCase() : '';
  const modelText = `${id} ${name} ${description}`.toLowerCase();
  const vision = Boolean(pricing?.image) || modelText.includes('vision') || modelText.includes('vlm');
  const inputModalities = vision ? ['text', 'image'] : ['text'];
  return {
    id,
    name,
    text: true,
    vision,
    image: false,
    voice: false,
    inputModalities,
    outputModalities: ['text'],
    supportedVoices: [],
    supportedParameters: [],
    contextLength: Number.isFinite(model?.context_length) ? model.context_length : undefined,
    pricing,
  };
}

module.exports = {
  compositeDefaultBaseUrl,
  compositeEndpoint,
  compositeModelEntries,
  compositeNormalizedModel,
};
