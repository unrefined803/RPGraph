const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
// Used when the account catalog does not report a model's thinking levels.
const chatgptReasoningCapabilities = {
  mandatory: true, defaultEnabled: true, defaultEffort: 'low',
  supportedEfforts: ['low', 'medium', 'high'],
};
const chatgptCapabilities = { text: true, vision: true, reasoning: true, image: false, voice: false };
function chatgptModelReasoning(model) {
  if (!Array.isArray(model?.supported_reasoning_levels)) return undefined;
  const reported = model.supported_reasoning_levels.map(level => typeof level === 'string' ? level : level?.effort);
  // Levels this application cannot label or send are not offered.
  const supportedEfforts = efforts.filter(effort => reported.includes(effort));
  if (!supportedEfforts.length) return undefined;
  const defaultEffort = supportedEfforts.includes(model.default_reasoning_level) ? model.default_reasoning_level : undefined;
  return { mandatory: !supportedEfforts.includes('none'), supportedEfforts,
    ...(defaultEffort ? { defaultEffort, defaultEnabled: defaultEffort !== 'none' } : {}) };
}
function chatgptReasoningEffort(value, capabilities) {
  const supported = Array.isArray(capabilities?.supportedEfforts) && capabilities.supportedEfforts.length
    ? capabilities.supportedEfforts : chatgptReasoningCapabilities.supportedEfforts;
  if (supported.includes(value)) return value;
  if (supported.includes(capabilities?.defaultEffort)) return capabilities.defaultEffort;
  return supported.includes('low') ? 'low' : supported[0];
}
module.exports = { chatgptCapabilities, chatgptReasoningCapabilities, chatgptModelReasoning, chatgptReasoningEffort };
