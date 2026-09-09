import { beforeEach, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { useRoleplayPanelRuntime } from './useRoleplayPanelRuntime';
import { emptyRpStorybook, normalizeRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { storyCharactersFromNodes } from '../storybook/runtime';
import { narratorCharacterId } from './runOrchestration';
import type { WorkflowNode } from '../types';

// Exercise selection transitions without mounting components or launching the application.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.slots[index] = typeof update === 'function' ? (update as (current: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useMemo: <T,>(compute: () => T) => compute(),
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => {},
}));

beforeEach(() => { hooks.slots = []; hooks.index = 0; });

function harness() {
  const book = normalizeRpStorybook({ ...emptyRpStorybook, characters: [
    { id: 'npc', name: 'NPC', playable: false }, { id: 'player', name: 'Player', playable: true },
  ] });
  const nodes = [{ id: 'book', data: { nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText(book) } } as WorkflowNode];
  const cast = storyCharactersFromNodes(nodes);
  const options = { appCharacters: cast, nodeViewNodes: nodes, nodesRef: { current: nodes }, messages: [], turns: [],
    storybooksByNodeId: new Map([['book', book]]), characterStorybookNodeCount: 1,
    captureNpcParticipants: vi.fn(), notifySystem: vi.fn(), commitNodes: vi.fn(), isRunning: false,
  } as unknown as Parameters<typeof useRoleplayPanelRuntime>[0];
  const render = () => {
    hooks.index = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useRoleplayPanelRuntime(options);
  };
  return { render, npc: cast[0], player: cast[1] };
}

it('retains NPC participants but excludes them from initial, explicit and restored player selection', () => {
  const { render, npc, player } = harness();
  expect(render().storyCharacters).toHaveLength(2);
  expect(render().playerCharacters.map((character) => character.id)).toEqual([player.id]);
  expect(render().characterColors.has(player.name)).toBe(true);
  expect(render().characterColors.has(npc.name)).toBe(false);
  expect(render().selectedCharacter?.id).toBe(player.id);
  render().selectChatCharacter(npc.id);
  expect(render().selectedCharacter?.id).toBe(player.id);
  render().setSelectedCharacterId(npc.id);
  expect(render().selectedCharacter?.id).toBe(player.id);
});

it('opens an NPC conversation from the playable side and preserves narrator inspection', () => {
  const { render, npc, player } = harness();
  render().openPhoneConversation('npc-player', 1, { speakerId: npc.id, contactId: player.id, activatePlayer: true });
  expect(render().selectedCharacter?.id).toBe(player.id);
  expect(render().viewedPhoneCharacter?.id).toBe(player.id);
  expect(render().selectedPhoneContact?.character.id).toBe(npc.id);
  expect(render().selectedPhoneContact?.color).toBe('#e8edf3');
  render().selectChatCharacter(narratorCharacterId);
  render().openPhoneConversation('npc-player', 1, { speakerId: npc.id, contactId: player.id, activatePlayer: false });
  expect(render().narratorSelected).toBe(true);
  expect(render().viewedPhoneCharacter?.id).toBe(npc.id);
});

it('opens an NPC publication for narrator inspection without selecting the NPC as player', () => {
  const { render, npc } = harness();
  render().openSocialPost({ app: 'onlyfriends', postId: 'npc-post', author: npc.name,
    authorHandle: 'npc', caption: 'NPC publication' });
  expect(render().narratorSelected).toBe(true);
  expect(render().selectedCharacter).toBeUndefined();
  expect(render().viewedPhoneCharacter?.id).toBe(npc.id);
  expect(render().socialPostOpenRequest?.postId).toBe('npc-post');
});
