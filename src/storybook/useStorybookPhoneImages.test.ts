import { expect, it, vi } from 'vitest';
import { useStorybookPhoneImages } from './useStorybookPhoneImages';
import { storyCharactersFromNodes } from './runtime';
import { emptyRpStorybook, normalizeRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { candidateStorybookRegistry, storybookRegistryEntries } from '../characters/npcParticipantRuntime';
import { buildCharacterRegistry, type CharacterRegistryEntry } from '../characters/registry';
import fixture from '../characters/fixtures/stage4-npc.json';
import type { WorkflowNode } from '../types';

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: <T,>(compute: () => T) => compute(),
  useRef: <T,>(current: T) => ({ current }),
  useEffect: () => {},
}));

function harness() {
  const book = normalizeRpStorybook({ ...emptyRpStorybook, characters: [structuredClone(fixture.character)] });
  const nodesRef = { current: [{ id: 'book', data: { nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText(book) } } as WorkflowNode] };
  const library: CharacterRegistryEntry[] = [];
  const updateRuntimeNode = vi.fn();
  const options = {
    nodesRef, storybooksByNodeId: new Map([['book', book]]), storyCharacters: storyCharactersFromNodes(nodesRef.current),
    messages: [], messagesRef: { current: [] }, dynamicSocialUsers: {}, currentTurnInputMessages: () => [],
    currentCharacterRegistry: () => buildCharacterRegistry([...library, ...storybookRegistryEntries(nodesRef.current)]),
    characterRegistryForStorybook: (nodeId, characters) => candidateStorybookRegistry(
      [...library, ...storybookRegistryEntries(nodesRef.current)], {}, nodeId, characters),
    updateRuntimeNode, updateMessage: vi.fn(), updatePhoneImageDescriptions: vi.fn(), notifySystem: vi.fn(),
  } satisfies Parameters<typeof useStorybookPhoneImages>[0];
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const api = useStorybookPhoneImages(options);
  return { api, library, updateRuntimeNode, owner: options.storyCharacters[0], book, options };
}

it.each(['fotogram', 'matchme'] as const)('rejects a phone %s username taken by a library NPC', (app) => {
  const { api, library, owner, updateRuntimeNode, book } = harness();
  const npc = structuredClone(book.characters[0]);
  npc.id = 'library-npc';
  for (const [kind, account] of Object.entries(npc.apps!)) {
    account.accountId = `library-${kind}`;
    account.username = `library.${kind}`;
  }
  library.push({ character: npc, tier: 'user', source: 'npc.json' });
  const username = npc.apps![app]!.username;
  const saved = app === 'fotogram' ? api.saveSocialUsername(owner, app, username) :
    api.saveDatingProfile(owner, { ...book.characters[0].apps!.matchme!.profile!, username });
  expect(saved).toBe(false);
  expect(updateRuntimeNode).not.toHaveBeenCalled();
});

it('allows a Storybook profile to override the same library character', () => {
  const { api, library, owner, book, updateRuntimeNode } = harness();
  library.push({ character: structuredClone(book.characters[0]), tier: 'user', source: 'npc.json' });
  expect(api.saveSocialUsername(owner, 'fotogram', 'updated.profile')).toBe(true);
  expect(updateRuntimeNode).toHaveBeenCalledOnce();
});

it('reports an invalid profile avatar without throwing or mutating the Storybook', () => {
  const { api, owner, updateRuntimeNode, options } = harness();
  expect(api.saveSocialUsername(owner, 'fotogram', 'updated.profile', {
    ...owner.apps!.fotogram!, avatarImageId: 'missing-image',
  })).toBe(false);
  expect(options.notifySystem).toHaveBeenCalledWith('warning', expect.stringContaining('gallery'));
  expect(updateRuntimeNode).not.toHaveBeenCalled();
});
