export type ImageGenerationAssistantMessage = {
  role: 'user' | 'assistant' | 'error';
  text: string;
};

export type ImageAssistantModelState = 'unknown' | 'loading' | 'loaded' | 'unloading' | 'unloaded';

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

type ImageGenerationCharacter = {
  name: string;
  profile: {
    description: string;
    personality: string;
    speechStyle: string;
  };
  comfyConfig?: { appearance: string };
};

export function imageGenerationCharacterContext(characters: ImageGenerationCharacter[]) {
  return characters.map((character, index) => [
    `Character ${index + 1}: ${character.name.trim() || 'Unnamed'}`,
    `Description: ${character.profile.description.trim() || '(none)'}`,
    `Personality: ${character.profile.personality.trim() || '(none)'}`,
    `Speech Style: ${character.profile.speechStyle.trim() || '(none)'}`,
    `Character Appearance: ${character.comfyConfig?.appearance.trim() || '(none)'}`,
  ].join('\n')).join('\n\n');
}

export const imageGenerationAssistantInstructions = [
  'You are the image-generation prompt assistant for an RP game inside RPGraph.',
  'Your job is to create and refine one complete image prompt, its generation settings, and the description of the currently selected generated image.',
  'You receive a Storybook character database with each character\'s description, personality, speech style, visual appearance, and optional exact Character LoRA filename.',
  'You receive the last four RP turns as story context. Use them to understand references, relationships, locations, actions, mood, and what is currently happening.',
  'You can see the currently selected generated image whenever one exists. Treat it as the image the user refers to when they mention this image, the current image, or visible details.',
  'You may create scenes without Storybook characters, such as an animal, object, location, or atmosphere.',
  'The image settings support at most one Character LoRA. A prompt using a Character LoRA may therefore depict only that one Storybook character.',
  'When one requested character has an available LoRA, use its exact filename in characterLora and create a prompt for only that character.',
  'Never combine two Character LoRAs and never place a second Storybook character into a prompt while characterLora is set.',
  'If the user requests multiple Storybook characters and any of them require LoRAs, briefly explain the one-character limitation and ask which single character to use; do not create a conflicting prompt.',
  'If none of the requested characters has a defined LoRA, you may describe multiple characters from their text-based appearance information and leave characterLora empty.',
  'Use the character database and recent story context as facts. Do not invent conflicting identity or appearance details.',
  'The current image prompt, settings, and image description are editable by the user and are the source of truth.',
  'When the user requests an image or a visual change, return a complete updated prompt that preserves all existing details not affected by the request.',
  'Do not merely append contradictory instructions. Integrate the requested change cleanly.',
  'When the user asks a general question or asks for advice without requesting a prompt change, set prompt to null.',
  'Only return settings when the user requests a settings change or when the correct Character LoRA selection must change. Preserve unchanged settings.',
  'width and height must be whole pixels from 64 through 4096. Use the requested aspect ratio and approximately requested pixel count.',
  'characterLora must be one exact available Character LoRA filename or an empty string. Other provider LoRA slots are outside these settings and remain unchanged.',
  'Only return imageDescription when describing or correcting the selected image. Write a concise 20 to 30 word scene description.',
  'Keep reply brief and conversational. Summarize what changed without repeating the image prompt.',
  'Return only valid JSON with all four fields. Start from this unchanged result and replace only fields that changed:',
  '{"reply":"Short chat response","prompt":null,"settings":null,"imageDescription":null}',
  'A changed settings value must be {"width":1024,"height":1024,"characterLora":"exact filename or empty"}.',
].join('\n');

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
  characterContext: string,
  chatHistoryContext: string,
  messages: ImageGenerationAssistantMessage[],
  userMessage: string,
  describeImage = false,
) {
  return [
    imageGenerationAssistantInstructions,
    ...(describeImage ? ['The Describe Image button was pressed. Describe the selected image now and do not change prompt or settings.'] : []),
    '',
    `Current image prompt:\n${currentPrompt.trim() || '(empty)'}`,
    '',
    `Current image settings:\n${JSON.stringify(currentSettings, null, 2)}`,
    '',
    `Available Character LoRAs (character name: exact filename):\n${availableCharacterLoras.join('\n') || '(none)'}`,
    '',
    `Storybook Characters:\n${characterContext || '(none)'}`,
    '',
    `Last Four RP Turns:\n${chatHistoryContext || '(none)'}`,
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
