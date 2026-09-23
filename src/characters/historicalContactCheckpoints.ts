import type { MessageRecord, TurnRecord, WorkflowNode } from '../types';
import type { TurnCheckpoint } from '../data-management/types';
import { applyTurnCheckpointToNodes } from '../data-management/checkpointStore';
import type { StorybookCharacter } from '../storybook/runtime';
import { isStorybookSourceNode } from '../storybook/runtime';
import { parseRpStorybookJson, type RpStorybook } from '../nodes/rp-storybook/model';
import type { Character } from './character';
import { messageContactGrants, withMessageContacts } from './messageContacts';

/** Backfilled contacts need the same per-turn before/after states as live messages. */
export function historicalContactCheckpoints(beforeNodes: WorkflowNode[], afterNodes: WorkflowNode[],
  messages: MessageRecord[], turns: TurnRecord[], checkpoints: TurnCheckpoint[], characters: StorybookCharacter[]) {
  const grants = messageContactGrants(messages, characters).filter((grant) => beforeNodes.some((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson || node === afterNodes.find((entry) => entry.id === node.id)) return false;
    const owner = parseRpStorybookJson(node.data.storybookJson).characters.find((entry) => entry.id === grant.ownerId);
    return owner && !owner.relationships?.some((entry) => entry.characterId === grant.targetId && entry.apps[grant.app]);
  }));
  if (!grants.length) return { nodes: afterNodes, checkpoints };
  const key = (grant: typeof grants[number]) => JSON.stringify([grant.ownerId, grant.targetId, grant.app]);
  const allowed = new Set(grants.map(key));
  const owners = new Set(grants.map((grant) => grant.ownerId));
  const affectedNodes = new Set(beforeNodes.filter((node) => node !== afterNodes.find((entry) => entry.id === node.id)).map((node) => node.id));
  const oldByTurn = new Map(checkpoints.map((checkpoint) => [checkpoint.turnId, checkpoint]));
  const states = new Map<string, { before: WorkflowNode[]; after: WorkflowNode[] }>();
  let cursor = beforeNodes;
  for (const turn of [...turns].reverse()) {
    const checkpoint = oldByTurn.get(turn.id);
    const before = checkpoint ? applyTurnCheckpointToNodes(cursor, checkpoint, 'before') : cursor;
    states.set(turn.id, { before, after: cursor });
    cursor = before;
  }
  const inTurns = new Set(turns.flatMap((turn) => [...turn.input.messages, ...turn.output.messages].map((message) => message.id)));
  const seenMessages = messages.filter((message) => !inTurns.has(message.id));
  let acquired = messageContactGrants(seenMessages, characters).filter((grant) => allowed.has(key(grant)));
  const nextByTurn = new Map(oldByTurn);
  const augment = (json: string, additions: typeof grants) => {
    const book = JSON.parse(json) as { characters?: Character[] };
    if (!Array.isArray(book.characters)) return json;
    const next = book.characters.map((character) => withMessageContacts(character, additions));
    return next.every((character, index) => character === book.characters![index]) ? json : JSON.stringify({ ...book, characters: next });
  };
  const contactDocument = (node: WorkflowNode) => JSON.stringify({
    characters: (JSON.parse(node.data.storybookJson!) as { characters: Character[] }).characters.filter((character) => owners.has(character.id)),
  });
  for (const turn of turns) {
    const previous = acquired;
    seenMessages.push(...turn.input.messages, ...turn.output.messages);
    acquired = messageContactGrants(seenMessages, characters).filter((grant) => allowed.has(key(grant)));
    const original = oldByTurn.get(turn.id);
    let checkpoint = original ?? { turnId: turn.id, createdTimelineEntryIds: [], nodeSnapshots: {} };
    const state = states.get(turn.id)!;
    for (const node of state.after) {
      if (!affectedNodes.has(node.id) || !isStorybookSourceNode(node) || !node.data.storybookJson) continue;
      const before = state.before.find((entry) => entry.id === node.id);
      if (!before?.data.storybookJson) continue;
      const snapshot = original?.nodeSnapshots[node.id];
      // Respect checkpoints that explicitly remove a document.
      if (snapshot?.clearedFields?.before.includes('storybookJson') || snapshot?.clearedFields?.after.includes('storybookJson')) continue;
      const beforeJson = typeof snapshot?.before.storybookJson === 'string' ? snapshot.before.storybookJson : contactDocument(before);
      const afterJson = typeof snapshot?.after.storybookJson === 'string' ? snapshot.after.storybookJson : contactDocument(node);
      const nextBefore = augment(beforeJson, previous);
      const nextAfter = augment(afterJson, acquired);
      if (nextBefore === beforeJson && nextAfter === afterJson) continue;
      if (!snapshot?.before.storybookJson && !snapshot?.after.storybookJson && nextBefore === nextAfter) continue;
      checkpoint = { ...checkpoint, nodeSnapshots: { ...checkpoint.nodeSnapshots, [node.id]: {
        ...snapshot, before: { ...snapshot?.before, storybookJson: nextBefore }, after: { ...snapshot?.after, storybookJson: nextAfter },
      } } };
    }
    if (checkpoint !== original && Object.keys(checkpoint.nodeSnapshots).length) nextByTurn.set(turn.id, checkpoint);
  }
  const nextCheckpoints = [...nextByTurn.values()];
  // Keep Save Storybook portable too, without replaying Opening History or nesting new documents.
  const nodes = afterNodes.map((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson) return node;
    const book = JSON.parse(node.data.storybookJson) as RpStorybook;
    if (!book.openingHistory?.turns?.length) return node;
    const opening = new Map((book.openingHistory.checkpoints ?? []).map((checkpoint) => [checkpoint.turnId, checkpoint]));
    let changed = false;
    for (const turn of book.openingHistory.turns) {
      const runtimeId = `opening-history-${node.id}-${turn.id}`;
      const checkpoint = nextByTurn.get(runtimeId);
      if (!checkpoint || checkpoint === oldByTurn.get(runtimeId)) continue;
      opening.set(turn.id, { ...checkpoint, turnId: turn.id });
      changed = true;
    }
    return changed ? { ...node, data: { ...node.data, storybookJson: JSON.stringify({ ...book,
      openingHistory: { ...book.openingHistory, checkpoints: [...opening.values()] } }, null, 2) } } : node;
  });
  return { nodes, checkpoints: nextCheckpoints };
}
