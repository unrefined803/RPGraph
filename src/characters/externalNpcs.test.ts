import { captureStoryNpcParticipants, migrateLegacyNpcImports } from './storyNpcParticipants';
import type { ImportedNpcSnapshots } from './externalNpcs';
import { npcImportPreview, npcSourceSwitches } from './npcImportPreview';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNpcLibraryService, scanNpcLibrary } from '../../electron/npcLibrary.cjs';
import type { Character } from './character';
import {
  createActiveStorybookContextCache, createExternalNpcLibrary, importedNpcSnapshots,
  type ActiveStorybookContext,
} from './externalNpcs';
import type { NpcLibrarySnapshot } from './npcLibrary';
import { buildCharacterRegistry } from './registry';
import { storybookRegistryEntries } from './npcParticipantRuntime';
import { npcSnapshotEntries } from './npcParticipants';
import { appCharactersFromRegistry } from './appRuntime';
import { initialCharacterPosts, postsWithInitialContent } from './publications';
import { appStateFromSessionV2, sessionV2FromCurrentState } from '../data-management/sessionStore';
import { isRpgraphSessionV2 } from '../data-management/validation';
import { currentCoreNodeVersions } from '../nodes/nodeVersion';
import { emptyRpStorybook, rpStorybookJsonText, type RpStorybook } from '../nodes/rp-storybook/model';
import { rpCharacterCardForCharacter } from '../storybook/characterCard';
import { currentWorkflowFormatVersion } from '../workflow/version';
import type { MessageRecord, SocialPostRecord, TurnRecord, WorkflowNode } from '../types';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const pixels = (seed: string) => `data:image/jpeg;base64,${Buffer.from(seed).toString('base64')}`;
const image = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, mimeType: 'image/jpeg' as const, size: 3,
  dataUrl: pixels(id), description: `Image ${id}`, ...extra });

function character(id: string, name: string, extra: Partial<Character> = {}): Character {
  return { id, name, description: '', personality: '', speechStyle: '', role: '', playable: true,
    images: [image(`${id}-portrait`)], relationships: [],
    apps: { fotogram: { accountId: `${id}-fg`, enabled: true, username: `${id}.photo`, displayName: name, bio: '',
      avatarImageId: `${id}-portrait`, initialPosts: [{ id: 'authored', text: `${name} authored`, imageId: `${id}-portrait` }] } },
    ...extra } as Character;
}

const post = (owner: Character, postId: string, caption: string, imageId?: string): SocialPostRecord => ({
  app: 'fotogram', postId, author: owner.name, authorHandle: `${owner.id}.photo`, authorCharacterId: owner.id,
  authorAccountId: `${owner.id}-fg`, caption, textOnly: !imageId, ...(imageId ? { imageId } : {}) });

let nextMessageId = 1;
function turn(id: string, number: number, posts: SocialPostRecord[], openingHistory = false): TurnRecord {
  const messages: MessageRecord[] = posts.map((socialPost) => ({ id: nextMessageId++, role: 'user', originalText: '', socialPost }));
  return { id, number, createdAt: '2026-10-01T10:00:00Z', ...(openingHistory ? { openingHistory: true } : {}),
    input: { graphText: '', messages }, output: { graphText: '', messages: [] } };
}

const storybook = (characters: Character[], openingTurns: TurnRecord[] = []): RpStorybook => ({ ...emptyRpStorybook,
  characters: characters as RpStorybook['characters'],
  openingHistory: { ...emptyRpStorybook.openingHistory, turns: openingTurns } });

const storybookNode = (book: RpStorybook, id = 'book', fileName?: string): WorkflowNode => ({
  id, type: 'workflow', position: { x: 0, y: 0 }, data: { nodeType: 'rp-storybook',
    nodeDataVersion: currentCoreNodeVersions['rp-storybook'], label: 'Book', description: '', preview: '',
    storybookJson: rpStorybookJsonText(book), ...(fileName ? { storybookFileName: fileName } : {}) },
} as WorkflowNode);

/** A real RP Save: the saved timeline already contains the Opening History turns. */
function rpSave(book: RpStorybook, storybookFileName: string | undefined, savedAt: string, turns: TurnRecord[],
  options: { name?: string; importedNpcs?: ImportedNpcSnapshots; npcParticipants?: Parameters<typeof sessionV2FromCurrentState>[0]['npcParticipants'] } = {}) {
  const nodes = [storybookNode(book)];
  const session = sessionV2FromCurrentState({ name: options.name ?? 'Save', settings: { englishProcessingEnabled: true, displayLanguage: 'en' },
    workflowVariables: {}, turns: [...book.openingHistory.turns, ...turns], turnCheckpoints: [], openingMessages: [],
    npcParticipants: options.npcParticipants },
  { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion, savedAt, nodes, edges: [] }, nodes, savedAt);
  // Only legacy fixtures carry a full library archive; new saves must never write it.
  if (options.importedNpcs) session.runtime.current.importedNpcsJson = JSON.stringify(options.importedNpcs);
  if (storybookFileName) session.metadata.storybookFileNames = { book: storybookFileName };
  return session;
}

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpgraph-npc-publications-'));
  temporaryDirectories.push(root);
  const roots = { bundled: path.join(root, 'bundled'), user: path.join(root, 'user'), storybooks: path.join(root, 'files') };
  await fs.mkdir(roots.storybooks, { recursive: true });
  const write = async (fileName: string, value: unknown, mtimeSeconds?: number) => {
    const filePath = path.join(roots.storybooks, fileName);
    await fs.writeFile(filePath, JSON.stringify(value), 'utf8');
    if (mtimeSeconds) await fs.utimes(filePath, mtimeSeconds, mtimeSeconds);
  };
  return { roots, write };
}

const scan = async (roots: Parameters<typeof scanNpcLibrary>[0], active: string[] = []) =>
  await scanNpcLibrary(roots, undefined, undefined, new Map(), active) as unknown as NpcLibrarySnapshot;
const noPins = {};
const noActive: ActiveStorybookContext = { characterIds: new Set(), storybookFileNames: [] };
const activeContext = (book: RpStorybook, fileName = 'a.json') =>
  createActiveStorybookContextCache()([storybookNode(book, 'active', fileName)]);
const externalEntries = (library: NpcLibrarySnapshot | null) =>
  (library?.entries ?? []).filter((entry) => entry.tier === 'saved-storybook');
const postTexts = (value: Character) => value.apps?.fotogram?.initialPosts?.map((entry) => entry.text) ?? [];

describe('cross-Storybook NPC publications', () => {
  it('uses the stored Storybook and its Opening History when no RP Save exists', async () => {
    const { roots, write } = await workspace();
    const mia = character('mia', 'Mia');
    await write('b.json', storybook([mia], [turn('opening-1', 1, [post(mia, 'opening-post', 'Opening post')], true)]));
    const snapshot = await scan(roots, ['a.json']);
    expect(snapshot.publicationSources).toMatchObject([{ key: 'b.json', kind: 'storybook', storybookName: 'b' }]);
    const library = createExternalNpcLibrary()(snapshot, {}, activeContext(storybook([character('alex', 'Alex')])));
    const [entry] = externalEntries(library);
    expect(postTexts(entry.character)).toEqual(['Mia authored', 'Opening post']);
    expect(entry.publication).toEqual({ storybookFileName: 'b.json', storybookName: 'b', kind: 'storybook' });
    expect(entry.character.playable).toBe(false);
    expect(buildCharacterRegistry([...library!.entries]).characters[0].playerSelectable).toBe(false);
  });

  it('takes state and publications from the latest usable save only, without merging alternates', async () => {
    const { roots, write } = await workspace();
    const mia = character('mia', 'Mia');
    const opening = [turn('opening-1', 1, [post(mia, 'opening-post', 'Opening post')], true)];
    const book = storybook([mia], opening);
    await write('b.json', book);
    const older = storybook([{ ...mia, description: 'Older state' }], opening);
    const newer = storybook([{ ...mia, description: 'Newer state', images: [...mia.images, image('beach')] }], opening);
    // More turns and a later file time must not outrank the real save time.
    await write('z-older.json', rpSave(older, 'b.json', '2026-10-01T08:00:00Z',
      [turn('t2', 2, [post(mia, 'old-1', 'Old branch')]), turn('t3', 3, [post(mia, 'old-2', 'Old branch 2')])]), 900);
    await write('a-newer.json', rpSave(newer, 'b.json', '2026-10-02T08:00:00Z',
      [turn('t2', 2, [post(mia, 'beach-post', 'At the beach', 'beach')])], { name: 'Evening Save' }), 100);
    await write('unlinked.json', rpSave(newer, undefined, '2026-10-03T08:00:00Z', [turn('t2', 2, [post(mia, 'stray', 'Unlinked')])]));
    const snapshot = await scan(roots);
    expect(snapshot.publicationSources).toMatchObject([{ kind: 'save', saveFileName: 'a-newer.json', saveName: 'Evening Save',
      savedAt: '2026-10-02T08:00:00Z' }]);
    const [entry] = externalEntries(createExternalNpcLibrary()(snapshot, {}, noActive));
    expect(entry.character.description).toBe('Newer state');
    // The timeline already holds the opening post: it appears once.
    expect(postTexts(entry.character)).toEqual(['Mia authored', 'Opening post', 'At the beach']);
    // The posted image lives in the save's media pool and stays available.
    expect(entry.character.images.find((entry) => entry.id === 'beach')?.dataUrl).toBe(pixels('beach'));
    expect(entry.publication).toMatchObject({ kind: 'save', saveName: 'Evening Save' });
  });

  it('breaks equal save times deterministically and falls back past unusable saves', async () => {
    const { roots, write } = await workspace();
    const mia = character('mia', 'Mia');
    const book = storybook([mia]);
    await write('b.json', book);
    const save = (caption: string, savedAt: string) => rpSave(book, 'b.json', savedAt, [turn('t1', 1, [post(mia, caption, caption)])]);
    await write('save-2.json', save('second', '2026-10-02T08:00:00Z'));
    await write('save-1.json', save('first', '2026-10-02T08:00:00Z'));
    let snapshot = await scan(roots);
    expect(snapshot.publicationSources![0].saveFileName).toBe('save-1.json');
    const corrupted = save('corrupted', '2026-10-05T08:00:00Z');
    corrupted.runtime.current.nodes.book = { storybookJson: '{"image":"\u0000rpgraph-data-ref:media-99\u0000"}' };
    await write('save-3.json', corrupted);
    await write('save-4.json', { ...save('undated', '2026-10-06T08:00:00Z'), savedAt: 'yesterday' });
    await write('save-5.json', { format: 'rpgraph-session' });
    await write('save-6.json', { format: 'rpgraph-encrypted-session' });
    await write('locked-book.json', { format: 'rpgraph-encrypted-storybook' });
    const ambiguous = save('ambiguous', '2026-10-07T08:00:00Z');
    ambiguous.metadata.storybookFileNames = { book: 'b.json', other: 'b.json' };
    await write('save-7.json', ambiguous);
    snapshot = await scan(roots);
    expect(snapshot.publicationSources![0].saveFileName).toBe('save-1.json');
    expect(snapshot.protectedSources).toBe(2);
    expect(snapshot.diagnostics.map((entry) => [entry.fileName, entry.code]).sort()).toEqual([
      ['save-3.json', 'missing-media'], ['save-4.json', 'unusable-source'],
      ['save-5.json', 'unsupported-version'], ['save-7.json', 'ambiguous-source'],
    ]);
    for (const fileName of ['save-1.json', 'save-2.json']) await fs.unlink(path.join(roots.storybooks, fileName));
    snapshot = await scan(roots);
    expect(snapshot.publicationSources).toMatchObject([{ kind: 'storybook' }]);
    expect(externalEntries(createExternalNpcLibrary()(snapshot, {}, noActive))).toHaveLength(1);
  });

  it('excludes active Storybook characters by identity, never by name', async () => {
    const { roots, write } = await workspace();
    const alexInB = character('alex', 'Alex', { description: 'B revision' });
    const mia = character('mia', 'Mia');
    const namesake = character('alex-two', 'Alex');
    await write('b.json', storybook([alexInB, mia, namesake],
      [turn('opening-1', 1, [post(alexInB, 'alex-b', 'Alex in B'), post(mia, 'mia-b', 'Mia in B')], true)]));
    const activeBook = storybook([character('alex', 'Alex', { description: 'A revision' })]);
    const context = activeContext(activeBook);
    const snapshot = await scan(roots, [...context.storybookFileNames]);
    const library = createExternalNpcLibrary()(snapshot, {}, context);
    expect(externalEntries(library).map((entry) => entry.character.id).sort()).toEqual(['alex-two', 'mia']);
    expect(postTexts(externalEntries(library).find((entry) => entry.character.id === 'mia')!.character))
      .toEqual(['Mia authored', 'Mia in B']);
    const registry = buildCharacterRegistry([...library!.entries, ...storybookRegistryEntries([storybookNode(activeBook, 'active')])]);
    const alex = registry.characters.find((entry) => entry.character.id === 'alex')!;
    expect(alex.character.description).toBe('A revision');
    expect(postTexts(alex.character)).toEqual(['Alex authored']);
    // Switching the active Storybook lifts the exclusion without rescanning.
    expect(externalEntries(createExternalNpcLibrary()(snapshot, {}, noActive)).map((entry) => entry.character.id).sort())
      .toEqual(['alex', 'alex-two', 'mia']);
  });

  it('never treats the active Storybook or imported NPCs as external sources', async () => {
    const { roots, write } = await workspace();
    const mia = character('mia', 'Mia');
    const removed = character('removed', 'Removed');
    const importedFromC = character('cara', 'Cara', { playable: false });
    await write('a.json', storybook([character('alex', 'Alex'), removed]), 300);
    await write('b.json', storybook([mia, importedFromC, { ...removed, description: 'B copy' }]), 200);
    const withoutContext = await scan(roots);
    expect(withoutContext.entries.find((entry) => entry.character.id === 'removed')?.fileName).toBe('a.json#removed');
    const snapshot = await scan(roots, ['a.json']);
    expect(snapshot.entries.map((entry) => entry.fileName).sort()).toEqual(['b.json#mia', 'b.json#removed']);
    // A stale snapshot selected for another Storybook cannot leak the active file's own copies.
    const stale = createExternalNpcLibrary()(withoutContext, {}, activeContext(storybook([character('alex', 'Alex')])));
    expect(externalEntries(stale).some((entry) => entry.publication?.storybookFileName === 'a.json')).toBe(false);
  });

  it('selects one Storybook lineage for a character that several Storybooks provide', async () => {
    const { roots, write } = await workspace();
    const mia = character('mia', 'Mia');
    await write('b.json', storybook([mia], [turn('opening-b', 1, [post(mia, 'b-post', 'From B')], true)]), 100);
    const bookC = storybook([mia], [turn('opening-c', 1, [post(mia, 'c-post', 'From C')], true)]);
    await write('c.json', bookC, 200);
    await write('c-save.json', rpSave(bookC, 'c.json', '2026-10-02T08:00:00Z', [turn('t2', 2, [post(mia, 'c-live', 'C continues')])]), 50);
    const [entry] = externalEntries(createExternalNpcLibrary()(await scan(roots), {}, noActive));
    expect(entry.publication).toMatchObject({ storybookFileName: 'c.json', kind: 'save', saveFileName: 'c-save.json' });
    expect(postTexts(entry.character)).toEqual(['Mia authored', 'From C', 'C continues']);
  });

  it('lets the user switch NPC sharing between a Storybook, its saves and other Storybooks', async () => {
    const { roots, write } = await workspace();
    const mia = character('mia', 'Mia');
    const ben = character('ben', 'Ben');
    await write('a.json', storybook([character('alex', 'Alex')]));
    const bookB = storybook([mia, ben], [turn('opening-b', 1, [post(mia, 'b-post', 'From B')], true)]);
    await write('b.json', bookB, 100);
    await write('b-save.json', rpSave(bookB, 'b.json', '2026-10-02T08:00:00Z', [turn('t2', 2, [post(mia, 'b-live', 'B continues')])]));
    await write('c.json', storybook([mia], [turn('opening-c', 1, [post(mia, 'c-post', 'From C')], true)]), 200);
    const saved: unknown[] = [];
    const service = createNpcLibraryService({ roots, openPath: async () => '',
      saveSourcePreferences: async (preferences) => { saved.push(preferences); } });
    await service.reload(['a.json']);
    const preview = async (target = 'a.json') => {
      const index = await service.preview();
      return { rows: npcImportPreview(index, target), switches: npcSourceSwitches(index, target) };
    };
    // Default: the newest save provides B's cast and the newest Storybook wins Mia.
    expect(await preview()).toEqual({ rows: { 'b-save.json': ['Ben'], 'c.json': ['Mia'] },
      switches: { 'b.json': ['b-save.json'], 'b-save.json': ['c.json'] } });
    // The active Storybook's own files never offer a switch.
    expect((await preview('b.json')).switches).toEqual({});

    // A switch takes the whole cast of that file, including characters another Storybook shared.
    await service.preferSource('b.json');
    expect(saved[saved.length - 1]).toEqual({ origins: { 'b.json': 'b.json' }, priority: ['b.json'] });
    expect(await preview()).toEqual({ rows: { 'b.json': ['Mia', 'Ben'] },
      switches: { 'b-save.json': ['b.json'], 'c.json': ['b.json'] } });
    const entry = () => externalEntries(createExternalNpcLibrary()(service.current() as unknown as NpcLibrarySnapshot, {}, noActive))
      .find((candidate) => candidate.character.id === 'mia')!;
    expect(entry().publication).toMatchObject({ storybookFileName: 'b.json', kind: 'storybook' });
    expect(postTexts(entry().character)).toEqual(['Mia authored', 'From B']);

    await service.preferSource('b-save.json');
    expect(await preview()).toEqual({ rows: { 'b-save.json': ['Mia', 'Ben'] },
      switches: { 'b.json': ['b-save.json'], 'c.json': ['b-save.json'] } });
    expect(postTexts(entry().character)).toEqual(['Mia authored', 'From B', 'B continues']);

    await service.preferSource('c.json');
    expect((await preview()).rows).toEqual({ 'b-save.json': ['Ben'], 'c.json': ['Mia'] });
    await expect(service.preferSource('missing.json')).rejects.toThrow();

    // The choice survives a restart; choices for missing files fall back to the defaults.
    await service.preferSource('b.json');
    const restarted = createNpcLibraryService({ roots, openPath: async () => '', sourcePreferences: saved[saved.length - 1] });
    expect(npcImportPreview(await restarted.preview(), 'a.json')).toEqual({ 'b.json': ['Mia', 'Ben'] });
    const stale = createNpcLibraryService({ roots, openPath: async () => '',
      sourcePreferences: { origins: { 'b.json': 'gone.json' }, priority: ['gone.json'] } });
    expect(npcImportPreview(await stale.preview(), 'a.json')).toEqual({ 'b-save.json': ['Ben'], 'c.json': ['Mia'] });
  });

  it('copies only required images and reports missing media without losing other characters', async () => {
    const { roots, write } = await workspace();
    const mia = character('mia', 'Mia', { images: [image('mia-portrait'),
      image('private-gift', { receivedFrom: 'someone' })] } as Partial<Character>);
    const npcOwner = character('npc', 'Npc', { playable: false, images: [image('npc-portrait'), image('shared-shot')] } as Partial<Character>);
    const tom = character('tom', 'Tom');
    await write('b.json', storybook([mia, npcOwner, tom], [turn('opening-1', 1, [
      post(mia, 'shared', 'Shared shot', 'shared-shot'), post(mia, 'lost', 'Lost image', 'gone'), post(tom, 'tom-1', 'Tom posts'),
    ], true)]));
    const snapshot = await scan(roots);
    expect(snapshot.publicationSources![0].gallery.map((entry) => entry.id)).toEqual(['shared-shot']);
    const library = createExternalNpcLibrary()(snapshot, {}, noActive)!;
    const entries = externalEntries(library);
    const miaEntry = entries.find((entry) => entry.character.id === 'mia')!;
    expect(miaEntry.character.images.map((entry) => entry.id)).toEqual(['mia-portrait', 'shared-shot']);
    expect(postTexts(miaEntry.character)).toEqual(['Mia authored', 'Shared shot']);
    expect(postTexts(entries.find((entry) => entry.character.id === 'tom')!.character)).toEqual(['Tom authored', 'Tom posts']);
    expect(library.diagnostics).toMatchObject([{ code: 'missing-media', fileName: 'b.json#mia' }]);
    expect(library.diagnostics[0].message).toContain('gone');
  });

  it('reads each changed source once and reuses prepared copies across refreshes', async () => {
    const { roots, write } = await workspace();
    const mia = character('mia', 'Mia');
    const book = storybook([mia, character('tom', 'Tom')]);
    await write('b.json', book);
    for (let index = 1; index <= 3; index += 1) {
      await write(`save-${index}.json`, rpSave(book, 'b.json', `2026-10-0${index}T08:00:00Z`,
        [turn('t1', 1, [post(mia, `post-${index}`, `Post ${index}`)])]));
    }
    await write('c.json', storybook([character('cleo', 'Cleo')]));
    const service = createNpcLibraryService({ roots, openPath: async () => '' });
    const prepare = createExternalNpcLibrary();
    const readFile = vi.spyOn(fs, 'readFile');
    try {
      const first = await service.reload() as unknown as NpcLibrarySnapshot;
      expect(readFile.mock.calls).toHaveLength(5);
      const firstEntries = externalEntries(prepare(first, noPins, noActive));
      expect(prepare(first, noPins, noActive)).toBe(prepare(first, noPins, noActive));
      readFile.mockClear();
      // A Storybook switch changes selection only; sources still in use are not read again.
      const second = await service.forActiveStorybooks(['c.json']) as unknown as NpcLibrarySnapshot;
      expect(second.entries.map((entry) => entry.character.id).sort()).toEqual(['mia', 'tom']);
      expect(readFile.mock.calls).toHaveLength(0);
      // The released copy of the formerly active Storybook is the only file read again.
      const third = await service.forActiveStorybooks([]) as unknown as NpcLibrarySnapshot;
      expect(readFile.mock.calls.map(([filePath]) => path.basename(String(filePath)))).toEqual(['c.json']);
      readFile.mockClear();
      const thirdEntries = externalEntries(prepare(third, noPins, noActive));
      expect(thirdEntries.map((entry) => entry.character.id).sort()).toEqual(['cleo', 'mia', 'tom']);
      expect(thirdEntries.find((entry) => entry.character.id === 'mia'))
        .toBe(firstEntries.find((entry) => entry.character.id === 'mia'));
      expect(postTexts(thirdEntries.find((entry) => entry.character.id === 'mia')!.character)).toEqual(['Mia authored', 'Post 3']);
      // Dropping the newest save reselects the next one and rereads only that file.
      await fs.unlink(path.join(roots.storybooks, 'save-3.json'));
      const fourth = await service.reload() as unknown as NpcLibrarySnapshot;
      expect(readFile.mock.calls.map(([filePath]) => path.basename(String(filePath)))).toEqual(['save-2.json']);
      expect(postTexts(externalEntries(prepare(fourth, noPins, noActive)).find((entry) => entry.character.id === 'mia')!.character))
        .toEqual(['Mia authored', 'Post 2']);
    } finally {
      readFile.mockRestore();
    }
  });

  it('saves only communicating NPCs and reloads unrelated characters dynamically', async () => {
    const { roots, write } = await workspace();
    const mia = character('mia', 'Mia');
    const tom = character('tom', 'Tom');
    await write('b.json', storybook([mia, tom]));
    const activeBook = storybook([character('alex', 'Alex')]);
    const live = createExternalNpcLibrary()(await scan(roots), {}, activeContext(activeBook))!;
    const idle = rpSave(activeBook, 'a.json', '2026-10-03T08:00:00Z', []);
    expect(idle.runtime.current.importedNpcsJson).toBeUndefined();
    expect(idle.runtime.current.npcParticipantsJson).toBeUndefined();
    expect(JSON.stringify(idle)).not.toContain(pixels('mia-portrait'));
    const message: MessageRecord = { id: 1, role: 'output', originalText: '', socialReactions: {
      app: 'fotogram', postId: 'alex-post', likes: 0, comments: [{ from: 'Mia', handle: 'mia.photo', text: 'Hello!' }],
    } };
    const participants = captureStoryNpcParticipants({}, live.entries, [message]);
    expect(Object.keys(participants)).toEqual(['mia']);
    const saved = rpSave(activeBook, 'a.json', '2026-10-03T08:00:00Z', [], { npcParticipants: participants });
    expect(isRpgraphSessionV2(saved)).toBe(true);
    expect(saved.runtime.current.importedNpcsJson).toBeUndefined();
    const restored = appStateFromSessionV2(saved);
    expect(restored.importedNpcs).toEqual({});
    expect(restored.npcParticipants.mia.character.images[0].dataUrl).toBe(pixels('mia-portrait'));
    expect(JSON.stringify(saved)).not.toContain(pixels('tom-portrait'));
    await write('b.json', storybook([{ ...mia, description: 'Changed' }, { ...tom, description: 'Latest Tom' }]));
    const context = activeContext(activeBook);
    const resumed = createExternalNpcLibrary()(await scan(roots), {}, { ...context,
      characterIds: new Set([...context.characterIds, ...Object.keys(restored.npcParticipants)]) })!;
    expect(externalEntries(resumed).map(entry => entry.character.id)).toEqual(['tom']);
    expect(externalEntries(resumed)[0].character.description).toBe('Latest Tom');
    expect(restored.npcParticipants.mia.character.description).toBe('');
    await fs.unlink(path.join(roots.storybooks, 'b.json'));
    expect(buildCharacterRegistry(npcSnapshotEntries(restored.npcParticipants)).characters[0].character.id).toBe('mia');
  });

  it('keeps registry precedence and exposes imported posts through the social timeline without duplicates', async () => {
    const { roots, write } = await workspace();
    const mia = character('mia', 'Mia');
    await write('b.json', storybook([mia], [turn('opening-1', 1, [post(mia, 'live', 'Live post')], true)]));
    const library = createExternalNpcLibrary()(await scan(roots), {}, noActive)!;
    const [external] = externalEntries(library);
    const localRevision = { ...mia, description: 'Local file' };
    const pinnedRevision = { ...mia, description: 'RP copy' };
    const local = buildCharacterRegistry([...library.entries, { character: localRevision, tier: 'user', source: 'user:mia.json' }]);
    expect(local.characters[0]).toMatchObject({ character: { description: 'Local file' }, provenance: { tier: 'user' } });
    const snapshot = buildCharacterRegistry([...library.entries, { character: localRevision, tier: 'user', source: 'user:mia.json' },
      ...npcSnapshotEntries({ mia: { character: pinnedRevision, source: 'user:mia.json' } })]);
    expect(snapshot.characters[0]).toMatchObject({ character: { description: 'RP copy' }, provenance: { tier: 'snapshot' } });

    const characters = appCharactersFromRegistry(buildCharacterRegistry([external]));
    expect(characters[0].playerSelectable).toBe(false);
    const seeds = initialCharacterPosts(characters);
    expect(seeds.map((seed) => seed.caption)).toEqual(['Mia authored', 'Live post']);
    expect(seeds.every((seed) => seed.postId.startsWith('npc-seed:') && seed.authorAccountId === 'mia-fg')).toBe(true);
    // Loading the posts creates no timeline activity and replays without accumulating.
    expect(postsWithInitialContent(characters, []).filter((message) => message.socialPost).length).toBe(2);
    expect(postsWithInitialContent(characters, postsWithInitialContent(characters, [])).filter((message) => message.socialPost)
      .length).toBe(2);
  });

  it('keeps the manual export options unchanged', () => {
    const mia = character('mia', 'Mia', { images: [image('mia-portrait'), image('gift', { receivedFrom: 'someone' })] } as Partial<Character>);
    const posts = [post(mia, 'gift-post', 'With a gift', 'gift')];
    const options = { posts, gallery: mia.images };
    expect(rpCharacterCardForCharacter(mia as never).character.apps.fotogram?.initialPosts).toBeUndefined();
    const withoutReceived = rpCharacterCardForCharacter(mia as never, { ...options, includePosts: true }).character;
    expect(withoutReceived.images.map((entry) => entry.id)).toEqual(['mia-portrait']);
    expect(withoutReceived.apps.fotogram?.initialPosts).toEqual([
      { id: 'authored', text: 'Mia authored', imageId: 'mia-portrait' }, { id: 'gift-post', text: 'With a gift' }]);
    const withReceived = rpCharacterCardForCharacter(mia as never, { ...options, includePosts: true, includeReceivedImages: true }).character;
    expect(withReceived.images.map((entry) => entry.id)).toEqual(['mia-portrait', 'gift']);
    expect(withReceived.apps.fotogram?.initialPosts?.[1]).toEqual({ id: 'gift-post', text: 'With a gift', imageId: 'gift' });
    expect(() => rpCharacterCardForCharacter(mia as never, { includePosts: true, gallery: [],
      posts: [post(mia, 'lost', 'Lost', 'gone')] })).toThrow('missing gallery image gone');
  });
});

it('falls back past a save with a corrupt playable character instead of dropping its cast', async () => {
  const { roots, write } = await workspace();
  const mia = character('mia', 'Mia');
  const book = storybook([mia]);
  await write('b.json', book);
  await write('older.json', rpSave(book, 'b.json', '2026-10-01T08:00:00Z',
    [turn('one', 1, [post(mia, 'one', 'Older valid post')])]));
  const broken = rpSave(book, 'b.json', '2026-10-02T08:00:00Z', []);
  const payload = JSON.parse(rpStorybookJsonText(book));
  payload.characters[0].apps.fotogram.accountId = 42;
  broken.runtime.current.nodes.book.storybookJson = JSON.stringify(payload);
  await write('newer.json', broken);
  const snapshot = await scan(roots);
  const result = createExternalNpcLibrary()(snapshot, {}, noActive);
  expect(externalEntries(result).map(entry => entry.character.id)).toEqual(['mia']);
  expect(snapshot.publicationSources?.[0].saveFileName).toBe('older.json');
  expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ fileName: 'newer.json', code: 'invalid-container' }));
});

it('previews five Storybooks and ten saves without reads on selection or changing the active library', async () => {
  const { roots, write } = await workspace();
  for (let i = 0; i < 5; i++) {
    const book = storybook([character(`person-${i}`, `Person ${i}`), character('shared', 'Shared')]);
    await write(`book-${i}.json`, book, 1000 + i);
    for (let n = 0; n < 2; n++) {
      await write(`save-${i}-${n}.json`, rpSave(book, `book-${i}.json`, `2026-10-0${n + 1}T08:00:00Z`, []));
    }
  }
  const service = createNpcLibraryService({ roots, openPath: async () => '' });
  await service.reload(['book-0.json']);
  const current = service.current();
  const index = await service.preview();
  expect(service.current()).toBe(current);
  expect(JSON.stringify(index)).not.toContain('data:image');
  const readFile = vi.spyOn(fs, 'readFile');
  try {
    for (let i = 0; i < 5; i++) {
      const rows = npcImportPreview(index, `book-${i}.json`)!;
      expect(Object.keys(rows)).toHaveLength(4);
      expect(rows[`save-${i}-1.json`]).toBeUndefined();
      for (let other = 0; other < 5; other++) {
        if (other !== i) expect(rows[`save-${other}-1.json`]).toEqual([`Person ${other}`]);
      }
    }
    expect(npcImportPreview(index, 'save-0-0.json')).toEqual(npcImportPreview(index, 'book-0.json'));
    expect(readFile).not.toHaveBeenCalled();
  } finally { readFile.mockRestore(); }
});

it('ignores idle legacy imports and excludes story participants from the preview', async () => {
  const { roots, write } = await workspace();
  const mia = character('mia', 'Mia');
  await write('b.json', storybook([mia]));
  const book = storybook([character('alex', 'Alex')]);
  const library = createExternalNpcLibrary()(await scan(roots), {}, activeContext(book));
  await write('a.json', book);
  await write('a-save.json', rpSave(book, 'a.json', '2026-10-03T08:00:00Z', [],
    { importedNpcs: importedNpcSnapshots(library) }));
  const service = createNpcLibraryService({ roots, openPath: async () => '' });
  const index = await service.preview();
  expect(npcImportPreview(index, 'a-save.json')).toEqual({ 'b.json': ['Mia'] });
  expect(npcImportPreview({ ...index, overriddenIds: ['mia'] }, 'a-save.json')).toEqual({});
  expect(npcImportPreview(index, 'missing.json')).toBeNull();
});

it('migrates only communicating legacy imports and stops writing the bulk archive', async () => {
  const { roots, write } = await workspace();
  await write('b.json', storybook([character('mia', 'Mia'), character('tom', 'Tom')]));
  const book = storybook([character('alex', 'Alex')]);
  const live = createExternalNpcLibrary()(await scan(roots), {}, activeContext(book))!;
  const comment: MessageRecord = { id: 1, role: 'output', originalText: '', socialReactions: {
    app: 'fotogram', postId: 'alex-post', likes: 0, comments: [{ from: 'Mia', handle: 'mia.photo', text: 'Hi!' }],
  } };
  const history: TurnRecord = { ...turn('reply', 1, []), output: { graphText: '', messages: [comment] } };
  const legacySave = rpSave(book, 'a.json', '2026-10-03T08:00:00Z', [history],
    { importedNpcs: importedNpcSnapshots(live) });
  const loaded = appStateFromSessionV2(legacySave);
  const participants = migrateLegacyNpcImports(loaded.npcParticipants, storybookRegistryEntries([storybookNode(book)]),
    loaded.importedNpcs, loaded.turns.flatMap(turn => [...turn.input.messages, ...turn.output.messages]));
  expect(Object.keys(participants)).toEqual(['mia']);
  const clean = rpSave(book, 'a.json', '2026-10-04T08:00:00Z', [history], { npcParticipants: participants });
  expect(clean.runtime.current.importedNpcsJson).toBeUndefined();
  expect(JSON.stringify(clean)).not.toContain(pixels('tom-portrait'));
  await write('a.json', book);
  await write('a-save.json', legacySave);
  const service = createNpcLibraryService({ roots, openPath: async () => '' });
  expect(npcImportPreview(await service.preview(), 'a-save.json')).toEqual({ 'b.json': ['Tom'] });
  await write('a-save.json', clean);
  expect(npcImportPreview(await service.preview(), 'a-save.json')).toEqual({ 'b.json': ['Tom'] });
});
