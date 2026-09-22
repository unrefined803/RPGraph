import { normalizeDatingProfile, type DatingProfile } from '../chat/datingProfile';
import { validateAccountAgency, validateCharacterAgency, type AgencyTagId, type AgencyAccountRole } from '../../shared/agency-tags.cjs';
import {
  validateCharacterContainer as validateSharedCharacterContainer,
  validateCharacterPayload as validateSharedCharacterPayload,
} from '../../shared/character-container.cjs';
import type {
  RpStorybookCharacterBanking, RpStorybookCharacterComfyConfig, RpStorybookCharacterImage,
  RpStorybookCharacterPhoneSettings, RpStorybookCharacterProfileImage, RpStorybookCharacterSocial,
  RpStorybookCharacterVoiceConfig,
} from '../nodes/rp-storybook/model';

export type CharacterAppAccount = {
  accountRole?: AgencyAccountRole;
  agencyTags?: AgencyTagId[];
  accountId: string;
  enabled: boolean;
  /** The only authored app name. WhatsUp has no profile name. */
  profileName?: string;
  /** Fotogram/OnlyFriends privacy mode; true hides real name and profile photo publicly. */
  privacyMode?: boolean;
  /** Historical handles retained for saved conversations and account links. */
  legacyHandles?: string[];
  /** Read-only legacy import fields; canonical serialization removes both. */
  username?: string;
  displayName?: string;
  bio: string;
  avatarImageId?: string;
  initialPosts?: Array<{ id: string; text: string; imageId?: string }>;
};
export type CharacterApps = {
  whatsup?: CharacterAppAccount;
  fotogram?: CharacterAppAccount;
  onlyfriends?: CharacterAppAccount;
  matchme?: CharacterAppAccount & { profile?: DatingProfile };
};

export type CharacterRelationship = {
  characterId: string;
  description: string;
  /** Directed contacts/follows; a MatchMe match is reciprocal. Missing apps mean false. */
  apps: Partial<Record<keyof CharacterApps, boolean>>;
};

/** The same character payload is used inside Storybooks and portable containers. */
export type Character = {
  id: string;
  name: string;
  description: string;
  personality: string;
  speechStyle: string;
  /** Author-only motivations; stored without activating runtime behavior. */
  hiddenAgency?: string;
  /** Authored behavior vocabulary; does not activate NPC actions. */
  agencyTags?: AgencyTagId[];
  relationships?: CharacterRelationship[];
  role: string;
  playable?: boolean;
  age?: number;
  gender?: 'woman' | 'man' | 'nonbinary';
  apps?: CharacterApps;
  images: RpStorybookCharacterImage[];
  profileImage?: RpStorybookCharacterProfileImage;
  phoneSettings?: RpStorybookCharacterPhoneSettings;
  banking?: RpStorybookCharacterBanking;
  comfyConfig?: RpStorybookCharacterComfyConfig;
  voiceConfig?: RpStorybookCharacterVoiceConfig;
  /** Runtime compatibility projection for existing app editors; not stored in V2. */
  social?: RpStorybookCharacterSocial;
};

/**
 * Old default display names yield to the authored username; customized display
 * names win. Once profileName exists it is authoritative, including empty drafts.
 */
export function migratedProfileName(account: CharacterAppAccount | Record<string, unknown>, characterName = '', fallback = '') {
  if (typeof account.profileName === 'string') return account.profileName.trim().replace(/^@/, '');
  const display = typeof account.displayName === 'string' ? account.displayName.trim() : '';
  const username = typeof account.username === 'string' ? account.username.trim() : '';
  return (display && display.toLowerCase() !== characterName.trim().toLowerCase()
    ? display : username || display || fallback || characterName).replace(/^@/, '');
}

/** Compatibility route for old saves; never display this value as the profile name. */
export function accountHandle(account: CharacterAppAccount | undefined) {
  return account?.legacyHandles?.[0] || account?.username || account?.profileName || '';
}

export function accountHandleMatches(account: CharacterAppAccount | undefined, value: string) {
  const key = value.trim().replace(/^@/, '').toLowerCase();
  return !!key && !!account && [account.profileName, account.username, account.displayName, ...(account.legacyHandles ?? [])]
    .some((alias) => alias?.trim().replace(/^@/, '').toLowerCase() === key);
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';
export function normalizeCharacterApps(value: unknown, legacy: unknown, id: string, name: string): CharacterApps {
  const source = record(value);
  const social = record(legacy);
  const apps: CharacterApps = {};
  for (const app of ['whatsup', 'fotogram', 'onlyfriends', 'matchme'] as const) {
    const account = record(source[app]);
    validateAccountAgency(app, account);
    const legacyHandle = app === 'fotogram' ? social.fotogramUsername : app === 'onlyfriends' ? social.onlyfriendsUsername : undefined;
    const rawProfile = app === 'matchme' ? record(account.profile ?? social.plotTwist) : {};
    const profileName = app === 'whatsup' ? undefined : app === 'matchme'
      ? (typeof account.profileName === 'string' ? account.profileName.trim()
        : string(account.displayName).trim() || string(rawProfile.name).trim() || name.trim())
      : migratedProfileName(account, name, string(rawProfile.name) || string(legacyHandle));
    const legacyHandles = [...new Set([
      ...(Array.isArray(account.legacyHandles) ? account.legacyHandles.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()) : []),
      string(account.username), string(account.displayName), string(legacyHandle),
      ...(app === 'matchme' ? [string(account.profileName), string(rawProfile.name), string(rawProfile.username)] : []),
      ...(app !== 'whatsup' && profileName ? [profileName] : []),
    ].filter(Boolean))];
    const profile = app === 'matchme' ? normalizeDatingProfile({ ...rawProfile,
      name: profileName, username: undefined,
      ...(typeof account.bio === 'string' ? { bio: account.bio } : {}),
    }, account.enabled === false) : undefined;
    if (!Object.keys(account).length && !legacyHandle && !profile) continue;
    apps[app] = {
      ...(account.accountRole !== undefined ? { accountRole: account.accountRole as AgencyAccountRole } : {}),
      ...(account.agencyTags !== undefined ? { agencyTags: [...account.agencyTags as AgencyTagId[]] } : {}),
      accountId: string(account.accountId) || `character:${id}:${app}`,
      enabled: typeof account.enabled === 'boolean' ? account.enabled : app === 'matchme' ? !!profile : app === 'whatsup' || !!profileName,
      ...(profileName !== undefined ? { profileName } : {}),
      ...((app === 'fotogram' || app === 'onlyfriends') && typeof account.privacyMode === 'boolean' ? { privacyMode: account.privacyMode } : {}),
      ...(legacyHandles.length ? { legacyHandles } : {}),
      bio: string(account.bio) || profile?.bio || '',
      ...(typeof account.avatarImageId === 'string' ? { avatarImageId: account.avatarImageId } : {}),
      ...(Array.isArray(account.initialPosts) ? { initialPosts: account.initialPosts.map((post) => {
        const entry = record(post);
        return { id: string(entry.id), text: string(entry.text), ...(typeof entry.imageId === 'string' ? { imageId: entry.imageId } : {}) };
      }) } : {}),
      ...(profile ? { profile } : {}),
    };
  }
  if (!apps.fotogram) {
    apps.fotogram = { accountId: `character:${id}:fotogram`, enabled: true,
      profileName: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'character'}.${id.replace(/[^a-zA-Z0-9]/g, '')}`,
      bio: '' };
  }
  if (!apps.whatsup) {
    apps.whatsup = { accountId: `character:${id}:whatsup`, enabled: true,
      bio: '' };
  }
  for (const account of Object.values(apps)) {
    if (account.profileName && !account.legacyHandles?.length) account.legacyHandles = [account.profileName];
  }
  return apps;
}

export function socialFromCharacterApps(apps: CharacterApps): RpStorybookCharacterSocial {
  return {
    fotogramUsername: apps.fotogram?.enabled ? accountHandle(apps.fotogram) : '',
    onlyfriendsUsername: apps.onlyfriends?.enabled ? accountHandle(apps.onlyfriends) : '',
    ...(apps.matchme?.enabled && apps.matchme.profile ? { plotTwist: apps.matchme.profile } : {}),
  };
}

/** Materialize one canonical payload, retaining gallery bytes only in images. */
export function characterPayload(character: Omit<Character, 'profileImage'> & {
  profileImage?: Pick<RpStorybookCharacterProfileImage, 'imageId' | 'crop'>;
}, portable = false) {
  const { social, profileImage, ...rest } = character;
  const apps = normalizeCharacterApps(character.apps, social, character.id, character.name);
  validateCharacterAgency({ ...character, apps });
  if (apps.matchme?.profile) {
    // DatingProfile.name is an editor/runtime projection, not a second stored app name.
    delete (apps.matchme.profile as Partial<DatingProfile>).name;
    delete apps.matchme.profile.username;
  }
  if (portable && apps.matchme?.profile) {
    const { messages: _messages, decisions: _decisions, historyVersion: _historyVersion, ...profile } = apps.matchme.profile;
    apps.matchme = { ...apps.matchme, profile: { ...profile, decisions: {} } };
  }
  return { ...rest, relationships: rest.relationships ?? [],
    ...(portable ? { images: rest.images.map(({ receivedFrom: _receivedFrom, imageAccess: _imageAccess, ...image }) => image) } : {}),
    playable: character.playable ?? true, apps,
    ...(profileImage ? { profileImage: { imageId: profileImage.imageId, crop: profileImage.crop } } : {}) };
}

/** Reject malformed fields and dangling image references through the shared boundary. */
export function validateCharacterPayload(value: unknown) {
  validateSharedCharacterPayload(value);
}

export function validateCharacterContainer(value: unknown) {
  validateSharedCharacterContainer(value);
}
