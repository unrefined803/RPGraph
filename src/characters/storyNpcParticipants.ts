import { storyNpcReferences } from '../../shared/storyNpcReferences.cjs';
import { resolveMessageAccount } from '../chat/accountLinks';
import { appCharactersFromRegistry } from './appRuntime';
import { buildCharacterRegistry, type CharacterRegistryEntry } from './registry';
import { captureNpcParticipants, npcSnapshotEntries, type NpcParticipantSnapshots } from './npcParticipants';
import type { MessageRecord } from '../types';
import { parseImportedNpcSnapshots, type ImportedNpcSnapshots } from './externalNpcs';

/** Story membership starts at first communication; Interacted remains a reciprocal-DM status. */
export function captureStoryNpcParticipants(snapshots: NpcParticipantSnapshots,
  entries: CharacterRegistryEntry[], messages: MessageRecord[]) {
  const characters = appCharactersFromRegistry(buildCharacterRegistry([...entries, ...npcSnapshotEntries(snapshots)]));
  const normalized = messages.map((message) => !message.phoneMessage ? message : { ...message,
    phoneFromAccountId: resolveMessageAccount('whatsup', message.phoneFromAccountId, message.phoneFrom, characters)?.accountId,
    phoneToAccountId: resolveMessageAccount('whatsup', message.phoneToAccountId, message.phoneTo, characters)?.accountId,
  });
  return captureNpcParticipants(snapshots, entries, storyNpcReferences(normalized));
}

/** Drop idle legacy imports while keeping the exact saved revision of communicating NPCs. */
export function migrateLegacyNpcImports(snapshots: NpcParticipantSnapshots, entries: CharacterRegistryEntry[],
  imports: ImportedNpcSnapshots | undefined, messages: MessageRecord[]) {
  const legacy = parseImportedNpcSnapshots(imports);
  const legacyEntries: CharacterRegistryEntry[] = Object.values(legacy).map((entry) => ({
    character: entry.character, source: entry.source, tier: 'saved-storybook',
  }));
  const current = entries.filter((entry) => entry.tier !== 'saved-storybook' || !legacy[entry.character.id]);
  return captureStoryNpcParticipants(snapshots, [...current, ...legacyEntries], messages);
}
