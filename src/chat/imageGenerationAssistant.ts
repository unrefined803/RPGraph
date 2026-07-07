export type ImageGenerationAssistantMessage = {
  role: 'user' | 'assistant' | 'error';
  text: string;
};

export type ImageGenerationAssistantResult = {
  reply: string;
  prompt: string | null;
};

function assistantConversation(messages: ImageGenerationAssistantMessage[]) {
  return messages
    .filter((message) => message.role !== 'error')
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`)
    .join('\n');
}

export function imageGenerationAssistantPrompt(
  currentPrompt: string,
  messages: ImageGenerationAssistantMessage[],
  userMessage: string,
) {
  return [
    'You are an image prompt assistant inside RPGraph.',
    'Help the user create and refine one image-generation prompt.',
    'The current image prompt is editable by the user and is the source of truth.',
    'When the user requests an image or a visual change, return a complete updated prompt that preserves all existing details not affected by the request.',
    'Do not merely append contradictory instructions. Integrate the requested change cleanly.',
    'When the user asks a general question or asks for advice without requesting a prompt change, set prompt to null.',
    'Keep reply brief and conversational. Summarize what changed without repeating the image prompt.',
    'Return only valid JSON. For a prompt change use:',
    '{"reply":"Short response shown in chat","prompt":"Complete updated image prompt"}',
    'For an answer that does not change the prompt use:',
    '{"reply":"Short answer shown in chat","prompt":null}',
    '',
    `Current image prompt:\n${currentPrompt.trim() || '(empty)'}`,
    '',
    `Earlier conversation:\n${assistantConversation(messages) || '(none)'}`,
    '',
    `New user message:\n${userMessage}`,
  ].join('\n');
}

export function parseImageGenerationAssistantResult(text: string): ImageGenerationAssistantResult {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  let value: unknown;
  try {
    value = JSON.parse(fenced);
  } catch {
    throw new Error('The assistant returned an invalid response. Please try again.');
  }
  if (!value || typeof value !== 'object') {
    throw new Error('The assistant response is missing its result.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.reply !== 'string' || !record.reply.trim()) {
    throw new Error('The assistant response is missing its chat reply.');
  }
  if (record.prompt !== null && typeof record.prompt !== 'string') {
    throw new Error('The assistant returned an invalid image prompt.');
  }
  return {
    reply: record.reply.trim(),
    prompt: typeof record.prompt === 'string' ? record.prompt.trim() : null,
  };
}
