import { describe, expect, it } from 'vitest';
import { applyTurnCheckpointToNodes, createTurnCheckpointFromNodesForTurnRecord } from './checkpointStore';
import type { TurnRecord, WorkflowNode } from '../types';

const turn = { id: 'turn', input: { messages: [] }, output: { messages: [] } } as unknown as TurnRecord;
const character = { id: 'ari', name: 'Ari', playable: true, images: [{ id: 'portrait' }], apps: { fotogram: { accountId: 'ari-fg' } } };
const node = (book: unknown, nodeType: string): WorkflowNode => ({ id: 'book', data: { nodeType, storybookJson: JSON.stringify(book) } }) as WorkflowNode;

describe.each(['rp-storybook', 'rp-storybook-editor'])('%s authoring and checkpoint ownership', (nodeType) => {
  const before = { title: 'Before', characters: [character], openingHistory: {} };
  const after = { ...before, title: 'After', characters: [{ ...character, images: [...character.images, { id: 'generated' }] }] };
  const checkpoint = JSON.parse(JSON.stringify(createTurnCheckpointFromNodesForTurnRecord(turn,
    [node(before, nodeType)], [node(after, nodeType)])));
  const apply = (book: unknown, target: 'before' | 'after' = 'before') => JSON.parse(
    applyTurnCheckpointToNodes([node(book, nodeType)], checkpoint, target)[0].data.storybookJson!);

  it('reverts turn-owned changes and reapplies them after persistence', () => {
    expect(apply(after)).toEqual(before);
    expect(apply(before, 'after')).toEqual(after);
  });

  it.each(['delete', 'retire'])('does not resurrect a character after manual %s', (mode) => {
    const live = { ...after, characters: [], openingHistory: mode === 'retire'
      ? { npcParticipants: { ari: { character: after.characters[0] } } } : {} };
    const undone = apply(live);
    expect(undone).toEqual({ ...live, title: 'Before' });
    expect(apply(undone, 'after')).toEqual(live);
  });

  it('preserves edits, stable identities, relationships, media and new imports', () => {
    const edited = { ...after.characters[0], name: 'Manual name', relationships: [{ characterId: 'new' }] };
    const live = { ...after, characters: [{ ...character, id: 'new' }, edited] };
    expect(apply(live)).toEqual({ ...live, title: 'Before' });
  });

  it('leaves manually deleted unchanged characters absent', () => {
    const onlyTitle = { ...before, title: 'After' };
    const stored = createTurnCheckpointFromNodesForTurnRecord(turn, [node(before, nodeType)], [node(onlyTitle, nodeType)]);
    const undone = applyTurnCheckpointToNodes([node({ ...onlyTitle, characters: [] }, nodeType)], stored, 'before');
    expect(JSON.parse(undone[0].data.storybookJson!).characters).toEqual([]);
  });

  it('keeps manual edits to the same top-level field and invalid current JSON', () => {
    expect(apply({ ...after, title: 'Manual title' }).title).toBe('Manual title');
    const invalid = node(after, nodeType); invalid.data.storybookJson = '{ editing';
    expect(applyTurnCheckpointToNodes([invalid], checkpoint, 'before')[0].data.storybookJson).toBe('{ editing');
  });
});
