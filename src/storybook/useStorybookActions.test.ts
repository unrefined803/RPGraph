import { beforeEach, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import type { WorkflowNode } from '../types';
import { emptyRpStorybook, parseRpStorybookJson, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { useStorybookActions } from './useStorybookActions';
import { candidateStorybookRegistry, storybookRegistryEntries } from '../characters/npcParticipantRuntime';
import { buildCharacterRegistry, type CharacterRegistryEntry } from '../characters/registry';
import { npcSnapshotEntries, type NpcParticipantSnapshots } from '../characters/npcParticipants';
import type { MessageRecord } from '../types';
import fixture from '../characters/fixtures/stage4-npc.json';
import { normalizeRpStorybook } from '../nodes/rp-storybook/model';

// Exercise delayed model replies without launching a UI or provider.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.slots[index] = typeof update === 'function'
        ? (update as (current: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
}));

function harness() {
  type Options = Parameters<typeof useStorybookActions>[0];
  const nodesRef = { current: [{
    id: 'book', data: { nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText(emptyRpStorybook) },
  } as WorkflowNode] };
  let resolve!: (value: { text: string; connection: { label: string } }) => void;
  const complete = vi.fn(() => new Promise((done) => { resolve = done; }));
  const clearCurrentSession = vi.fn();
  const library: CharacterRegistryEntry[] = [];
  const snapshots: NpcParticipantSnapshots = {};
  const messages: MessageRecord[] = [];
  const options = {
    nodesRef, turnsRef: { current: [] }, turnCheckpointsRef: { current: [] },
    nodeLlm: { complete }, usedStorybookImageIds: new Set(),
    currentCharacterRegistry: () => buildCharacterRegistry([...library, ...storybookRegistryEntries(nodesRef.current),
      ...npcSnapshotEntries(snapshots)]),
    characterRegistryForStorybook: ((nodeId, characters, candidateOptions) => candidateStorybookRegistry(
      [...library, ...storybookRegistryEntries(nodesRef.current)], snapshots, nodeId, characters, candidateOptions)) as Options['characterRegistryForStorybook'],
    currentTimelineMessages: () => messages,
    clearCurrentSession,
    updateRuntimeNode: (id: string, patch: object) => {
      nodesRef.current = nodesRef.current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node);
    },
    errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    notifySystem: vi.fn(),
  } as unknown as Options;
  function render() {
    hooks.index = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStorybookActions(options);
  }
  render().openStorybookCreator('book');
  return {
    nodesRef, complete, clearCurrentSession, options, render, library, snapshots, messages,
    reply: () => resolve({ text: JSON.stringify({ reply: 'Updated.', patch: [{ op: 'replace', path: '/title', value: 'AI title' }] }), connection: { label: 'Test' } }),
  };
}

beforeEach(() => { hooks.slots = []; hooks.index = 0; });

it('preserves a manual update made while the assistant is working', async () => {
  const state = harness();
  const request = state.render().submitStorybookCreatorMessage('Change the title');
  state.render().updateStorybook('book', { ...emptyRpStorybook, title: 'Manual title' });
  state.reply();
  await request;
  expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).title).toBe('Manual title');
  expect(state.render().storybookCreatorMessages.slice(-1)[0]?.text).toContain('response was not applied');
});

it('applies an unchanged request and rejects duplicate submissions immediately', async () => {
  const state = harness();
  const api = state.render();
  const request = api.submitStorybookCreatorMessage('Change the title');
  await api.submitStorybookCreatorMessage('Duplicate');
  expect(state.complete).toHaveBeenCalledTimes(1);
  state.reply();
  await request;
  expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).title).toBe('AI title');
  expect(state.render().storybookCreatorSubmitting).toBe(false);
});

it('does not recreate a deleted node when an assistant response arrives', async () => {
  const state = harness();
  const request = state.render().submitStorybookCreatorMessage('Change the title');
  state.nodesRef.current = [];
  state.reply();
  await request;
  expect(state.nodesRef.current).toEqual([]);
  expect(state.render().storybookCreatorMessages.slice(-1)[0]?.text).toContain('response was not applied');
  expect(state.render().updateStorybook('book', emptyRpStorybook)).toBe(false);
});

it('updates a legacy Storybook only after the user confirms from its node', () => {
  const state = harness();
  const legacy = JSON.stringify({ ...emptyRpStorybook, version: '2.2.0', title: 'Old book' });
  state.nodesRef.current[0].data.storybookJson = legacy;
  const confirm = vi.fn(() => false);
  vi.stubGlobal('window', { rpgraph: { confirmV3Migration: confirm } });
  try {
    expect(state.render().ensureCurrentStorybook('book')).toBe(false);
    expect(state.nodesRef.current[0].data.storybookJson).toBe(legacy);
    confirm.mockReturnValue(true);
    expect(state.render().ensureCurrentStorybook('book')).toBe(true);
    expect(JSON.parse(state.nodesRef.current[0].data.storybookJson!).version).toBe('3.0.0');
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('0 character(s)'));
    state.render().ensureCurrentStorybook('book');
    expect(confirm).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});

it('validates a full replacement before clearing the current session', () => {
  const state = harness();
  state.options.characterRegistryForStorybook = () => ({ characters: [], diagnostics: [{
    code: 'duplicate-username', app: 'fotogram', identity: 'taken',
    characterIds: ['one', 'two'], sources: ['one.json', 'book'], message: 'Username conflict.',
  }] });
  expect(state.render().commitStorybookToNode('book', emptyRpStorybook, {}, { replaceExisting: true }))
    .toBe('Username conflict.');
  expect(state.clearCurrentSession).not.toHaveBeenCalled();
});

function reviewBook(id = 'player') {
  const character = structuredClone(fixture.character);
  character.id = id;
  for (const [app, account] of Object.entries(character.apps)) {
    account.accountId = `${id}-${app}`;
    account.username = `${id}.${app}`;
  }
  return normalizeRpStorybook({ ...emptyRpStorybook, characters: [character] });
}

it('checks real library identities during editor commits', () => {
  const state = harness();
  const npc = reviewBook('npc').characters[0];
  state.library.push({ character: npc, source: 'npc.json', tier: 'user' });
  const book = reviewBook();
  book.characters[0].apps!.fotogram!.username = npc.apps!.fotogram!.username;
  expect(state.render().commitStorybookToNode('book', book, {})).toContain('username');
  expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).characters).toEqual([]);
});

it('drops old snapshots and timeline collisions when replacing the entire session', () => {
  const state = harness();
  const book = reviewBook();
  const oldNpc = reviewBook('old-npc').characters[0];
  oldNpc.apps!.fotogram!.username = book.characters[0].apps!.fotogram!.username;
  state.snapshots[oldNpc.id] = { character: oldNpc, source: 'old.json' };
  state.messages.push({ id: 1, role: 'user', originalText: '', socialPost: {
    app: 'fotogram', postId: 'first-post', author: 'Old Author', authorHandle: 'old.author', caption: 'Old activity',
  } });
  expect(state.render().commitStorybookToNode('book', book, {}, { replaceExisting: true })).toBeNull();
  expect(state.clearCurrentSession).toHaveBeenCalledOnce();
});

it('checks incoming Opening History snapshots before replacing the session', () => {
  const state = harness();
  const book = reviewBook();
  const npc = reviewBook('incoming-npc').characters[0];
  npc.apps!.fotogram!.username = book.characters[0].apps!.fotogram!.username;
  book.openingHistory.npcParticipants = { [npc.id]: { character: npc, source: 'incoming.json' } };
  expect(state.render().commitStorybookToNode('book', book, {}, { replaceExisting: true })).toContain('username');
  expect(state.clearCurrentSession).not.toHaveBeenCalled();
});

it('rejects newly added Opening History collisions with existing starting posts', () => {
  const state = harness();
  const book = reviewBook();
  expect(state.render().commitStorybookToNode('book', book, {})).toBeNull();
  const incoming = structuredClone(book);
  incoming.openingHistory.turns = [{ id: 'opening', number: 1, mode: 'user', createdAt: '2026-09-08T00:00:00Z',
    input: { graphText: '', messages: [] }, output: { graphText: '', messages: [{ id: 1, role: 'output',
      originalText: '', socialPost: { app: 'fotogram', postId: 'first-post', author: 'Foreign', authorHandle: 'foreign', caption: '' } }] } }];
  expect(state.render().commitStorybookToNode('book', incoming, {})).toContain('timeline author');
});
