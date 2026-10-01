const chatgptReasoningCapabilities = {
  mandatory: true, defaultEnabled: true, defaultEffort: 'low',
  supportedEfforts: ['low', 'medium', 'high'],
};
const chatgptCapabilities = { text: true, vision: true, reasoning: true, image: false, voice: false };
function chatgptReasoningEffort(value) {
  return value === 'medium' || value === 'high' ? value : 'low';
}
module.exports = { chatgptCapabilities, chatgptReasoningCapabilities, chatgptReasoningEffort };
