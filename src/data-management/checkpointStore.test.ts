import { describe, expect, it } from 'vitest';
import { customNodeDefinition, defaultCustomNodeDefinition } from '../nodes/custom-node/model';
import type { TurnRecord, WorkflowNode } from '../types';
import {
  applyTurnCheckpointToNodes,
  createTurnCheckpointFromNodesForTurnRecord,
} from './checkpointStore';

const turn = { id: 'turn', number: 1, input: { messages: [] }, output: { messages: [] } } as unknown as TurnRecord;
function compressionNode(compressedText?: string): WorkflowNode {
  return {
    id: 'compression', type: 'workflow', position: { x: 0, y: 0 },
    data: { nodeType: 'context-compression', label: 'Compression', compressedText },
  } as WorkflowNode;
}

describe('persisted checkpoints', () => {
  it.each([false, true])('restores absent fields and supports redo after JSON round-trip: %s', (roundTrip) => {
    const before = compressionNode();
    const after = compressionNode('Summary');
    const checkpoint = createTurnCheckpointFromNodesForTurnRecord(turn, [before], [after]);
    const stored = roundTrip ? JSON.parse(JSON.stringify(checkpoint)) : checkpoint;
    const undone = applyTurnCheckpointToNodes([after], stored, 'before');
    expect(undone[0].data.compressedText).toBeUndefined();
    expect(applyTurnCheckpointToNodes(undone, stored, 'after')[0].data.compressedText).toBe('Summary');
  });

  it('persists fields cleared by the run itself', () => {
    const before = compressionNode('Summary');
    const after = compressionNode();
    const stored = JSON.parse(JSON.stringify(createTurnCheckpointFromNodesForTurnRecord(turn, [before], [after])));
    expect(applyTurnCheckpointToNodes([before], stored, 'after')[0].data.compressedText).toBeUndefined();
    expect(applyTurnCheckpointToNodes([after], stored, 'before')[0].data.compressedText).toBe('Summary');
  });

  it('recovers absent fields from legacy JSON checkpoints', () => {
    const after = compressionNode('Summary');
    const checkpoint = { turnId: 'turn', createdTimelineEntryIds: [], nodeSnapshots: { compression: { before: {}, after: { compressedText: 'Summary' } } } };
    expect(applyTurnCheckpointToNodes([after], checkpoint, 'before')[0].data.compressedText).toBeUndefined();
  });
});


it('restores custom state through persisted undo and redo while preserving authored edits', () => {
  const before = compressionNode();
  before.data = { nodeType: 'custom', label: 'Counter', description: '', preview: '', customNodeDefinition: { ...defaultCustomNodeDefinition(), state: { count: 0, nested: { value: 'before' } } } };
  const after = structuredClone(before);
  customNodeDefinition(after.data.customNodeDefinition).state = { count: 1, nested: { value: 'after' } };
  const stored = JSON.parse(JSON.stringify(createTurnCheckpointFromNodesForTurnRecord(turn, [before], [after])));
  customNodeDefinition(after.data.customNodeDefinition).code = 'return { outputs: {} };';
  const undone = applyTurnCheckpointToNodes([after], stored, 'before');
  expect(customNodeDefinition(undone[0].data.customNodeDefinition).state).toEqual(customNodeDefinition(before.data.customNodeDefinition).state);
  expect(customNodeDefinition(undone[0].data.customNodeDefinition).code).toBe(customNodeDefinition(after.data.customNodeDefinition).code);
  const redone = applyTurnCheckpointToNodes(undone, stored, 'after');
  expect(customNodeDefinition(redone[0].data.customNodeDefinition).state).toEqual(customNodeDefinition(after.data.customNodeDefinition).state);
  customNodeDefinition(undone[0].data.customNodeDefinition).state.count = 99;
  expect(customNodeDefinition(applyTurnCheckpointToNodes([after], stored, 'before')[0].data.customNodeDefinition).state.count).toBe(0);
});
