export type ImageGenerationAssistantMessage = {
  role: 'user' | 'assistant' | 'error';
  text: string;
};

export type ImageGenerationAssistantResult = {
  reply: string;
  prompt: string | null;
  settings: ImageGenerationSettings | null;
  imageDescription: string | null;
};

export type ImageGenerationSettings = {
  width: number;
  height: number;
  characterLora: string;
};

function assistantConversation(messages: ImageGenerationAssistantMessage[]) {
  return messages
    .filter((message) => message.role !== 'error')
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`)
    .join('\n');
}

export function imageGenerationAssistantPrompt(
  currentPrompt: string,
  currentSettings: ImageGenerationSettings,
  currentImageDescription: string,
  availableCharacterLoras: string[],
  messages: ImageGenerationAssistantMessage[],
  userMessage: string,
  describeImage = false,
) {
  return [
    'You are an image prompt assistant inside RPGraph.',
    'Help the user create and refine one image-generation prompt, its settings, and the description of the currently selected generated image.',
    'You can see the currently selected image whenever one exists. Treat it as the image the user refers to.',
    'The current image prompt, settings, and image description are editable by the user and are the source of truth.',
    'When the user requests an image or a visual change, return a complete updated prompt that preserves all existing details not affected by the request.',
    'Do not merely append contradictory instructions. Integrate the requested change cleanly.',
    'When the user asks a general question or asks for advice without requesting a prompt change, set prompt to null.',
    'Only return settings when the user requests a settings change. Preserve unchanged settings.',
    'width and height must be whole pixels from 64 through 4096. Use the requested aspect ratio and approximately requested pixel count.',
    'characterLora must be an exact available Character LoRA filename or an empty string. Other provider LoRA slots are outside these settings and remain unchanged.',
    'Only return imageDescription when describing or correcting the selected image. Write a concise 20 to 30 word scene description.',
    'Keep reply brief and conversational. Summarize what changed without repeating the image prompt.',
    'Return only valid JSON with all four fields. Start from this unchanged result and replace only fields that changed:',
    '{"reply":"Short chat response","prompt":null,"settings":null,"imageDescription":null}',
    'A changed settings value must be {"width":1024,"height":1024,"characterLora":"exact filename or empty"}.',
    ...(describeImage ? ['The Describe Image button was pressed. Describe the selected image now and do not change prompt or settings.'] : []),
    '',
    `Current image prompt:\n${currentPrompt.trim() || '(empty)'}`,
    '',
    `Current image settings:\n${JSON.stringify(currentSettings, null, 2)}`,
    '',
    `Available Character LoRAs (character name: exact filename):\n${availableCharacterLoras.join('\n') || '(none)'}`,
    '',
    `Current selected image description:\n${currentImageDescription.trim() || '(none)'}`,
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
  let settings: ImageGenerationSettings | null = null;
  if (record.settings !== null) {
    if (!record.settings || typeof record.settings !== 'object' || Array.isArray(record.settings)) {
      throw new Error('The assistant returned invalid image settings.');
    }
    const candidate = record.settings as Record<string, unknown>;
    if (
      typeof candidate.width !== 'number' || !Number.isInteger(candidate.width) || candidate.width < 64 || candidate.width > 4096 ||
      typeof candidate.height !== 'number' || !Number.isInteger(candidate.height) || candidate.height < 64 || candidate.height > 4096 ||
      typeof candidate.characterLora !== 'string'
    ) {
      throw new Error('The assistant returned invalid image settings.');
    }
    settings = {
      width: candidate.width,
      height: candidate.height,
      characterLora: candidate.characterLora.trim(),
    };
  }
  if (record.imageDescription !== null && typeof record.imageDescription !== 'string') {
    throw new Error('The assistant returned an invalid image description.');
  }
  return {
    reply: record.reply.trim(),
    prompt: typeof record.prompt === 'string' ? record.prompt.trim() : null,
    settings,
    imageDescription: typeof record.imageDescription === 'string' ? record.imageDescription.trim() : null,
  };
}
