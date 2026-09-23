import { automaticAccountLinkGrants, resolveMessageAccount, type AccountLinkApp } from '../chat/accountLinks';
import type { MessageRecord, WorkflowNode } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { isStorybookSourceNode } from '../storybook/runtime';
import { storybookNeedsUpdate } from '../nodes/rp-storybook/model';
import type { Character } from './character';
import { appCharactersFromRegistry } from './appRuntime';
import { buildCharacterRegistry, type CharacterRegistryEntry } from './registry';
import { captureNpcParticipants, npcReferencesFromMessages, npcSnapshotEntries, type NpcParticipantSnapshots } from './npcParticipants';

type ContactApp = Exclude<AccountLinkApp, 'banking'>;
type ContactGrant = { ownerId: string; targetId: string; app: ContactApp };

/** Reciprocal DMs connect their endpoints; a shared account belongs only to its recipient. */
export function messageContactGrants(messages: MessageRecord[], characters: StorybookCharacter[]): ContactGrant[] {
  const grants: ContactGrant[] = [];
  const directions = new Set<string>();
  const add = (ownerId: string, targetId: string, app: ContactApp) => {
    if (ownerId !== targetId && !grants.some((entry) => entry.ownerId === ownerId && entry.targetId === targetId && entry.app === app)) {
      grants.push({ ownerId, targetId, app });
    }
  };
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'output') continue;
    const dm = message.socialDirectMessage;
    if (!dm && !message.phoneMessage) continue;
    const app = dm?.app ?? 'whatsup';
    const sender = resolveMessageAccount(app, dm?.fromAccountId ?? message.phoneFromAccountId,
      dm?.fromHandle || dm?.from || message.phoneFrom, characters);
    const recipient = resolveMessageAccount(app, dm?.toAccountId ?? message.phoneToAccountId,
      dm?.toHandle || dm?.to || message.phoneTo, characters);
    if (!sender || !recipient || sender.characterId === recipient.characterId) continue;
    directions.add(JSON.stringify([app, sender.accountId, recipient.accountId]));
    if (!directions.has(JSON.stringify([app, recipient.accountId, sender.accountId]))) continue;
    add(sender.characterId, recipient.characterId, app);
    add(recipient.characterId, sender.characterId, app);
  }
  for (const { owner, link } of automaticAccountLinkGrants(messages, characters)) {
    if (link.app !== 'matchme' && link.app !== 'banking') add(owner.sourceId, link.characterId, link.app);
  }
  return grants;
}

export function withMessageContacts(character: Character, grants: ContactGrant[]): Character {
  let relationships = character.relationships;
  for (const grant of grants) {
    if (grant.ownerId !== character.id) continue;
    const previous = relationships?.find((entry) => entry.characterId === grant.targetId);
    if (previous?.apps[grant.app]) continue;
    const next = { characterId: grant.targetId, description: previous?.description ?? '',
      apps: { ...previous?.apps, [grant.app]: true } };
    relationships = previous ? relationships!.map((entry) => entry === previous ? next : entry) : [...relationships ?? [], next];
  }
  return relationships === character.relationships ? character : { ...character, relationships };
}

/** Add acquired contacts to RP-owned containers, never to the source Library files. */
export function acquireMessageContacts(nodes: WorkflowNode[], snapshots: NpcParticipantSnapshots,
  registryEntries: CharacterRegistryEntry[], messages: MessageRecord[]) {
  const registry = buildCharacterRegistry([...registryEntries, ...npcSnapshotEntries(snapshots)]);
  const grants = messageContactGrants(messages, appCharactersFromRegistry(registry));
  let participants = captureNpcParticipants(snapshots, registryEntries, [
    ...npcReferencesFromMessages(messages),
    ...grants.flatMap((grant) => [
      { kind: 'character' as const, id: grant.ownerId }, { kind: 'character' as const, id: grant.targetId },
    ]),
  ]);
  if (!grants.length) return { nodes, participants };
  const storybookIds = new Set(registry.characters.filter((entry) => entry.provenance.tier === 'storybook').map((entry) => entry.character.id));
  for (const [id, snapshot] of Object.entries(participants)) {
    if (storybookIds.has(id)) continue;
    const origins = [...snapshot.messageContacts ?? []];
    for (const grant of grants.filter((entry) => entry.ownerId === id)) {
      const relationship = snapshot.character.relationships?.find((entry) => entry.characterId === grant.targetId);
      if (relationship?.apps[grant.app] || origins.some((entry) => entry.characterId === grant.targetId && entry.app === grant.app)) continue;
      origins.push({ characterId: grant.targetId, app: grant.app, previous: relationship?.apps[grant.app], createdRelationship: !relationship });
    }
    const character = withMessageContacts(snapshot.character, grants);
    if (character !== snapshot.character) participants = { ...participants, [id]: { ...snapshot, character, messageContacts: origins } };
  }
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson || storybookNeedsUpdate(node.data.storybookJson)) return node;
    // Registry entries already contain the parsed authored characters. Inspect
    // relationships there before reading the image-bearing raw JSON again.
    // Keep raw parsing for actual writes so unrelated fields remain untouched.
    const needsWrite = registryEntries.some((entry) => entry.tier === 'storybook' && entry.source === node.id &&
      withMessageContacts(entry.character, grants) !== entry.character);
    if (!needsWrite) return node;
    const book = JSON.parse(node.data.storybookJson) as { characters: Character[] };
    const characters = book.characters.map((character) => withMessageContacts(character, grants));
    if (characters.every((character, index) => character === book.characters[index])) return node;
    changed = true;
    return { ...node, data: { ...node.data, storybookJson: JSON.stringify({ ...book, characters }, null, 2) } };
  });
  return { nodes: changed ? nextNodes : nodes, participants };
}

/** Retract only message-owned NPC app flags when an answer is removed or replaced. */
export function reconcileNpcMessageContacts(snapshots: NpcParticipantSnapshots, registryEntries: CharacterRegistryEntry[], messages: MessageRecord[]) {
  if (!Object.values(snapshots).some((snapshot) => snapshot.messageContacts?.length)) return snapshots;
  const registry = buildCharacterRegistry([...registryEntries, ...npcSnapshotEntries(snapshots)]);
  const grants = messageContactGrants(messages, appCharactersFromRegistry(registry));
  let next = snapshots;
  for (const [id, snapshot] of Object.entries(snapshots)) {
    if (!snapshot.messageContacts?.length || registry.characters.find((entry) => entry.character.id === id)?.provenance.tier === 'storybook') continue;
    let character = snapshot.character;
    for (const origin of snapshot.messageContacts) {
      const active = grants.some((grant) => grant.ownerId === id && grant.targetId === origin.characterId && grant.app === origin.app);
      if (active) {
        character = withMessageContacts(character, [{ ownerId: id, targetId: origin.characterId, app: origin.app }]);
        continue;
      }
      const relation = character.relationships?.find((entry) => entry.characterId === origin.characterId);
      if (!relation || relation.apps[origin.app] === origin.previous) continue;
      const apps = { ...relation.apps };
      if (origin.previous === undefined) delete apps[origin.app];
      else apps[origin.app] = origin.previous;
      character = { ...character, relationships: character.relationships!.map((entry) => entry === relation ? { ...relation, apps } : entry) };
    }
    const created = new Set(snapshot.messageContacts.filter((entry) => entry.createdRelationship).map((entry) => entry.characterId));
    const relationships = character.relationships?.filter((entry) => !created.has(entry.characterId) || entry.description.trim() || Object.values(entry.apps).some(Boolean));
    if (relationships?.length !== character.relationships?.length) character = { ...character, relationships };
    if (character !== snapshot.character) next = { ...next, [id]: { ...snapshot, character } };
  }
  return next;
}
