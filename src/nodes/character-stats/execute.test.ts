import { expect, it, vi } from 'vitest';
import { NodeLlmApi } from '../../llm/NodeLlmApi';
import { normalizeRpStorybook, rpStorybookJsonText } from '../rp-storybook/model';
import { storyCharacterRefsFromNodes } from '../../storybook/runtime';
import type { WorkflowNode } from '../../types';
import { executeCharacterStatsNode } from './execute';

it('initializes from legacy TOON and patches persisted stats with keyed TOON', async () => {
  const book = {
    id: 'book', position: { x: 0, y: 0 },
    data: { nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText(
      normalizeRpStorybook({ characters: [{ id: 'alice', name: 'Alice' }] }),
    ) },
  } as WorkflowNode;
  const node = {
    id: 'stats', position: { x: 0, y: 0 },
    data: { nodeType: 'character-stats', characterStatDefinitions: [
      { id: 'mood', name: 'Mood', description: '', enabled: true },
    ] },
  } as WorkflowNode;
  const llm = new NodeLlmApi({ resolveConnection: vi.fn() });
  const complete = vi.spyOn(llm, 'complete');
  complete.mockResolvedValueOnce({ text: '```toon\naction: init\nbaselines:\n  Alice:\n    Mood: 60\ncharacters:\n  Alice:\n    Mood: 70\n```' } as Awaited<ReturnType<typeof llm.complete>>);
  const run = () => executeCharacterStatsNode({
    node, nodes: [book, node], initialContext: 'Alice feels happy.', lastMessage: 'Alice smiles.',
    historyMessages: [], llm,
    updateRuntimeNode: (_id, patch) => { Object.assign(node.data, patch); },
  });
  await run();
  const id = storyCharacterRefsFromNodes([book])[0].nodeId;
  expect(node.data.characterStatsState?.characters[id]).toEqual({ mood: 70 });
  expect(node.data.characterStatsBaselineState?.characters[id]).toEqual({ mood: 60 });
  node.data = JSON.parse(JSON.stringify(node.data));
  complete.mockResolvedValueOnce({ text: 'action: patch\ncharacterChanges[1:]{Mood}:\n  Alice: 5' } as Awaited<ReturnType<typeof llm.complete>>);
  await run();
  expect(node.data.characterStatsState?.characters[id]).toEqual({ mood: 75 });
  complete.mockResolvedValueOnce({ text: 'action: keep' } as Awaited<ReturnType<typeof llm.complete>>);
  await run();
  expect(node.data.characterStatsState?.characters[id]).toEqual({ mood: 75 });
});
