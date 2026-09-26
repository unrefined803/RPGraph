const { normalizeLmStudioReasoning, normalizeReasoningCapabilities, normalizeReasoningEffort } = require('./reasoning.cjs');

const effortNames = ['none', 'on', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

// Only interpret known metadata fields. Missing information stays unknown.
function compatibleModel(model) {
  if (!model || typeof model.id !== 'string' || !model.id.trim()) return null;
  const caps = model.capabilities ?? {};
  const capabilities = {};
  for (const key of ['text', 'vision', 'tools', 'image', 'voice', 'reasoning']) {
    const value = caps[key] ?? model[key];
    if (typeof value === 'boolean') capabilities[key] = value;
  }
  if (Array.isArray(caps)) {
    for (const [name, key] of [['vision', 'vision'], ['tools', 'tools'], ['thinking', 'reasoning'], ['completion', 'text']]) {
      if (caps.includes(name)) capabilities[key] = true;
    }
  }
  if (typeof caps.trained_for_tool_use === 'boolean') capabilities.tools = caps.trained_for_tool_use;
  const input = model.architecture?.input_modalities ?? model.input_modalities;
  const output = model.architecture?.output_modalities ?? model.output_modalities;
  if (Array.isArray(input) && input.every((v) => typeof v === 'string')) {
    capabilities.vision = input.includes('image');
  }
  if (Array.isArray(output) && output.every((v) => typeof v === 'string')) {
    capabilities.text = output.includes('text');
    capabilities.image = output.includes('image');
    capabilities.voice = output.includes('audio') || output.includes('speech');
  }
  const parameters = Array.isArray(model.supported_parameters) ? model.supported_parameters : undefined;
  if (parameters?.includes('tools')) capabilities.tools = true;
  if (parameters?.some((p) => p === 'reasoning' || p === 'reasoning_effort')) capabilities.reasoning = true;
  const raw = caps.reasoning ?? model.reasoning;
  let reasoning = normalizeLmStudioReasoning(raw);
  if (!reasoning && raw && typeof raw === 'object') {
    const normalized = normalizeReasoningCapabilities(raw);
    if (normalized && Object.keys(normalized).length) {
      reasoning = { ...normalized, supportedEfforts: normalized.supportedEfforts ?? null };
    }
    if (Array.isArray(raw.supported_efforts)) {
      reasoning = { ...reasoning, supportedEfforts: raw.supported_efforts.filter((v) => effortNames.includes(v)) };
    }
  }
  if (reasoning) capabilities.reasoning = reasoning.supportedEfforts === null
    ? true : reasoning.supportedEfforts?.some((v) => v !== 'none') === true;
  if (capabilities.reasoning === false) reasoning = { supportedEfforts: [], defaultEnabled: false };
  return {
    id: model.id.trim(), capabilities, reasoning,
    reasoningFormat: parameters?.includes('reasoning') && !parameters.includes('reasoning_effort')
      ? 'reasoning' : 'reasoning_effort',
  };
}

function compatibleReasoningOptions(connection) {
  if (connection.reasoningCapabilities?.supportedEfforts?.length === 0) return {};
  const selected = normalizeReasoningEffort(connection.reasoningEffort, connection.reasoningCapabilities);
  const effort = selected === 'on' ? 'low' : selected;
  if (effort === 'auto' || !effortNames.includes(effort)) return {};
  return connection.compatibleReasoningFormat === 'reasoning'
    ? { reasoning: { effort } } : { reasoning_effort: effort };
}

function mergeCompatibleNativeModels(models, native) {
  for (const entry of Array.isArray(native?.models) ? native.models : []) {
    const key = entry?.key ?? entry?.model_key;
    const instances = Array.isArray(entry?.loaded_instances) ? entry.loaded_instances : [];
    const ids = [key, ...instances.map((instance) => instance?.id)];
    const detail = compatibleModel({ ...entry, id: key });
    if (!detail) continue;
    for (const model of models.filter((model) => ids.includes(model.id))) {
      model.capabilities = { ...model.capabilities, ...detail.capabilities };
      model.reasoning = detail.reasoning ?? model.reasoning;
    }
  }
  return models;
}

module.exports = { compatibleModel, compatibleReasoningOptions, mergeCompatibleNativeModels };
