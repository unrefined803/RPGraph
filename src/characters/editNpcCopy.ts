import { characterPayload, validateCharacterPayload, type Character } from './character';
import { npcSnapshotEntries, parseNpcParticipantSnapshots, type NpcParticipantSnapshots } from './npcParticipants';
import { buildCharacterRegistry, type EffectiveCharacterRegistry } from './registry';
import { validateCandidateCharacterRegistry } from './profiles';
import { validateRelationshipTargets } from './relationships';
import { validateCandidateLegacySeedTimeline } from './publications';
import { appCharactersFromRegistry } from './appRuntime';
import { emptyRpStorybook, normalizeRpStorybookCharacter, parseRpStorybookJson, rpStorybookIdentityLockViolations, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { isStorybookSourceNode } from '../storybook/runtime';
import { openingHistoryNpcParticipantsFromNodes } from './npcParticipantRuntime';
import type { MessageRecord, WorkflowNode } from '../types';

/** Explicit RP authoring: preserve identities and update portable copies together. */
export function planNpcCopyEdit(nodes: WorkflowNode[], snapshots: NpcParticipantSnapshots,
  registry: EffectiveCharacterRegistry, expected: NpcParticipantSnapshots[string], draft: Character, messages: MessageRecord[]) {
  const id = expected.character.id;
  if (snapshots[id] !== expected || registry.characters.find((entry) => entry.character.id === id)?.provenance.tier !== 'snapshot') {
    throw new Error('The active RP copy changed. Reopen the character before applying edits.');
  }
  if (draft.id !== id) throw new Error('The RP character ID cannot be changed.');
  const character = { ...structuredClone(draft), playable: false };
  validateCharacterPayload(characterPayload(character));
  const previous = expected.character;
  const violations = rpStorybookIdentityLockViolations(
    { ...emptyRpStorybook, characters: [normalizeRpStorybookCharacter(previous, 0, new Set())] },
    { ...emptyRpStorybook, characters: [normalizeRpStorybookCharacter(character, 0, new Set())] });
  if (violations.length) throw new Error(violations.join(' '));
  // Pinned galleries can be referenced by older checkpoints as well as live messages.
  for (const image of previous.images) {
    const next = character.images.find((entry) => entry.id === image.id);
    if (!next || next.dataUrl !== image.dataUrl) throw new Error('Existing RP images must be retained unchanged. Add a new image instead.');
  }
  for (const [app, account] of Object.entries(previous.apps ?? {})) {
    const next = character.apps?.[app as keyof NonNullable<Character['apps']>];
    if (account.initialPosts?.some((post) => !next?.initialPosts?.some((entry) => entry.id === post.id))) {
      throw new Error('Existing RP initial post IDs must be retained.');
    }
  }
  validateRelationshipTargets([character], [previous], registry.characters.map((entry) => entry.character));
  const participants = parseNpcParticipantSnapshots({ ...snapshots, [id]: { ...expected, character } });
  const rebuilt = buildCharacterRegistry([
    ...registry.characters.filter((entry) => entry.character.id !== id).map((entry) => ({
      character: entry.character, tier: entry.provenance.tier, source: entry.provenance.source, aliases: entry.aliases,
    })), ...npcSnapshotEntries({ [id]: participants[id] }),
  ]);
  // The effective registry has already resolved lower-tier NPC origins. Keep
  // those projection keys when validating unrelated promoted characters too.
  const candidate = { ...rebuilt, characters: rebuilt.characters.map((entry) => ({ ...entry,
    npcOrigin: registry.characters.find((current) => current.character.id === entry.character.id)?.npcOrigin ?? entry.npcOrigin,
  })) };
  const warnings = validateCandidateCharacterRegistry(registry, candidate);
  validateCandidateLegacySeedTimeline(appCharactersFromRegistry(registry), appCharactersFromRegistry(candidate), messages);
  const nextNodes = nodes.map((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson) return node;
    const book = parseRpStorybookJson(node.data.storybookJson);
    if (!book.openingHistory.npcParticipants?.[id]) return node;
    return { ...node, data: { ...node.data, storybookJson: rpStorybookJsonText({ ...book,
      openingHistory: { ...book.openingHistory, npcParticipants: { ...book.openingHistory.npcParticipants, [id]: participants[id] } },
    }) } };
  });
  openingHistoryNpcParticipantsFromNodes(nextNodes);
  return { nodes: nextNodes, participants, warnings };
}
