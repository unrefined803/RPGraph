import { validateCharacterPayload, type Character } from './character';
import {
  buildCharacterRegistry, registryAccounts,
  type CharacterApp, type CharacterRegistryAliases, type CharacterRegistryEntry,
  type EffectiveCharacter, type EffectiveCharacterRegistry,
} from './registry';
import type { MessageRecord } from '../types';

/** Immutable revision archive, scoped to one RP. Activity remains in its existing stores. */
export type NpcParticipantSnapshots = Record<string, {
  character: Character;
  source: string;
  aliases?: CharacterRegistryAliases;
}>;

export type NpcParticipantReference =
  | { kind: 'character'; id: string }
  | { kind: 'account'; app: CharacterApp; id: string; canonical?: boolean }
  | { kind: 'post'; app: CharacterApp; id: string; accountId?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isStrings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Missing fields in older saves mean an empty archive; malformed snapshots must not be dropped. */
export function parseNpcParticipantSnapshots(value: unknown): NpcParticipantSnapshots {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('Invalid saved NPC participant archive.');
  for (const [id, snapshot] of Object.entries(value)) {
    if (!isRecord(snapshot) || !isRecord(snapshot.character) || snapshot.character.id !== id ||
        typeof snapshot.source !== 'string') throw new Error('Invalid saved NPC participant identity.');
    validateCharacterPayload(snapshot.character);
    const aliases = snapshot.aliases;
    if (aliases !== undefined && (!isRecord(aliases) ||
        (aliases.characterIds !== undefined && !isStrings(aliases.characterIds)) ||
        (aliases.accountIds !== undefined && (!isRecord(aliases.accountIds) ||
          Object.entries(aliases.accountIds).some(([app, ids]) =>
            !['whatsup', 'fotogram', 'onlyfriends', 'matchme'].includes(app) || !isStrings(ids)))))) {
      throw new Error('Invalid saved NPC participant aliases.');
    }
  }
  return structuredClone(value) as NpcParticipantSnapshots;
}

export function npcSnapshotEntries(snapshots: NpcParticipantSnapshots): CharacterRegistryEntry[] {
  return Object.entries(snapshots).map(([id, snapshot]) => ({
    ...snapshot, tier: 'snapshot', source: `snapshot:${id}`,
  }));
}

/** Reversible owner-scoped seed key for persistent app actions; source seed IDs stay untouched. */
export function npcSeedPostKey(accountId: string, seedId: string) {
  return `npc-seed:${JSON.stringify([accountId, seedId])}`;
}

/** Recover the stable gallery owner for a seeded post's DM origin. */
export function npcSeedPostAccountId(postId: string) {
  if (!postId.startsWith('npc-seed:')) return undefined;
  try {
    const key: unknown = JSON.parse(postId.slice('npc-seed:'.length));
    return Array.isArray(key) && key.length === 2 && key.every((item) => typeof item === 'string') ? key[0] as string : undefined;
  } catch { return undefined; }
}

function referencedParticipant(registry: EffectiveCharacterRegistry, reference: NpcParticipantReference) {
  if (reference.kind === 'character') {
    // Never bind historical IDs through display-name fallback.
    const matches = registry.characters.filter((entry) => entry.character.id === reference.id ||
      entry.aliases.characterIds?.includes(reference.id));
    return matches.length === 1 ? matches[0] : undefined;
  }
  if (reference.kind === 'account') {
    const accounts = registryAccounts(registry, reference.app, { includeDisabled: true });
    const exact = accounts.filter((entry) => entry.account.accountId === reference.id);
    const aliases = accounts.filter((entry) => entry.character.aliases.accountIds?.[reference.app]?.includes(reference.id));
    const handle = reference.id.trim().replace(/^@/, '').toLowerCase();
    const matches = exact.length ? exact : aliases.length ? aliases : reference.canonical ? [] :
      accounts.filter((entry) => !!handle && entry.account.username.trim().replace(/^@/, '').toLowerCase() === handle);
    return matches.length === 1 ? matches[0].character : undefined;
  }
  let id = reference.id;
  let accountId = reference.accountId;
  if (id.startsWith('npc-seed:')) {
    try {
      const key: unknown = JSON.parse(id.slice('npc-seed:'.length));
      if (!Array.isArray(key) || key.length !== 2 || !key.every((item) => typeof item === 'string')) return;
      [accountId, id] = key;
    } catch { return; }
  }
  const matches = registryAccounts(registry, reference.app, { includeDisabled: true }).filter((entry) =>
    (!accountId || entry.account.accountId === accountId) && entry.account.initialPosts?.some((post) => post.id === id));
  // Old unscoped IDs are usable only if their owner is unique.
  return matches.length === 1 ? matches[0].character : undefined;
}

export function captureNpcParticipants(
  snapshots: NpcParticipantSnapshots,
  entries: CharacterRegistryEntry[],
  references: NpcParticipantReference[],
): NpcParticipantSnapshots {
  const registry = buildCharacterRegistry([...entries, ...npcSnapshotEntries(snapshots)]);
  const additions: Array<[string, NpcParticipantSnapshots[string]]> = [];
  const captured = new Set(Object.keys(snapshots));
  const capture = (entry: EffectiveCharacter | undefined) => {
    if (!entry || entry.provenance.tier === 'storybook' || captured.has(entry.character.id)) return;
    validateCharacterPayload(entry.character);
    captured.add(entry.character.id);
    additions.push([entry.character.id, structuredClone({ character: entry.character,
      source: entry.provenance.source, aliases: entry.aliases })]);
  };
  references.forEach((reference) => capture(referencedParticipant(registry, reference)));
  return additions.length ? { ...snapshots, ...Object.fromEntries(additions) } : snapshots;
}

/** Only structured activity can pin a participant. Free history text never creates identities. */
export function npcReferencesFromMessages(messages: MessageRecord[]): NpcParticipantReference[] {
  const references: NpcParticipantReference[] = [];
  const account = (app: CharacterApp, id: string | undefined, handle?: string) => {
    if (id || handle) references.push({ kind: 'account', app, id: (id || handle)!, canonical: !!id });
  };
  for (const message of messages) {
    message.matchMeMatch?.accountIds.forEach((id) => account('matchme', id));
    account('whatsup', message.phoneFromAccountId);
    account('whatsup', message.phoneToAccountId);
    const dm = message.socialDirectMessage;
    if (dm) {
      account(dm.app, dm.fromAccountId, dm.fromHandle);
      account(dm.app, dm.toAccountId, dm.toHandle);
      if (dm.origin) account(dm.app, undefined, dm.origin.postAuthorHandle);
    }
    const post = message.socialPost;
    if (post) account(post.app, post.authorAccountId, post.authorHandle);
    const thread = message.socialThreadAction;
    if (thread) {
      account(thread.app, undefined, thread.postAuthorHandle);
      account(thread.app, undefined, thread.actorHandle);
    }
    const reactions = message.socialReactions;
    if (reactions) {
      references.push({ kind: 'post', app: reactions.app, id: reactions.postId });
      reactions.comments.forEach((comment) => account(reactions.app, undefined, comment.handle));
    }
  }
  return references;
}
