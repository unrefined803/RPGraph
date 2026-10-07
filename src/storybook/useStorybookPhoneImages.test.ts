import { appCharacterImage, appCharactersFromRegistry, phoneImageSource } from '../characters/appRuntime';
import { expect, it, vi } from 'vitest';
import { useStorybookPhoneImages } from './useStorybookPhoneImages';
import { chatAttachmentFromStorybookImage, storyCharactersFromNodes } from './runtime';
import { emptyRpStorybook, parseRpStorybookJson, normalizeRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { candidateStorybookRegistry, storybookRegistryEntries } from '../characters/npcParticipantRuntime';
import { buildCharacterRegistry, type CharacterRegistryEntry } from '../characters/registry';
import fixture from '../characters/fixtures/stage4-npc.json';
import type { MessageRecord, WorkflowNode } from '../types';

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

it.each([false, true].flatMap((inLibrary) => ['main', 'alias', 'link'].map((identity) => ({ inLibrary, identity }))))('links foreign phone images through sender and recipient ($identity, library: $inLibrary)', ({ inLibrary, identity }) => {
  const { options, book, library } = harness();
  const original = book.characters[0];
  const sender = { ...structuredClone(original), id: 'sender', name: 'Noah Voss', images: [],
    apps: { whatsup: { accountId: 'sender-wa', enabled: true, bio: '', alias: { name: 'Work Sender' } } }, social: undefined, profileImage: undefined };
  const recipient = { ...structuredClone(original), id: 'recipient', name: 'Espen Harper', images: [],
    apps: { whatsup: { accountId: 'recipient-wa', enabled: true, bio: '', alias: { name: 'Work Recipient' } } }, social: undefined, profileImage: undefined };
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
  const from = identity === 'main' ? sender.name : sender.apps.whatsup.alias.name;
  const to = identity === 'main' ? recipient.name : recipient.apps.whatsup.alias.name;
  const send = () => api.ensurePhoneImages(identity === 'link' ? `@whatsup:${from}` : from, identity === 'link' ? `@whatsup:${to}` : to,
    [chatAttachmentFromStorybookImage(image)], image.description, original.name);
  expect(send()?.[0].id).toBe(image.id);
  send();
  const characters = inLibrary ? [...snapshots.values()] : parseRpStorybookJson(options.nodesRef.current[0].data.storybookJson!).characters;
  expect(characters.find((entry) => entry.id === sender.id)?.images).toEqual([
    expect.objectContaining({ id: image.id, dataUrl: image.dataUrl, receivedFrom: original.name }),
  ]);
  expect(characters.find((entry) => entry.id === recipient.id)?.images).toEqual([
    expect.objectContaining({ id: image.id, dataUrl: image.dataUrl, receivedFrom: from,
      receivedFromCharacterId: sender.id, receivedFromAccountId: `sender-wa${identity === 'main' ? '' : ':alias'}` }),
  ]);
  expect(original.images[0].receivedFrom).toBeUndefined();
  const retainedPost: MessageRecord = { id: 1, role: 'output', originalText: '', socialPost: {
    app: 'onlyfriends', postId: 'original-post', author: original.name, authorHandle: 'original',
    caption: '', imageId: image.id,
  } };
  const retainedSend: MessageRecord = { id: 2, role: 'output', originalText: '', channel: 'phone',
    phoneFrom: from, phoneTo: to, phoneImageIds: [image.id] };
  const gallery = (id: string) => currentCharacterRegistry().characters.find((entry) => entry.character.id === id)!.character.images;
  // An earlier surviving delivery (or the retained regeneration input) keeps both copies.
  api.pruneExternalImagesForMessages([retainedPost, retainedSend]);
  expect(gallery(recipient.id)).toHaveLength(1);
  expect(gallery(sender.id)).toHaveLength(1);
  // Undo/regeneration removes the delivery; an unrelated original post must not retain it.
  const restorePruned = api.pruneExternalImagesForMessages([retainedPost]);
  expect(gallery(recipient.id).map((image) => image.id)).toEqual([]);
  expect(gallery(sender.id).map((image) => image.id)).toEqual([]);
  expect(gallery(original.id)).toEqual(original.images);
  if (inLibrary) {
    // A failed regeneration must be able to restore the former NPC album.
    restorePruned();
    expect(gallery(recipient.id)).toHaveLength(1);
    expect(gallery(sender.id)).toHaveLength(1);
  }

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

function uploadHarness() {
  const context = harness();
  context.options.updateRuntimeNode.mockImplementation((id, patch) => {
    const node = context.options.nodesRef.current.find((entry) => entry.id === id)!;
    node.data = { ...node.data, ...patch };
  });
  const gallery = () => parseRpStorybookJson(context.options.nodesRef.current[0].data.storybookJson!).characters[0].images;
  const upload = { id: 'computer-upload', name: 'upload.jpg', mimeType: 'image/jpeg', size: 3,
    dataUrl: 'data:image/jpeg;base64,bmV3' };
  return { ...context, gallery, upload };
}

it.each(['fotogram', 'onlyfriends'] as const)('removes a new %s computer upload on undo, including after regeneration', (app) => {
  const { api, owner, gallery, upload, book } = uploadHarness();
  const saved = api.ensureImagesForCharacter(owner, [upload], '', () => '', { turnUpload: true })![0];
  expect(gallery().find((image) => image.id === saved.id)?.turnUpload).toBe(true);
  const post: MessageRecord = { id: 10, role: 'output', originalText: '', socialPost: {
    app, postId: 'post-1', author: owner.name, authorHandle: 'owner', imageId: saved.id, caption: '',
  } };
  // Ordinary pruning and regeneration must preserve the source pixels.
  api.pruneExternalImagesForMessages([post]);
  const regenerated = { ...post, id: 20 };
  api.pruneExternalImagesForMessages([regenerated], [post]);
  expect(gallery().some((image) => image.id === saved.id)).toBe(true);
  api.pruneExternalImagesForMessages([], [regenerated]);
  expect(gallery()).toEqual(book.characters[0].images);
});

it('preserves existing gallery images when an identical computer upload is undone', () => {
  const { api, owner, book, gallery } = uploadHarness();
  const original = book.characters[0].images[0];
  const saved = api.ensureImagesForCharacter(owner, [chatAttachmentFromStorybookImage(original)], '', () => '',
    { turnUpload: true })![0];
  expect(gallery().find((image) => image.id === saved.id)?.turnUpload).toBeUndefined();
  api.pruneExternalImagesForMessages([], [{ id: 1, role: 'output', originalText: '', socialPost: {
    app: 'fotogram', postId: 'post-1', author: owner.name, authorHandle: 'owner', imageId: saved.id, caption: '',
  } }]);
  expect(gallery()).toEqual(book.characters[0].images);
});

it('keeps unsubmitted uploads and uploads referenced by surviving turns', () => {
  const { api, owner, gallery, upload } = uploadHarness();
  const saved = api.ensureImagesForCharacter(owner, [upload], '', () => '', { turnUpload: true })![0];
  api.pruneExternalImagesForMessages([]);
  expect(gallery().some((image) => image.id === saved.id)).toBe(true);
  const send: MessageRecord = { id: 1, role: 'user', originalText: '', phoneFrom: owner.name,
    phoneTo: 'Recipient', phoneImageIds: [saved.id] };
  api.pruneExternalImagesForMessages([send], [{ ...send, id: 2 }]);
  expect(gallery().some((image) => image.id === saved.id)).toBe(true);
});

it('removes a WhatsUp computer upload from both sender and recipient on undo', () => {
  const { api, options, owner, book, upload } = uploadHarness();
  const recipient = { ...structuredClone(book.characters[0]), id: 'recipient', name: 'Recipient',
    images: [], apps: {}, social: undefined, profileImage: undefined };
  options.nodesRef.current[0].data.storybookJson = rpStorybookJsonText({ ...book, characters: [book.characters[0], recipient] });
  const saved = api.ensurePhoneImages(owner.name, recipient.name, [upload])![0];
  const send: MessageRecord = { id: 1, role: 'user', originalText: '', phoneFrom: owner.name,
    phoneTo: recipient.name, phoneImageIds: [saved.id], imageAttachments: [saved] };
  api.pruneExternalImagesForMessages([send]);
  const albums = () => parseRpStorybookJson(options.nodesRef.current[0].data.storybookJson!).characters;
  expect(albums()[0].images.find((image) => image.id === saved.id)?.turnUpload).toBe(true);
  expect(albums()[1].images).toHaveLength(1);
  api.pruneExternalImagesForMessages([], [send]);
  expect(albums()[0].images).toEqual(book.characters[0].images);
  expect(albums()[1].images).toEqual([]);
});

it.each([false, true])('keeps uploaded alias images through reload and renames, then removes them on undo (sender alias: %s)', (senderAlias) => {
  const { options, book, upload } = uploadHarness();
  const sender = structuredClone(book.characters[0]);
  sender.apps!.whatsup!.alias = { name: 'Hidden Sender' };
  const recipient = { ...structuredClone(sender), id: 'recipient', name: 'Recipient', images: [], social: undefined,
    profileImage: undefined, apps: { whatsup: { accountId: 'recipient-wa', enabled: true, bio: '', alias: { name: 'Hidden Recipient' } } } };
  options.nodesRef.current[0].data.storybookJson = rpStorybookJsonText({ ...book, characters: [sender, recipient] });
  const api = useStorybookPhoneImages(options);
  const fromId = `${sender.apps!.whatsup!.accountId}${senderAlias ? ':alias' : ''}`;
  const from = senderAlias ? 'Hidden Sender' : sender.name;
  const saved = api.ensurePhoneImages(fromId, 'recipient-wa:alias', [upload])![0];
  const albums = () => parseRpStorybookJson(options.nodesRef.current[0].data.storybookJson!).characters;
  const receipt = albums()[1].images[0];
  expect(receipt).toMatchObject({ receivedFrom: from, receivedFromCharacterId: sender.id, receivedFromAccountId: fromId });
  expect(chatAttachmentFromStorybookImage(receipt)).toMatchObject({ receivedFrom: from, receivedFromCharacterId: sender.id });
  const reloaded = albums();
  reloaded[0].name = 'Renamed Sender';
  reloaded[0].apps!.whatsup!.alias!.name = 'New Sender Alias';
  reloaded[1].name = 'Renamed Recipient';
  reloaded[1].apps!.whatsup!.alias!.name = 'New Recipient Alias';
  options.nodesRef.current[0].data.storybookJson = rpStorybookJsonText({ ...book, characters: reloaded });
  const send: MessageRecord = { id: 1, role: 'user', channel: 'phone', phoneMessage: true, originalText: '',
    phoneFrom: from, phoneTo: 'Hidden Recipient', phoneFromAccountId: fromId, phoneToAccountId: 'recipient-wa:alias',
    phoneImageIds: [saved.id], imageAttachments: [saved] };
  api.pruneExternalImagesForMessages([send]);
  expect(albums()[0].images.some((image) => image.id === saved.id)).toBe(true);
  expect(albums()[1].images[0]).toMatchObject({ receivedFrom: from, receivedFromCharacterId: sender.id });
  // The same name on an unrelated account must not retain either gallery copy.
  api.pruneExternalImagesForMessages([{ ...send, id: 2, phoneFrom: 'New Sender Alias', phoneTo: 'New Recipient Alias',
    phoneFromAccountId: 'unrelated-sender', phoneToAccountId: 'unrelated-recipient' }], [send]);
  expect(albums()[0].images).toEqual(sender.images);
  expect(albums()[1].images).toEqual([]);
});

it('keeps a received image referenced through a previously issued account ID', () => {
  const { options, book, library } = harness();
  const original = book.characters[0];
  const recipient = { ...structuredClone(original), id: 'recipient', name: 'Recipient', images: [], social: undefined,
    profileImage: undefined, apps: { whatsup: { accountId: 'recipient-wa', enabled: true, bio: '' } } };
  library.push({ character: recipient, tier: 'user', source: 'recipient', aliases: { accountIds: { whatsup: ['old-recipient-wa'] } } });
  const snapshots = new Map<string, typeof original>();
  const api = useStorybookPhoneImages({ ...options,
    currentCharacterRegistry: () => {
      const registry = options.currentCharacterRegistry();
      return { ...registry, characters: registry.characters.map((entry) => entry.character.id === recipient.id
        ? { ...entry, character: snapshots.get(entry.character.id) ?? entry.character, provenance: { ...entry.provenance, tier: 'snapshot' as const } } : entry) };
    },
    updateNpcImages: (id, images) => snapshots.set(id, { ...recipient, images }),
  });
  const image = chatAttachmentFromStorybookImage(original.images[0]);
  api.ensurePhoneImages(original.name, 'recipient-wa', [image]);
  expect(snapshots.get(recipient.id)?.images).toHaveLength(1);
  const delivery: MessageRecord = { id: 1, role: 'output', originalText: '', channel: 'phone', phoneMessage: true,
    phoneFrom: original.name, phoneTo: 'Earlier Name', phoneToAccountId: 'old-recipient-wa', phoneImageIds: [image.id] };
  api.pruneExternalImagesForMessages([delivery]);
  expect(snapshots.get(recipient.id)?.images).toHaveLength(1);
  api.pruneExternalImagesForMessages([{ ...delivery, phoneToAccountId: 'unrelated-wa' }]);
  expect(snapshots.get(recipient.id)?.images).toEqual([]);
});

it('labels forwarded pictures with the forwarding account and keeps one copy across account switches', () => {
  const { options, book } = uploadHarness();
  const original = book.characters[0];
  const makeContact = (id: string, name: string, alias: string) => ({ ...structuredClone(original), id, name,
    images: [], social: undefined, profileImage: undefined,
    apps: { whatsup: { accountId: `${id}-wa`, enabled: true, bio: '', alias: { name: alias } } } });
  const forwarder = makeContact('forwarder', 'Real Forwarder', 'Hidden Forwarder');
  const recipient = makeContact('recipient', 'Real Recipient', 'Hidden Recipient');
  options.nodesRef.current[0].data.storybookJson = rpStorybookJsonText({ ...book, characters: [original, forwarder, recipient] });
  const api = useStorybookPhoneImages(options);
  const source = chatAttachmentFromStorybookImage(original.images[0]);
  api.ensurePhoneImages(original.name, 'forwarder-wa', [source]);
  api.ensurePhoneImages('forwarder-wa:alias', 'recipient-wa:alias', [source]);
  const received = () => parseRpStorybookJson(options.nodesRef.current[0].data.storybookJson!).characters[2].images;
  expect(received()).toHaveLength(1);
  expect(received()[0]).toMatchObject({ receivedFrom: 'Hidden Forwarder', receivedFromCharacterId: 'forwarder', receivedFromAccountId: 'forwarder-wa:alias' });
  api.ensurePhoneImages('forwarder-wa', 'recipient-wa', [source]);
  expect(received()).toHaveLength(1);
  expect(received()[0]).toMatchObject({ receivedFrom: 'Real Forwarder', receivedFromCharacterId: 'forwarder', receivedFromAccountId: 'forwarder-wa' });
  const earlier: MessageRecord = { id: 1, role: 'output', originalText: '', channel: 'phone', phoneMessage: true,
    phoneFrom: 'Hidden Forwarder', phoneFromAccountId: 'forwarder-wa:alias', phoneTo: 'Hidden Recipient', phoneToAccountId: 'recipient-wa:alias',
    phoneImageIds: [source.id] };
  api.pruneExternalImagesForMessages([earlier], [{ ...earlier, id: 2, phoneFrom: 'Real Forwarder', phoneFromAccountId: 'forwarder-wa' }]);
  expect(received()).toHaveLength(1);
  expect(received()[0]).toMatchObject({ receivedFrom: 'Hidden Forwarder', receivedFromCharacterId: 'forwarder', receivedFromAccountId: 'forwarder-wa:alias' });
});

it('resolves an alias sender to their own image even when another gallery uses a colliding ID', () => {
  const { options, book } = harness();
  const owner = book.characters[0];
  owner.apps!.whatsup!.alias = { name: 'Hidden Owner' };
  const other = { ...structuredClone(owner), id: 'other', name: 'Other', apps: {},
    images: [{ ...owner.images[0], dataUrl: 'data:image/jpeg;base64,b3RoZXI=' }] };
  const characters = appCharactersFromRegistry(buildCharacterRegistry([
    { character: owner, tier: 'user', source: 'owner' }, { character: other, tier: 'user', source: 'other' },
  ]));
  expect(phoneImageSource(characters, owner.images[0].id, `${owner.apps!.whatsup!.accountId}:alias`)?.image.dataUrl).toBe(owner.images[0].dataUrl);
  expect(options.updateRuntimeNode).not.toHaveBeenCalled();
});
