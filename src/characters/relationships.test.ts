import { applyRpStorybookEditorJson, rpStorybookEditorJsonView } from '../nodes/rp-storybook-editor/rawJson';
import { describe, expect, it } from 'vitest';
import { createAuthoredCharacter, createCharacterContainer } from './creator';
import { validateCharacterPayload, type Character, type CharacterRelationship } from './character';
import { appCharactersFromRegistry, recipientCharacterContext } from './appRuntime';
import { buildCharacterRegistry } from './registry';
import { characterReferenceCandidates, hasAuthoredConnection, hydrateAddedCharacterReferences, relationshipReferenceContext, searchRelationshipCharacters, validateRelationshipTargets } from './relationships';
import { emptyRpStorybook, normalizeRpStorybook, parseRpStorybookAssistantResult, parseRpStorybookJson, rpStorybookFormattedText, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { buildSocialDirectory, socialConnectionIds, withAuthoredSocialConnections, withSocialConnectionAdded, withSocialDirectoryConnectionAdded } from '../chat/socialDirectory';
import { canSendMatchMeMessage, incomingMatchMeMessage, matchMeContext, matchMeMessageAllowed, matchMeState } from '../chat/matchMe';
import { phoneRuntimeCharactersFromMessages } from '../chat/phoneCharacters';
import { planCharacterCardImport } from '../storybook/characterCard';
import { newAssistantCharacter, parseCharacterAssistantResult, runCharacterAuthoringSteps } from './assistant';
import type { MessageRecord } from '../types';

const photo = { id: 'photo', name: 'Portrait', mimeType: 'image/jpeg' as const, size: 3, dataUrl: 'data:image/jpeg;base64,YWJj', description: 'A fictional portrait.' };
function person(id: string, relationships: CharacterRelationship[] = []): Character {
  const container = createAuthoredCharacter({ id, name: `Person ${id}`, relationships, images: [{ ...photo, id: `${id}-photo` }],
    description: `${id} background`, personality: 'Patient', speechStyle: 'Direct', hiddenAgency: 'NEVER_IN_CONTEXT',
    apps: { onlyfriends: { username: `${id}.of` }, matchme: { username: `${id}.mm`, displayName: `Person ${id}`, bio: 'Hello',
      profile: { name: `Person ${id}`, age: 25, bio: 'Hello', interests: 'Art', photoIds: [`${id}-photo`], decisions: {} } } },
  }, () => id);
  return planCharacterCardImport(container, structuredClone(emptyRpStorybook)).character;
}
const link = (characterId: string, apps: CharacterRelationship['apps'], description = '') => ({ characterId, apps, description });
function runtime(player: Character, ...npcs: Character[]) {
  return appCharactersFromRegistry(buildCharacterRegistry([
    { character: player, tier: 'storybook', source: 'book', aliases: { characterIds: [`book:${player.id}`] } },
    ...npcs.map((character) => ({ character, tier: 'user' as const, source: `${character.id}.json` })),
  ]));
}

describe('authored character relationships', () => {
  it('stores independent app choices, preserves portable and Storybook round trips and does not import contacts', () => {
    const source = person('a', [link('b', { whatsup: true }, 'Her manager.'), link('c', { fotogram: true, onlyfriends: true }, 'An artist she follows.')]);
    const before = structuredClone(source);
    const exported = createCharacterContainer(source, true);
    const imported = planCharacterCardImport(exported, structuredClone(emptyRpStorybook));
    const restored = parseRpStorybookJson(rpStorybookJsonText(imported.storybook));
    expect(restored.characters).toHaveLength(1);
    expect(restored.characters[0].relationships).toEqual(source.relationships);
    expect(source).toEqual(before);
    expect(createCharacterContainer(restored.characters[0], true).character.relationships).toEqual(source.relationships);
  });

  it('rejects malformed relationships without resolving external IDs during container validation', () => {
    const source = person('a');
    for (const relationships of [null, {}, [link('a', {})], [link('b', {}), link('b', {})],
      [link('b', { whatsup: 'yes' } as never)], [link('b', { unknown: true } as never)], [{ characterId: 'b', apps: {} }]]) {
      expect(() => validateCharacterPayload({ ...source, relationships })).toThrow(/relationship/i);
      expect(() => normalizeRpStorybook({ ...emptyRpStorybook, characters: [{ ...source, relationships }] })).toThrow(/relationship/i);
    }
    expect(() => validateCharacterPayload({ ...source, relationships: [link('missing-library-person', { fotogram: true })] })).not.toThrow();
  });

  it('migrates old visible pairs once, keeps blocked pairs absent and respects explicit empty lists', () => {
    const a = person('a'); const b = person('b'); const c = person('c');
    delete a.relationships; delete b.relationships; delete c.relationships;
    const story = normalizeRpStorybook({ ...emptyRpStorybook, characters: [a, b, c], phoneContacts: { blocked: [{ owner: 'a', contact: 'c' }] } });
    expect(story.characters[0].relationships).toEqual([link('b', { whatsup: true, fotogram: true })]);
    expect(story.characters[2].relationships).toEqual([link('b', { whatsup: true, fotogram: true })]);
    expect(parseRpStorybookJson(rpStorybookJsonText(story)).characters.map((entry) => entry.relationships)).toEqual(story.characters.map((entry) => entry.relationships));
    const edited = { ...story, characters: story.characters.map((entry) => ({ ...entry, relationships: [] })) };
    expect(normalizeRpStorybook(edited).characters.every((entry) => !entry.relationships?.length)).toBe(true);
    const importedOld = planCharacterCardImport({ ...createCharacterContainer(a), character: a }, story);
    expect(importedOld.character.relationships).toEqual([]);
  });

  it('does not infer connections for newly authored characters or from description mentions', () => {
    const a = person('a');
    const b = person('b'); delete b.relationships;
    const story = normalizeRpStorybook({ ...emptyRpStorybook, characters: [a] });
    const result = parseRpStorybookAssistantResult(JSON.stringify({ reply: 'Added.', patch: [{ op: 'add', path: '/characters/-', value: b }] }), story);
    expect(result.storybook.characters[1].relationships).toEqual([]);
    const characters = runtime(person('a', [link('b', {}, '@Person b is her friend.')]), person('b'));
    expect(hasAuthoredConnection(characters[0], characters[1], 'whatsup')).toBe(false);
  });

  it('clears relationships through assistant and raw JSON removal without restoring legacy contacts', () => {
    const story = normalizeRpStorybook({ ...emptyRpStorybook, characters: [person('a', [link('b', { whatsup: true, fotogram: true })]), person('b')] });
    const result = parseRpStorybookAssistantResult(JSON.stringify({ reply: 'Cleared.', patch: [{ op: 'remove', path: '/characters/0/relationships' }] }), story);
    expect(result.storybook.characters[0].relationships).toEqual([]);
    const draft = JSON.parse(rpStorybookEditorJsonView(story));
    delete draft.characters[0].relationships;
    const edited = applyRpStorybookEditorJson(story, JSON.stringify(draft));
    expect('storybook' in edited && edited.storybook.characters[0].relationships).toEqual([]);
    expect(story.characters[0].relationships).toHaveLength(1);
  });

  it('projects WhatsUp, Fotogram and OnlyFriends separately and directionally without mutating session activity', () => {
    const characters = runtime(person('a', [link('b', { whatsup: true }), link('c', { fotogram: true, onlyfriends: true })]), person('b'), person('c'));
    const users = buildSocialDirectory({ storyCharacters: characters, messages: [] }).users;
    const saved = {};
    const connections = withAuthoredSocialConnections(saved, characters, users);
    const viewer = characters[0];
    expect(socialConnectionIds(connections, viewer.id, 'whatsup', characters)).toEqual([characters[1].apps!.whatsup!.accountId]);
    expect(socialConnectionIds(connections, viewer.id, 'fotogram', characters)).toEqual([users.find((user) => user.characterId === 'c')!.id]);
    expect(socialConnectionIds(connections, viewer.id, 'onlyfriends', characters)).toHaveLength(1);
    expect(socialConnectionIds(connections, 'b', 'whatsup', characters)).toEqual([]);
    expect(socialConnectionIds(connections, 'c', 'fotogram', characters)).toEqual([]);
    expect(phoneRuntimeCharactersFromMessages(characters, [], new Set(Object.values(connections).flatMap((apps) => apps.whatsup ?? []))).map((entry) => entry.sourceId)).toEqual(['a', 'b']);
    expect(saved).toEqual({});
    expect(withAuthoredSocialConnections(saved, runtime(person('a'), person('b'), person('c')), users)).toEqual({});
  });

  it('keeps live follows directional while retaining older explicit reciprocal records', () => {
    const characters = runtime(person('a'), person('b'));
    const users = buildSocialDirectory({ storyCharacters: characters, messages: [] }).users;
    const b = users.find((user) => user.characterId === 'b')!;
    const connections = withSocialDirectoryConnectionAdded({}, users, characters[0].id, 'fotogram', b.id);
    expect(socialConnectionIds(connections, 'b', 'fotogram', characters)).toEqual([]);
    const historical = withSocialConnectionAdded(connections, 'b', 'fotogram', users[0].id);
    expect(withAuthoredSocialConnections(historical, characters, users)).toEqual(historical);
  });

  it('uses stable IDs across promotion and renames and never binds missing or ambiguous targets by name', () => {
    const a = person('a', [link('b', { fotogram: true })]);
    const b = person('b');
    const promoted = { ...b, name: 'Renamed Person' };
    const characters = appCharactersFromRegistry(buildCharacterRegistry([
      { character: a, tier: 'storybook', source: 'book' }, { character: b, tier: 'user', source: 'old.json' },
      { character: promoted, tier: 'storybook', source: 'book' },
    ]));
    expect(characters).toHaveLength(2);
    expect(hasAuthoredConnection(characters[0], characters[1], 'fotogram')).toBe(true);
    const namesake = { ...person('other'), name: b.name };
    const missing = runtime(a, namesake);
    expect(withAuthoredSocialConnections({}, missing, buildSocialDirectory({ storyCharacters: missing, messages: [] }).users)).toEqual({});
    const ambiguous = [...runtime(a, b), runtime(a, b)[1]];
    expect(withAuthoredSocialConnections({}, ambiguous, buildSocialDirectory({ storyCharacters: ambiguous, messages: [] }).users)).toEqual({});
  });

  it('retains authored flags but grants nothing when a target app is disabled', () => {
    const a = person('a', [link('b', { whatsup: true, fotogram: true, onlyfriends: true, matchme: true })]);
    const b = person('b'); Object.values(b.apps!).forEach((account) => { account.enabled = false; });
    const characters = runtime(a, b);
    expect(withAuthoredSocialConnections({}, characters, buildSocialDirectory({ storyCharacters: characters, messages: [] }).users)).toEqual({});
    expect(matchMeState(characters, []).matches).toEqual([]);
    expect(a.relationships![0].apps.matchme).toBe(true);
  });

  it('makes starting MatchMe matches reciprocal and lets timeline unmatches override them after reload', () => {
    const characters = runtime(person('a', [link('b', { matchme: true }, 'They matched last week.')]), person('b'));
    const state = matchMeState(characters, []);
    const [a, b] = characters.map((entry) => entry.apps!.matchme!.accountId);
    expect(state.matches).toHaveLength(1);
    expect(canSendMatchMeMessage(a, b, state)).toBe(true);
    expect(canSendMatchMeMessage(b, a, state)).toBe(true);
    const direct = incomingMatchMeMessage(b, a, 'Hello', state, 'dm', '2026-09-13T12:00:00Z')!;
    expect(matchMeMessageAllowed(direct, state)).toBe(true);
    expect(matchMeContext(state, direct)).toContain('Pre-existing match');
    expect(matchMeContext(state)).not.toContain('1970');
    const inactive = { ...state.matches[0], authored: undefined, matchedAt: '2026-09-13T12:00:00Z', status: 'inactive' as const };
    const messages: MessageRecord[] = [{ id: 1, role: 'user', originalText: '', matchMeMatch: inactive }];
    expect(canSendMatchMeMessage(a, b, matchMeState(characters, JSON.parse(JSON.stringify(messages))))).toBe(false);
    expect(canSendMatchMeMessage(a, b, matchMeState(characters, []))).toBe(true);
  });

  it('includes attributed relationships in recipient context and keeps hidden agency opt-in', () => {
    const a = person('a', [link('b', { whatsup: true }, 'B is her older sister.')]);
    const b = person('b');
    const characters = runtime(a, b);
    expect(recipientCharacterContext(characters[1])).toContain("Person a's relationship to Person b: B is her older sister.");
    expect(recipientCharacterContext(characters[0])).toContain('Person b [b]');
    expect(recipientCharacterContext(characters[0])).not.toContain('NEVER_IN_CONTEXT');
    const story = normalizeRpStorybook({ ...emptyRpStorybook, characters: [a, b] });
    expect(rpStorybookFormattedText(story)).toContain('B is her older sister.');
    expect(rpStorybookFormattedText(story)).not.toContain('NEVER_IN_CONTEXT');
    expect(rpStorybookFormattedText(story, { hiddenAgency: true })).toContain('NEVER_IN_CONTEXT');
    expect(rpStorybookFormattedText(story, { relationships: false })).not.toContain('B is her older sister.');
  });

  it('searches from one letter with five results and attaches only selected compact context', () => {
    const characters = Array.from({ length: 8 }, (_, index) => person(`a${index}`));
    expect(searchRelationshipCharacters(characters, '')).toEqual([]);
    expect(searchRelationshipCharacters(characters, '@p')).toHaveLength(5);
    expect(searchRelationshipCharacters(characters, 'A7')[0].id).toBe('a7');
    const context = relationshipReferenceContext(['a7', 'a7', 'missing'], characters);
    expect(context).toContain('a7 background');
    expect(context).not.toContain('a0 background');
    expect(context).not.toContain('data:image');
    expect(context).not.toContain('NEVER_IN_CONTEXT');
    expect(context).not.toContain('decisions');
    expect(characterReferenceCandidates([{ ...characters[0], name: 'Draft Name' }], characters)).toHaveLength(8);
    expect(searchRelationshipCharacters([...characters, characters[0]], 'a0')).toEqual([]);
  });

  it('supports relationship patches in both assistants and the existing profile specialist', async () => {
    const original = newAssistantCharacter();
    const relationship = link('b', { onlyfriends: true }, 'An artist she follows.');
    const response = JSON.stringify({ reply: 'Updated.', patch: [{ op: 'add', path: '/character/relationships', value: [relationship] }] });
    const result = parseCharacterAssistantResult(response, original);
    expect(result.character.relationships).toEqual([relationship]);
    expect(original.relationships).toEqual([]);
    const initial = parseCharacterAssistantResult(JSON.stringify({ reply: 'Creating.', patch: [], steps: ['profile'] }), original);
    const staged = await runCharacterAuthoringSteps(initial, relationshipReferenceContext(['b'], [person('b')]), [], async (_step, prompt) => {
      expect(prompt).toContain('b background');
      return response;
    });
    expect(staged.character.relationships).toEqual([relationship]);
    const book = normalizeRpStorybook({ ...emptyRpStorybook, characters: [original] });
    const storyResult = parseRpStorybookAssistantResult(JSON.stringify({ reply: 'Updated.', patch: [{ op: 'add', path: '/characters/0/relationships', value: [relationship] }] }), book);
    expect(storyResult.storybook.characters[0].relationships).toEqual([relationship]);
    expect(() => validateRelationshipTargets([result.character], [original], [])).toThrow('Unknown relationship target');
    expect(() => validateRelationshipTargets([result.character], [original], [person('b')])).not.toThrow();
    expect(() => validateRelationshipTargets([result.character], [result.character], [])).not.toThrow();
  });

  it('hydrates an assistant-added selected NPC from its authoritative container', () => {
    const existing = person('a');
    const selected = person('b', [link('a', { whatsup: true }, 'A close friend.')]);
    const modelPlaceholder = { ...selected, description: 'Paraphrased', images: [], apps: {} };
    const hydrated = hydrateAddedCharacterReferences(
      [existing, modelPlaceholder], [existing], ['b'], [existing, selected],
    );
    expect(hydrated[1]).toEqual({ ...selected, playable: true });
    expect(hydrated[1].images).toEqual(selected.images);
    expect(hydrated[1].apps).toEqual(selected.apps);
    expect(hydrateAddedCharacterReferences([existing], [existing], ['b'], [selected])).toEqual([existing]);
  });

  it('keeps relationship edits requested while importing an authoritative NPC', () => {
    const existing = person('a');
    const selected = person('b', [link('c', { fotogram: true }, 'Existing library connection.')]);
    const placeholder = { ...selected, images: [], apps: {}, relationships: [
      link('a', { whatsup: true }, 'A new Storybook friend.'),
    ] };
    const hydrated = hydrateAddedCharacterReferences(
      [existing, placeholder], [existing], ['b'], [existing, selected],
    );
    expect(hydrated[1].relationships).toEqual([
      link('c', { fotogram: true }, 'Existing library connection.'),
      link('a', { whatsup: true }, 'A new Storybook friend.'),
    ]);
    expect(hydrated[1].images).toEqual(selected.images);
  });
});
