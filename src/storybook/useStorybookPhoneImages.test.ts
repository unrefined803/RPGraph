import { appCharacterImage, appCharactersFromRegistry } from '../characters/appRuntime';
import { expect, it, vi } from 'vitest';
import { useStorybookPhoneImages } from './useStorybookPhoneImages';
import { chatAttachmentFromStorybookImage, storyCharactersFromNodes } from './runtime';
import { emptyRpStorybook, parseRpStorybookJson, normalizeRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
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

it.each(['fotogram', 'matchme'] as const)('validates phone %s names against its naming policy', (app) => {
  const { api, library, owner, updateRuntimeNode, book } = harness();
  const npc = structuredClone(book.characters[0]);
  npc.id = 'library-npc';
  npc.name = 'Library NPC';
  for (const [kind, account] of Object.entries(npc.apps!)) {
    account.accountId = `library-${kind}`;
    account.profileName = `library.${kind}`;
    account.legacyHandles = [];
  }
  library.push({ character: npc, tier: 'user', source: 'npc.json' });
  const username = npc.apps![app]!.profileName!;
  const saved = app === 'fotogram' ? api.saveSocialUsername(owner, app, username) :
    api.saveDatingProfile(owner, { ...book.characters[0].apps!.matchme!.profile!, name: username });
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

it.each([false, true])('links foreign phone images through sender and recipient (library: %s)', (inLibrary) => {
  const { options, book, library } = harness();
  const original = book.characters[0];
  const sender = { ...structuredClone(original), id: 'sender', name: 'Noah Voss', images: [], apps: {} };
  const recipient = { ...structuredClone(original), id: 'recipient', name: 'Espen Harper', images: [], apps: {} };
  const snapshots = new Map<string, typeof original>();
  if (inLibrary) {
    library.push({ character: sender, tier: 'user', source: 'sender' },
      { character: recipient, tier: 'user', source: 'recipient' });
  } else {
    options.nodesRef.current[0].data.storybookJson = rpStorybookJsonText({ ...book, characters: [original, sender, recipient] });
  }
  options.updateRuntimeNode.mockImplementation((id, patch) => {
    const node = options.nodesRef.current.find((entry) => entry.id === id)!;
    node.data = { ...node.data, ...patch };
  });
  const registry = options.currentCharacterRegistry;
  const currentCharacterRegistry = () => buildCharacterRegistry([
    ...registry().characters.map((entry) => ({ character: entry.character, tier: 'user' as const, source: entry.provenance.source })),
    ...storybookRegistryEntries(options.nodesRef.current),
    ...[...snapshots.values()].map((character) => ({ character, tier: 'snapshot' as const, source: character.id })),
  ]);
  const api = useStorybookPhoneImages({ ...options, currentCharacterRegistry,
    updateNpcImages: (id, images) => {
      const character = currentCharacterRegistry().characters.find((entry) => entry.character.id === id)!.character;
      snapshots.set(id, { ...character, images });
    },
  });
  const image = original.images[0];
  const send = () => api.ensurePhoneImages(sender.name, recipient.name,
    [chatAttachmentFromStorybookImage(image)], image.description, original.name);
  expect(send()?.[0].id).toBe(image.id);
  send();
  const characters = inLibrary ? [...snapshots.values()] : parseRpStorybookJson(options.nodesRef.current[0].data.storybookJson!).characters;
  expect(characters.find((entry) => entry.id === sender.id)?.images).toEqual([
    expect.objectContaining({ id: image.id, dataUrl: image.dataUrl, receivedFrom: original.name }),
  ]);
  expect(characters.find((entry) => entry.id === recipient.id)?.images).toEqual([
    expect.objectContaining({ id: image.id, dataUrl: image.dataUrl, receivedFrom: sender.name }),
  ]);
  expect(original.images[0].receivedFrom).toBeUndefined();
});

it('keeps an unbound social post image visible after forwarding it to another gallery', () => {
  const { options, book } = harness();
  const owner = book.characters[0];
  const recipient = { ...structuredClone(owner), id: 'recipient', name: 'Jack Carter', images: [], apps: {} };
  options.nodesRef.current[0].data.storybookJson = rpStorybookJsonText({ ...book, characters: [recipient, owner] });
  options.updateRuntimeNode.mockImplementation((id, patch) => {
    const node = options.nodesRef.current.find((entry) => entry.id === id)!;
    node.data = { ...node.data, ...patch };
  });
  const api = useStorybookPhoneImages(options);
  const characters = () => appCharactersFromRegistry(options.currentCharacterRegistry());
  const image = owner.images[0];
  const original = appCharacterImage(characters(), image.id);
  expect(original?.dataUrl).toBe(image.dataUrl);
  api.ensurePhoneImages(owner.name, recipient.name, [chatAttachmentFromStorybookImage(image)]);
  expect(characters().filter((character) => character.images?.some((entry) => entry.id === image.id))).toHaveLength(2);
  expect(appCharacterImage(characters(), image.id)).toEqual(original);
  expect(appCharacterImage(characters(), image.id, owner.id)).toEqual(original);
  expect(appCharacterImage(characters(), image.id, 'unknown-owner')).toBeUndefined();
});


it('saves a separate dating identity from the phone without renaming the character', () => {
  const { api, owner, book, updateRuntimeNode } = harness();
  const original = book.characters[0];
  const profile = { ...original.apps!.matchme!.profile!, name: 'Dating Persona', age: 29, gender: 'nonbinary' as const };
  expect(api.saveDatingProfile(owner, profile)).toBe(true);
  const saved = parseRpStorybookJson(updateRuntimeNode.mock.calls[0][1].storybookJson).characters[0];
  expect(saved.name).toBe(original.name);
  expect(saved.age).toBe(original.age);
  expect(saved.gender).toBe(original.gender);
  expect(saved.apps!.matchme!.accountId).toBe(original.apps!.matchme!.accountId);
  expect(saved.apps!.matchme!.profileName).toBe('Dating Persona');
  expect(saved.social!.plotTwist).toMatchObject({ name: 'Dating Persona', age: 29, gender: 'nonbinary' });
  expect(saved.images).toEqual(original.images);
});
