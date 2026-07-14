import type { ChatImageAttachment, MessageRecord, ProviderConnectionHealth, WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import { createComfyImageForCharacter } from '../runScratch';
import { storybookImageListsFromNodes, type StorybookCreateImageCharacter } from '../../storybook/runtime';

export type PromptActionId = 'getImageId' | 'updatePhoneImageCaption' | 'describeInputImage' | 'createImage';

export type PromptActionConfig = {
  title: string;
  actionId: PromptActionId;
  maxReturnedImages: number;
  sendImagesToLlm: boolean;
  hideImageTextWhenSendingToLlm: boolean;
  manageModelMemoryForComfy: boolean;
  runAfterReply: boolean;
  comfyProviderId?: string;
  instructionTemplate: string;
  afterReplyTemplate: string;
  resultTemplate: string;
};

export type PromptActionRuntimeConfig = Pick<
  PromptActionConfig,
  'maxReturnedImages' | 'sendImagesToLlm' | 'hideImageTextWhenSendingToLlm' | 'manageModelMemoryForComfy' | 'comfyProviderId'
>;

export type PromptActionRuntimeSettings = Partial<Record<PromptActionId, Partial<PromptActionRuntimeConfig>>>;

export type PromptActionStoredConfig = Partial<PromptActionConfig> & {
  title: string;
  actionId: PromptActionId | 'getImages' | 'update_phone_image_caption' | 'describe_input_image' | 'create_image';
  preset?: 'default';
};

export type PromptActionToken = {
  raw: string;
  title: string;
  index: number;
  hasTitle: boolean;
};

export type ParsedPromptActionCall = {
  action: PromptActionId;
  characters?: string;
  phoneOwner?: string;
  loraCharacter?: string;
  tags?: string;
  prompt?: string;
  imageId?: string;
  imageAction?: 'create' | 'update' | 'no_change';
  caption?: string;
};

export type ParsedPromptActionRequest = {
  action: 'getImageId' | 'createImage';
  plan: string;
};

type ActionImageResult = {
  imageId: string;
  caption: string;
  characterName: string;
  shownTo: string[];
  score: number;
  attachment: ChatImageAttachment;
};

export const promptActionIds: PromptActionId[] = ['getImageId', 'updatePhoneImageCaption', 'describeInputImage', 'createImage'];
export const defaultPromptActionTitle = 'Get character phone image list';
export const updatePhoneImageCaptionActionTitle = 'Update phone image caption';
export const describeInputImageActionTitle = 'Describe input image';
export const createImageActionTitle = 'Create character phone image';

export function promptActionTitle(actionId: PromptActionId) {
  switch (actionId) {
    case 'updatePhoneImageCaption':
      return updatePhoneImageCaptionActionTitle;
    case 'describeInputImage':
      return describeInputImageActionTitle;
    case 'createImage':
      return createImageActionTitle;
    default:
      return defaultPromptActionTitle;
  }
}

export const afterReplyPromptActionSuffix = ' (After Reply Action)';

export function promptActionPromptTitle(actionId: PromptActionId) {
  const title = promptActionTitle(actionId);
  return defaultPromptActionRunAfterReply(actionId)
    ? `${title}${afterReplyPromptActionSuffix}`
    : title;
}

export function promptActionHintText(actionId: PromptActionId) {
  switch (actionId) {
    case 'getImageId':
      return [
        'Stored character image search is available. To request it, output exactly one JSON object and nothing else:',
        '{"action":"get_image_id","plan":"brief plan describing whose image is needed and what it should show"}',
      ].join('\n');
    case 'createImage':
      return [
        'Character image generation is available. To request it, output exactly one JSON object and nothing else:',
        '{"action":"create_image","plan":"briefly state who takes and owns the photo, who is photographed, and what is visibly photographed"}',
      ].join('\n');
    default:
      return '';
  }
}

const legacyPromptActionTitleKeys = new Map<string, string>([
  ['get character image list', 'get character phone image list'],
  ['update incoming image caption', 'update phone image caption'],
  ['create image', 'create character phone image'],
]);

export type PromptActionCondition = {
  id: 'vision' | 'imageInput' | 'comfyProvider' | 'createImageCharacters';
  label: string;
};

export function promptActionConditions(actionId: PromptActionId): PromptActionCondition[] {
  switch (actionId) {
    case 'updatePhoneImageCaption':
    case 'describeInputImage':
      return [
        { id: 'vision', label: 'LLM vision capability enabled' },
        { id: 'imageInput', label: 'Image input attached to this run' },
      ];
    case 'createImage':
      return [
        { id: 'comfyProvider', label: 'ComfyUI provider connected and online' },
        { id: 'createImageCharacters', label: 'Storybook character available' },
      ];
    default:
      return [];
  }
}

export const getImagesLlmInstruction = [
  'Action follow-up: search stored character phone images',
  '',
  'The first pass requested this action with the following plan:',
  '{{plan}}',
  '',
  'Use the Text Input and this plan to choose the Storybook characters and visual search tags. This pass performs only the image search; do not write or continue the visible reply.',
  '',
  'Now output exactly one JSON object and nothing else:',
  '',
  '{',
  '"action": "get_image_id",',
  '"characters": "Character Name, Other Name",',
  '"tags": "name, location, pose, clothing, selfie, mirror"',
  '}',
  '',
  'Search with at least 10 tags.',
].join('\n');

export const updatePhoneImageCaptionInstruction = [
  'Available action: update phone image caption',
  '',
  'Use this action once, before the final visible phone reply, when the latest phone input includes an attached incoming image.',
  'Caption only the latest incoming phone input image. When image labels are present, this is normally Attached input image Nr1. Do not caption older attached/reference images such as Attached input image Nr2, Nr3, or images sent by the other character earlier.',
  '',
  'This action records the internal caption/create/update/no-change decision for that incoming image.',
  '',
  'To call it, output exactly one JSON object and nothing else:',
  '',
  '{',
  '"action": "update_phone_image_caption",',
  '"imageId": "new_image",',
  '"imageAction": "create",',
  '"caption": "complete contextual caption"',
  '}',
  '',
  'Use imageAction "create" only when the incoming image has no imageId and no caption yet; set imageId to "new_image". If the image label already shows an imageId and caption, never use "create".',
  'If the image label shows an imageId but no caption yet, always use imageAction "update" with that exact imageId and write its first caption.',
  'Use imageAction "update" with the exact existing imageId only when the latest messages establish story-relevant new information that changes the meaning of the existing caption: a confirmed event, changed situation, identity, relationship, location, or intent. Do not update just to reword the caption or add minor visible details the caption already implies.',
  'Use imageAction "no_change" with the exact existing imageId in every other case. When in doubt, choose "no_change". Restating what is already captioned, small wording differences, or context that merely matches the image are not reasons to update.',
  '',
  'For create/update, write one concise 20 to 30 word caption. Combine visible image details with reliable recent phone/chat/story context. Describe pose, expression, clothing, action, setting, mood, and confirmed situation. Avoid metadata, filenames, image-generation wording, and uncertainty about identity.',
  '',
  'After this action is accepted, do not write this caption action again in the final reply. Continue with the normal phone message or the next available action.',
].join('\n');

export const describeInputImageInstruction = [
  'Available action: describe input image',
  '',
  'The latest input includes an attached image. Call this action once, before writing the final visible RP story.',
  'Caption only the latest attached input image. When image labels are present, this is normally Attached input image Nr1. Do not caption older attached/reference images.',
  '',
  'To call it, output exactly one JSON object and nothing else:',
  '',
  '{',
  '"action": "describe_input_image",',
  '"caption": "20 to 30 word RP scene snapshot"',
  '}',
  '',
  'The caption is hidden scene metadata for the chat history, not a phone image, not a gallery entry, and not an outgoing attachment.',
  'Describe who is likely shown, pose, expression, clothing, setting, action, mood, and why the moment matters in the scene. Combine visible image details with recent scene and relationship context.',
  'If nudity, exposed genitals, breasts, nipples, ass, sexual body parts, revealing or tight clothing, partial or complete undress, or erotic atmosphere is visible, name it directly and neutrally.',
  '',
  'After this action is accepted, do not write it again. Continue with the normal RP story and react to the attached image content in the visible prose.',
].join('\n');

export const describeInputImageAfterReplyInstruction = [
  'Internal caption task: describe input image',
  '',
  'The chat context above is the story so far, ending with the latest input that includes an attached image. The visible RP reply has already been written and sent:',
  '',
  'RP reply:',
  '{{reply}}',
  '',
  'Now record the hidden scene caption for the attached input image. Output exactly one JSON object and nothing else:',
  '',
  '{',
  '"action": "describe_input_image",',
  '"caption": "20 to 30 word RP scene snapshot"',
  '}',
  '',
  'Caption only the latest attached input image. When image labels are present, this is normally Attached input image Nr1. Do not caption older attached/reference images.',
  'Describe who is likely shown, pose, expression, clothing, setting, action, mood, and why the moment matters in the scene. Combine visible image details with the chat history and the RP reply.',
  'If nudity, exposed genitals, breasts, nipples, ass, sexual body parts, revealing or tight clothing, partial or complete undress, or erotic atmosphere is visible, name it directly and neutrally.',
  'The caption is hidden scene metadata for the chat history, not a phone image, not a gallery entry, and not an outgoing attachment. Do not write story text, explanations, or any other JSON.',
].join('\n');

const previousUpdatePhoneImageCaptionAfterReplyDecisionRules = [
  'Use imageAction "update" with the exact existing imageId only when the latest messages or the visible phone reply establish story-relevant new information that changes the meaning of the existing caption: a confirmed event, changed situation, identity, relationship, location, or intent. Do not update just to reword the caption or add minor visible details the caption already implies.',
  'Use imageAction "no_change" with the exact existing imageId in every other case. When in doubt, choose "no_change".',
].join('\n');

const updatePhoneImageCaptionAfterReplyDecisionRules = [
  'For an image that already has a caption, imageAction "no_change" is the default.',
  'Use imageAction "update" with the exact existing imageId only when the phone/chat/story context explicitly establishes a new fact about the pictured moment that was not known when the current caption was written and materially changes its meaning. Valid examples are a previously unknown person being explicitly identified, or a confirmed event, relationship, location, situation, or intent that changes what the image represents.',
  'The visible phone reply is not new evidence by itself. A reaction, compliment, guess, inference, paraphrase, or more detailed description of already visible content must not trigger an update. Forwarding or resending the existing image to another person must not trigger an update.',
  'Do not update for minor visible details, improved wording, extra atmosphere, inferred emotions, or information already stated or implied by the current caption.',
  'Before choosing "update", compare the exact new fact with the current caption. If there is no clear new fact, or the existing caption remains accurate and useful without it, use "no_change".',
].join('\n');

const previousUpdatePhoneImageCaptionAfterReplyWritingRule =
  'For create/update, write one concise 20 to 30 word caption. Combine visible image details with reliable recent phone/chat/story context and the visible phone reply. Avoid metadata, filenames, image-generation wording, and uncertainty about identity.';

const updatePhoneImageCaptionAfterReplyWritingRule =
  'For create/update, write one concise 20 to 30 word caption. Combine visible image details with reliable facts explicitly established by recent phone/chat/story context. Avoid metadata, filenames, image-generation wording, guesses, and uncertainty about identity.';

const previousUpdatePhoneImageCaptionAfterReplyExample = [
  '{',
  '"action": "update_phone_image_caption",',
  '"imageId": "new_image",',
  '"imageAction": "create",',
  '"caption": "complete contextual caption"',
  '}',
].join('\n');

const updatePhoneImageCaptionAfterReplyExample = [
  'For the common case where the image label already contains both an imageId and a caption, output this no-change shape:',
  '',
  '{',
  '"action": "update_phone_image_caption",',
  '"imageId": "exact existing imageId",',
  '"imageAction": "no_change"',
  '}',
  '',
  'Use the create or update shapes only when the strict rules below require them.',
].join('\n');

export const updatePhoneImageCaptionAfterReplyInstruction = [
  'Internal caption task: update phone image caption',
  '',
  'The phone context above ends with the latest phone input that includes an attached incoming image. The visible phone reply has already been written and sent:',
  '',
  'Phone reply:',
  '{{reply}}',
  '',
  'Now record the internal caption/create/update/no-change decision for that incoming image. Output exactly one JSON object and nothing else:',
  '',
  updatePhoneImageCaptionAfterReplyExample,
  '',
  'Caption only the latest incoming phone input image. When image labels are present, this is normally Attached input image Nr1. Do not caption older attached/reference images such as Attached input image Nr2, Nr3, or images sent by the other character earlier.',
  'Use imageAction "create" only when the incoming image has no imageId and no caption yet; set imageId to "new_image". If the image label already shows an imageId and caption, never use "create".',
  'If the image label shows an imageId but no caption yet, always use imageAction "update" with that exact imageId and write its first caption.',
  updatePhoneImageCaptionAfterReplyDecisionRules,
  updatePhoneImageCaptionAfterReplyWritingRule,
].join('\n');

const previousCreateImageInstruction = [
  'Action follow-up: generate a character phone image',
  '',
  'The first pass requested this action with the following plan:',
  '{{plan}}',
  '',
  'Use the Text Input and this plan to choose the exact character owner and write the complete image-generation prompt. This pass performs only image generation; do not write or continue the visible reply.',
  '',
  'Available characters:',
  '{{availableCharacters}}',
  '',
  'Character selection and appearance:',
  '- character is the exact Storybook owner of the generated phone image and must match one available character name exactly.',
  '- The character value is internal routing data. Keep that Storybook name out of the prompt unless it is a widely recognized real or fictional subject explicitly requested by the user.',
  '- When the selected character has LoRA, RPGraph applies it automatically. Describe that character only through their current visible pose, expression, clothing, position, and action; do not repeat permanent face, hair, or body details.',
  '- When the selected character has Description but no LoRA, RPGraph automatically prepends the saved visual appearance. Do not repeat or contradict that permanent appearance in the prompt.',
  '- Other visible people do not receive the selected character setup. Describe every other person with the complete visible appearance needed to generate them consistently from the Text Input.',
  '',
  'Image prompt guidelines:',
  '- Write one complete natural English paragraph of roughly 80 to 120 words.',
  '- Describe one frozen visual snapshot of the current moment. Do not advance the story, describe what happens next, or combine earlier and later scene states.',
  '- Use direct, factual visual language and standard ASCII characters with normal punctuation. Do not use Markdown, decorative symbols, poetic narration, metaphors, generic quality tags, or image-generation terminology.',
  '- Include only details visible in a single still image. Exclude thoughts, dialogue, sounds, smells, tastes, memories, intentions, relationships, backstory, and explanations. Express mood through visible posture, facial expression, lighting, composition, and environment.',
  '- Use the latest established state of every person, garment, object, and location. Track clothing that was put on, removed, opened, closed, raised, lowered, loosened, or covered. Mention only clothing and accessories that are currently visible.',
  '- Describe objects only in their current visible state. Omit anything fully concealed, behind another object, or outside the frame. Do not explain previous states or describe absent elements with negative phrases such as "no visible" or "no other".',
  '- Do not use Storybook-only character names, private fictional place names, or other story-specific proper nouns in the prompt. Replace them with unambiguous visual identifiers such as "the young woman", "the seated man", or "the woman on the left".',
  '- For multiple people, describe each person separately and distinguish them through position, appearance, clothing, hairstyle, pose, and visible action. Avoid ambiguous pronouns. When one visual feature is important for identification, give the corresponding visible feature for the others when useful.',
  '- Order the paragraph clearly: visible subjects and clothing first; then positions, poses, expressions, actions, and interaction; then setting and background objects; then camera angle, framing, composition, lighting, time of day, and visible atmosphere.',
  '- Preserve all reliable visual continuity from the Text Input and plan, but never invent details that conflict with the current scene or character setup.',
  '',
  'Now output exactly one JSON object and nothing else:',
  '',
  '{',
  '"action": "create_image",',
  '"character": "Character Name",',
  '"prompt": "complete image generation prompt"',
  '}',
].join('\n');

const previousPhoneOwnerSubjectCreateImageInstruction = [
  'Action follow-up: generate a character phone image',
  '',
  'The first pass requested this action with the following plan:',
  '{{plan}}',
  '',
  'Use the Text Input and this plan to choose the exact phone owner, the exact photographed subject character, and the complete image-generation prompt. This pass performs only image generation; do not write or continue the visible reply.',
  '',
  'Available subject characters:',
  '{{availableCharacters}}',
  '',
  'Phone owner and subject selection:',
  '- phoneOwner is the known Storybook character who takes or owns the photo. It controls only which Phone Gallery stores the generated image; every known Storybook character may be used, even without Character Appearance or LoRA.',
  '- subjectCharacter is the primary photographed person. It must exactly match one name from Available subject characters. RPGraph uses only this character\'s Appearance and LoRA for image generation.',
  '- phoneOwner and subjectCharacter may be the same for a selfie, or different when one character photographs another.',
  '- Both values are internal routing data. Keep Storybook-only names out of the prompt unless they are widely recognized real or fictional subjects explicitly requested by the user.',
  '- When the subject character has LoRA, RPGraph applies it automatically. Describe that character only through their current visible pose, expression, clothing, position, and action; do not repeat permanent face, hair, or body details.',
  '- When the subject character has Description but no LoRA, RPGraph automatically prepends the saved visual appearance. Do not repeat or contradict that permanent appearance in the prompt.',
  '- Other visible people do not receive the subject character setup. Describe every other person with the complete visible appearance needed to generate them consistently from the Text Input.',
  '',
  'Image prompt guidelines:',
  '- Write one complete natural English paragraph of roughly 80 to 120 words.',
  '- Describe one frozen visual snapshot of the current moment. Do not advance the story, describe what happens next, or combine earlier and later scene states.',
  '- Use direct, factual visual language and standard ASCII characters with normal punctuation. Do not use Markdown, decorative symbols, poetic narration, metaphors, generic quality tags, or image-generation terminology.',
  '- Include only details visible in a single still image. Exclude thoughts, dialogue, sounds, smells, tastes, memories, intentions, relationships, backstory, and explanations. Express mood through visible posture, facial expression, lighting, composition, and environment.',
  '- Use the latest established state of every person, garment, object, and location. Track clothing that was put on, removed, opened, closed, raised, lowered, loosened, or covered. Mention only clothing and accessories that are currently visible.',
  '- Describe objects only in their current visible state. Omit anything fully concealed, behind another object, or outside the frame. Do not explain previous states or describe absent elements with negative phrases such as "no visible" or "no other".',
  '- Do not use Storybook-only character names, private fictional place names, or other story-specific proper nouns in the prompt. Replace them with unambiguous visual identifiers such as "the young woman", "the seated man", or "the woman on the left".',
  '- For multiple people, describe each person separately and distinguish them through position, appearance, clothing, hairstyle, pose, and visible action. Avoid ambiguous pronouns. When one visual feature is important for identification, give the corresponding visible feature for the others when useful.',
  '- Order the paragraph clearly: visible subjects and clothing first; then positions, poses, expressions, actions, and interaction; then setting and background objects; then camera angle, framing, composition, lighting, time of day, and visible atmosphere.',
  '- Preserve all reliable visual continuity from the Text Input and plan, but never invent details that conflict with the current scene or character setup.',
  '',
  'Now output exactly one JSON object and nothing else:',
  '',
  '{',
  '"action": "create_image",',
  '"phoneOwner": "Phone Owner Name",',
  '"subjectCharacter": "Subject Character Name",',
  '"prompt": "complete image generation prompt"',
  '}',
].join('\n');

const finishedImageViewRule =
  '- Write the prompt from the finished image\'s point of view. Describe only what the camera captures. Do not narrate who takes the photo, how they approach, why the photo is discreet, or what happens outside the frame. The photographer is invisible unless their body or reflection must actually appear in the final image.';

export const createImageInstruction = [
  'Action follow-up: generate a character phone image',
  '',
  'The first pass requested this action with the following plan:',
  '{{plan}}',
  '',
  'Use the Text Input, story context, and this plan to choose the exact phone owner, optionally select one character LoRA, and write the complete image-generation prompt. This pass performs only image generation; do not write or continue the visible reply.',
  '',
  'Available characters:',
  '{{availableCharacters}}',
  '',
  'Phone owner, Appearance, and LoRA selection:',
  '- phoneOwner is the known Storybook character who takes or owns the photo. It controls only which Phone Gallery stores the generated image; every known Storybook character may be used.',
  '- Character Appearance is reference material for writing the prompt. RPGraph does not prepend it automatically. Select only currently visible and relevant details, and combine them naturally with the latest story context.',
  '- The latest reliable context overrides saved temporary details such as clothing, hairstyle, accessories, makeup, pose, and location. Do not copy outdated or contradictory Appearance details into the prompt.',
  '- loraCharacter selects the one Storybook character whose configured LoRA RPGraph applies. If the primary or most visually important photographed character has LoRA available, use that character\'s exact name; otherwise use the number 0.',
  '- In the JSON example below, replace 0 with that exact character name as a quoted string when selecting a LoRA.',
  '- Only one character LoRA can be used per image. When multiple people are visible, choose the available LoRA for the primary or most visually important character. Describe every other person fully through prompt text using their Appearance and the story context.',
  '- For a visible character without Character Appearance, build a consistent visual description from reliable story context. Do not invent details that conflict with known information.',
  '- State every visible person\'s age in the prompt whenever their age is known from Appearance or context. Use a natural form such as "a 28-year-old woman". Do not invent an age when none is known.',
  '- phoneOwner and loraCharacter are internal routing data. Keep Storybook-only names out of the image prompt unless they are widely recognized real or fictional subjects explicitly requested by the user.',
  '',
  'Image prompt guidelines:',
  finishedImageViewRule,
  '- Write one complete natural English paragraph of roughly 80 to 120 words.',
  '- Describe one frozen visual snapshot of the current moment. Do not advance the story, describe what happens next, or combine earlier and later scene states.',
  '- Use direct, factual visual language and standard ASCII characters with normal punctuation. Do not use Markdown, decorative symbols, poetic narration, metaphors, generic quality tags, or image-generation terminology.',
  '- Include only details visible in a single still image. Exclude thoughts, dialogue, sounds, smells, tastes, memories, intentions, relationships, backstory, and explanations. Express mood through visible posture, facial expression, lighting, composition, and environment.',
  '- Use the latest established state of every person, garment, object, and location. Track clothing that was put on, removed, opened, closed, raised, lowered, loosened, or covered. Mention only clothing and accessories that are currently visible.',
  '- Describe objects only in their current visible state. Omit anything fully concealed, behind another object, or outside the frame. Do not explain previous states or describe absent elements with negative phrases such as "no visible" or "no other".',
  '- Do not use Storybook-only character names, private fictional place names, or other story-specific proper nouns in the prompt. Replace them with unambiguous visual identifiers such as "the young woman", "the seated man", or "the woman on the left".',
  '- For multiple people, describe each person separately and distinguish them through position, age when known, appearance, clothing, hairstyle, pose, and visible action. Avoid ambiguous pronouns.',
  '- Order the paragraph clearly: visible subjects and clothing first; then positions, poses, expressions, actions, and interaction; then setting and background objects; then camera angle, framing, composition, lighting, time of day, and visible atmosphere.',
  '- Preserve all reliable visual continuity from the Text Input, story context, and plan.',
  '',
  'Now output exactly one JSON object and nothing else:',
  '',
  '{',
  '"action": "create_image",',
  '"phoneOwner": "Phone Owner Name",',
  '"loraCharacter": 0,',
  '"prompt": "complete image generation prompt"',
  '}',
].join('\n');

const previousCreateImageInstructions = new Set([
  createImageInstruction.replace(`\n${finishedImageViewRule}`, ''),
  previousCreateImageInstruction,
  previousPhoneOwnerSubjectCreateImageInstruction,
  [
    'Available action: create character phone image',
    '',
    'Use this internal action when no stored image fits and a new outgoing phone image should be generated for a character.',
    'Call it once before the final visible reply. Do not write a normal message together with this action.',
    '',
    'Available characters:',
    '{{availableCharacters}}',
    '',
    'To call it, output exactly one JSON object and nothing else:',
    '',
    '{',
    '"action": "create_image",',
    '"character": "Character Name",',
    '"prompt": "complete image generation prompt"',
    '}',
    '',
    'The character must be the sender/owner of the outgoing generated phone image.',
    'The character value must match one of the available character names exactly.',
    'The prompt should describe the current RP image moment for ComfyUI: pose, expression, clothing for this scene, setting, lighting, mood, camera/framing, and relevant RP context.',
    'Do not try to redefine the character identity or permanent base appearance. RPGraph automatically prepends the character appearance saved in Storybook and applies that character LoRA when configured.',
    'Do not include instructions to send a message. This action only creates and stores the image in the character phone image library.',
  ].join('\n'),
  [
    'Available action: create image',
    '',
    'Use this internal action when no stored image fits and a new outgoing phone/RP image should be generated for a character.',
    'Call it once before the final visible reply. Do not write a normal message together with this action.',
    '',
    'Available characters:',
    '{{availableCharacters}}',
    '',
    'To call it, output exactly one JSON object and nothing else:',
    '',
    '{',
    '"action": "create_image",',
    '"character": "Character Name",',
    '"prompt": "complete image generation prompt"',
    '}',
    '',
    'The character must be the sender/owner of the outgoing generated image.',
    'The character value must match one of the available character names exactly.',
    'The prompt should describe the current RP image moment for ComfyUI: pose, expression, clothing for this scene, setting, lighting, mood, camera/framing, and relevant RP context.',
    'Do not try to redefine the character identity or permanent base appearance. RPGraph automatically prepends the character appearance saved in Storybook and applies that character LoRA when configured.',
    'Do not include instructions to send a message. This action only creates and stores the image.',
  ].join('\n'),
]);

const updatePhoneImageCaptionMissingCaptionRule =
  'If the image label shows an imageId but no caption yet, always use imageAction "update" with that exact imageId and write its first caption.';

const previousUpdatePhoneImageCaptionInstructions = new Set([
  updatePhoneImageCaptionInstruction.replace(`\n${updatePhoneImageCaptionMissingCaptionRule}`, ''),
]);

const previousUpdatePhoneImageCaptionAfterReplyInstruction = updatePhoneImageCaptionAfterReplyInstruction
  .replace(
    updatePhoneImageCaptionAfterReplyExample,
    previousUpdatePhoneImageCaptionAfterReplyExample,
  )
  .replace(
    updatePhoneImageCaptionAfterReplyDecisionRules,
    previousUpdatePhoneImageCaptionAfterReplyDecisionRules,
  )
  .replace(
    updatePhoneImageCaptionAfterReplyWritingRule,
    previousUpdatePhoneImageCaptionAfterReplyWritingRule,
  );

const previousUpdatePhoneImageCaptionAfterReplyInstructions = new Set([
  updatePhoneImageCaptionAfterReplyInstruction.replace(`\n${updatePhoneImageCaptionMissingCaptionRule}`, ''),
  previousUpdatePhoneImageCaptionAfterReplyInstruction,
  previousUpdatePhoneImageCaptionAfterReplyInstruction
    .replace(`\n${updatePhoneImageCaptionMissingCaptionRule}`, ''),
]);

const previousGetImagesLlmInstructions = new Set([
  [
    'Available action: get character phone image list',
    '',
    'Call this action when image list information is needed. Do not write a normal message together with this action.',
    '',
    'To call it, output exactly one JSON object and nothing else:',
    '',
    '{',
    '"action": "get_image_id",',
    '"characters": "Character Name, Other Name",',
    '"tags": "name, location, pose, clothing, selfie, mirror"',
    '}',
    '',
    'Search with at least 6 tags.',
    '',
    'Use the image ID action proactively when the phone situation is about appearance, outfit, clothes, getting ready, selfies, mirrors, parties, bedrooms, current look, a character asking what someone is wearing, or sending/receiving photos. Do not wait for the sender to explicitly say "send a picture" if a fitting stored image would naturally support the reply.',
  ].join('\n'),
  [
    'Available action: get image ID list',
    '',
    'Call this action when image list information is needed. Do not write a normal message together with this action.',
    '',
    'To call it, output exactly one JSON object and nothing else:',
    '',
    '{',
    '"action": "get_image_id",',
    '"characters": "Character Name, Other Name",',
    '"tags": "name, location, pose, clothing, selfie, mirror"',
    '}',
    '',
    'Search with at least 6 tags.',
    '',
    'Use the image ID action proactively when the phone situation is about appearance, outfit, clothes, getting ready, selfies, mirrors, parties, bedrooms, current look, a character asking what someone is wearing, or sending/receiving photos. Do not wait for the sender to explicitly say "send a picture" if a fitting stored image would naturally support the reply.',
  ].join('\n'),
  [
    'Available action: getImages',
    '',
    'Only call this action when image information is needed. Do not write a normal message together with this action.',
    '',
    'To call it, output exactly one JSON object and nothing else:',
    '',
    '{',
    '"action": "getImages",',
    '"characters": "Character Name,Other Character Name",',
    '"tags": "tag1,tag2"',
    '}',
    '',
    '`tags` is a comma-separated list of short search tags. Search with at least 6 tags.',
  ].join('\n'),
  [
    'Available action: getImages',
    '',
    'Use this action if you need a list of stored images for one or more characters before writing the final reply.',
    '',
    'To call it, output exactly one JSON object and nothing else:',
    '',
    '{',
    '"action": "getImages",',
    '"characters": "Character Name,Other Character Name",',
    '"tags": "tag1,tag2"',
    '}',
    '',
    '`characters` is a comma-separated list of full character names.',
    '`tags` is a comma-separated list of short search tags such as selfie, mirror, bedroom, outfit, smiling, angry, phone_photo.',
    '',
    'Only call this action when image information is needed. Do not write a normal message together with this action.',
  ].join('\n'),
]);

const defaultGetImagesResultLineTemplate = '* {{imageReference}}: {{imageId}} : {{imageText}} : Image shown to: {{imageShownTo}}';

export const defaultGetImagesResultTemplate = [
  'Action executed: get character phone image list.',
  'Found images for tags: {{tags}}',
  defaultGetImagesResultLineTemplate,
  '',
  'Do not send a returned image again to anyone listed under "Image shown to"; they have already seen or received it. Choose another fitting image or omit sendImageId instead.',
  'If no returned image fits, use the Create character phone image action when it is offered elsewhere in the current prompt: request it next, following its instructions, instead of writing the final reply.',
  'If image generation is not offered, write the reply without an image and steer the conversation naturally away from sending a photo. Do not mention a missing image and do not force an unrelated stored photo into the reply.',
].join('\n');

export const defaultUpdatePhoneImageCaptionResultTemplate = [
  'Incoming image caption action recorded:',
  '',
  '{{imageActionJson}}',
  '',
  'Do not repeat this caption action in the final reply.',
].join('\n');

export const defaultDescribeInputImageResultTemplate = [
  'Attached input image caption recorded:',
  '',
  '{{caption}}',
  '',
  'The caption is saved automatically as hidden scene metadata for the chat history. Do not repeat this caption action and do not add image metadata JSON to the final reply. React to the attached image content in the visible RP story.',
].join('\n');

export const defaultCreateImageResultTemplate = [
  'Action executed: create a phone image for {{phoneOwner}}.',
  '',
  '* LoRA character: {{loraCharacter}}',
  '* imageId: {{imageId}}',
  '* imagePrompt: {{imagePrompt}}',
  '',
  'The image was generated from the complete prompt and saved to {{phoneOwner}}\'s Phone Gallery.',
  'If the final Phone Message attaches this image with sendImageId, inspect the attached generated image and output one second JSON object immediately after the phone-message object:',
  '{"imageId":"{{imageId}}","imageAction":"update","caption":"complete contextual caption"}',
  'The caption must naturally describe who and what is visibly shown in 20 to 35 words. Use the generated image as visual authority and reliable story context for identities. Do not mention the image prompt, generation, LoRA, how or why the photo was taken, hidden intent, or anything outside the captured frame. If the image is not attached, omit this second object.',
].join('\n');

const previousCreateImageResultTemplates = new Set([
  [
    'Action executed: create a phone image for {{phoneOwner}}.',
    '',
    '* LoRA character: {{loraCharacter}}',
    '* imageId: {{imageId}}',
    '* description: {{description}}',
    '',
    'The image was generated from the complete prompt and saved to {{phoneOwner}}\'s Phone Gallery.',
  ].join('\n'),
  [
    'Action executed: create a phone image of {{subjectCharacter}} for {{phoneOwner}}.',
    '',
    '* imageId: {{imageId}}',
    '* description: {{description}}',
    '',
    'The image was generated using the subject character setup and saved to {{phoneOwner}}\'s Phone Gallery.',
  ].join('\n'),
  [
    'Action executed: create character phone image for {{character}}.',
    '',
    '* imageId: {{imageId}}',
    '* description: {{description}}',
    '',
    'The image was generated from your prompt and saved to the character phone image library.',
  ].join('\n'),
  [
    'Generated phone image for {{character}}:',
    '',
    '* imageId: {{imageId}}',
    '* description: {{description}}',
    '',
    'This image was generated for the current moment and saved to the character phone image library.',
    'For Phone Message output, use this image in the final phone reply by setting sendImageId to "{{imageId}}".',
    'For Normal RP output, display this image in the Chat tab without sending a phone message by adding one hidden metadata object to the final RP output: {"displayImageId":"{{imageId}}"}',
    'Do not display or send more than one image in the same final reply.',
  ].join('\n'),
  [
    'Generated phone image for {{character}}:',
    '',
    '* imageId: {{imageId}}',
    '* description: {{description}}',
    '',
    'This image was generated for the current phone moment and saved to the character phone image library. Use this image in the final phone reply. Set sendImageId to "{{imageId}}".',
  ].join('\n'),
  [
    'Generated image for {{character}}:',
    '',
    '* imageId: {{imageId}}',
    '* description: {{description}}',
    '',
    'This image was generated for the current RP moment and saved to the character image library. Use this image in the final phone/RP reply. For phone output, set sendImageId to "{{imageId}}".',
  ].join('\n'),
]);

const previousGetImagesResultTemplates = new Set([
  [
    'Action executed: get character phone image list.',
    'Found images for tags: {{tags}}',
    '* {{imageReference}}: {{imageId}} : {{imageText}} : Image shown to: {{imageShownTo}}',
    '',
    'Do not send a returned image again to anyone listed under "Image shown to"; they have already seen or received it. Choose another fitting image or omit sendImageId instead.',
    'If no returned image fits and the Create character phone image action is shown elsewhere in the current prompt, call that action before writing the final reply. The action is available only when it is shown.',
    'If that action is not shown, continue naturally without an image. Do not mention the missing image, force an unrelated photo into the reply, or steer the roleplay away from its current topic.',
  ].join('\n'),
  [
    'Action executed: get character phone image list.',
    'Found images for tags: {{tags}}',
    '* {{imageReference}}: {{imageId}} : {{imageText}} : Image shown to: {{imageShownTo}}',
    '',
    'Do not send a returned image again to anyone listed under "Image shown to"; they have already seen or received it. Choose another fitting image or omit sendImageId instead.',
  ].join('\n'),
  [
    'Action executed: get character phone image list.',
    'Found images for tags: {{tags}}',
    '* {{imageReference}}: {{imageId}} : {{imageText}}',
  ].join('\n'),
  [
    'Found Images: {{tags}}',
    '* {{imageReference}}: {{imageId}} : {{imageText}}',
    '',
    'Use a returned imageId as sendImageId only if that image fits the replying/sending character and would feel natural in-character as an outgoing stored phone attachment.',
    'For Normal RP, you may instead display exactly one returned image in the Chat tab without sending a phone message. Add one hidden metadata object to the final RP output: {"displayImageId":"returned_image_id"}',
    'Only display an image when the story beat is literally about seeing, taking, browsing, showing, or looking at that image. Do not display multiple images.',
    'Prefer images that belong to the sender, or image IDs established in recent phone/photo history. Only use another character\'s image ID if recent context clearly makes it available, such as forwarded, shared, saved, or plausibly obtained.',
    'Do not invent image IDs. If no returned image clearly fits, omit sendImageId.',
  ].join('\n'),
  [
    'Found Images: {{tags}}',
    '* {{imageReference}}: {{imageId}} : {{imageText}}',
    '',
    'Use a returned imageId as sendImageId only if that image fits the replying/sending character and would feel natural in-character as an outgoing stored phone attachment.',
    'Prefer images that belong to the sender, or image IDs established in recent phone/photo history. Only use another character\'s image ID if recent context clearly makes it available, such as forwarded, shared, saved, or plausibly obtained.',
    'Do not invent image IDs. If no returned image clearly fits, omit sendImageId.',
  ].join('\n'),
  [
    'Action result: {{actionId}}',
    '',
    'Found images:',
    '',
    '{{images}}',
  ].join('\n'),
]);

function currentOrCustomTemplate(value: unknown, currentTemplate: string, previousTemplates: Set<string>) {
  if (typeof value !== 'string' || !value.trim()) {
    return currentTemplate;
  }
  return previousTemplates.has(value.trim()) ? currentTemplate : value;
}

export function defaultPromptActionRunAfterReply(actionId: PromptActionId) {
  return actionId === 'describeInputImage' || actionId === 'updatePhoneImageCaption';
}

export function defaultPromptActionInstructionTemplate(actionId: PromptActionId) {
  switch (actionId) {
    case 'updatePhoneImageCaption':
      return updatePhoneImageCaptionInstruction;
    case 'describeInputImage':
      return describeInputImageInstruction;
    case 'createImage':
      return createImageInstruction;
    default:
      return getImagesLlmInstruction;
  }
}

function defaultResultTemplate(actionId: PromptActionId) {
  switch (actionId) {
    case 'updatePhoneImageCaption':
      return defaultUpdatePhoneImageCaptionResultTemplate;
    case 'describeInputImage':
      return defaultDescribeInputImageResultTemplate;
    case 'createImage':
      return defaultCreateImageResultTemplate;
    default:
      return defaultGetImagesResultTemplate;
  }
}

export function defaultPromptActionAfterReplyTemplate(actionId: PromptActionId) {
  switch (actionId) {
    case 'updatePhoneImageCaption':
      return updatePhoneImageCaptionAfterReplyInstruction;
    case 'describeInputImage':
      return describeInputImageAfterReplyInstruction;
    default:
      return defaultPromptActionInstructionTemplate(actionId);
  }
}

export function defaultPromptActionConfig(
  title = defaultPromptActionTitle,
  actionId: PromptActionId = 'getImageId',
): PromptActionConfig {
  const canonicalTitle = promptActionTitle(actionId);
  const sendsImagesByDefault = actionId === 'getImageId';
  return {
    title: canonicalTitle || title,
    actionId,
    maxReturnedImages: actionId === 'getImageId' ? 3 : 5,
    sendImagesToLlm: sendsImagesByDefault,
    hideImageTextWhenSendingToLlm: false,
    manageModelMemoryForComfy: true,
    runAfterReply: defaultPromptActionRunAfterReply(actionId),
    comfyProviderId: '',
    instructionTemplate: defaultPromptActionInstructionTemplate(actionId),
    afterReplyTemplate: defaultPromptActionAfterReplyTemplate(actionId),
    resultTemplate: defaultResultTemplate(actionId),
  };
}

function normalizedPromptActionRuntimeConfig(
  actionId: PromptActionId,
  value: Partial<PromptActionRuntimeConfig> | undefined,
): PromptActionRuntimeConfig {
  const maxReturnedImages = Number(value?.maxReturnedImages);
  const sendImagesToLlm = typeof value?.sendImagesToLlm === 'boolean'
    ? value.sendImagesToLlm
    : actionId === 'getImageId';
  return {
    maxReturnedImages: Number.isFinite(maxReturnedImages)
      ? Math.min(20, Math.max(1, Math.trunc(maxReturnedImages)))
      : actionId === 'getImageId' ? 3 : 5,
    sendImagesToLlm,
    hideImageTextWhenSendingToLlm: sendImagesToLlm && (
      typeof value?.hideImageTextWhenSendingToLlm === 'boolean'
        ? value.hideImageTextWhenSendingToLlm
        : false
    ),
    manageModelMemoryForComfy: actionId === 'createImage' && typeof value?.manageModelMemoryForComfy === 'boolean'
      ? value.manageModelMemoryForComfy
      : true,
    comfyProviderId: typeof value?.comfyProviderId === 'string'
      ? value.comfyProviderId.trim()
      : '',
  };
}

export function promptActionRuntimeConfigFromConfig(config: PromptActionConfig): PromptActionRuntimeConfig {
  return normalizedPromptActionRuntimeConfig(config.actionId, config);
}

export function promptActionRuntimeSettings(value: unknown): PromptActionRuntimeSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    promptActionIds.flatMap((actionId) => {
      const settings = record[actionId];
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return [];
      }
      return [[actionId, normalizedPromptActionRuntimeConfig(
        actionId,
        settings as Partial<PromptActionRuntimeConfig>,
      )]];
    }),
  );
}

export function withPromptActionRuntimeSettings(
  config: PromptActionConfig,
  settings: PromptActionRuntimeSettings,
): PromptActionConfig {
  return {
    ...config,
    ...normalizedPromptActionRuntimeConfig(config.actionId, {
      ...config,
      ...settings[config.actionId],
    }),
  };
}

export function withPromptActionRuntimeSettingsList(
  configs: PromptActionConfig[],
  settings: PromptActionRuntimeSettings,
): PromptActionConfig[] {
  return configs.map((config) => withPromptActionRuntimeSettings(config, settings));
}

export function promptActionTemplateConfig(config: PromptActionConfig): PromptActionConfig {
  return {
    ...config,
    ...normalizedPromptActionRuntimeConfig(config.actionId, undefined),
  };
}

function promptActionComparable(config: PromptActionConfig) {
  const templateConfig = promptActionTemplateConfig(config);
  return {
    actionId: templateConfig.actionId,
    title: templateConfig.title.trim(),
    runAfterReply: defaultPromptActionRunAfterReply(templateConfig.actionId) && templateConfig.runAfterReply,
    instructionTemplate: templateConfig.instructionTemplate.trim(),
    afterReplyTemplate: templateConfig.afterReplyTemplate.trim(),
    resultTemplate: templateConfig.resultTemplate.trim(),
  };
}

export function promptActionConfigsEqual(first: PromptActionConfig, second: PromptActionConfig) {
  return JSON.stringify(promptActionComparable(first)) === JSON.stringify(promptActionComparable(second));
}

export function isDefaultPromptActionConfig(config: PromptActionConfig) {
  return promptActionConfigsEqual(
    config,
    defaultPromptActionConfig(config.title, config.actionId),
  );
}

export function normalizePromptActionConfig(
  value: unknown,
): PromptActionConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const actionId =
    record.actionId === 'getImageId' || record.actionId === 'getImages'
      ? 'getImageId'
      : record.actionId === 'updatePhoneImageCaption' || record.actionId === 'update_phone_image_caption'
        ? 'updatePhoneImageCaption'
        : record.actionId === 'describeInputImage' || record.actionId === 'describe_input_image'
          ? 'describeInputImage'
        : record.actionId === 'createImage' || record.actionId === 'create_image'
          ? 'createImage'
        : undefined;
  if (!actionId) {
    return undefined;
  }
  const title = promptActionTitle(actionId);
  const maxReturnedImages = Number(record.maxReturnedImages);
  const runAfterReply = defaultPromptActionRunAfterReply(actionId);
  const sendImagesToLlm = typeof record.sendImagesToLlm === 'boolean'
    ? record.sendImagesToLlm
    : actionId === 'getImageId';
  return {
    title,
    actionId,
    maxReturnedImages: Number.isFinite(maxReturnedImages)
      ? Math.min(20, Math.max(1, Math.trunc(maxReturnedImages)))
      : actionId === 'getImageId' ? 3 : 5,
    sendImagesToLlm,
    hideImageTextWhenSendingToLlm: sendImagesToLlm && (
      typeof record.hideImageTextWhenSendingToLlm === 'boolean'
        ? record.hideImageTextWhenSendingToLlm
        : false
    ),
    manageModelMemoryForComfy: typeof record.manageModelMemoryForComfy === 'boolean'
      ? record.manageModelMemoryForComfy
      : true,
    runAfterReply,
    comfyProviderId: typeof record.comfyProviderId === 'string'
      ? record.comfyProviderId.trim()
      : '',
    instructionTemplate: actionId === 'getImageId'
      ? currentOrCustomTemplate(
          record.instructionTemplate,
          getImagesLlmInstruction,
          previousGetImagesLlmInstructions,
        )
      : actionId === 'updatePhoneImageCaption'
        ? currentOrCustomTemplate(
            record.instructionTemplate,
            updatePhoneImageCaptionInstruction,
            previousUpdatePhoneImageCaptionInstructions,
          )
      : actionId === 'createImage'
        ? currentOrCustomTemplate(
            record.instructionTemplate,
            createImageInstruction,
            previousCreateImageInstructions,
          )
      : (typeof record.instructionTemplate === 'string' && record.instructionTemplate.trim()
        ? record.instructionTemplate
        : defaultPromptActionInstructionTemplate(actionId)),
    afterReplyTemplate: actionId === 'updatePhoneImageCaption'
      ? currentOrCustomTemplate(
          record.afterReplyTemplate,
          updatePhoneImageCaptionAfterReplyInstruction,
          previousUpdatePhoneImageCaptionAfterReplyInstructions,
        )
      : typeof record.afterReplyTemplate === 'string' && record.afterReplyTemplate.trim()
        ? record.afterReplyTemplate
        : defaultPromptActionAfterReplyTemplate(actionId),
    resultTemplate: actionId === 'getImageId'
      ? currentOrCustomTemplate(
          record.resultTemplate,
          defaultGetImagesResultTemplate,
          previousGetImagesResultTemplates,
        )
      : (typeof record.resultTemplate === 'string' && record.resultTemplate.trim()
        ? (actionId === 'createImage'
          ? currentOrCustomTemplate(
              record.resultTemplate,
              defaultCreateImageResultTemplate,
              previousCreateImageResultTemplates,
            )
          : record.resultTemplate)
        : defaultResultTemplate(actionId)),
  };
}

export function promptActionConfigs(value: unknown): PromptActionConfig[] {
  const configs = Array.isArray(value)
    ? value.flatMap((entry) => {
      const normalized = normalizePromptActionConfig(entry);
      return normalized ? [normalized] : [];
    })
    : [];
  return uniquePromptActionConfigs(configs);
}

export function promptActionSaveConfigs(value: unknown): PromptActionStoredConfig[] {
  return promptActionConfigs(value).map((config) => {
    const templateConfig = promptActionTemplateConfig(config);
    const storedConfig = {
      title: templateConfig.title,
      actionId: templateConfig.actionId,
      runAfterReply: templateConfig.runAfterReply,
      instructionTemplate: templateConfig.instructionTemplate,
      afterReplyTemplate: templateConfig.afterReplyTemplate,
      resultTemplate: templateConfig.resultTemplate,
    };
    if (isDefaultPromptActionConfig(templateConfig)) {
      return {
        title: storedConfig.title,
        actionId: storedConfig.actionId,
        preset: 'default',
      };
    }
    return storedConfig;
  });
}

function uniquePromptActionConfigs<T extends PromptActionConfig>(configs: T[]): T[] {
  return Array.from(
    configs
      .reduce((byTitle, config) =>
        byTitle.set(promptActionKey(config.title), config),
      new Map<string, T>())
      .values(),
  );
}

export function promptActionKey(title: string) {
  const key = title.trim().replace(/\s*\(after reply action\)\s*$/i, '').toLocaleLowerCase();
  return legacyPromptActionTitleKeys.get(key) ?? key;
}

const promptActionPattern = /@action(?::([^\n\r]+))?/g;

export function parsePromptActionTokens(text: string): PromptActionToken[] {
  const tokens: PromptActionToken[] = [];
  text.replace(promptActionPattern, (raw, title: string | undefined, index: number) => {
    const trimmedTitle = title?.trim() || defaultPromptActionTitle;
    tokens.push({ raw, title: trimmedTitle, index, hasTitle: !!title?.trim() });
    return raw;
  });
  return tokens;
}

export function countPromptActionUses(values: string[], title: string) {
  const normalizedTitle = promptActionKey(title);
  return values.reduce(
    (count, value) => count + parsePromptActionTokens(value).filter(
      (token) => promptActionKey(token.title) === normalizedTitle,
    ).length,
    0,
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replacePromptActionTitle(
  value: string,
  previousTitle: string,
  nextTitle: string,
  previousHasTitle: boolean,
) {
  if (!previousHasTitle) {
    return value.replace(/@action[^\n\r]*(?=\r?\n|$)/g, `@action:${nextTitle}`);
  }
  return value.replace(
    new RegExp(`@action:\\s*${escapeRegExp(previousTitle)}(?=\\r?\\n|$)`, 'g'),
    `@action:${nextTitle}`,
  );
}

export function replacePromptActionAtIndex(
  value: string,
  index: number,
  nextTitle: string,
) {
  let replaced = false;
  return value.replace(promptActionPattern, (raw, _title: string | undefined, offset: number) => {
    if (replaced || offset !== index) {
      return raw;
    }
    replaced = true;
    return `@action:${nextTitle}`;
  });
}

export function configForPromptActionToken(
  actions: PromptActionConfig[],
  title: string,
) {
  const normalizedTitle = promptActionKey(title);
  return actions.find(
    (action) => promptActionKey(action.title) === normalizedTitle,
  ) ?? defaultPromptActionConfig(
    title,
    normalizedTitle === promptActionKey(updatePhoneImageCaptionActionTitle)
      ? 'updatePhoneImageCaption'
      : normalizedTitle === promptActionKey(describeInputImageActionTitle)
        ? 'describeInputImage'
      : normalizedTitle === promptActionKey(createImageActionTitle)
        ? 'createImage'
      : 'getImageId',
  );
}

export type PromptActionAvailabilityOptions = {
  visionEnabled?: boolean;
  hasImageInput?: boolean;
  comfyProviderIds?: string[];
  providerHealthById?: Record<string, ProviderConnectionHealth>;
  createImageCharacters?: StorybookCreateImageCharacter[];
};

export type PromptActionStatus = {
  available: boolean;
  tone: 'warning' | 'error';
  label: string;
};

function createImageProviderStatus(
  action: Pick<PromptActionConfig, 'actionId' | 'comfyProviderId'>,
  options: PromptActionAvailabilityOptions,
): PromptActionStatus | undefined {
  if (action.actionId !== 'createImage' || options.comfyProviderIds === undefined) {
    return undefined;
  }
  if (options.comfyProviderIds.length === 0) {
    return { available: false, tone: 'error', label: 'No ComfyUI provider' };
  }
  const providerId = action.comfyProviderId?.trim();
  const providerIds = providerId ? [providerId] : options.comfyProviderIds;
  if (!providerIds.every((id) => options.comfyProviderIds?.includes(id))) {
    return { available: false, tone: 'error', label: 'Provider unavailable' };
  }
  if (!options.providerHealthById) {
    return undefined;
  }
  const healthValues = providerIds.map((id) => options.providerHealthById?.[id]);
  if (healthValues.some((health) => health?.status === 'online')) {
    return undefined;
  }
  if (healthValues.some((health) => health?.status === 'checking')) {
    return { available: false, tone: 'warning', label: 'Checking provider' };
  }
  if (healthValues.some((health) => health?.status === 'warning')) {
    return { available: false, tone: 'warning', label: 'ComfyUI setup needed' };
  }
  if (healthValues.some((health) => health?.status === 'offline')) {
    return { available: false, tone: 'error', label: 'ComfyUI offline' };
  }
  return { available: false, tone: 'warning', label: 'Checking provider' };
}

function createImageCharacterStatus(
  action: Pick<PromptActionConfig, 'actionId'>,
  options: PromptActionAvailabilityOptions,
): PromptActionStatus | undefined {
  if (action.actionId !== 'createImage' || options.createImageCharacters === undefined) {
    return undefined;
  }
  if (options.createImageCharacters.length === 0) {
    return { available: false, tone: 'error', label: 'No Storybook characters' };
  }
  return undefined;
}

export function promptActionStatus(
  action: Pick<PromptActionConfig, 'actionId' | 'sendImagesToLlm' | 'comfyProviderId'>,
  options: PromptActionAvailabilityOptions = {},
): PromptActionStatus | undefined {
  const createImageStatus = createImageProviderStatus(action, options);
  if (createImageStatus) {
    return createImageStatus;
  }
  const createImageCharacterSetupStatus = createImageCharacterStatus(action, options);
  if (createImageCharacterSetupStatus) {
    return createImageCharacterSetupStatus;
  }
  const isImageCaptionAction =
    action.actionId === 'updatePhoneImageCaption' || action.actionId === 'describeInputImage';
  if (options.visionEnabled === false && isImageCaptionAction) {
    return { available: false, tone: 'warning', label: 'No vision for images' };
  }
  if (options.hasImageInput === false && isImageCaptionAction) {
    return { available: false, tone: 'warning', label: 'No image input' };
  }
  if (options.visionEnabled === false && action.actionId === 'getImageId' && action.sendImagesToLlm) {
    return { available: true, tone: 'warning', label: 'No vision for images' };
  }
  return undefined;
}

export function promptActionAvailable(
  action: Pick<PromptActionConfig, 'actionId' | 'sendImagesToLlm' | 'comfyProviderId'>,
  options: PromptActionAvailabilityOptions = {},
) {
  return promptActionStatus(action, options)?.available !== false;
}

export function promptActionTokenText(
  config: PromptActionConfig,
  actionResults: Map<string, string>,
  options: PromptActionAvailabilityOptions,
) {
  if (!promptActionAvailable(config, options)) {
    return '';
  }
  const result = actionResults.get(promptActionKey(config.title));
  if (result !== undefined) {
    return result;
  }
  if (config.runAfterReply) {
    return '';
  }
  return promptActionHintText(config.actionId);
}

export function replacePromptActionTokensWithInstructions(
  text: string,
  actions: PromptActionConfig[],
  actionResults = new Map<string, string>(),
  options: PromptActionAvailabilityOptions = {},
) {
  return text.replace(promptActionPattern, (_raw, title: string | undefined) => {
    const trimmedTitle = title?.trim() || defaultPromptActionTitle;
    const config = configForPromptActionToken(actions, trimmedTitle);
    return promptActionTokenText(config, actionResults, options);
  });
}

function createImageAvailableCharactersText(options: PromptActionAvailabilityOptions) {
  const availableCharacters = options.createImageCharacters ?? [];
  if (availableCharacters.length === 0) {
    return '* No Storybook characters are available.';
  }
  return availableCharacters
    .map((character) => [
      `* ${character.name}`,
      `  Character Appearance: ${character.createImage.appearance || 'not configured; use reliable story context'}`,
      `  LoRA: ${character.createImage.hasLora ? 'available' : 'not available'}`,
    ].join('\n'))
    .join('\n');
}

export function promptActionInstructionText(
  config: PromptActionConfig,
  options: PromptActionAvailabilityOptions,
  plan = '',
) {
  const template = config.instructionTemplate;
  const planText = plan.trim() || '(no plan provided)';
  const withPlan = template.includes('{{plan}}')
    ? template.split('{{plan}}').join(planText)
    : `${template.trim()}\n\nFirst-pass plan:\n${planText}`;
  if (config.actionId !== 'createImage') {
    return withPlan;
  }
  const availableCharacters = createImageAvailableCharactersText(options);
  const rendered = withPlan
    .split('{{availableCharacters}}').join(availableCharacters)
    .split('<Available Characters>').join(availableCharacters)
    .split('<availableCharacters>').join(availableCharacters)
    .split('<available characters>').join(availableCharacters);
  return rendered === withPlan
    ? `${withPlan.trim()}\n\nAvailable characters:\n${availableCharacters}`
    : rendered;
}

export function promptActionAfterReplyText(
  config: PromptActionConfig,
  reply: string,
) {
  return config.afterReplyTemplate
    .split('{{reply}}').join(reply)
    .split('{{response}}').join(reply);
}

function parsePromptActionRecord(parsed: unknown): ParsedPromptActionCall | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  if (record.action === 'get_image_id' || record.action === 'getImageId' || record.action === 'getImages') {
    const characters = typeof record.characters === 'string' ? record.characters.trim() : '';
    const tags = typeof record.tags === 'string' ? record.tags.trim() : '';
    // Tags are required for an executable search. Rejecting character-only or
    // plan-only calls prevents an unfiltered image dump when the follow-up
    // model omits the visual search terms.
    if (!tags) {
      return undefined;
    }
    return {
      action: 'getImageId',
      characters,
      tags,
    };
  }
  if (record.action === 'describe_input_image' || record.action === 'describeInputImage') {
    const caption = typeof record.caption === 'string'
      ? record.caption.trim()
      : typeof record.image === 'string'
        ? record.image.trim()
        : '';
    if (!caption) {
      return undefined;
    }
    return {
      action: 'describeInputImage',
      caption,
    };
  }
  if (record.action === 'create_image' || record.action === 'createImage') {
    const phoneOwner = typeof record.phoneOwner === 'string' ? record.phoneOwner.trim() : '';
    const loraCharacterValue = typeof record.loraCharacter === 'string'
      ? record.loraCharacter.trim()
      : record.loraCharacter === 0 || record.loraCharacter === null
        ? ''
        : undefined;
    // The instruction asks for the number 0 when no LoRA is selected; models
    // frequently quote it or write "none" instead, so treat those as no LoRA.
    const loraCharacter = loraCharacterValue !== undefined && /^(0|none)$/i.test(loraCharacterValue)
      ? ''
      : loraCharacterValue;
    const prompt = typeof record.prompt === 'string'
      ? record.prompt.trim()
      : typeof record.description === 'string'
        ? record.description.trim()
        : '';
    if (!phoneOwner || loraCharacter === undefined || !prompt) {
      return undefined;
    }
    return {
      action: 'createImage',
      phoneOwner,
      loraCharacter,
      prompt,
    };
  }
  if (record.action !== 'update_phone_image_caption' && record.action !== 'updatePhoneImageCaption') {
    return undefined;
  }
  const imageAction = compactImageAction(record.imageAction);
  const imageId = typeof record.imageId === 'string'
    ? record.imageId.trim()
    : typeof record.image_id === 'string'
      ? record.image_id.trim()
      : '';
  const caption = typeof record.caption === 'string' ? record.caption.trim() : undefined;
  if (!imageId || !imageAction || ((imageAction === 'create' || imageAction === 'update') && !caption)) {
    return undefined;
  }
  const normalizedImageId = imageAction === 'create' ? 'new_image' : imageId;
  return {
    action: 'updatePhoneImageCaption',
    imageId: normalizedImageId,
    imageAction,
    ...(caption ? { caption } : {}),
  };
}

function jsonObjectRanges(text: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        ranges.push({ start, end: index + 1 });
        start = -1;
      }
      if (depth < 0) {
        depth = 0;
        start = -1;
      }
    }
  }
  return ranges;
}

function parsePromptActionFromJsonSequence(text: string) {
  const ranges = jsonObjectRanges(text);
  if (ranges.length <= 1) {
    return undefined;
  }
  const outside = ranges.reduceRight(
    (current, range) => `${current.slice(0, range.start)}${current.slice(range.end)}`,
    text,
  );
  if (outside.trim()) {
    return undefined;
  }
  for (const range of ranges) {
    try {
      const action = parsePromptActionRecord(JSON.parse(text.slice(range.start, range.end)) as unknown);
      if (action) {
        return action;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function unwrapJsonCodeFence(text: string) {
  const trimmedText = text.trim();
  const fencedJson = trimmedText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedJson ? fencedJson[1]?.trim() ?? trimmedText : trimmedText;
}

export function knownPromptActionId(actionName: string): PromptActionId | undefined {
  switch (actionName) {
    case 'get_image_id':
    case 'getImageId':
    case 'getImages':
      return 'getImageId';
    case 'describe_input_image':
    case 'describeInputImage':
      return 'describeInputImage';
    case 'update_phone_image_caption':
    case 'updatePhoneImageCaption':
      return 'updatePhoneImageCaption';
    case 'create_image':
    case 'createImage':
      return 'createImage';
    default:
      return undefined;
  }
}

function parsePromptActionRequestRecord(parsed: unknown): ParsedPromptActionRequest | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const actionName = typeof record.action === 'string' ? record.action : '';
  const action = knownPromptActionId(actionName);
  const plan = typeof record.plan === 'string' ? record.plan.trim() : '';
  if ((action !== 'getImageId' && action !== 'createImage') || !plan) {
    return undefined;
  }
  return { action, plan };
}

export function parsePromptActionRequest(text: string): ParsedPromptActionRequest | undefined {
  const parseText = unwrapJsonCodeFence(text);
  try {
    const request = parsePromptActionRequestRecord(JSON.parse(parseText) as unknown);
    if (request) {
      return request;
    }
  } catch {
    // Fall through to the embedded-object scan below.
  }
  const ranges = jsonObjectRanges(parseText);
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    try {
      const request = parsePromptActionRequestRecord(
        JSON.parse(parseText.slice(range.start, range.end)) as unknown,
      );
      if (request) {
        return request;
      }
    } catch {
      // Not a usable request object; try the previous range.
    }
  }
  return undefined;
}

export function parsePromptActionCall(text: string): ParsedPromptActionCall | undefined {
  const parseText = unwrapJsonCodeFence(text);
  try {
    const action = parsePromptActionRecord(JSON.parse(parseText) as unknown);
    if (action) {
      return action;
    }
  } catch {
    // Fall through to the multi-object parser below.
  }
  return parsePromptActionFromJsonSequence(parseText) ?? parseEmbeddedPromptActionCall(parseText);
}

// Reasoning-capable models (e.g. Claude Opus) may prepend a sentence of narration
// before the action JSON ("Let me first check if there's a stored image ...").
// That preamble makes both the whole-text JSON.parse above and
// parsePromptActionFromJsonSequence (which requires no surrounding text) fail, so
// the action call would otherwise leak into the visible reply. As a tolerant
// fallback, scan every balanced JSON object in the reply and accept the last one
// that validates to a KNOWN action. parsePromptActionRecord only accepts objects
// with a recognised `action` key and required fields, so narrative prose that
// merely contains braces is never mistaken for an action call.
function parseEmbeddedPromptActionCall(text: string): ParsedPromptActionCall | undefined {
  const ranges = jsonObjectRanges(text);
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    try {
      const action = parsePromptActionRecord(JSON.parse(text.slice(range.start, range.end)) as unknown);
      if (action) {
        return action;
      }
    } catch {
      // Not a usable JSON object; try the next range.
    }
  }
  return undefined;
}

function compactImageAction(value: unknown) {
  const compacted = typeof value === 'string'
    ? value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
    : '';
  return compacted === 'create'
    ? 'create'
    : compacted === 'update'
      ? 'update'
      : compacted === 'nochange'
        ? 'no_change'
        : undefined;
}

function normalizedSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCommaList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitSearchWords(value: string) {
  return normalizedSearchText(value)
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function namesMatch(characterName: string, requestedName: string) {
  const character = normalizedSearchText(characterName);
  const requested = normalizedSearchText(requestedName);
  if (!character || !requested) {
    return false;
  }
  if (character === requested) {
    return true;
  }
  const characterParts = character.split(' ');
  const requestedParts = requested.split(' ');
  return requestedParts.length === 1 && characterParts[0] === requestedParts[0];
}

function searchWords(tags: string[]) {
  return Array.from(new Set(tags.flatMap(splitSearchWords)));
}

function tagScore(caption: string, words: string[]) {
  if (words.length === 0) {
    return 0;
  }
  const normalizedCaption = normalizedSearchText(caption);
  const captionWords = new Set(splitSearchWords(caption));
  return words.reduce(
    (score, word) => score + (captionWords.has(word) || normalizedCaption.includes(word) ? 1 : 0),
    0,
  );
}

function addImageRecipient(
  recipientsByImageId: Map<string, Map<string, string>>,
  imageId: string,
  recipientName: string,
) {
  const normalizedImageId = imageId.trim();
  const normalizedRecipientName = recipientName.trim();
  if (!normalizedImageId || !normalizedRecipientName) {
    return;
  }
  const recipients = recipientsByImageId.get(normalizedImageId) ?? new Map<string, string>();
  const recipientKey = normalizedSearchText(normalizedRecipientName);
  if (recipientKey && !recipients.has(recipientKey)) {
    recipients.set(recipientKey, normalizedRecipientName);
  }
  recipientsByImageId.set(normalizedImageId, recipients);
}

function imageRecipientsById(
  imageLists: ReturnType<typeof storybookImageListsFromNodes>,
  historyMessages: MessageRecord[],
) {
  const recipientsByImageId = new Map<string, Map<string, string>>();
  imageLists.forEach((imageList) => {
    imageList.images.forEach((image) => {
      if (image.receivedFrom) {
        addImageRecipient(recipientsByImageId, image.id, imageList.name);
      }
    });
  });
  historyMessages.forEach((message) => {
    const recipientName = message.phoneTo?.trim();
    if (!recipientName || (message.channel !== 'phone' && !message.phoneMessage)) {
      return;
    }
    const imageIds = [
      ...(message.phoneImageIds ?? []),
      ...(message.imageAttachments?.map((image) => image.id) ?? []),
    ];
    imageIds.forEach((imageId) => addImageRecipient(recipientsByImageId, imageId, recipientName));
  });
  return new Map(
    [...recipientsByImageId].map(([imageId, recipients]) => [
      imageId,
      [...recipients.values()].sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

function findGetImagesResults(
  nodes: WorkflowNode[],
  historyMessages: MessageRecord[],
  call: ParsedPromptActionCall,
  maxReturnedImages: number,
): ActionImageResult[] {
  const requestedCharacters = splitCommaList(call.characters ?? '');
  const requestedTags = splitCommaList(call.tags ?? '');
  const words = searchWords(requestedTags);
  const imageLists = storybookImageListsFromNodes(nodes);
  const recipientsByImageId = imageRecipientsById(imageLists, historyMessages);
  const lists = imageLists.filter((imageList) =>
    requestedCharacters.length === 0 ||
    requestedCharacters.some((characterName) => namesMatch(imageList.name, characterName)),
  );
  return lists
    .flatMap((imageList) =>
      imageList.images.map((image) => ({
        imageId: image.id,
        caption: image.description,
        characterName: imageList.name,
        shownTo: recipientsByImageId.get(image.id) ?? [],
        score: tagScore(image.description, words),
        attachment: {
          id: image.id,
          name: image.name,
          mimeType: image.mimeType,
          size: image.size,
          dataUrl: image.dataUrl,
          width: image.width,
          height: image.height,
          description: image.description,
          receivedFrom: image.receivedFrom,
          imageAccess: image.imageAccess,
        },
      })),
    )
    .filter((result) => words.length === 0 || result.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.characterName.localeCompare(right.characterName) ||
      left.imageId.localeCompare(right.imageId),
    )
    .slice(0, maxReturnedImages);
}

const imageTemplateTokenPattern =
  /\{\{(imageReference|imageReferences|imageId|imageIdTag|imageId_tag|imageTag|imageTags|caption|imageText|imageShownTo)\}\}/g;
const imageTemplateLinePattern =
  /\{\{(?:imageReference|imageReferences|imageId|imageIdTag|imageId_tag|imageTag|imageTags|caption|imageText|imageShownTo)\}\}/;

function noMatchingImagesLine() {
  return '* No matching stored Storybook character images were found for the requested characters and tags.';
}

function imageReferenceLabel(index: number, includeImageOrderLabels: boolean) {
  return includeImageOrderLabels ? `Image ${index + 1}` : 'imageId';
}

function imageTextValue(result: ActionImageResult, hideImageText: boolean) {
  const imageText = result.caption.trim();
  return !hideImageText ? imageText : '';
}

function imageShownToValue(result: ActionImageResult) {
  return result.shownTo.length ? result.shownTo.join(', ') : 'No one yet';
}

function formatImageLine(result: ActionImageResult, index: number, includeImageOrderLabels: boolean, hideImageText: boolean) {
  const imageReference = imageReferenceLabel(index, includeImageOrderLabels);
  const imageText = imageTextValue(result, hideImageText);
  return `* ${imageReference}: ${result.imageId}${imageText ? ` : ${imageText}` : ''} : Image shown to: ${imageShownToValue(result)}`;
}

function imageTemplateValue(
  tokenName: string,
  result: ActionImageResult,
  index: number,
  includeImageOrderLabels: boolean,
  hideImageText: boolean,
) {
  switch (tokenName) {
    case 'imageReference':
    case 'imageReferences':
      return imageReferenceLabel(index, includeImageOrderLabels);
    case 'imageId':
      return result.imageId;
    case 'imageText':
      return imageTextValue(result, hideImageText);
    case 'imageShownTo':
      return imageShownToValue(result);
    case 'imageIdTag':
    case 'imageId_tag':
    case 'imageTag':
    case 'imageTags':
    case 'caption':
      return hideImageText ? '' : result.caption.trim();
    default:
      return '';
  }
}

function renderImageTemplateLine(
  line: string,
  result: ActionImageResult,
  index: number,
  includeImageOrderLabels: boolean,
  hideImageText: boolean,
) {
  const preparedLine = hideImageText
    ? line.replace(/[ \t]*:[ \t]*\{\{(?:imageText|imageIdTag|imageId_tag|imageTag|imageTags|caption)\}\}/g, '')
    : line;
  const rendered = preparedLine.replace(imageTemplateTokenPattern, (_match, tokenName: string) =>
    imageTemplateValue(tokenName, result, index, includeImageOrderLabels, hideImageText),
  );
  return rendered.replace(/[ \t:=-]+$/g, '').trimEnd();
}

function expandImageTemplateRows(
  template: string,
  results: ActionImageResult[],
  includeImageOrderLabels: boolean,
  hideImageText: boolean,
) {
  const lines = template.split(/\r?\n/);
  return lines
    .flatMap((line) => {
      if (!imageTemplateLinePattern.test(line)) {
        return [line];
      }
      if (results.length === 0) {
        return [noMatchingImagesLine()];
      }
      return results.map((result, index) =>
        renderImageTemplateLine(line, result, index, includeImageOrderLabels, hideImageText),
      );
    })
    .join('\n');
}

function formatImages(results: ActionImageResult[], includeImageOrderLabels: boolean, hideImageText: boolean) {
  if (results.length === 0) {
    return noMatchingImagesLine();
  }
  return results
    .map((result, index) => formatImageLine(result, index, includeImageOrderLabels, hideImageText))
    .join('\n');
}

function getImagesResultTemplateText(
  config: PromptActionConfig,
  call: ParsedPromptActionCall,
  results: ActionImageResult[],
  hideImageText: boolean,
) {
  const template = expandImageTemplateRows(config.resultTemplate, results, config.sendImagesToLlm, hideImageText);
  return template
    .split('{{actionId}}').join(config.actionId)
    .split('{{characters}}').join(call.characters ?? '')
    .split('{{tags}}').join(call.tags ?? '')
    .split('{{images}}').join(formatImages(results, config.sendImagesToLlm, hideImageText))
    .trim();
}

function imageCaptionActionJson(call: ParsedPromptActionCall) {
  return JSON.stringify(
    {
      imageId: call.imageId,
      imageAction: call.imageAction,
      ...(call.caption ? { caption: call.caption } : {}),
    },
    null,
    2,
  );
}

function phoneImageCaptionCallForContext(
  context: ExecuteContext,
  call: ParsedPromptActionCall,
): ParsedPromptActionCall {
  if (call.imageAction !== 'create') {
    return call;
  }
  const incomingImage = context.inputImages[0];
  const existingImageId = incomingImage?.id.trim();
  const existingCaption = incomingImage?.description?.trim();
  if (!existingImageId || !existingCaption) {
    return call;
  }
  return {
    ...call,
    imageId: existingImageId,
    imageAction: 'no_change',
    caption: undefined,
  };
}

function createImageResultTemplateText(
  config: PromptActionConfig,
  call: ParsedPromptActionCall,
  result: {
    phoneOwner: string;
    loraCharacter: string;
    imageId: string;
    imagePrompt: string;
  },
) {
  return config.resultTemplate
    .split('{{actionId}}').join(config.actionId)
    .split('{{phoneOwner}}').join(result.phoneOwner)
    .split('{{loraCharacter}}').join(result.loraCharacter)
    .split('{{subjectCharacter}}').join(result.loraCharacter)
    .split('{{character}}').join(result.loraCharacter)
    .split('{{characters}}').join(result.loraCharacter)
    .split('{{imageId}}').join(result.imageId)
    .split('{{imagePrompt}}').join(result.imagePrompt)
    .split('{{description}}').join(result.imagePrompt)
    .split('{{prompt}}').join(call.prompt ?? '')
    .trim();
}

export async function executePromptAction(
  context: ExecuteContext,
  config: PromptActionConfig,
  call: ParsedPromptActionCall,
  options: PromptActionAvailabilityOptions & { llmConnectionId?: string } = {},
) {
  if (!promptActionAvailable(config, options)) {
    return { text: '', images: [] };
  }
  if (call.action === 'describeInputImage') {
    const imageJson = JSON.stringify({ image: call.caption ?? '' }, null, 2);
    return {
      text: config.resultTemplate
        .split('{{actionId}}').join(config.actionId)
        .split('{{imageJson}}').join(imageJson)
        .split('{{caption}}').join(call.caption ?? '')
        .trim(),
      images: [],
      finalOutputText: imageJson,
    };
  }
  if (call.action === 'updatePhoneImageCaption') {
    const effectiveCall = phoneImageCaptionCallForContext(context, call);
    const imageActionJson = imageCaptionActionJson(effectiveCall);
    return {
      text: config.resultTemplate
        .split('{{actionId}}').join(config.actionId)
        .split('{{imageActionJson}}').join(imageActionJson)
        .split('{{imageId}}').join(effectiveCall.imageId ?? '')
        .split('{{imageAction}}').join(effectiveCall.imageAction ?? '')
        .split('{{caption}}').join(effectiveCall.caption ?? '')
        .trim(),
      images: [],
      finalOutputText: imageActionJson,
    };
  }
  if (call.action !== 'getImageId') {
    if (call.action !== 'createImage') {
      return { text: '', images: [] };
    }
    const generatedImages = await createComfyImageForCharacter(context, {
      phoneOwnerName: call.phoneOwner ?? '',
      loraCharacterName: call.loraCharacter || undefined,
      prompt: call.prompt ?? '',
      llmConnectionId: options.llmConnectionId,
      comfyProviderId: config.comfyProviderId,
      manageModelMemory: config.manageModelMemoryForComfy,
    });
    const generatedImage = generatedImages.images[0];
    const imageId = generatedImage?.id ?? generatedImages.imageIds[0] ?? '';
    return {
      text: createImageResultTemplateText(config, call, {
        phoneOwner: generatedImages.phoneOwnerName,
        loraCharacter: generatedImages.loraCharacterName ?? 'none',
        imageId,
        imagePrompt: call.prompt ?? '',
      }),
      images: options.visionEnabled !== false && generatedImage ? [generatedImage] : [],
    };
  }
  const results = findGetImagesResults(context.nodes, context.historyMessages, call, config.maxReturnedImages);
  const sendImagesToLlm = options.visionEnabled !== false && config.sendImagesToLlm;
  const resultConfig = sendImagesToLlm === config.sendImagesToLlm
    ? config
    : {
        ...config,
        sendImagesToLlm: false,
        hideImageTextWhenSendingToLlm: false,
      };
  const hideImageText = sendImagesToLlm && config.hideImageTextWhenSendingToLlm;
  const text = getImagesResultTemplateText(resultConfig, call, results, hideImageText);
  return {
    text,
    images: sendImagesToLlm ? results.map((result) => result.attachment) : [],
  };
}

export function isPromptActionConfig(value: unknown): value is PromptActionConfig {
  return !!normalizePromptActionConfig(value);
}
