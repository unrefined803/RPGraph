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
import { useRuntimeNodePatching } from '../app/useRuntimeNodePatching';
import { openingHistoryTurnsFromNodes } from './openingHistoryRuntime';
import { appCharactersFromRegistry } from '../characters/appRuntime';
import { buildSocialDirectory } from '../chat/socialDirectory';
import { initialCharacterPosts } from '../characters/publications';
import { characterLibrarySummary } from '../characters/librarySummary';

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
    currentNpcParticipants: () => snapshots,
    restoreNpcParticipants: (next: NpcParticipantSnapshots) => {
      Object.keys(snapshots).forEach((id) => delete snapshots[id]); Object.assign(snapshots, next);
    },
    currentLibraryEntries: () => library.map((entry) => ({ ...entry, fileName: 'npc.json' })),
    currentSocialLikesByAccount: () => ({}), currentSocialConnectionsByCharacter: () => ({}),
    currentPhoneNotesByCharacter: () => ({}), currentChatGpdChatsByCharacter: () => ({}),
    clearCurrentSession,
    replaceCurrentChatWithOpeningHistoryRef: { current: false },
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
    rawReply: (text: string) => resolve({ text, connection: { label: 'Test' } }),
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

it.each(['rp-storybook', 'rp-storybook-editor'] as const)(
  'hydrates legacy history only after a confirmed upgrade in %s', (nodeType) => {
    const state = harness();
    state.nodesRef.current[0].data.nodeType = nodeType;
    const book = structuredClone(emptyRpStorybook);
    book.openingHistory.turns = [{
      id: 'opening', number: 1, createdAt: '2026-09-09T12:00:00Z',
      input: { graphText: '', messages: [] },
      output: { graphText: '', messages: [{ id: 1, role: 'output', originalText: 'Opening message' }] },
    }];
    const legacy = JSON.stringify({ ...book, version: '2.2.0', title: 'Old book' });
    state.nodesRef.current[0].data.storybookJson = legacy;
    const signature = (json?: string) => JSON.stringify(parseRpStorybookJson(json ?? '').openingHistory);
    const refresh = vi.fn((nodes: WorkflowNode[]) => {
      expect(state.options.replaceCurrentChatWithOpeningHistoryRef.current).toBe(false);
      state.messages.push(...openingHistoryTurnsFromNodes(nodes).flatMap((turn) => turn.output.messages));
    });
    state.options.updateRuntimeNode = useRuntimeNodePatching({
      nodesRef: state.nodesRef,
      commitNodes: (nodes) => { state.nodesRef.current = nodes; },
      activeRunRef: { current: null }, activeRunLlmReportRef: { current: null },
      setRunLlmReport: vi.fn(), openingHistorySignature: signature,
      onStorybookOpeningHistoryChanged: refresh,
      replaceCurrentChatWithOpeningHistoryRef: state.options.replaceCurrentChatWithOpeningHistoryRef,
    }).updateRuntimeNode;
    const confirm = vi.fn(() => false);
    vi.stubGlobal('window', { rpgraph: { confirmV3Migration: confirm } });
    try {
      expect(state.render().ensureCurrentStorybook('book')).toBe(false);
      expect(state.nodesRef.current[0].data.storybookJson).toBe(legacy);
      expect(refresh).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      expect(state.render().ensureCurrentStorybook('book')).toBe(true);
      expect(JSON.parse(state.nodesRef.current[0].data.storybookJson!).version).toBe('3.0.0');
      expect(signature(state.nodesRef.current[0].data.storybookJson)).toBe(signature(legacy));
      expect(state.messages.map((message) => message.originalText)).toEqual(['Opening message']);
      expect(state.clearCurrentSession).not.toHaveBeenCalled();
      expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('0 character(s)'));
      state.render().ensureCurrentStorybook('book');
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  },
);

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
  const character = normalizeRpStorybook({ ...emptyRpStorybook, characters: [fixture.character] }).characters[0];
  character.id = id;
  for (const [app, account] of Object.entries(character.apps ?? {})) {
    account.accountId = `${id}-${app}`;
    account.profileName = `${id}.${app}`;
  }
  return normalizeRpStorybook({ ...emptyRpStorybook, characters: [character] });
}

it.each(['npc-library', 'built-in'] as const)('preserves starting posts when importing from %s', async (source) => {
  const state = harness();
  const libraryNpc = reviewBook('library-npc').characters[0];
  libraryNpc.name = 'Library NPC';
  const builtIn = reviewBook('built-in').characters[0];
  builtIn.name = 'Built-in NPC';
  state.library.push(
    { character: libraryNpc, source: 'library.json', tier: 'user' },
    { character: builtIn, source: 'built-in.json', tier: 'bundled' },
  );
  vi.stubGlobal('window', { rpgraph: {
    loadFile: vi.fn(async () => ({ fileName: 'npc.json', value: { ...fixture, character: libraryNpc } })),
    listCharacterFiles: vi.fn(async () => [{
      fileName: 'local.json', name: 'Local Character', characterName: 'Local Character',
      updatedAt: '2026-09-14T12:00:00Z', type: 'character-card', protection: 'plain',
      formatVersion: '3.0.0', storage: 'characters', compatible: true,
    }]),
  } });
  try {
    await state.render().importCharacterCard('book');
    const choices = state.render().characterImportChoices;
    expect(choices.map((choice) => choice.source)).toEqual(['characters', 'npc-library', 'built-in']);
    const selected = choices.find((choice) => choice.source === source);
    expect(selected).toBeDefined();
    await state.render().importSelectedCharacterCard(selected);
    const imported = parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).characters[0];
    const original = source === 'built-in' ? builtIn : libraryNpc;
    expect(imported.name).toBe(original.name);
    expect(original.apps?.fotogram?.initialPosts?.length).toBeGreaterThan(0);
    expect(characterLibrarySummary(imported).apps.fotogram?.initialPosts)
      .toEqual(original.apps?.fotogram?.initialPosts);
    const runtime = appCharactersFromRegistry(state.options.currentCharacterRegistry!());
    expect(initialCharacterPosts(runtime)).toEqual(expect.arrayContaining(
      original.apps!.fotogram!.initialPosts!.map((post) => expect.objectContaining({
        app: 'fotogram', postId: post.id, caption: post.text, imageId: post.imageId,
      })),
    ));
    expect(state.render().showCharacterFiles).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('imports a session-unlocked NPC without requesting its password again', async () => {
  const state = harness();
  state.options.workspacePassword = () => 'game-secret';
  state.options.currentLibraryEntries = () => [{ tier: 'user', source: 'user:locked.json', fileName: 'locked.json',
    character: normalizeRpStorybook({ characters: [fixture.character] }).characters[0] }];
  state.options.currentLibraryFiles = () => [{ tier: 'user', fileName: 'locked.json', name: fixture.character.name,
    updatedAt: '', type: 'character-card', protection: 'encrypted', compatible: true, unlocked: true }];
  const loadFile = vi.fn();
  vi.stubGlobal('window', { rpgraph: { listCharacterFiles: async () => [], loadFile } });
  try {
    await state.render().importCharacterCard('book');
    await state.render().importSelectedCharacterCard(state.render().characterImportChoices[0]);
    expect(loadFile).not.toHaveBeenCalled();
    const imported = parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).characters[0];
    expect(imported.name).toBe(fixture.character.name);
    expect(imported.apps?.fotogram?.initialPosts).toEqual(fixture.character.apps.fotogram.initialPosts);
  } finally { vi.unstubAllGlobals(); }
});

it('requires a protected game before importing encrypted NPC files', async () => {
  const state = harness();
  state.options.currentLibraryFiles = () => [{
    tier: 'user', fileName: 'locked.json', name: 'Locked NPC', characterName: 'Locked NPC',
    updatedAt: '2026-09-15T01:00:00Z', type: 'character-card', protection: 'encrypted',
    envelopeFormatVersion: '1.0', formatVersion: '2.0.0', storage: 'npc-characters', compatible: true,
  }];
  state.options.setPendingSessionFilePath = vi.fn();
  state.options.setSessionPassword = vi.fn();
  state.options.setFileStorageStatus = vi.fn();
  state.options.setSessionPasswordAction = vi.fn();
  state.options.sessionPassword = '';
  const loadFile = vi.fn(async () => ({
    fileName: 'locked.json', name: 'Locked NPC', filePath: '/profile/npc-characters/locked.json',
    type: 'character-card' as const, protection: 'encrypted' as const, value: fixture,
  }));
  vi.stubGlobal('window', { rpgraph: { listCharacterFiles: vi.fn(async () => []), loadFile } });
  try {
    await state.render().importCharacterCard('book');
    const selected = state.render().characterImportChoices[0];
    expect(selected.source).toBe('npc-library');
    await state.render().importSelectedCharacterCard(selected);
    expect(loadFile).not.toHaveBeenCalled();
    expect(state.render().showCharacterFiles).toBe(true);
    expect(state.render().characterFileStatus).toContain('Open a protected Storybook');

    state.options.workspacePassword = () => 'secret';
    await state.render().importSelectedCharacterCard(selected);
    expect(loadFile).toHaveBeenCalledWith('locked.json', 'secret', 'npc-characters');
    expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).characters[0].name)
      .toBe(fixture.character.name);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('checks real library identities during editor commits', () => {
  const state = harness();
  const npc = reviewBook('npc').characters[0];
  npc.name = 'Library NPC';
  state.library.push({ character: npc, source: 'npc.json', tier: 'user' });
  const book = reviewBook();
  book.characters[0].apps!.fotogram!.profileName = npc.apps!.fotogram!.profileName;
  expect(state.render().commitStorybookToNode('book', book, {})).toContain('profile name');
  expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).characters).toEqual([]);
});

it('drops old snapshots and timeline collisions when replacing the entire session', () => {
  const state = harness();
  const book = reviewBook();
  const oldNpc = reviewBook('old-npc').characters[0];
  oldNpc.apps!.fotogram!.profileName = book.characters[0].apps!.fotogram!.profileName;
  state.snapshots[oldNpc.id] = { character: oldNpc, source: 'old.json' };
  state.messages.push({ id: 1, role: 'user', originalText: '', socialPost: {
    app: 'fotogram', postId: 'first-post', author: 'Old Author', authorHandle: 'old.author', caption: 'Old activity',
  } });
  expect(state.render().commitStorybookToNode('book', book, {}, { replaceExisting: true })).toBeNull();
  expect(state.clearCurrentSession).toHaveBeenCalledOnce();
});

it.each(['rp-storybook', 'rp-storybook-editor'] as const)(
  'restores Opening History on repeated file loads into %s', (nodeType) => {
    const state = harness();
    state.nodesRef.current[0].data.nodeType = nodeType;
    state.nodesRef.current.push(
      { id: 'events', position: { x: 0, y: 0 }, data: { label: 'Events', description: '', preview: '', nodeType: 'event-manager', eventAppointments: [] } } as WorkflowNode,
      { id: 'stats', position: { x: 0, y: 0 }, data: { nodeType: 'character-stats' } } as WorkflowNode,
    );
    state.options.setActiveStorybookProtection = vi.fn();
    const book = structuredClone(emptyRpStorybook);
    book.openingHistory.turns = [{
      id: 'opening', number: 1, createdAt: '2026-09-09T12:00:00Z',
      input: { graphText: '', messages: [] },
      output: { graphText: '', messages: [{ id: 1, role: 'output', originalText: 'Opening message' }] },
    }];
    state.clearCurrentSession.mockImplementation(() => { state.messages.length = 0; });
    const refresh = vi.fn((nodes: WorkflowNode[]) => {
      state.messages.push(...openingHistoryTurnsFromNodes(nodes).flatMap((turn) => turn.output.messages));
      state.options.replaceCurrentChatWithOpeningHistoryRef.current = false;
    });
    const patching = useRuntimeNodePatching({
      nodesRef: state.nodesRef,
      commitNodes: (nodes) => { state.nodesRef.current = nodes; },
      activeRunRef: { current: null }, activeRunLlmReportRef: { current: null },
      setRunLlmReport: vi.fn(),
      openingHistorySignature: (json) => JSON.stringify(parseRpStorybookJson(json ?? '').openingHistory),
      onStorybookOpeningHistoryChanged: refresh,
      replaceCurrentChatWithOpeningHistoryRef: state.options.replaceCurrentChatWithOpeningHistoryRef,
    });
    state.options.updateRuntimeNode = patching.updateRuntimeNode;
    for (let load = 0; load < 3; load += 1) {
      expect(state.render().applyStorybookToNode('book', book, 'book.json')).toBe(true);
      expect(state.messages.map((message) => message.originalText)).toEqual(['Opening message']);
      expect(refresh).toHaveBeenCalledTimes(load + 1);
    }
    state.render().updateStorybook('book', { ...book, title: 'Edited title' });
    expect(refresh).toHaveBeenCalledTimes(3);
  },
);

it('checks incoming Opening History snapshots before replacing the session', () => {
  const state = harness();
  const book = reviewBook();
  const npc = reviewBook('incoming-npc').characters[0];
  npc.name = 'Incoming NPC';
  npc.apps!.fotogram!.profileName = book.characters[0].apps!.fotogram!.profileName;
  book.openingHistory.npcParticipants = { [npc.id]: { character: npc, source: 'incoming.json' } };
  expect(state.render().commitStorybookToNode('book', book, {}, { replaceExisting: true })).toContain('profile name');
  expect(state.clearCurrentSession).not.toHaveBeenCalled();
});

it('blocks duplicate character names from assistant and editor commits', () => {
  const state = harness();
  const book = reviewBook();
  const duplicate = reviewBook('duplicate').characters[0];
  duplicate.name = `  ${book.characters[0].name.toUpperCase()}  `;
  book.characters.push(duplicate);
  expect(state.render().commitStorybookToNode('book', book, {})).toContain('Character names must be unique');
  expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).characters).toEqual([]);
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


it.each(['rp-storybook', 'rp-storybook-editor'])('deletes an unused character despite unrelated history in %s', async (nodeType) => {
  const state = harness();
  const book = normalizeRpStorybook({ characters: [fixture.character] });
  state.nodesRef.current[0].data.nodeType = nodeType as 'rp-storybook';
  state.nodesRef.current[0].data.storybookJson = rpStorybookJsonText(book);
  state.messages.push({ id: 1, role: 'user', originalText: 'A conversation with someone else.' });
  state.options.turnsRef.current.push({ id: 'turn', number: 1, createdAt: '2026-09-14T00:00:00Z',
    input: { graphText: 'Context includes Nova Vale', messages: state.messages }, output: { graphText: '', messages: [] } });
  expect(state.render().removalInfo('book', fixture.character.id).reasons).toEqual([]);
  await state.render().removeStorybookCharacter('book', fixture.character.id, 'delete');
  expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).characters).toHaveLength(0);
});

it('deletes an unused character and removes relationships pointing to it', async () => {
  const state = harness();
  const book = normalizeRpStorybook({ characters: [fixture.character, {
    ...fixture.character,
    id: 'other-character',
    name: 'Other Character',
    relationships: [
      { characterId: fixture.character.id, description: 'A former friend.', apps: { whatsup: true } },
      { characterId: 'external-character', description: 'A colleague.', apps: { fotogram: true } },
    ],
  }] });
  state.nodesRef.current[0].data.storybookJson = rpStorybookJsonText(book);

  expect(state.render().removalInfo('book', fixture.character.id).reasons).toEqual([]);
  await state.render().removeStorybookCharacter('book', fixture.character.id, 'delete');

  const characters = parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).characters;
  expect(characters.map((character) => character.id)).toEqual(['other-character']);
  expect(characters[0].relationships).toEqual([
    { characterId: 'external-character', description: 'A colleague.', apps: { fotogram: true } },
  ]);
});

it('warns about story text mentions without blocking character deletion', async () => {
  const state = harness();
  const book = normalizeRpStorybook({
    introduction: `${fixture.character.name} has just arrived.`,
    scenario: { summary: '', openingSituation: '', currentSituation: `Everyone is waiting for ${fixture.character.name}.` },
    characters: [fixture.character],
  });
  state.nodesRef.current[0].data.storybookJson = rpStorybookJsonText(book);

  const info = state.render().removalInfo('book', fixture.character.id);
  expect(info.reasons).toEqual([]);
  expect(info.warnings.length).toBeGreaterThan(0);
  await state.render().removeStorybookCharacter('book', fixture.character.id, 'delete');
  expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).characters).toHaveLength(0);
  expect(hooks.slots.flatMap((slot) => Array.isArray(slot) ? slot : [])).toContainEqual(expect.objectContaining({
    role: 'assistant', text: expect.stringContaining('Check Story Logic'),
  }));
});

it('blocks direct and raw JSON deletion of a used character but retains an edited NPC with its history', async () => {
  const state = harness();
  const book = normalizeRpStorybook({ characters: [fixture.character] });
  book.characters[0].description = 'Story-specific revision';
  state.nodesRef.current[0].data.storybookJson = rpStorybookJsonText(book);
  state.messages.push({ id: 1, role: 'user', originalText: '', socialDirectMessage: {
    app: 'fotogram', fromHandle: 'someone', toHandle: 'nova.vale.art', toAccountId: 'stage4-nova-fg', text: 'Hello',
  } } as MessageRecord);
  expect(state.render().removalInfo('book', fixture.character.id).reasons.length).toBeGreaterThan(0);
  await expect(state.render().removeStorybookCharacter('book', fixture.character.id, 'delete')).rejects.toThrow('in use');
  expect(state.render().commitStorybookToNode('book', { ...book, characters: [] }, {})).toContain('Cannot delete');
  await state.render().removeStorybookCharacter('book', fixture.character.id, 'npc');
  const next = parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!);
  expect(next.characters).toHaveLength(0);
  expect(next.openingHistory.npcParticipants![fixture.character.id].character.description).toBe('Story-specific revision');
  expect(state.snapshots[fixture.character.id].character.description).toBe('Story-specific revision');
  expect(state.messages).toHaveLength(1);
});

it('keeps the playable character and snapshots unchanged when saving fails or generation is active', async () => {
  const state = harness();
  state.nodesRef.current[0].data.storybookJson = rpStorybookJsonText(normalizeRpStorybook({ characters: [fixture.character] }));
  const original = state.nodesRef.current[0].data.storybookJson;
  state.options.saveNpcCharacter = vi.fn(async () => { throw new Error('Disk unavailable'); });
  await expect(state.render().removeStorybookCharacter('book', fixture.character.id, 'save')).rejects.toThrow('Disk unavailable');
  expect(state.nodesRef.current[0].data.storybookJson === original).toBe(true);
  expect(state.snapshots).toEqual({});
  state.options.lifecycleBusy = () => true;
  await expect(state.render().removeStorybookCharacter('book', fixture.character.id, 'npc')).rejects.toThrow('generation');
  expect(state.nodesRef.current[0].data.storybookJson === original).toBe(true);
});

it('saves before retirement and retains portable NPCs when Opening History is cleared', async () => {
  const state = harness();
  state.nodesRef.current[0].data.storybookJson = rpStorybookJsonText(normalizeRpStorybook({ characters: [fixture.character] }));
  const save = vi.fn(async () => {});
  state.options.saveNpcCharacter = save;
  await state.render().removeStorybookCharacter('book', fixture.character.id, 'save', true);
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]?.length).toBe(2);
  state.render().clearStorybookOpeningHistory('book');
  expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).openingHistory.npcParticipants![fixture.character.id].character.playable).toBe(false);
});

it('updates all retained Opening History copies atomically without replaying history', async () => {
  const state = harness();
  const book = normalizeRpStorybook({ characters: [fixture.character] });
  const character = book.characters[0];
  const original = { character: { ...character, playable: false }, source: 'book', aliases: { characterIds: ['book:character:stage4-nova'] } };
  state.snapshots[character.id] = original;
  book.openingHistory.npcParticipants = { [character.id]: original };
  const other = { ...book, characters: [] };
  state.nodesRef.current.push({ ...state.nodesRef.current[0], id: 'other', data: {
    ...state.nodesRef.current[0].data, storybookJson: rpStorybookJsonText(other),
  } } as WorkflowNode);
  book.characters[0] = { ...character, description: 'Latest revision' };
  state.nodesRef.current[0].data.storybookJson = rpStorybookJsonText(book);
  const commit = vi.fn((next: WorkflowNode[]) => { state.nodesRef.current = next; });
  state.options.commitLifecycleNodes = commit;
  await state.render().removeStorybookCharacter('book', character.id, 'npc');
  expect(commit).toHaveBeenCalledOnce();
  for (const node of state.nodesRef.current) {
    expect(parseRpStorybookJson(node.data.storybookJson!).openingHistory.npcParticipants![character.id].character.description).toBe('Latest revision');
  }
});

it('does not remove the character if the RP changes while its NPC file is being saved', async () => {
  const state = harness();
  state.nodesRef.current[0].data.storybookJson = rpStorybookJsonText(normalizeRpStorybook({ characters: [fixture.character] }));
  state.options.saveNpcCharacter = async () => {
    const current = parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!);
    current.characters[0].description = 'Edited while saving';
    state.nodesRef.current = state.nodesRef.current.map((node) => node.id === 'book'
      ? { ...node, data: { ...node.data, storybookJson: rpStorybookJsonText(current) } }
      : node);
  };
  await expect(state.render().removeStorybookCharacter('book', fixture.character.id, 'save')).rejects.toThrow('RP changed');
  expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).characters[0].description).toBe('Edited while saving');
  expect(state.snapshots).toEqual({});
});

it('protects a followed character without chat and preserves the connection when retired', async () => {
  const state = harness();
  const book = normalizeRpStorybook({ characters: [fixture.character] });
  state.nodesRef.current[0].data.storybookJson = rpStorybookJsonText(book);
  const directory = () => buildSocialDirectory({
    storyCharacters: appCharactersFromRegistry(state.options.currentCharacterRegistry()), messages: [],
  }).users;
  const originalUserId = directory()[0].id;
  state.options.currentSocialConnectionsByCharacter = () => ({
    other: { fotogram: [originalUserId] },
  });
  expect(state.render().removalInfo('book', fixture.character.id).reasons.length).toBeGreaterThan(0);
  await expect(state.render().removeStorybookCharacter('book', fixture.character.id, 'delete')).rejects.toThrow('in use');
  await state.render().removeStorybookCharacter('book', fixture.character.id, 'npc');
  expect(directory()[0].id).toBe(originalUserId);
  expect(state.snapshots[fixture.character.id].character.playable).toBe(false);
});


it('resets events and character stats only after a valid Storybook replacement', () => {
  const state = harness();
  state.options.setActiveStorybookProtection = vi.fn();
  state.nodesRef.current.push(
    { id: 'events', position: { x: 0, y: 0 }, data: { label: 'Events', description: '', preview: '', nodeType: 'event-manager', eventAppointments: [{ id: 'old-event' }] } } as WorkflowNode,
    { id: 'stats', position: { x: 0, y: 0 }, data: { nodeType: 'character-stats', characterStatsLastRpDateTime: 'old-time',
      characterStatsContextText: 'Old story context' } } as WorkflowNode,
  );
  state.options.lifecycleBusy = () => true;
  expect(state.render().applyStorybookToNode('book', emptyRpStorybook)).toBe(false);
  expect(state.clearCurrentSession).not.toHaveBeenCalled();
  expect(state.nodesRef.current[1].data.eventAppointments).toHaveLength(1);
  state.options.lifecycleBusy = () => false;
  expect(state.render().applyStorybookToNode('book', emptyRpStorybook)).toBe(true);
  expect(state.clearCurrentSession).toHaveBeenCalledOnce();
  expect(state.nodesRef.current[1].data.eventAppointments).toEqual([]);
  expect(state.nodesRef.current[2].data.characterStatsLastRpDateTime).toBeUndefined();
  expect(state.nodesRef.current[2].data.characterStatsContextText).toBe('');
  expect(state.options.replaceCurrentChatWithOpeningHistoryRef.current).toBe(true);
});


it('retains the exact failed model response for copying without applying partial edits', async () => {
  const state = harness();
  const original = state.nodesRef.current[0].data.storybookJson;
  const request = state.render().submitStorybookCreatorMessage('Create a story');
  const raw = '{"reply":"Done","patch":[{"op":"replace","path":"/title","value":"Broken"}]} {"reply":"Another object"}';
  state.rawReply(raw);
  await request;
  const error = state.render().storybookCreatorMessages.slice(-1)[0];
  expect(error).toMatchObject({ role: 'error', failedResponse: raw });
  expect(error?.text).toContain('JSON');
  expect(state.nodesRef.current[0].data.storybookJson).toBe(original);
  state.render().clearStorybookCreatorChat();
  expect(state.render().storybookCreatorMessages).toEqual([]);
});

it('retries the latest failed request with provider sampling and preserved request details', async () => {
  const state = harness();
  const request = state.render().submitStorybookCreatorMessage('Change the title', 'Rename story', ['external-character']);
  state.rawReply('{"reply":"broken","patch":[]}]}');
  await request;
  const index = state.render().storybookCreatorMessages.length - 1;
  expect(state.render().storybookCreatorMessages[index].retryRequest).toEqual({
    message: 'Change the title', visibleMessage: 'Rename story', referenceIds: ['external-character'],
  });
  const retry = state.render().retryStorybookCreatorMessage(index);
  await state.render().retryStorybookCreatorMessage(index);
  expect(state.complete).toHaveBeenCalledTimes(2);
  expect(state.complete).toHaveBeenLastCalledWith(expect.objectContaining({
    useConnectionSampling: true,
    prompt: expect.stringContaining('This is an explicit retry of the failed request above.'),
  }));
  expect(state.complete).toHaveBeenLastCalledWith(expect.objectContaining({
    prompt: expect.stringContaining('Current user message:\nChange the title'),
  }));
  state.reply();
  await retry;
  expect(parseRpStorybookJson(state.nodesRef.current[0].data.storybookJson!).title).toBe('AI title');
  await state.render().retryStorybookCreatorMessage(index);
  expect(state.complete).toHaveBeenCalledTimes(2);
});
