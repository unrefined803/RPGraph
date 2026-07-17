import type { MessageRecord, RpAppointment, TurnRecord } from '../../types';
import type { TurnCheckpoint } from '../../data-management/types';
import {
  normalizeChatGpdChatsByCharacter,
  normalizePhoneNotesByCharacter,
  type ChatGpdChatsByCharacter,
  type PhoneNotesByCharacter,
} from '../../chat/phoneAppsSessions';

export type RpStorybookCharacterImage = {
  id: string;
  name: string;
  mimeType: 'image/jpeg';
  size: number;
  dataUrl: string;
  width?: number;
  height?: number;
  description: string;
  receivedFrom?: string;
  imageAccess?: true;
};

export type RpStorybookCharacterImageOwner = {
  images: RpStorybookCharacterImage[];
};

export type RpStorybookCharacterProfileImage = {
  imageId: string;
  dataUrl: string;
  crop: {
    x: number;
    y: number;
    size: number;
  };
};

export type RpStorybookCharacterComfyConfig = {
  loraName: string;
  loraUrl?: string;
  appearance: string;
};

export type RpStorybookCharacterVoiceConfig = {
  sampleName: string;
  sampleMimeType: string;
  sampleDataUrl: string;
};

export type RpStorybookCharacterPhoneSettings = {
  wallpaperId: string;
};

export type RpStorybookBankingFixedExpense = {
  label: string;
  amount: number;
};

export type RpStorybookCharacterBanking = {
  startBalance: number;
  fixedExpenses: RpStorybookBankingFixedExpense[];
};

export type RpStorybookCharacterSocial = {
  /** Fotogram account username; every character is expected to have one. */
  fotogramUsername: string;
  /** OnlyFriends account username; empty string means no account (accounts are private). */
  onlyfriendsUsername: string;
};

export type RpStorybookV1Character = {
  id: string;
  name: string;
  description: string;
  personality: string;
  speechStyle: string;
  role: string;
  comfyConfig?: RpStorybookCharacterComfyConfig;
  voiceConfig?: RpStorybookCharacterVoiceConfig;
  profileImage?: RpStorybookCharacterProfileImage;
  phoneSettings?: RpStorybookCharacterPhoneSettings;
  banking?: RpStorybookCharacterBanking;
  social?: RpStorybookCharacterSocial;
} & RpStorybookCharacterImageOwner;

export type RpStorybookPhoneContactBlock = {
  owner: string;
  contact: string;
};

export type RpStorybookImageDescriptionPromptSettings = {
  mode: 'default' | 'custom';
  customText?: string;
};

export const currentRpStorybookVersion = '2.0.0' as const;

const rpStorybookVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type RpStorybookVersionStatus = 'current' | 'legacy' | 'newer' | 'invalid';

function parsedRpStorybookVersion(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = rpStorybookVersionPattern.exec(value);
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Older format versions load through the tolerant normalizer ("legacy"),
 * newer versions than this build are rejected ("newer").
 */
export function rpFormatVersionStatus(
  value: unknown,
  currentVersion: string,
): RpStorybookVersionStatus {
  const version = parsedRpStorybookVersion(value);
  const current = parsedRpStorybookVersion(currentVersion);
  if (!version || !current) {
    return 'invalid';
  }
  if (value === currentVersion) {
    return 'current';
  }
  const difference =
    version.major - current.major || version.minor - current.minor || version.patch - current.patch;
  return difference > 0 ? 'newer' : 'legacy';
}

export function rpStorybookVersionStatus(value: unknown): RpStorybookVersionStatus {
  return rpFormatVersionStatus(value, currentRpStorybookVersion);
}

export type RpStorybookV1 = {
  format: 'rpgraph-storybook';
  version: typeof currentRpStorybookVersion;
  title: string;
  introduction: string;
  imageDescriptionPrompt: RpStorybookImageDescriptionPromptSettings;
  scenario: {
    summary: string;
    openingSituation: string;
    currentSituation: string;
  };
  characters: RpStorybookV1Character[];
  phoneContacts: {
    blocked: RpStorybookPhoneContactBlock[];
  };
  openingHistory: {
    summary: string;
    turns: TurnRecord[];
    checkpoints: TurnCheckpoint[];
    events: RpAppointment[];
    /** Liked post ids per "characterId/app" account key, imported with the session. */
    socialLikes: Record<string, string[]>;
    /** Notes-app cards per character id, imported with the session. */
    notes: PhoneNotesByCharacter;
    /** ChatGPD chats per character id, imported with the session. */
    chatGpdChats: ChatGpdChatsByCharacter;
  };
};

export type RpStorybookAssistantResult = {
  reply: string;
  changedFields: string[];
  patchPaths: string[];
  storybook: RpStorybookV1;
};

type JsonPatchOperation = {
  op?: unknown;
  path?: unknown;
  from?: unknown;
  value?: unknown;
};

export type RpStorybookFormattedTextSettings = {
  title: boolean;
  introduction: boolean;
  scenario: boolean;
  characters: boolean;
  openingHistory: boolean;
  characterImages: boolean;
};

export const defaultRpStorybookFormattedTextSettings: RpStorybookFormattedTextSettings = {
  title: true,
  introduction: true,
  scenario: true,
  characters: true,
  openingHistory: true,
  characterImages: false,
};

export function rpStorybookFormattedTextSettings(
  value: Partial<RpStorybookFormattedTextSettings> | undefined,
): RpStorybookFormattedTextSettings {
  return {
    title: value?.title ?? defaultRpStorybookFormattedTextSettings.title,
    introduction: value?.introduction ?? defaultRpStorybookFormattedTextSettings.introduction,
    scenario: value?.scenario ?? defaultRpStorybookFormattedTextSettings.scenario,
    characters: value?.characters ?? defaultRpStorybookFormattedTextSettings.characters,
    openingHistory: value?.openingHistory ?? defaultRpStorybookFormattedTextSettings.openingHistory,
    characterImages: value?.characterImages ?? defaultRpStorybookFormattedTextSettings.characterImages,
  };
}

export const defaultRpStorybookImageDescriptionPrompt = [
  'Describe this image for an RPGraph character image library.',
  'Assume the visible character is the character from the provided context.',
  'Return only one concise description in 20 to 30 words.',
  'Focus on visible pose, expression, clothing, action, setting, and mood.',
  'If the image shows nudity, exposed genitals, breasts, nipples, ass, sexual body parts, revealing or tight clothing, partial/complete undress, or an erotic/sexual atmosphere, describe those visible details clearly and directly.',
  'Otherwise, write a natural scene description using only the visible non-sexual details.',
  'Do not mention file names, image generation, metadata, or uncertainty about identity.',
  'Write the description so a later LLM can choose this image for a matching RP scene.',
].join('\n');

export function defaultRpStorybookImageDescriptionPromptSettings(): RpStorybookImageDescriptionPromptSettings {
  return { mode: 'default' };
}

export function rpStorybookImageDescriptionPromptSettings(
  value: unknown,
): RpStorybookImageDescriptionPromptSettings {
  const settings = recordValue(value);
  return settings.mode === 'custom'
    ? { mode: 'custom', customText: typeof settings.customText === 'string' ? settings.customText : '' }
    : defaultRpStorybookImageDescriptionPromptSettings();
}

export function rpStorybookImageDescriptionPromptSaveSettings(
  value: unknown,
): RpStorybookImageDescriptionPromptSettings {
  const settings = rpStorybookImageDescriptionPromptSettings(value);
  return settings.mode === 'custom' && settings.customText === defaultRpStorybookImageDescriptionPrompt
    ? defaultRpStorybookImageDescriptionPromptSettings()
    : settings;
}

export function rpStorybookImageDescriptionPromptText(value: unknown) {
  const settings = rpStorybookImageDescriptionPromptSettings(value);
  return settings.mode === 'custom'
    ? settings.customText?.trim() || defaultRpStorybookImageDescriptionPrompt
    : defaultRpStorybookImageDescriptionPrompt;
}

export const emptyRpStorybookV1: RpStorybookV1 = {
  format: 'rpgraph-storybook',
  version: currentRpStorybookVersion,
  title: '',
  introduction: '',
  imageDescriptionPrompt: defaultRpStorybookImageDescriptionPromptSettings(),
  scenario: {
    summary: '',
    openingSituation: '',
    currentSituation: '',
  },
  characters: [],
  phoneContacts: {
    blocked: [],
  },
  openingHistory: {
    summary: '',
    turns: [],
    checkpoints: [],
    events: [],
    socialLikes: {},
    notes: {},
    chatGpdChats: {},
  },
};

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

function slugStorybookImageIdPart(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function storybookCharacterImageOwnerIdBase(name: string, sourceId: string) {
  const namePart = slugStorybookImageIdPart(name);
  const sourcePart = slugStorybookImageIdPart(sourceId);
  return [namePart || sourcePart || 'character', sourcePart]
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join('_');
}

export function formatStorybookCharacterImageId(ownerBase: string, number: number) {
  return `${ownerBase || 'character'}_image_${String(Math.max(1, number)).padStart(2, '0')}`;
}

function storybookCharacterImageIdPattern(ownerBase: string) {
  return new RegExp(`^${ownerBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_image_(\\d+)$`);
}

export function nextStorybookCharacterImageId(
  ownerBase: string,
  ownerImages: Array<Pick<RpStorybookCharacterImage, 'id'>>,
  reservedIds = new Set<string>(),
) {
  const pattern = storybookCharacterImageIdPattern(ownerBase);
  const existingNumbers = ownerImages
    .map((image) => pattern.exec(image.id)?.[1])
    .filter((value): value is string => !!value)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
  let nextNumber = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;
  let nextId = formatStorybookCharacterImageId(ownerBase, nextNumber);
  while (reservedIds.has(nextId)) {
    nextNumber += 1;
    nextId = formatStorybookCharacterImageId(ownerBase, nextNumber);
  }
  return nextId;
}

function normalizedStorybookCharacterImageId(
  value: unknown,
  ownerBase: string,
  ownerImages: Array<Pick<RpStorybookCharacterImage, 'id'>>,
  usedIds: Set<string>,
  allowExternalId = false,
) {
  const id = stringValue(value);
  const pattern = storybookCharacterImageIdPattern(ownerBase);
  if (
    allowExternalId &&
    /^[a-z0-9][a-z0-9_]*_image_\d+$/i.test(id) &&
    !ownerImages.some((image) => image.id === id)
  ) {
    return id;
  }
  if (pattern.test(id) && !usedIds.has(id) && !ownerImages.some((image) => image.id === id)) {
    return id;
  }
  return nextStorybookCharacterImageId(ownerBase, ownerImages, usedIds);
}

function normalizeCharacterImages(value: unknown, ownerBase: string, usedIds: Set<string>): RpStorybookCharacterImage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: RpStorybookCharacterImage[] = [];
  value.forEach((entry) => {
    const image = recordValue(entry);
    const dataUrl = stringValue(image.dataUrl);
    const mimeType = stringValue(image.mimeType);
    if (!dataUrl.startsWith('data:image/jpeg;base64,') || mimeType !== 'image/jpeg') {
      return;
    }
    const receivedFrom = stringValue(image.receivedFrom);
    const imageAccess = image.imageAccess === true;
    const externalImage = !!receivedFrom || imageAccess;
    const id = normalizedStorybookCharacterImageId(image.id, ownerBase, normalized, usedIds, externalImage);
    if (!externalImage) {
      usedIds.add(id);
    }
    normalized.push({
      id,
      name: stringValue(image.name) || id,
      mimeType: 'image/jpeg' as const,
      size: numberValue(image.size) ?? dataUrl.length,
      dataUrl,
      ...(numberValue(image.width) ? { width: numberValue(image.width) } : {}),
      ...(numberValue(image.height) ? { height: numberValue(image.height) } : {}),
      description: stringValue(image.description),
      ...(receivedFrom ? { receivedFrom } : {}),
      ...(imageAccess ? { imageAccess: true } : {}),
    });
  });
  return normalized;
}

function percentValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : undefined;
}

function normalizeCharacterProfileImage(
  value: unknown,
  images: RpStorybookCharacterImage[],
): RpStorybookCharacterProfileImage | undefined {
  const profileImage = recordValue(value);
  const imageId = stringValue(profileImage.imageId);
  const image = images.find((entry) => entry.id === imageId);
  const dataUrl = stringValue(profileImage.dataUrl);
  if (!image || !dataUrl.startsWith('data:image/jpeg;base64,')) {
    return undefined;
  }
  const crop = recordValue(profileImage.crop);
  const size = percentValue(crop.size);
  if (size === undefined || size <= 0) {
    return undefined;
  }
  return {
    imageId,
    dataUrl,
    crop: {
      x: percentValue(crop.x) ?? 0,
      y: percentValue(crop.y) ?? 0,
      size,
    },
  };
}

export function defaultRpStorybookCharacterComfyConfig(): RpStorybookCharacterComfyConfig {
  return {
    loraName: '',
    loraUrl: '',
    appearance: '',
  };
}

export function rpStorybookCharacterComfyConfig(value: unknown): RpStorybookCharacterComfyConfig {
  const config = recordValue(value);
  return {
    loraName: stringValue(config.loraName),
    loraUrl: stringValue(config.loraUrl),
    appearance: stringValue(config.appearance),
  };
}

export function defaultRpStorybookCharacterVoiceConfig(): RpStorybookCharacterVoiceConfig {
  return {
    sampleName: '',
    sampleMimeType: '',
    sampleDataUrl: '',
  };
}

export function defaultRpStorybookCharacterPhoneSettings(): RpStorybookCharacterPhoneSettings {
  return { wallpaperId: 'wallpaper-1' };
}

export const defaultRpStorybookCharacterStartBalance = 1000;

export function defaultRpStorybookCharacterBanking(): RpStorybookCharacterBanking {
  return { startBalance: defaultRpStorybookCharacterStartBalance, fixedExpenses: [] };
}

function centsAmount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value * 100) / 100
    : undefined;
}

export function rpStorybookCharacterBanking(value: unknown): RpStorybookCharacterBanking {
  const banking = recordValue(value);
  const startBalance = banking.startBalance;
  const fixedExpenses = Array.isArray(banking.fixedExpenses) ? banking.fixedExpenses : [];
  return {
    startBalance: typeof startBalance === 'number' && Number.isFinite(startBalance) && startBalance >= 0
      ? Math.round(startBalance * 100) / 100
      : defaultRpStorybookCharacterStartBalance,
    fixedExpenses: fixedExpenses.flatMap((entry) => {
      const expense = recordValue(entry);
      const label = stringValue(expense.label);
      const amount = centsAmount(expense.amount);
      return label && amount !== undefined ? [{ label, amount }] : [];
    }),
  };
}

export function defaultRpStorybookCharacterSocial(): RpStorybookCharacterSocial {
  return { fotogramUsername: '', onlyfriendsUsername: '' };
}

export function rpStorybookCharacterSocial(value: unknown): RpStorybookCharacterSocial {
  const social = recordValue(value);
  return {
    fotogramUsername: stringValue(social.fotogramUsername).trim(),
    onlyfriendsUsername: stringValue(social.onlyfriendsUsername).trim(),
  };
}

export function rpStorybookCharacterPhoneSettings(
  value: unknown,
): RpStorybookCharacterPhoneSettings {
  const settings = recordValue(value);
  return {
    wallpaperId: stringValue(settings.wallpaperId) || defaultRpStorybookCharacterPhoneSettings().wallpaperId,
  };
}

export function rpStorybookCharacterVoiceConfig(value: unknown): RpStorybookCharacterVoiceConfig {
  const config = recordValue(value);
  const sampleDataUrl = stringValue(config.sampleDataUrl);
  if (!sampleDataUrl.startsWith('data:audio/')) {
    return defaultRpStorybookCharacterVoiceConfig();
  }
  return {
    sampleName: stringValue(config.sampleName),
    sampleMimeType: stringValue(config.sampleMimeType) || 'audio/mpeg',
    sampleDataUrl,
  };
}

function normalizeCharacter(value: unknown, index: number, usedImageIds: Set<string>): RpStorybookV1Character {
  const character = recordValue(value);
  const name = stringValue(character.name);
  const id = stringValue(character.id) ||
    (name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : `character-${index + 1}`);
  const imageOwnerBase = storybookCharacterImageOwnerIdBase(name, id);
  const images = normalizeCharacterImages(character.images, imageOwnerBase, usedImageIds);
  const profileImage = normalizeCharacterProfileImage(character.profileImage, images);
  return {
    id,
    name,
    description: stringValue(character.description),
    personality: stringValue(character.personality),
    speechStyle: stringValue(character.speechStyle),
    role: stringValue(character.role),
    comfyConfig: rpStorybookCharacterComfyConfig(character.comfyConfig),
    voiceConfig: rpStorybookCharacterVoiceConfig(character.voiceConfig),
    phoneSettings: rpStorybookCharacterPhoneSettings(character.phoneSettings),
    banking: rpStorybookCharacterBanking(character.banking),
    social: rpStorybookCharacterSocial(character.social),
    ...(profileImage ? { profileImage } : {}),
    images,
  };
}

/**
 * Normalizes one character from an external source (e.g. a character card
 * import); image ids are re-namespaced against `usedImageIds` on collision.
 */
export function normalizeRpStorybookCharacter(
  value: unknown,
  index: number,
  usedImageIds: Set<string>,
): RpStorybookV1Character {
  return normalizeCharacter(value, index, usedImageIds);
}

function phoneContactRef(value: string) {
  return value.trim();
}

function phoneContactPairRefs(leftRef: string, rightRef: string) {
  return [leftRef, rightRef].sort();
}

function phoneContactPairKey(leftRef: string, rightRef: string) {
  return phoneContactPairRefs(leftRef, rightRef).join('\u0000');
}

function phoneContactPairBlock(leftRef: string, rightRef: string): RpStorybookPhoneContactBlock {
  const [owner, contact] = phoneContactPairRefs(leftRef, rightRef);
  return { owner, contact };
}

function normalizePhoneContacts(value: unknown, validRefs: Set<string>): RpStorybookV1['phoneContacts'] {
  const phoneContacts = recordValue(value);
  const blocked = Array.isArray(phoneContacts.blocked) ? phoneContacts.blocked : [];
  const normalized = blocked.flatMap((entry) => {
    const block = recordValue(entry);
    const owner = phoneContactRef(stringValue(block.owner));
    const contact = phoneContactRef(stringValue(block.contact));
    return owner && contact && owner !== contact && validRefs.has(owner) && validRefs.has(contact)
      ? [phoneContactPairBlock(owner, contact)]
      : [];
  });
  return {
    blocked: Array.from(
      normalized.reduce((blocks, block) => {
        blocks.set(phoneContactPairKey(block.owner, block.contact), block);
        return blocks;
      }, new Map<string, RpStorybookPhoneContactBlock>()).values(),
    ),
  };
}

function normalizeOpeningHistoryMessage(value: unknown, index: number): MessageRecord | undefined {
  const message = recordValue(value);
  const role = message.role;
  const originalText = typeof message.originalText === 'string' ? message.originalText : undefined;
  if ((role !== 'user' && role !== 'output' && role !== 'error') || originalText === undefined) {
    return undefined;
  }
  const id = typeof message.id === 'number' && Number.isSafeInteger(message.id) && message.id > 0
    ? message.id
    : index + 1;
  return {
    ...(structuredClone(message) as Omit<MessageRecord, 'id' | 'role' | 'originalText'>),
    id,
    role,
    originalText,
  };
}

function normalizeOpeningHistorySocialLikes(value: unknown): Record<string, string[]> {
  const likes = recordValue(value);
  return Object.fromEntries(
    Object.entries(likes).flatMap(([accountKey, postIds]) => {
      if (!accountKey.trim() || !Array.isArray(postIds)) {
        return [];
      }
      const normalizedPostIds = postIds.filter(
        (postId): postId is string => typeof postId === 'string' && !!postId.trim(),
      );
      return normalizedPostIds.length ? [[accountKey, normalizedPostIds]] : [];
    }),
  );
}

function normalizeOpeningHistoryTurn(value: unknown, index: number): TurnRecord | undefined {
  const turn = recordValue(value);
  const input = recordValue(turn.input);
  const output = recordValue(turn.output);
  const inputMessages = Array.isArray(input.messages)
    ? input.messages
        .map(normalizeOpeningHistoryMessage)
        .filter((message): message is MessageRecord => !!message)
    : [];
  const outputMessages = Array.isArray(output.messages)
    ? output.messages
        .map(normalizeOpeningHistoryMessage)
        .filter((message): message is MessageRecord => !!message)
    : [];
  const number = typeof turn.number === 'number' && Number.isFinite(turn.number)
    ? Math.max(1, Math.round(turn.number))
    : index + 1;
  if (inputMessages.length === 0 && outputMessages.length === 0) {
    return undefined;
  }
  return {
    ...(structuredClone(turn) as Omit<TurnRecord, 'id' | 'number' | 'createdAt' | 'input' | 'output'>),
    id: stringValue(turn.id) || `opening-turn-${number}`,
    number,
    createdAt: stringValue(turn.createdAt) || new Date(0).toISOString(),
    input: {
      ...(structuredClone(input) as Omit<TurnRecord['input'], 'graphText' | 'messages'>),
      graphText: typeof input.graphText === 'string' ? input.graphText : '',
      messages: inputMessages,
    },
    output: {
      ...(structuredClone(output) as Omit<TurnRecord['output'], 'graphText' | 'messages'>),
      graphText: typeof output.graphText === 'string' ? output.graphText : '',
      messages: outputMessages,
    },
  };
}

function normalizeOpeningHistoryCheckpoint(value: unknown): TurnCheckpoint | undefined {
  const checkpoint = recordValue(value);
  if (!stringValue(checkpoint.turnId) || !checkpoint.nodeSnapshots || typeof checkpoint.nodeSnapshots !== 'object') {
    return undefined;
  }
  return structuredClone(checkpoint) as TurnCheckpoint;
}

function normalizeOpeningHistoryEvent(value: unknown): RpAppointment | undefined {
  const event = recordValue(value);
  const id = stringValue(event.id);
  const title = stringValue(event.title);
  if (!id || !title) {
    return undefined;
  }
  const status: RpAppointment['status'] =
    event.status === 'completed' || event.status === 'cancelled'
      ? event.status
      : 'upcoming';
  const channel =
    event.channel === 'phone' || event.channel === 'chat'
      ? event.channel
      : undefined;
  return {
    id,
    ...(stringValue(event.scheduledAt) ? { scheduledAt: stringValue(event.scheduledAt) } : {}),
    title,
    ...(stringValue(event.condition) ? { condition: stringValue(event.condition) } : {}),
    ...(stringValue(event.details) ? { details: stringValue(event.details) } : {}),
    ...(channel ? { channel } : {}),
    ...(stringValue(event.phoneFrom) ? { phoneFrom: stringValue(event.phoneFrom) } : {}),
    ...(stringValue(event.phoneTo) ? { phoneTo: stringValue(event.phoneTo) } : {}),
    ...(stringValue(event.phoneRequester) ? { phoneRequester: stringValue(event.phoneRequester) } : {}),
    ...(stringValue(event.phoneMessenger) ? { phoneMessenger: stringValue(event.phoneMessenger) } : {}),
    ...(stringValue(event.phoneRecipient) ? { phoneRecipient: stringValue(event.phoneRecipient) } : {}),
    ...(stringValue(event.phoneAction) ? { phoneAction: stringValue(event.phoneAction) } : {}),
    ...(stringValue(event.requestedBy) ? { requestedBy: stringValue(event.requestedBy) } : {}),
    ...(stringValue(event.assignedTo) ? { assignedTo: stringValue(event.assignedTo) } : {}),
    sourceTurnId: stringValue(event.sourceTurnId) || 'opening-history',
    ...(typeof event.sourceTurnNumber === 'number' && Number.isFinite(event.sourceTurnNumber)
      ? { sourceTurnNumber: Math.round(event.sourceTurnNumber) }
      : {}),
    ...(stringValue(event.sourceNote) ? { sourceNote: stringValue(event.sourceNote) } : {}),
    status,
  };
}

export function normalizeRpStorybookV1(value: unknown): RpStorybookV1 {
  const storybook = recordValue(value);
  const scenario = recordValue(storybook.scenario);
  const characters = Array.isArray(storybook.characters) ? storybook.characters : [];
  const usedImageIds = new Set<string>();
  const normalizedCharacters = characters.map((character, index) =>
    normalizeCharacter(character, index, usedImageIds)
  );
  const validPhoneContactRefs = new Set(normalizedCharacters.map((character) => character.id));
  const openingHistory = recordValue(storybook.openingHistory);
  const openingHistoryTurns = Array.isArray(openingHistory.turns)
    ? openingHistory.turns
    : [];
  const openingHistoryEvents = Array.isArray(openingHistory.events)
    ? openingHistory.events
    : [];
  const openingHistoryCheckpoints = Array.isArray(openingHistory.checkpoints)
    ? openingHistory.checkpoints
    : [];

  return {
    ...emptyRpStorybookV1,
    version: currentRpStorybookVersion,
    title: stringValue(storybook.title),
    introduction: stringValue(storybook.introduction),
    imageDescriptionPrompt: rpStorybookImageDescriptionPromptSettings(storybook.imageDescriptionPrompt),
    scenario: {
      summary: stringValue(scenario.summary),
      openingSituation: stringValue(scenario.openingSituation),
      currentSituation: stringValue(scenario.currentSituation),
    },
    characters: normalizedCharacters,
    phoneContacts: normalizePhoneContacts(storybook.phoneContacts, validPhoneContactRefs),
    openingHistory: {
      summary: stringValue(openingHistory.summary),
      turns: openingHistoryTurns
        .map(normalizeOpeningHistoryTurn)
        .filter((turn): turn is TurnRecord => !!turn),
      checkpoints: openingHistoryCheckpoints
        .map(normalizeOpeningHistoryCheckpoint)
        .filter((checkpoint): checkpoint is TurnCheckpoint => !!checkpoint),
      events: openingHistoryEvents
        .map(normalizeOpeningHistoryEvent)
        .filter((event): event is RpAppointment => !!event),
      socialLikes: normalizeOpeningHistorySocialLikes(openingHistory.socialLikes),
      notes: normalizePhoneNotesByCharacter(openingHistory.notes),
      chatGpdChats: normalizeChatGpdChatsByCharacter(openingHistory.chatGpdChats),
    },
  };
}

/**
 * A tiny, ready-to-run starter story used when a fresh Storybook node is added,
 * so the chat works out of the box (one player + one actor) — enough to try a
 * turn and test a provider connection before writing your own story. Normalized
 * so every character field carries its defaults.
 */
export const starterRpStorybookV1: RpStorybookV1 = normalizeRpStorybookV1({
  format: 'rpgraph-storybook',
  version: currentRpStorybookVersion,
  title: 'Starter Story',
  introduction:
    'A tiny ready-to-run scene so you can try the chat and test your provider connection right away. Replace it with your own story whenever you like.',
  scenario: {
    summary: 'Two friends share a quiet evening at a roadside inn as the rain sets in.',
    openingSituation: 'You have just settled in by the fire, glad for a warm place to rest.',
    currentSituation: 'The common room is warm and nearly empty.',
  },
  characters: [
    {
      id: 'you',
      name: 'You',
      description: 'A traveler passing through, curious about the little inn and its people.',
      personality: 'Easygoing and curious.',
      speechStyle: 'Natural and relaxed.',
      role: 'Player',
    },
    {
      id: 'mira',
      name: 'Mira',
      description: "The innkeeper's daughter, quick-witted and full of local stories.",
      personality: 'Warm, playful, and endlessly curious about newcomers.',
      speechStyle: 'Friendly and animated; asks lots of questions.',
      role: 'Companion',
    },
  ],
});

const storybookParseCacheMaxEntries = 1;
const storybookParseCache: Array<{ text: string; storybook: RpStorybookV1 }> = [];

export function parseRpStorybookJson(text: string): RpStorybookV1 {
  const cachedIndex = storybookParseCache.findIndex((entry) => entry.text === text);
  if (cachedIndex >= 0) {
    const [cached] = storybookParseCache.splice(cachedIndex, 1);
    storybookParseCache.unshift(cached);
    return cached.storybook;
  }
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('The model did not return JSON.');
  }
  const parsed = recordValue(JSON.parse(stripped.slice(start, end + 1)));
  if (parsed.format !== 'rpgraph-storybook') {
    throw new Error('Incompatible RP Storybook format. Expected format "rpgraph-storybook".');
  }
  const versionStatus = rpStorybookVersionStatus(parsed.version);
  if (versionStatus === 'newer') {
    throw new Error(
      `This storybook uses Storybook Format ${String(parsed.version)}, which is newer than the supported Format ${currentRpStorybookVersion}. Update RPGraph to open it.`,
    );
  }
  if (versionStatus === 'invalid') {
    throw new Error(`Incompatible RP Storybook format version. Expected ${currentRpStorybookVersion}.`);
  }
  const storybook = normalizeRpStorybookV1(parsed);
  storybookParseCache.unshift({ text, storybook });
  storybookParseCache.splice(storybookParseCacheMaxEntries);
  return storybook;
}

function decodeJsonPointerPath(pathValue: unknown) {
  if (typeof pathValue !== 'string' || !pathValue.startsWith('/')) {
    throw new Error('JSON Patch path must start with /.');
  }
  return pathValue
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function jsonPatchParent(target: unknown, pathValue: unknown) {
  const parts = decodeJsonPointerPath(pathValue);
  if (parts.length === 0) {
    throw new Error('Storybook JSON Patch path cannot target the document root.');
  }
  let parent = target;
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== 'object') {
      throw new Error(`JSON Patch path does not exist: ${String(pathValue)}`);
    }
    parent = (parent as Record<string, unknown>)[part];
  }
  return { parent, key: parts[parts.length - 1] };
}

function jsonPatchValue(target: unknown, pathValue: unknown) {
  const parts = decodeJsonPointerPath(pathValue);
  if (parts.length === 0) {
    return target;
  }
  let value = target;
  for (const part of parts) {
    if (Array.isArray(value)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= value.length) {
        throw new Error(`JSON Patch path does not exist: ${String(pathValue)}`);
      }
      value = value[index];
    } else if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, part)) {
      value = (value as Record<string, unknown>)[part];
    } else {
      throw new Error(`JSON Patch path does not exist: ${String(pathValue)}`);
    }
  }
  return value;
}

function applyJsonPatchAdd(target: unknown, operation: JsonPatchOperation) {
  const { parent, key } = jsonPatchParent(target, operation.path);
  if (!parent || typeof parent !== 'object') {
    throw new Error(`JSON Patch path has no parent: ${String(operation.path)}`);
  }
  if (Array.isArray(parent)) {
    if (key === '-') {
      parent.push(operation.value);
      return;
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new Error(`Invalid JSON Patch array index: ${String(operation.path)}`);
    }
    parent.splice(index, 0, operation.value);
    return;
  }
  (parent as Record<string, unknown>)[key] = operation.value;
}

function applyJsonPatchRemove(target: unknown, operation: JsonPatchOperation) {
  const { parent, key } = jsonPatchParent(target, operation.path);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`Invalid JSON Patch array index: ${String(operation.path)}`);
    }
    parent.splice(index, 1);
    return;
  }
  if (!parent || typeof parent !== 'object' || !Object.prototype.hasOwnProperty.call(parent, key)) {
    throw new Error(`JSON Patch path does not exist: ${String(operation.path)}`);
  }
  delete (parent as Record<string, unknown>)[key];
}

function applyJsonPatchReplace(target: unknown, operation: JsonPatchOperation) {
  const { parent, key } = jsonPatchParent(target, operation.path);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`Invalid JSON Patch array index: ${String(operation.path)}`);
    }
    parent[index] = operation.value;
    return;
  }
  if (!parent || typeof parent !== 'object' || !Object.prototype.hasOwnProperty.call(parent, key)) {
    throw new Error(`JSON Patch path does not exist: ${String(operation.path)}`);
  }
  (parent as Record<string, unknown>)[key] = operation.value;
}

function jsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyJsonPatchOperation(target: unknown, operation: JsonPatchOperation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new Error('JSON Patch entries must be objects.');
  }
  const op = operation.op;
  if (
    op !== 'add' &&
    op !== 'replace' &&
    op !== 'remove' &&
    op !== 'copy' &&
    op !== 'move' &&
    op !== 'test'
  ) {
    throw new Error(`Unsupported JSON Patch operation: ${String(op)}`);
  }
  if (operation.path === '') {
    throw new Error('Storybook JSON Patch path cannot target the document root.');
  }
  if (op === 'add') {
    applyJsonPatchAdd(target, operation);
  } else if (op === 'replace') {
    applyJsonPatchReplace(target, operation);
  } else if (op === 'remove') {
    applyJsonPatchRemove(target, operation);
  } else if (op === 'copy') {
    applyJsonPatchAdd(target, {
      op: 'add',
      path: operation.path,
      value: structuredClone(jsonPatchValue(target, operation.from)),
    });
  } else if (op === 'move') {
    const value = structuredClone(jsonPatchValue(target, operation.from));
    applyJsonPatchRemove(target, { op: 'remove', path: operation.from });
    applyJsonPatchAdd(target, { op: 'add', path: operation.path, value });
  } else if (!jsonValuesEqual(jsonPatchValue(target, operation.path), operation.value)) {
    throw new Error(`JSON Patch test failed: ${String(operation.path)}`);
  }
}

function applyStorybookJsonPatch(value: RpStorybookV1, patch: unknown) {
  if (!Array.isArray(patch)) {
    throw new Error('Assistant response must include a JSON Patch array in "patch".');
  }
  const target = structuredClone(value);
  patch.forEach((operation) => applyJsonPatchOperation(target, operation as JsonPatchOperation));
  return target;
}

function changedFieldsFromJsonPatch(patch: unknown[]) {
  const fields = new Set<string>();
  patch.forEach((operation) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      return;
    }
    const pathValue = (operation as JsonPatchOperation).path;
    if (typeof pathValue !== 'string' || !pathValue.startsWith('/')) {
      return;
    }
    const [first, second] = decodeJsonPointerPath(pathValue);
    if (!first) {
      fields.add('storybook');
    } else if (first === 'scenario' && second) {
      fields.add(`scenario.${second}`);
    } else {
      fields.add(first);
    }
  });
  return Array.from(fields);
}

export function parseRpStorybookAssistantResult(text: string, fallback: RpStorybookV1): RpStorybookAssistantResult {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('The model did not return JSON.');
  }
  const parsed = recordValue(JSON.parse(stripped.slice(start, end + 1)));
  const patch = Array.isArray(parsed.patch) ? parsed.patch : undefined;
  if (!patch) {
    throw new Error('Assistant response must include a JSON Patch array in "patch".');
  }
  const explicitChangedFields = Array.isArray(parsed.changedFields)
    ? parsed.changedFields.map(stringValue).filter(Boolean)
    : [];
  const changedFields = explicitChangedFields.length || patch.length === 0
    ? explicitChangedFields
    : changedFieldsFromJsonPatch(patch);

  const patchedStorybook = applyStorybookJsonPatch(fallback, patch);
  const normalizedStorybook = withPreservedCharacterImages(
    normalizeRpStorybookV1(patchedStorybook),
    fallback,
  );

  return {
    reply: stringValue(parsed.reply) || (changedFields.length ? 'Updated the storybook.' : 'No changes.'),
    changedFields,
    patchPaths: patch.flatMap((operation) => {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
        return [];
      }
      const entry = operation as JsonPatchOperation;
      return [entry.path, entry.from].filter((path): path is string => typeof path === 'string');
    }),
    storybook: normalizedStorybook,
  };
}

export function rpStorybookJsonText(storybook: RpStorybookV1) {
  return JSON.stringify({
    ...storybook,
    imageDescriptionPrompt: rpStorybookImageDescriptionPromptSaveSettings(storybook.imageDescriptionPrompt),
  }, null, 2);
}

export function rpStorybookPromptJsonText(storybook: RpStorybookV1) {
  const omittedTurns = storybook.openingHistory.turns.length;
  const omittedNote = omittedTurns
    ? `[${omittedTurns} Opening History turn${omittedTurns === 1 ? '' : 's'} stored but omitted from this view; the app manages them.]`
    : '';
  return JSON.stringify({
    ...storybook,
    characters: storybook.characters.map((character) => {
      const { phoneSettings: _phoneSettings, ...characterWithoutPhoneSettings } = character;
      return {
        ...characterWithoutPhoneSettings,
        ...(character.profileImage
          ? { profileImage: { ...character.profileImage, dataUrl: 'data:image/jpeg;base64,...' } }
          : {}),
        ...(character.voiceConfig?.sampleDataUrl
          ? { voiceConfig: { ...character.voiceConfig, sampleDataUrl: 'data:audio/mpeg;base64,...' } }
          : {}),
        images: character.images.map(({ dataUrl: _dataUrl, ...image }) => image),
      };
    }),
    // Opening History turns and checkpoints hold imported runtime memory that
    // can exceed any model context; the assistant only sees the summary.
    openingHistory: {
      ...storybook.openingHistory,
      summary: [storybook.openingHistory.summary, omittedNote].filter(Boolean).join(' '),
      checkpoints: [],
      turns: [],
    },
  }, null, 2);
}

/**
 * Rough prompt-size estimate (~4 characters per token) of the storybook as an
 * LLM sees it: image and voice data URLs excluded, Opening History summarized.
 */
export function estimatedRpStorybookPromptTokens(storybook: RpStorybookV1) {
  return Math.ceil(rpStorybookPromptJsonText(storybook).length / 4);
}

function withPreservedCharacterImages(
  storybook: RpStorybookV1,
  fallback: RpStorybookV1,
): RpStorybookV1 {
  const fallbackCharacters = new Map(fallback.characters.map((character) => [character.id, character]));
  return {
    ...storybook,
    openingHistory: fallback.openingHistory,
    characters: storybook.characters.map((character) => ({
      ...character,
      ...(fallbackCharacters.get(character.id)?.profileImage
        ? { profileImage: fallbackCharacters.get(character.id)!.profileImage }
        : {}),
      comfyConfig: character.comfyConfig?.loraName || character.comfyConfig?.loraUrl || character.comfyConfig?.appearance
        ? character.comfyConfig
        : fallbackCharacters.get(character.id)?.comfyConfig ?? character.comfyConfig ?? defaultRpStorybookCharacterComfyConfig(),
      // Voice samples are binary payloads the assistant never edits; always keep the stored ones.
      voiceConfig: fallbackCharacters.get(character.id)?.voiceConfig ??
        character.voiceConfig ??
        defaultRpStorybookCharacterVoiceConfig(),
      phoneSettings: fallbackCharacters.get(character.id)?.phoneSettings ??
        character.phoneSettings ??
        defaultRpStorybookCharacterPhoneSettings(),
      images: fallbackCharacters.get(character.id)?.images ?? character.images,
    })),
  };
}

export function rpStorybookFormattedText(
  storybook: RpStorybookV1,
  settingsInput?: Partial<RpStorybookFormattedTextSettings>,
) {
  const settings = rpStorybookFormattedTextSettings(settingsInput);
  const characterText = storybook.characters.length
    ? storybook.characters.map((character) => [
        `Charakter: ${character.name || character.id}`,
        character.role ? `Role: ${character.role}` : '',
        character.description ? `Description: ${character.description}` : '',
        character.personality ? `Personality: ${character.personality}` : '',
        character.speechStyle ? `Speech Style: ${character.speechStyle}` : '',
        character.comfyConfig?.appearance ? `Appearance: ${character.comfyConfig.appearance}` : '',
        settings.characterImages && character.images.length
          ? [
              'Character Images:',
              ...character.images.map((image, index) =>
                `- ${index + 1}. ${image.description || image.name || image.id}`
              ),
            ].join('\n')
          : '',
      ].filter(Boolean).join('\n')).join('\n\n')
    : 'No characters defined.';

  return [
    settings.title ? `# ${storybook.title || 'Untitled RP Storybook'}` : '',
    settings.title ? '' : '',
    settings.introduction ? '## Introduction' : '',
    settings.introduction ? storybook.introduction || 'No introduction defined.' : '',
    settings.introduction ? '' : '',
    settings.scenario ? '## Scenario' : '',
    settings.scenario ? storybook.scenario.summary || 'No scenario summary defined.' : '',
    settings.scenario && storybook.scenario.openingSituation ? `Opening Situation: ${storybook.scenario.openingSituation}` : '',
    settings.scenario && storybook.scenario.currentSituation ? `Current Situation: ${storybook.scenario.currentSituation}` : '',
    settings.scenario ? '' : '',
    settings.characters ? '## Charakter' : '',
    settings.characters ? characterText : '',
    settings.openingHistory && (storybook.openingHistory.summary || storybook.openingHistory.turns.length || storybook.openingHistory.events.length) ? '' : '',
    settings.openingHistory && (storybook.openingHistory.summary || storybook.openingHistory.turns.length || storybook.openingHistory.events.length) ? '## Opening History' : '',
    settings.openingHistory ? storybook.openingHistory.summary || '' : '',
    settings.openingHistory && storybook.openingHistory.turns.length
      ? `${storybook.openingHistory.turns.length} imported opening turns.`
      : '',
    settings.openingHistory && storybook.openingHistory.events.length
      ? `${storybook.openingHistory.events.length} imported opening events.`
      : '',
  ].filter((line, index, lines) => line || lines[index - 1]).join('\n').trim();
}

export function rpStorybookPhoneContactCharacters(storybook: RpStorybookV1) {
  return storybook.characters.map((character, index) => ({
    ref: character.id || `character-${index + 1}`,
    name: character.name || character.id || `Character ${index + 1}`,
    kind: 'character' as const,
  }));
}

export function rpStorybookPhoneContactBlocked(
  storybook: RpStorybookV1,
  ownerRef: string,
  contactRef: string,
) {
  return storybook.phoneContacts.blocked.some(
    (block) => phoneContactPairKey(block.owner, block.contact) === phoneContactPairKey(ownerRef, contactRef),
  );
}

export function rpStorybookPhoneContactAllowed(
  storybook: RpStorybookV1,
  ownerRef: string,
  contactRef: string,
) {
  return ownerRef !== contactRef && !rpStorybookPhoneContactBlocked(storybook, ownerRef, contactRef);
}

export function withRpStorybookPhoneContactPairBlocked(
  storybook: RpStorybookV1,
  leftRef: string,
  rightRef: string,
  blocked: boolean,
): RpStorybookV1 {
  const target = phoneContactPairBlock(leftRef, rightRef);
  const targetPairKey = phoneContactPairKey(leftRef, rightRef);
  const nextBlocked = storybook.phoneContacts.blocked.filter(
    (entry) => phoneContactPairKey(entry.owner, entry.contact) !== targetPairKey,
  );
  return {
    ...storybook,
    phoneContacts: {
      blocked: blocked ? [...nextBlocked, target] : nextBlocked,
    },
  };
}

export function withRpStorybookPhoneContactPairAllowed(
  storybook: RpStorybookV1,
  leftRef: string,
  rightRef: string,
): RpStorybookV1 {
  return withRpStorybookPhoneContactPairBlocked(storybook, leftRef, rightRef, false);
}

export function withRpStorybookCharacterPhoneWallpaper(
  storybook: RpStorybookV1,
  characterId: string,
  wallpaperId: string,
): RpStorybookV1 {
  const nextWallpaperId = wallpaperId.trim() || defaultRpStorybookCharacterPhoneSettings().wallpaperId;
  return {
    ...storybook,
    characters: storybook.characters.map((character) =>
      character.id === characterId
        ? { ...character, phoneSettings: { wallpaperId: nextWallpaperId } }
        : character,
    ),
  };
}

export function withRpStorybookCharacterSocialUsername(
  storybook: RpStorybookV1,
  characterId: string,
  app: 'fotogram' | 'onlyfriends',
  username: string,
): RpStorybookV1 {
  const field = app === 'fotogram' ? 'fotogramUsername' : 'onlyfriendsUsername';
  return {
    ...storybook,
    characters: storybook.characters.map((character) =>
      character.id === characterId
        ? {
            ...character,
            social: {
              ...(character.social ?? defaultRpStorybookCharacterSocial()),
              [field]: username.trim(),
            },
          }
        : character,
    ),
  };
}

/**
 * Fields that running chat or Opening History references by value: character
 * existence, names, and established social handles. Changing them mid-story
 * orphans messages, phone conversations, and social posts.
 */
export function rpStorybookIdentityLockViolations(
  current: RpStorybookV1,
  next: RpStorybookV1,
): string[] {
  const violations: string[] = [];
  const nextById = new Map(next.characters.map((character) => [character.id, character]));
  current.characters.forEach((character) => {
    const label = character.name || character.id;
    const nextCharacter = nextById.get(character.id);
    if (!nextCharacter) {
      violations.push(`Character "${label}" cannot be removed while the story has chat or Opening History.`);
      return;
    }
    if (character.name && nextCharacter.name !== character.name) {
      violations.push(`Character "${label}" cannot be renamed while the story has chat or Opening History.`);
    }
    const currentSocial = character.social ?? defaultRpStorybookCharacterSocial();
    const nextSocial = nextCharacter.social ?? defaultRpStorybookCharacterSocial();
    if (currentSocial.fotogramUsername && nextSocial.fotogramUsername !== currentSocial.fotogramUsername) {
      violations.push(`The Fotogram username of "${label}" cannot be changed while the story has chat or Opening History.`);
    }
    if (currentSocial.onlyfriendsUsername && nextSocial.onlyfriendsUsername !== currentSocial.onlyfriendsUsername) {
      violations.push(`The OnlyFriends username of "${label}" cannot be changed while the story has chat or Opening History.`);
    }
  });
  return violations;
}

export function parseNodeStorybookJson(text: string | undefined): RpStorybookV1 | undefined {
  if (!text) {
    return undefined;
  }
  try {
    return parseRpStorybookJson(text);
  } catch {
    return undefined;
  }
}

export function storybookCharacterId(nodeId: string, characterId: string, index: number) {
  return `${nodeId}:character:${characterId || `character-${index + 1}`}`;
}

/**
 * Canned assistant instruction that checks scenario texts against the current
 * cast, e.g. after a character card import swapped a character.
 */
export const rpStorybookLogicCheckInstruction = [
  'Run a story logic check on this storybook.',
  'Compare the characters list against introduction, scenario.summary, scenario.openingSituation, and scenario.currentSituation.',
  'Find: references to characters that do not exist (anymore), main characters the scenario texts never mention, and contradictions in relationships, locations, or timeline.',
  'Propose patches only for those text fields (introduction and scenario.*) so they match the current cast. Do not touch characters, openingHistory, phoneContacts, or images.',
  'In reply, list every inconsistency you found and how you fixed it, or state that everything is consistent.',
].join(' ');

export function rpStorybookEditPrompt(currentJson: string, instruction: string, identityLocked = false) {
  return [
    ...(identityLocked
      ? [
          'IMPORTANT: The story is already running (current chat or Opening History exists). Character identity is locked: never remove a character, never change characters[].id or characters[].name, and never change or clear a non-empty social username. If the user asks for such a change, explain in reply that these fields are locked while a story is running (a full Storybook reset would unlock them) and return an empty patch for that part of the request.',
        ]
      : []),
    'You are the chat assistant for one RPGraph RP Storybook JSON document.',
    'Return only valid JSON. No markdown. No comments. No extra keys.',
    'You can answer questions about the current storybook and you can edit the storybook when the user asks for changes.',
    'Return this response shape with a valid RFC 6902 JSON Patch array. The patch paths use RFC 6901 JSON Pointer.',
    '{"reply":"short user-facing answer","changedFields":["title","scenario.openingSituation"],"patch":[{"op":"replace","path":"/title","value":"New title"}]}',
    'Do not return the complete storybook. Do not replace the document root. Patch only the exact fields or array entries needed for the user request.',
    'Keep the exact storybook shape below:',
    `{"format":"rpgraph-storybook","version":"${currentRpStorybookVersion}",` +
    '"title":"","introduction":"","imageDescriptionPrompt":{"mode":"default"},"scenario":{"summary":"","openingSituation":"","currentSituation":""},"characters":[{"id":"","name":"","description":"","personality":"","speechStyle":"","role":"","banking":{"startBalance":1000,"fixedExpenses":[{"label":"Mobile plan","amount":24.99}]},"social":{"fotogramUsername":"nova.reyes","onlyfriendsUsername":""},"comfyConfig":{"loraName":"","loraUrl":"","appearance":""},"profileImage":{"imageId":"robert_miller_image_01","dataUrl":"data:image/jpeg;base64,...","crop":{"x":25,"y":20,"size":50}},"images":[{"id":"robert_miller_image_01","name":"robert_miller_image_01","mimeType":"image/jpeg","size":0,"dataUrl":"data:image/jpeg;base64,...","width":0,"height":0,"description":"","receivedFrom":"","imageAccess":false}]}],"phoneContacts":{"blocked":[{"owner":"character-id","contact":"other-character-id"}]},"openingHistory":{"summary":"","turns":[],"checkpoints":[],"events":[]}}',
    'If the user asks a question, answer it in reply, keep changedFields empty, and return an empty patch array.',
    'If the user asks for edits or provides new story facts, edit only the required fields. Preserve all existing values, including imageDescriptionPrompt, characters[].comfyConfig, characters[].voiceConfig, characters[].profileImage, characters[].phoneSettings, and characters[].images dataUrl values, unless the user explicitly changes them.',
    'Do not create, rewrite, append, delete, reorder, summarize, or otherwise patch openingHistory or any of its fields. Opening History contains imported runtime memory with assigned ids and message slots that you cannot generate correctly. If the user asks for Opening History changes, explain in reply that Opening History must be imported or reset by the app controls instead, and return an empty patch unless another editable storybook text field was requested.',
    'For character renames, replace only characters/{index}/name and keep the character id stable.',
    'For new characters, add one complete character object at /characters/- with id, name, description, personality, speechStyle, role, banking, social, comfyConfig, and images.',
    'characters[].banking.startBalance is the character\'s bank account start balance in US dollars for the phone Banking app. Always set a value that fits the character\'s life situation (for example a student low, an engineer or doctor high). Use 1000 only when nothing about the character suggests a better value. Keep existing balances unless the user asks to change them.',
    'characters[].banking.fixedExpenses lists recurring payments shown in the Banking app history, each as {"label":"Mobile plan","amount":24.99} with a US dollar amount. Always include exactly one mobile plan entry with a realistic amount that fits the character. Add further fixed expenses in the same format only when the user asks for them; the app fills the rest of the history with generated everyday spending automatically.',
    'characters[].social.fotogramUsername is the character\'s account username in the phone Fotogram app (a lowercase handle like "nova.reyes"). Every character is expected to have a Fotogram account, so always set a fitting handle derived from the name for new characters. Keep existing usernames unless the user asks to change them.',
    'characters[].social.onlyfriendsUsername is the character\'s account username in the phone OnlyFriends app (an OnlyFans-style platform). These accounts are private: keep it an empty string unless the user or the story explicitly gives the character an OnlyFriends account.',
    'characters[].comfyConfig is optional image-generation configuration. loraName is a ComfyUI LoRA file name for that character. loraUrl is an optional download/source URL for that LoRA. appearance is a concise visual description for generated images. Leave them empty unless the user explicitly provides image-generation details.',
    'characters[].voiceConfig stores a binary voice sample managed by the app. Never create, edit, or remove it.',
    'For edits, changedFields must list compact field paths that changed, for example "title", "scenario", "characters".',
    'Every playable person, npc, or roleplay participant belongs in characters. Do not create any other character container fields.',
    'phoneContacts.blocked stores bidirectional hidden phone contact pairs for the Phone UI only. It is not story context. Default is everyone can see everyone, so keep blocked empty unless the user explicitly says two characters should not appear as phone contacts.',
    'characters[].phoneSettings is app-only Phone UI state. It is intentionally omitted from the current JSON and must never be created or patched by the assistant.',
    'Use character ids for owner and contact. Store each hidden pair once only. If you add or rename characters, keep character ids stable and update phoneContacts.blocked only when needed.',
    'Use concise but useful roleplay authoring text. Answer in the same language as the user when practical.',
    '',
    `Current JSON:\n${currentJson}`,
    '',
    `User instruction:\n${instruction}`,
  ].join('\n');
}
