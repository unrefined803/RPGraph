import { portraitDataUrl } from '../../characters/portrait';
import { parseNpcParticipantSnapshots, type NpcParticipantSnapshots } from '../../characters/npcParticipants';
import { withCharacterAppProfile } from '../../characters/profiles';
import { normalizeCharacterApps, socialFromCharacterApps, characterPayload, type Character } from '../../characters/character';
import { normalizeDatingProfile, type DatingProfile } from '../../chat/datingProfile';
import type { MessageRecord, RpAppointment, TurnRecord } from '../../types';
import type { TurnCheckpoint } from '../../data-management/types';
import {
  normalizeChatGpdChatsByCharacter,
  normalizePhoneNotesByCharacter,
  type ChatGpdChatsByCharacter,
  type PhoneNotesByCharacter,
} from '../../chat/phoneAppsSessions';
import {
  normalizeDynamicSocialUsers,
  normalizeSocialConnectionsByCharacter,
  type DynamicSocialUsers,
  type SocialConnectionsByCharacter,
} from '../../chat/socialDirectory';
import {
  normalizeStorybookVoiceMedia,
  turnsWithStorybookVoiceRefs,
  type StorybookVoiceMedia,
} from '../../storybook/openingHistoryVoiceMedia';

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
  crop?: {
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
  plotTwist?: DatingProfile;
  /** Fotogram account username; every character is expected to have one. */
  fotogramUsername: string;
  /** OnlyFriends account username; empty string means no account (accounts are private). */
  onlyfriendsUsername: string;
};

export type RpStorybookCharacter = Character;

export type RpStorybookPhoneContactBlock = {
  owner: string;
  contact: string;
};

export type RpStorybookImageDescriptionPromptSettings = {
  mode: 'default' | 'custom';
  customText?: string;
};

export const currentRpStorybookVersion = '3.0.0' as const;

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

export type RpStorybook = {
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
  characters: RpStorybookCharacter[];
  /** Bidirectional pairs hidden from the default Phone + Fotogram contact display. */
  phoneContacts: {
    blocked: RpStorybookPhoneContactBlock[];
  };
  openingHistory: {
    /** Non-playable pinned NPC revisions required by activity and its checkpoints. */
    npcParticipants?: NpcParticipantSnapshots;
    summary: string;
    turns: TurnRecord[];
    checkpoints: TurnCheckpoint[];
    events: RpAppointment[];
    /** Deduplicated generated voice audio referenced by Opening History messages. */
    voiceMedia: StorybookVoiceMedia;
    /** Liked post ids per "characterId/app" account key, imported with the session. */
    socialLikes: Record<string, string[]>;
    /** Dynamic social identities imported from an RP session. */
    dynamicSocialUsers: DynamicSocialUsers;
    /** Added social users per player character and app. */
    socialConnections: SocialConnectionsByCharacter;
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
  storybook: RpStorybook;
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

export const emptyRpStorybook: RpStorybook = {
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
    npcParticipants: {},
    summary: '',
    turns: [],
    checkpoints: [],
    events: [],
    voiceMedia: {},
    socialLikes: {},
    dynamicSocialUsers: {},
    socialConnections: {},
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
  usedImageDataUrls: ReadonlyMap<string, string>,
  dataUrl: string,
  allowExternalId = false,
) {
  const id = stringValue(value);
  const pattern = storybookCharacterImageIdPattern(ownerBase);
  if (
    allowExternalId &&
    /^[a-z0-9][a-z0-9_]*_image_\d+$/i.test(id) &&
    !ownerImages.some((image) => image.id === id) &&
    (!usedIds.has(id) || usedImageDataUrls.get(id) === dataUrl)
  ) {
    return id;
  }
  if (
    pattern.test(id) &&
    !ownerImages.some((image) => image.id === id) &&
    (!usedIds.has(id) || usedImageDataUrls.get(id) === dataUrl)
  ) {
    return id;
  }
  return nextStorybookCharacterImageId(ownerBase, ownerImages, usedIds);
}

function normalizeCharacterImages(
  value: unknown,
  ownerBase: string,
  usedIds: Set<string>,
  usedImageDataUrls: Map<string, string>,
  stableIds = false,
): RpStorybookCharacterImage[] {
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
    const storedId = stringValue(image.id);
    if (stableIds && storedId && (normalized.some((entry) => entry.id === storedId) ||
      (usedIds.has(storedId) && usedImageDataUrls.get(storedId) !== dataUrl))) {
      throw new Error(`Conflicting gallery image ID: ${storedId}`);
    }
    const id = stableIds && storedId ? storedId : normalizedStorybookCharacterImageId(
      image.id,
      ownerBase,
      normalized,
      usedIds,
      usedImageDataUrls,
      dataUrl,
      externalImage,
    );
    usedIds.add(id);
    usedImageDataUrls.set(id, dataUrl);
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
  const dataUrl = image?.dataUrl ?? stringValue(profileImage.dataUrl);
  if (!image || !dataUrl.startsWith('data:image/jpeg;base64,')) {
    return undefined;
  }
  const crop = recordValue(profileImage.crop);
  const size = percentValue(crop.size);
  if (profileImage.crop === undefined) return { imageId, dataUrl };
  if (size === undefined || size <= 0) {
    return undefined;
  }
  return {
    imageId,
    dataUrl: portraitDataUrl(image, { x: percentValue(crop.x) ?? 0, y: percentValue(crop.y) ?? 0, size }),
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
    ...(normalizeDatingProfile(social.plotTwist) ? { plotTwist: normalizeDatingProfile(social.plotTwist) } : {}),
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

function characterIdentityValues(character: Record<string, unknown>, index: number) {
  const name = stringValue(character.name);
  const id = stringValue(character.id) ||
    (name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : `character-${index + 1}`);
  return { name, id };
}

/**
 * Reserves every character's own-namespaced image ids together with their
 * pixels before any character is normalized. Without this, a received copy
 * that precedes its owner in the characters array could claim the owner's id
 * with different pixels and force the owner's image to be renamed.
 */
function reserveOwnerImageIds(
  characters: unknown[],
  usedImageIds: Set<string>,
  usedImageDataUrls: Map<string, string>,
) {
  characters.forEach((value, index) => {
    const character = recordValue(value);
    const { name, id } = characterIdentityValues(character, index);
    const pattern = storybookCharacterImageIdPattern(storybookCharacterImageOwnerIdBase(name, id));
    const images = Array.isArray(character.images) ? character.images : [];
    images.forEach((entry) => {
      const image = recordValue(entry);
      const dataUrl = stringValue(image.dataUrl);
      const imageId = stringValue(image.id);
      if (
        !dataUrl.startsWith('data:image/jpeg;base64,') ||
        stringValue(image.mimeType) !== 'image/jpeg' ||
        !pattern.test(imageId) ||
        usedImageIds.has(imageId)
      ) {
        return;
      }
      usedImageIds.add(imageId);
      usedImageDataUrls.set(imageId, dataUrl);
    });
  });
}

function normalizeCharacter(
  value: unknown,
  index: number,
  usedImageIds: Set<string>,
  usedImageDataUrls: Map<string, string>,
): RpStorybookCharacter {
  const character = recordValue(value);
  const { name, id } = characterIdentityValues(character, index);
  const imageOwnerBase = storybookCharacterImageOwnerIdBase(name, id);
  const images = normalizeCharacterImages(
    character.images,
    imageOwnerBase,
    usedImageIds,
    usedImageDataUrls,
    character.apps !== undefined,
  );
  const profileImage = normalizeCharacterProfileImage(character.profileImage, images);
  const apps = normalizeCharacterApps(character.apps, character.social, id, name);
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
    playable: character.playable !== false,
    ...(typeof character.age === 'number' ? { age: character.age } : {}),
    ...(['woman', 'man', 'nonbinary'].includes(String(character.gender)) ? { gender: character.gender as Character['gender'] } : {}),
    apps,
    social: socialFromCharacterApps(apps),
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
): RpStorybookCharacter {
  return normalizeCharacter(
    value,
    index,
    usedImageIds,
    new Map([...usedImageIds].map((imageId) => [imageId, ''])),
  );
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

function normalizePhoneContacts(value: unknown, validRefs: Set<string>): RpStorybook['phoneContacts'] {
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

export function normalizeRpStorybook(value: unknown): RpStorybook {
  const storybook = recordValue(value);
  const scenario = recordValue(storybook.scenario);
  const characters = Array.isArray(storybook.characters) ? storybook.characters : [];
  const usedImageIds = new Set<string>();
  const usedImageDataUrls = new Map<string, string>();
  reserveOwnerImageIds(characters, usedImageIds, usedImageDataUrls);
  const normalizedCharacters = characters.map((character, index) =>
    normalizeCharacter(character, index, usedImageIds, usedImageDataUrls)
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
  const openingHistoryVoiceMedia = normalizeStorybookVoiceMedia(openingHistory.voiceMedia);
  const normalizedOpeningHistoryMedia = turnsWithStorybookVoiceRefs(
    openingHistoryTurns
      .map(normalizeOpeningHistoryTurn)
      .filter((turn): turn is TurnRecord => !!turn),
    openingHistoryVoiceMedia,
  );

  return {
    ...emptyRpStorybook,
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
      npcParticipants: parseNpcParticipantSnapshots(openingHistory.npcParticipants),
      summary: stringValue(openingHistory.summary),
      turns: normalizedOpeningHistoryMedia.turns,
      checkpoints: openingHistoryCheckpoints
        .map(normalizeOpeningHistoryCheckpoint)
        .filter((checkpoint): checkpoint is TurnCheckpoint => !!checkpoint),
      events: openingHistoryEvents
        .map(normalizeOpeningHistoryEvent)
        .filter((event): event is RpAppointment => !!event),
      voiceMedia: normalizedOpeningHistoryMedia.voiceMedia,
      socialLikes: normalizeOpeningHistorySocialLikes(openingHistory.socialLikes),
      dynamicSocialUsers: normalizeDynamicSocialUsers(openingHistory.dynamicSocialUsers),
      socialConnections: normalizeSocialConnectionsByCharacter(openingHistory.socialConnections),
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
export const starterRpStorybook: RpStorybook = normalizeRpStorybook({
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
const storybookParseCache: Array<{ text: string; storybook: RpStorybook }> = [];

/** Inspect stored data without normalizing or migrating it. */
export function storybookNeedsUpdate(text: string | undefined): boolean {
  if (!text?.trim()) return false;
  try {
    const value = JSON.parse(text);
    return value.format === 'rpgraph-storybook' && rpStorybookVersionStatus(value.version) === 'legacy';
  } catch {
    return false;
  }
}

export function parseRpStorybookJson(text: string): RpStorybook {
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
  const storybook = normalizeRpStorybook(parsed);
  storybookParseCache.unshift({ text, storybook });
  storybookParseCache.splice(storybookParseCacheMaxEntries);
  return storybook;
}

function decodeJsonPointerPath(pathValue: unknown) {
  if (typeof pathValue !== 'string' || !pathValue.startsWith('/')) {
    throw new Error('JSON Patch path must start with /.');
  }
  const parts = pathValue.slice(1).split('/');
  if (parts.some((part) => /~(?:[^01]|$)/.test(part))) {
    throw new Error('JSON Patch paths must escape ~ as ~0 and / as ~1.');
  }
  const decoded = parts.map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (decoded.some((part) => ['__proto__', 'constructor', 'prototype'].includes(part))) {
    throw new Error('JSON Patch path contains a forbidden property.');
  }
  return decoded;
}

function jsonPatchParent(target: unknown, pathValue: unknown) {
  const parts = decodeJsonPointerPath(pathValue);
  if (parts.length === 0) {
    throw new Error('Storybook JSON Patch path cannot target the document root.');
  }
  let parent = target;
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !Object.prototype.hasOwnProperty.call(parent, part)) {
      throw new Error(`JSON Patch path does not exist: ${String(pathValue)}`);
    }
    if (Array.isArray(parent)) jsonPatchArrayIndex(part, parent.length);
    parent = (parent as Record<string, unknown>)[part];
  }
  return { parent, key: parts[parts.length - 1] };
}

function jsonPatchArrayIndex(key: string, length: number, allowAppend = false) {
  const index = Number(key);
  if (!/^(0|[1-9][0-9]*)$/.test(key) || !Number.isSafeInteger(index) || index >= length + (allowAppend ? 1 : 0)) {
    throw new Error(`Invalid JSON Patch array index "${key}". Use a zero-based numeric index from the current JSON.`);
  }
  return index;
}

function jsonPatchValue(target: unknown, pathValue: unknown) {
  const parts = decodeJsonPointerPath(pathValue);
  if (parts.length === 0) {
    return target;
  }
  let value = target;
  for (const part of parts) {
    if (Array.isArray(value)) {
      const index = jsonPatchArrayIndex(part, value.length);
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
    const index = jsonPatchArrayIndex(key, parent.length, true);
    parent.splice(index, 0, operation.value);
    return;
  }
  (parent as Record<string, unknown>)[key] = operation.value;
}

function applyJsonPatchRemove(target: unknown, operation: JsonPatchOperation) {
  const { parent, key } = jsonPatchParent(target, operation.path);
  if (Array.isArray(parent)) {
    const index = jsonPatchArrayIndex(key, parent.length);
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
    const index = jsonPatchArrayIndex(key, parent.length);
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
  if ((op === 'add' || op === 'replace' || op === 'test') && !Object.prototype.hasOwnProperty.call(operation, 'value')) {
    throw new Error(`JSON Patch ${op} requires a value. Use an empty string to clear text.`);
  }
  if (op === 'move') {
    const from = decodeJsonPointerPath(operation.from);
    const to = decodeJsonPointerPath(operation.path);
    if (to.length > from.length && from.every((part, index) => part === to[index])) {
      throw new Error('JSON Patch move cannot move a value into its own child.');
    }
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

function applyStorybookJsonPatch(value: RpStorybook, patch: unknown) {
  if (!Array.isArray(patch)) {
    throw new Error('Assistant response must include a JSON Patch array in "patch".');
  }
  const target = structuredClone(value);
  patch.forEach((operation, index) => {
    try {
      applyJsonPatchOperation(target, operation as JsonPatchOperation);
      const path = (operation as JsonPatchOperation).path;
      const appEdit = typeof path === 'string' ? /^\/characters\/(\d+)\/apps(?:\/|$)/.exec(path) : null;
      if (appEdit && (operation as JsonPatchOperation).op !== 'test') {
        const character = target.characters[Number(appEdit[1])];
        if (character) delete character.social;
      }
    } catch (error) {
      const path = operation && typeof operation === 'object' ? operation.path : undefined;
      const patchError = new Error(`Patch operation ${index + 1}${typeof path === 'string' ? ` (${path})` : ''} failed: ${error instanceof Error ? error.message : String(error)} No changes were applied.`);
      Object.assign(patchError, { cause: error });
      throw patchError;
    }
  });
  return target;
}

export function parseRpStorybookAssistantResult(text: string, fallback: RpStorybook): RpStorybookAssistantResult {
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
  const patchedStorybook = applyStorybookJsonPatch(fallback, patch);
  const unchanged = jsonValuesEqual(patchedStorybook, fallback);
  const normalizedStorybook = unchanged
    ? patchedStorybook
    : withPreservedCharacterImages(normalizeRpStorybook(patchedStorybook), fallback);
  const comparisonFallback = unchanged
    ? fallback
    : withPreservedCharacterImages(normalizeRpStorybook(fallback), fallback);

  // Report authored changes, excluding defaults introduced by normalization.
  const changedFields = (Object.keys(normalizedStorybook) as Array<keyof RpStorybook>)
    .filter((key) => !jsonValuesEqual(normalizedStorybook[key], comparisonFallback[key]));

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

export function rpStorybookJsonText(storybook: RpStorybook) {
  return JSON.stringify({
    ...storybook,
    characters: storybook.characters.map((character) => characterPayload(character)),
    imageDescriptionPrompt: rpStorybookImageDescriptionPromptSaveSettings(storybook.imageDescriptionPrompt),
  }, null, 2);
}

export function rpStorybookPromptJsonText(storybook: RpStorybook) {
  const omittedTurns = storybook.openingHistory.turns.length;
  const omittedNote = omittedTurns
    ? `[${omittedTurns} Opening History turn${omittedTurns === 1 ? '' : 's'} stored but omitted from this view; the app manages them.]`
    : '';
  return JSON.stringify({
    ...storybook,
    characters: storybook.characters.map((character) => {
      const { phoneSettings: _phoneSettings, ...characterWithoutPhoneSettings } = character;
      return {
        ...characterPayload(characterWithoutPhoneSettings),
        ...(character.profileImage
          ? { profileImage: { imageId: character.profileImage.imageId, crop: character.profileImage.crop } }
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
      npcParticipants: {},
      checkpoints: [],
      turns: [],
      voiceMedia: {},
    },
  }, null, 2);
}

/**
 * Rough prompt-size estimate (~4 characters per token) of the storybook as an
 * LLM sees it: image and voice data URLs excluded, Opening History summarized.
 */
export function estimatedRpStorybookPromptTokens(storybook: RpStorybook) {
  return Math.ceil(rpStorybookPromptJsonText(storybook).length / 4);
}

function withPreservedCharacterImages(
  storybook: RpStorybook,
  fallback: RpStorybook,
): RpStorybook {
  const fallbackCharacters = new Map(fallback.characters.map((character) => [character.id, character]));
  return {
    ...storybook,
    openingHistory: fallback.openingHistory,
    characters: storybook.characters.map((character) => ({
      ...character,
      ...(fallbackCharacters.get(character.id)?.profileImage
        ? { profileImage: fallbackCharacters.get(character.id)!.profileImage }
        : {}),
      comfyConfig: character.comfyConfig ?? defaultRpStorybookCharacterComfyConfig(),
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
  storybook: RpStorybook,
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

export function rpStorybookPhoneContactCharacters(storybook: RpStorybook) {
  return storybook.characters.map((character, index) => ({
    ref: character.id || `character-${index + 1}`,
    name: character.name || character.id || `Character ${index + 1}`,
    kind: 'character' as const,
  }));
}

export function rpStorybookPhoneContactBlocked(
  storybook: RpStorybook,
  ownerRef: string,
  contactRef: string,
) {
  return storybook.phoneContacts.blocked.some(
    (block) => phoneContactPairKey(block.owner, block.contact) === phoneContactPairKey(ownerRef, contactRef),
  );
}

export function rpStorybookPhoneContactAllowed(
  storybook: RpStorybook,
  ownerRef: string,
  contactRef: string,
) {
  return ownerRef !== contactRef && !rpStorybookPhoneContactBlocked(storybook, ownerRef, contactRef);
}

export function withRpStorybookPhoneContactPairBlocked(
  storybook: RpStorybook,
  leftRef: string,
  rightRef: string,
  blocked: boolean,
): RpStorybook {
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
  storybook: RpStorybook,
  leftRef: string,
  rightRef: string,
): RpStorybook {
  return withRpStorybookPhoneContactPairBlocked(storybook, leftRef, rightRef, false);
}

export function withRpStorybookCharacterPhoneWallpaper(
  storybook: RpStorybook,
  characterId: string,
  wallpaperId: string,
): RpStorybook {
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
  storybook: RpStorybook,
  characterId: string,
  app: 'fotogram' | 'onlyfriends',
  username: string,
): RpStorybook {

  return { ...storybook, characters: storybook.characters.map((character) => character.id === characterId
    ? withCharacterAppProfile(character, app, {
        accountId: character.apps?.[app]?.accountId ?? `character:${character.id}:${app}`,
        displayName: character.name, bio: '', ...character.apps?.[app],
        username: username.trim(), enabled: !!username.trim(),
      })
    : character) };

}

/**
 * Fields that running chat or Opening History references by value: character
 * existence, names, and established social handles. Changing them mid-story
 * orphans messages, phone conversations, and social posts.
 */
export function rpStorybookIdentityLockViolations(
  current: RpStorybook,
  next: RpStorybook,
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
    for (const app of ['whatsup', 'fotogram', 'onlyfriends', 'matchme'] as const) {
      const account = character.apps?.[app];
      const nextAccount = nextCharacter.apps?.[app];
      if (account && (!nextAccount || account.accountId !== nextAccount.accountId ||
        (account.enabled && !nextAccount.enabled) || (account.username && account.username !== nextAccount.username))) {
        violations.push(`The ${app} account identity of "${label}" cannot be changed or removed while the story has chat or Opening History.`);
      }
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

export function parseNodeStorybookJson(text: string | undefined): RpStorybook | undefined {
  if (!text || storybookNeedsUpdate(text)) {
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
          'IMPORTANT: The story is already running (current chat or Opening History exists). Character identity is locked: never remove a character, never change characters[].id or characters[].name, and never remove an existing app account, change its accountId, disable an enabled account, or change or clear a non-empty username. Display names, bios and valid profile details remain editable; new accounts may be added. If the user asks for such a change, explain in reply that these fields are locked while a story is running (a full Storybook reset would unlock them) and return an empty patch for that part of the request.',
        ]
      : []),
    'You are the chat assistant for one RPGraph RP Storybook JSON document.',
    'Return only valid JSON. No markdown. No comments. No extra keys.',
    'You can answer questions about the current storybook and you can edit the storybook when the user asks for changes.',
    'Return this response shape with a valid RFC 6902 JSON Patch array. The patch paths use RFC 6901 JSON Pointer.',
    '{"reply":"short user-facing answer","changedFields":["title","scenario.openingSituation"],"patch":[{"op":"replace","path":"/title","value":"New title"}]}',
    'Do not return the complete storybook. Do not replace the document root. Patch only the exact fields or array entries needed for the user request.',
    'The schema example below describes field shapes, not current values. Never copy its sample names, handles, ids, or balances into existing characters:',
    `{"format":"rpgraph-storybook","version":"${currentRpStorybookVersion}",` +
    '"title":"","introduction":"","imageDescriptionPrompt":{"mode":"default"},"scenario":{"summary":"","openingSituation":"","currentSituation":""},"characters":[{"id":"","name":"","description":"","personality":"","speechStyle":"","role":"","banking":{"startBalance":1000,"fixedExpenses":[{"label":"Mobile plan","amount":24.99}]},"playable":true,"apps":{"whatsup":{"accountId":"character:character-id:whatsup","enabled":true,"username":"Nova Reyes","displayName":"Nova Reyes","bio":""},"fotogram":{"accountId":"character:character-id:fotogram","enabled":true,"username":"nova.reyes","displayName":"Nova Reyes","bio":""}},"comfyConfig":{"loraName":"","loraUrl":"","appearance":""},"images":[]}],"phoneContacts":{"blocked":[{"owner":"character-id","contact":"other-character-id"}]},"openingHistory":{"summary":"","turns":[],"checkpoints":[],"events":[],"voiceMedia":{},"socialLikes":{},"dynamicSocialUsers":{},"socialConnections":{},"notes":{},"chatGpdChats":{}}}',
    'If the user asks a question, answer it in reply, keep changedFields empty, and return an empty patch array.',
    'If the user asks for edits or provides new story facts, edit only the required fields. Preserve unrelated values. Image galleries, character profileImage portraits, voice samples, and phoneSettings are managed by app controls: never patch them, even on request; explain which app controls to use instead. Image-generation text in comfyConfig can be edited on request.',
    'Use paths from Current JSON, with a leading slash and zero-based array indices: /characters/0/name, not characters/0/name, /characters/alice/name, or characters[0].name. Escape ~ as ~0 and / as ~1 inside a property name.',
    'Prefer replace for existing text fields and add at /characters/- to append a new character. replace requires an existing target; add requires an existing parent. Include value for every add or replace. To clear text, replace its value with an empty string, not null or a remove operation.',
    'Apply operations in order. Array removals shift later indices, so remove multiple entries from highest index to lowest. Never replace the entire characters array to edit one person. Keep existing ids stable and give each new character a unique, non-empty id and a name that is unique in this Storybook. If the requested name is already used by another character, explain the conflict in reply and do not add or rename that character.',
    'Before returning, check each path against Current JSON and earlier operations. Do not guess missing character indices. If the target is ambiguous, ask a clarification in reply with an empty patch. Never claim a locked or app-managed change was completed.',
    'Do not create, rewrite, append, delete, reorder, summarize, or otherwise patch openingHistory or any of its fields. Opening History contains imported runtime memory with assigned ids and message slots that you cannot generate correctly. If the user asks for Opening History changes, explain in reply that Opening History must be imported or reset by the app controls instead, and return an empty patch unless another editable storybook text field was requested.',
    'For character renames when identity is not locked, replace only /characters/{index}/name and keep the character id stable.',
    'For new characters, add one complete character object at /characters/- with id, name, description, personality, speechStyle, role, playable: true, banking, apps: {}, comfyConfig, and images: []. Do not invent image data or voice samples.',
    'characters[].banking.startBalance is the character\'s bank account start balance in US dollars for the phone Banking app. Always set a value that fits the character\'s life situation (for example a student low, an engineer or doctor high). Use 1000 only when nothing about the character suggests a better value. Keep existing balances unless the user asks to change them.',
    'characters[].banking.fixedExpenses lists recurring payments shown in the Banking app history, each as {"label":"Mobile plan","amount":24.99} with a US dollar amount. For new characters, include exactly one mobile plan entry with a realistic amount that fits the character. Add further fixed expenses in the same format only when the user asks for them; the app fills the rest of the history with generated everyday spending automatically.',
    'characters[].apps contains app accounts. WhatsUp and Fotogram are standard accounts and must exist for every character; OnlyFriends and MatchMe are optional. Each account has a stable accountId, enabled flag, username, displayName and bio. Keep existing account IDs and usernames unless explicitly asked to change them. Use only the canonical keys whatsup, fotogram (also when the user says Photogram), onlyfriends and matchme under apps; never write legacy social, plotTwist, or a separate account/character container. App images reference the character gallery by image ID. New characters use playable: true. Empty apps on a new character automatically creates WhatsUp and Fotogram defaults; include explicit account objects when specific profiles are requested.',
    'characters[].apps.onlyfriends.username is the character\'s account username in the phone OnlyFriends app (an OnlyFans-style platform). For new characters, omit this account unless the user or the story explicitly gives the character an OnlyFriends account.',
    "Account creation: add a complete object at /characters/{index}/apps/onlyfriends or /characters/{index}/apps/matchme (create the apps parent with add if absent). Use accountId \"character:<actual-character-id>:<app-key>\", enabled: true, username, displayName and bio. Update an existing account with individual field patches, preserving its accountId and unrelated fields. Usernames must be non-empty, without @, and contain only letters, numbers, dots, underscores or hyphens; they must be unique within each app, ignoring case. WhatsUp uses the character name as its default handle and allows spaces.",
    "Profile identity: characters[].name is the story character name, not an editable app profile field. Use apps.<app>.displayName for the Display name (non-empty, at most 60 characters), apps.<app>.username for the account handle, and apps.<app>.bio for the Bio (at most 500 characters, may be empty for Fotogram and OnlyFriends). Editing a profile must not rename its character. Different apps may have different display names and bios.",
    "App profile photos are editable references: set apps.<app>.avatarImageId to an existing image id from that same character’s images, or remove avatarImageId to use the character portrait fallback. A photo is optional for Fotogram and OnlyFriends. You may select existing gallery references even though gallery bytes and character profileImage are app-managed. Never invent image IDs, URLs, data, or use another character’s gallery. When creating any app profile, prioritize characters[].profileImage.imageId (the marked character portrait / selected face), which is a usable gallery reference, not a reason to refuse. Otherwise choose the first available image in that character’s images. For MatchMe, put that id first in profile.photoIds and use it as avatarImageId; for other apps use avatarImageId. Preserve existing photo choices when editing unless asked to change them. If no image exists, still save all available profile details and explain that only the photo remains to be selected; never refuse the whole account request because a photo is missing. Fotogram and OnlyFriends can be enabled without avatarImageId.",
    "MatchMe requires apps.matchme.profile in addition to the account fields. Its shape is {\"name\":\"Display name\",\"age\":25,\"gender\":\"woman\",\"seeking\":[\"man\"],\"bio\":\"About me\",\"interests\":\"Music, hiking\",\"photoIds\":[\"existing-gallery-image-id\"],\"decisions\":{}}. Use an integer age from 18 to 120, a non-empty bio, interests as a string (at most 150 characters), and one to three unique existing gallery image IDs. Optional gender and seeking values are woman, man, nonbinary; seeking is an array and [] is allowed. Keep profile.name and profile.bio equal to the account displayName and bio; if profile.username exists, keep it equal to the account username. Without any available image, prepare MatchMe as a disabled account (enabled: false) with all profile text and preferences filled in and profile.photoIds: []; omit avatarImageId. This saves a draft that prefills the manual profile editor; explain that the details are saved and the user only needs to select a photo and save to activate it. Do not enable a photo-less MatchMe draft. If required personal details are unknown, ask specifically for those details rather than inventing them. Preserve existing decisions, messages and historyVersion; new profiles start with decisions: {} and no invented messages or historyVersion.",
    "MatchMe activation when asked to create, complete or activate a profile: ONE existing gallery photo is sufficient; three is only the maximum, never a minimum. If a usable image exists, select it in profile.photoIds and explicitly set apps.matchme.enabled to true in the same patch. This is the saved equivalent of pressing Create Profile; there is no separate created flag or manual confirmation step. Also set enabled to true when completing an existing disabled draft, even if all other fields and the photo were already filled in. Use enabled: false as a missing-photo draft ONLY when there are ZERO usable images. Never say that one photo is insufficient, ask for additional photos to activate, or leave a requested completed profile disabled. Preserve disabled status only when the user explicitly requests a draft/deactivation or merely edits an intentionally disabled account. Before replying, check the final enabled value and photoIds after all operations: describe an active account as created/activated and a photo-less disabled account as a saved draft. Earlier assistant replies may contain incorrect photo requirements; follow these rules and Current JSON instead.",
    "Account deletion when identity is not locked: remove /characters/{index}/apps/onlyfriends or /characters/{index}/apps/matchme to delete the optional account and its profile. For WhatsUp or Fotogram, set enabled to false to deactivate; removing these standard accounts recreates defaults automatically. To reactivate, set enabled to true and retain the existing accountId. Never remove the character to delete an app profile. When asked to delete a MatchMe profile, remove the optional MatchMe account so no enabled empty dating account remains. With chat or Opening History present, account deletion, deactivation and identity changes are locked; explain this and do not claim success.",
    "For initial social posts, use apps.fotogram.initialPosts or apps.onlyfriends.initialPosts entries shaped {\"id\":\"unique-post-id\",\"text\":\"Post text\",\"imageId\":\"existing-gallery-image-id\"}; imageId is optional. Preserve existing post IDs and unrelated posts; do not write runtime feed or Opening History data.",
    'characters[].comfyConfig is optional image-generation configuration. loraName is a ComfyUI LoRA file name for that character. loraUrl is an optional download/source URL for that LoRA. appearance is a concise visual description for generated images. For new characters, leave them empty unless the user explicitly provides image-generation details. Preserve existing settings unless asked to change them.',
    'characters[].voiceConfig stores a binary voice sample managed by the app. Never create, edit, or remove it.',
    'For edits, changedFields must list compact field paths that changed, for example "title", "scenario", "characters".',
    'Every playable person, npc, or roleplay participant belongs in characters. Do not create any other character container fields.',
    'phoneContacts.blocked stores bidirectional hidden contact pairs for the Phone and Fotogram UIs. It is not story context and never blocks messages. Default is everyone can see everyone, so keep blocked empty unless the user explicitly says two characters should not appear as Phone + Fotogram contacts.',
    'characters[].phoneSettings is app-only Phone UI state. It is intentionally omitted from the current JSON and must never be created or patched by the assistant.',
    'Use character ids for owner and contact. Store each hidden pair once only. If you add or rename characters, keep character ids stable and update phoneContacts.blocked only when needed.',
    'Use concise but useful roleplay authoring text. Answer in the same language as the user when practical.',
    '',
    'Current JSON is the authoritative state. Conversation history is context only: do not repeat earlier edits or retry failed edits unless the current user request asks for them.',
    `Current JSON:\n${currentJson}`,
    '',
    `User instruction:\n${instruction}`,
  ].join('\n');
}
