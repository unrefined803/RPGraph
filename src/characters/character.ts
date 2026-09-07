import { normalizeDatingProfile, type DatingProfile } from '../chat/datingProfile';
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
  accountId: string;
  enabled: boolean;
  username: string;
  displayName: string;
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

/** The same character payload is used inside Storybooks and portable containers. */
export type Character = {
  id: string;
  name: string;
  description: string;
  personality: string;
  speechStyle: string;
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

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';
export function normalizeCharacterApps(value: unknown, legacy: unknown, id: string, name: string): CharacterApps {
  const source = record(value);
  const social = record(legacy);
  const apps: CharacterApps = {};
  for (const app of ['whatsup', 'fotogram', 'onlyfriends', 'matchme'] as const) {
    const account = record(source[app]);
    const legacyHandle = app === 'fotogram' ? social.fotogramUsername : app === 'onlyfriends' ? social.onlyfriendsUsername : undefined;
    const rawProfile = app === 'matchme' ? record(account.profile ?? social.plotTwist) : {};
    const profile = app === 'matchme' ? normalizeDatingProfile({ ...rawProfile,
      ...(typeof account.displayName === 'string' ? { name: account.displayName } : {}),
      ...(typeof account.bio === 'string' ? { bio: account.bio } : {}),
      ...(typeof account.username === 'string' ? { username: account.username } : {}),
    }) : undefined;
    if (!Object.keys(account).length && !legacyHandle && !profile) continue;
    const username = Object.keys(account).length ? string(account.username) : string(legacyHandle);
    apps[app] = {
      accountId: string(account.accountId) || `character:${id}:${app}`,
      enabled: typeof account.enabled === 'boolean' ? account.enabled : app === 'matchme' ? !!profile : !!username,
      username,
      displayName: string(account.displayName) || profile?.name || name,
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
      username: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'character'}.${id.replace(/[^a-zA-Z0-9]/g, '')}`,
      displayName: name, bio: '' };
  }
  return apps;
}

export function socialFromCharacterApps(apps: CharacterApps): RpStorybookCharacterSocial {
  return {
    fotogramUsername: apps.fotogram?.enabled ? apps.fotogram.username : '',
    onlyfriendsUsername: apps.onlyfriends?.enabled ? apps.onlyfriends.username : '',
    ...(apps.matchme?.enabled && apps.matchme.profile ? { plotTwist: apps.matchme.profile } : {}),
  };
}

/** Materialize one canonical payload, retaining gallery bytes only in images. */
export function characterPayload(character: Omit<Character, 'profileImage'> & {
  profileImage?: Pick<RpStorybookCharacterProfileImage, 'imageId' | 'crop'>;
}, portable = false) {
  const { social, profileImage, ...rest } = character;
  const apps = normalizeCharacterApps(character.apps, social, character.id, character.name);
  if (portable && apps.matchme?.profile) {
    const { messages: _messages, decisions: _decisions, historyVersion: _historyVersion, ...profile } = apps.matchme.profile;
    apps.matchme = { ...apps.matchme, profile: { ...profile, decisions: {} } };
  }
  return { ...rest,
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
