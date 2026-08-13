function textFromReasoningContentPart(part) {
  if (!part || typeof part !== 'object') {
    return '';
  }
  if (typeof part.text === 'string') {
    return part.text;
  }
  if (typeof part.content === 'string') {
    return part.content;
  }
  if (Array.isArray(part.content)) {
    return textFromReasoningContent(part.content);
  }
  return '';
}

function textFromReasoningContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(textFromReasoningContentPart).filter(Boolean).join('');
  }
  return '';
}

function reasoningTextFromChatMessage(message) {
  if (!message || typeof message !== 'object') {
    return '';
  }
  return textFromReasoningContent(message.reasoning_content) ||
    textFromReasoningContent(message.reasoning) ||
    textFromReasoningContent(message.thinking) ||
    (Array.isArray(message.reasoning_details)
      ? message.reasoning_details
          .map((detail) => {
            if (!detail || typeof detail !== 'object') {
              return '';
            }
            if (detail.type === 'reasoning.text') {
              return typeof detail.text === 'string' ? detail.text : '';
            }
            if (detail.type === 'reasoning.summary') {
              return textFromReasoningContent(detail.summary);
            }
            return '';
          })
          .filter(Boolean)
          .join('')
      : '');
}

module.exports = { reasoningTextFromChatMessage };
