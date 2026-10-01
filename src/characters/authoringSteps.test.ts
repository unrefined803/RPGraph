import { buildCharacterRegistry } from './registry';
import { describe, expect, it } from 'vitest';
import { accountsStagePending, characterAssistantPrompt, newAssistantCharacter, nextCharacterAuthoringStage, parseCharacterAssistantResult,
  runCharacterAuthoringStep, undescribedCharacterImages } from './assistant';
import type { Character } from './character';
import { characterProvenanceStages, characterStorageBadge, effectiveLibraryEntry, npcSaveDestination, visibleLibraryEntries } from './librarySummary';
import type { NpcLibraryEntry } from './npcLibrary';

const response = (patch: unknown[], extra = {}) => JSON.stringify({ reply: 'Done.', patch, ...extra });
const entry = (tier: 'user' | 'bundled' | 'saved-storybook' | 'account', id = 'same', fileName = `${tier}.json`): NpcLibraryEntry => ({
  tier, fileName, source: `${tier}:${fileName}`, character: { ...newAssistantCharacter(), id, name: 'Alex' },
});

it('saves NPC revisions to the existing writable tier or the preferred folder', () => {
  expect(npcSaveDestination([entry('bundled')], 'same', 'account-npc-characters')).toBe('account-npc-characters');
  expect(npcSaveDestination([entry('user')], 'same', 'account-npc-characters')).toBe('npc-characters');
  expect(npcSaveDestination([entry('user'), entry('account')], 'same', 'npc-characters')).toBe('account-npc-characters');
  expect(npcSaveDestination([entry('account'), entry('account', 'same', 'duplicate.json')], 'same', 'npc-characters')).toBe('account-npc-characters');
});

describe('edited built-in library entries', () => {
  it('shows only the user revision, identifies its built-in origin by ID, and restores the original when removed', () => {
    const bundled = entry('bundled');
    const user = entry('user', 'same', 'renamed.json');
    user.character.name = 'Edited Alex';
    expect(visibleLibraryEntries([bundled, user])).toEqual([{ ...user, editedBuiltIn: true }]);
    expect(visibleLibraryEntries([bundled])).toEqual([{ ...bundled, editedBuiltIn: false }]);
  });
  it('does not confuse equal names with matching identity', () => {
    const visible = visibleLibraryEntries([entry('bundled'), entry('user', 'different')]);
    expect(visible).toHaveLength(2);
    expect(visible.every((item) => !item.editedBuiltIn)).toBe(true);
  });
  it('keeps ambiguous user files visible for diagnostics instead of silently picking one', () => {
    expect(visibleLibraryEntries([entry('bundled'), entry('user'), entry('user', 'same', 'duplicate.json')])).toHaveLength(3);
  });
  it('uses the bundled fallback when local files share an ID and never picks an arbitrary duplicate', () => {
    const bundled = entry('bundled');
    const local = entry('user');
    const duplicate = entry('user', 'same', 'duplicate.json');
    expect(effectiveLibraryEntry([bundled, local], 'same')).toBe(local);
    expect(effectiveLibraryEntry([bundled, local, duplicate], 'same')).toBe(bundled);
    expect(effectiveLibraryEntry([local, duplicate], 'same')).toBeUndefined();
    expect(effectiveLibraryEntry([bundled], 'missing')).toBeUndefined();
  });
  it('hides retained recovery copies after switching back to Storybook', () => {
    for (const tier of [undefined, 'bundled', 'user'] as const) {
      for (const storybookEdited of [false, true]) {
        const options = { tier, inStorybook: true, storybookEdited };
        expect(characterProvenanceStages({ ...options, retained: true, snapshotEdited: true }))
          .toEqual(characterProvenanceStages(options));
      }
    }
    expect(characterProvenanceStages({ inStorybook: false, storybookEdited: false, retained: true })
      .map((stage) => stage.label)).toEqual(['Story NPC']);
  });
  it('shows resolution layers in priority order with the active layer last', () => {
    expect(characterProvenanceStages({ editedBuiltIn: true, localEdited: true, tier: 'user', inStorybook: true, storybookEdited: true })
      .map((stage) => stage.label)).toEqual(['Built-in', 'Local NPC', 'Storybook']);
    expect(characterProvenanceStages({ editedBuiltIn: true, localEdited: false, tier: 'user', inStorybook: false, storybookEdited: false })
      .map((stage) => stage.label)).toEqual(['Built-in', 'Local NPC']);
    expect(characterProvenanceStages({ tier: 'bundled', inStorybook: true, storybookEdited: false })
      .map((stage) => stage.label)).toEqual(['Built-in', 'Storybook']);
    expect(characterProvenanceStages({ inStorybook: true, storybookEdited: false })
      .map((stage) => stage.label)).toEqual(['Storybook']);
    expect(characterProvenanceStages({ tier: 'user', inStorybook: true, storybookEdited: false })
      .map((stage) => stage.label)).toEqual(['Local NPC', 'Storybook']);
    expect(characterProvenanceStages({ tier: 'user', inStorybook: false, storybookEdited: false })
      .map((stage) => stage.label)).toEqual(['Local NPC']);
  });
});

describe('staged character specialists', () => {
  it('commits the profile stage alone and leaves the accounts stage pending', async () => {
    const character = newAssistantCharacter();
    const initial = parseCharacterAssistantResult(response([], { steps: ['profile'] }), character);
    expect(initial.steps).toEqual(['profile']);
    const profile = await runCharacterAuthoringStep('profile', initial.character, 'Create Alex, give him OnlyFriends', [], async (prompt) => {
      expect(JSON.parse(prompt.split('Current draft: ')[1].split('\n\n')[0]).character).not.toHaveProperty('apps');
      expect(prompt).toContain('later stages handle them');
      expect(prompt).not.toContain('- shy_user: ');
      return response([{ op: 'replace', path: '/character/name', value: 'Alex' }, { op: 'replace', path: '/character/age', value: 27 }]);
    });
    expect(profile).toMatchObject({ asked: false, character: { name: 'Alex', age: 27 } });
    expect(character.name).toBe('New Character');
    expect(accountsStagePending(profile.character)).toBe(true);
  });

  it('asks for undecided accounts and tags, then completes the accounts stage in one patch', async () => {
    const created = { ...newAssistantCharacter(), name: 'Alex' };
    const question = await runCharacterAuthoringStep('accounts', created, 'Create Alex', [], async (prompt) => {
      expect(prompt).toContain('"name":"Alex"');
      expect(prompt).toContain('is an app placeholder: always replace it');
      expect(prompt).toContain('ask for exactly the missing decisions');
      expect(prompt).toContain('- shy_user: ');
      return JSON.stringify({ reply: 'Which optional accounts should Alex have?', patch: [] });
    });
    expect(question).toMatchObject({ asked: true, reply: 'Which optional accounts should Alex have?' });
    expect(question.character).toBe(created);
    const done = await runCharacterAuthoringStep('accounts', created, 'Only the standard accounts, you choose the tags', [], async () => response([
      { op: 'replace', path: '/character/apps/fotogram/profileName', value: 'alex.outdoors' },
      { op: 'replace', path: '/character/apps/fotogram/bio', value: 'Trails and coffee.' },
      { op: 'replace', path: '/character/agencyTags', value: ['hobby_friend'] },
    ]));
    expect(done).toMatchObject({ asked: false, character: { agencyTags: ['hobby_friend'],
      apps: { fotogram: { profileName: 'alex.outdoors', bio: 'Trails and coffee.' } } } });
    expect(accountsStagePending(done.character)).toBe(false);
    expect(accountsStagePending(created)).toBe(true);
  });

  it('skips the creation questions when an existing character has real accounts', async () => {
    const existing = newAssistantCharacter();
    existing.apps!.fotogram!.profileName = 'alex.outdoors';
    await runCharacterAuthoringStep('accounts', existing, 'Add a post', [], async (prompt) => {
      expect(prompt).not.toContain('ask for exactly the missing decisions');
      return response([{ op: 'replace', path: '/character/apps/fotogram/bio', value: 'New bio' }]);
    });
  });

  it('rejects specialist edits outside their scope without touching the source', async () => {
    const character = newAssistantCharacter();
    await expect(runCharacterAuthoringStep('accounts', character, 'Create', [], async () => response([
      { op: 'replace', path: '/character/name', value: 'Forbidden' },
    ]))).rejects.toThrow('outside its step: /character/name.');
    await expect(runCharacterAuthoringStep('profile', character, 'Create', [], async () => response([
      { op: 'add', path: '/character/agencyTags', value: ['shy_user'] },
    ]))).rejects.toThrow('outside its step: /character/agencyTags.');
    expect(character.name).toBe('New Character');
  });

  const photo = (id: string, description = '') => ({ id, name: `${id}.jpg`, description, mimeType: 'image/jpeg' as const, size: 3,
    dataUrl: 'data:image/jpeg;base64,/9j/', width: 1, height: 1 });
  const created = (images: Character['images'] = []): Character => ({ ...newAssistantCharacter(), name: 'Alex', description: 'A barista.', images });

  it('describes attached images with the profile as context and only edits image metadata', async () => {
    const character = created([photo('one'), photo('two', 'Existing description')]);
    expect(undescribedCharacterImages(character).map((image) => image.id)).toEqual(['one']);
    const described = await runCharacterAuthoringStep('images', character, 'Continue', ['one'], async (prompt) => {
      expect(prompt).toContain('image description authoring specialist');
      expect(prompt).toContain('Attached image IDs (in order): ["one"]');
      expect(prompt).toContain('"description":"A barista."');
      expect(prompt).not.toContain('/9j/');
      expect(prompt).not.toContain('- shy_user: ');
      return response([{ op: 'add', path: '/images/one/description', value: 'Alex behind the counter, smiling.' },
        { op: 'add', path: '/images/one/name', value: 'Alex at work' }]);
    });
    expect(described.character.images[0]).toMatchObject({ description: 'Alex behind the counter, smiling.', name: 'Alex at work', dataUrl: 'data:image/jpeg;base64,/9j/' });
    await expect(runCharacterAuthoringStep('images', character, 'Continue', ['one'], async () => response([
      { op: 'add', path: '/character/profileImage', value: { imageId: 'one' } },
    ]))).rejects.toThrow('outside its step: /character/profileImage.');
  });

  it('offers image descriptions after the profile and accounts after the images', () => {
    const draft = newAssistantCharacter();
    const withPhotos = created([photo('one'), photo('two')]);
    const vision = { vision: true };
    // No profile yet: nothing can say who is in the pictures.
    expect(nextCharacterAuthoringStage(draft, { ...draft, images: [photo('one')] }, undefined, vision)).toBeUndefined();
    expect(nextCharacterAuthoringStage(draft, withPhotos, 'profile', vision)).toBe('images');
    // Without a vision provider the images cannot be described; continue with accounts.
    expect(nextCharacterAuthoringStage(draft, withPhotos, 'profile', { vision: false })).toBe('accounts');
    const partly = { ...withPhotos, images: [photo('one', 'Alex smiling.'), photo('two')] };
    expect(nextCharacterAuthoringStage(withPhotos, partly, 'images', vision)).toBe('images');
    expect(nextCharacterAuthoringStage(partly, partly, 'images', vision)).toBeUndefined();
    const described = { ...withPhotos, images: [photo('one', 'Alex smiling.'), photo('two', 'Alex outdoors.')] };
    expect(nextCharacterAuthoringStage(partly, described, 'images', vision)).toBe('accounts');
    // A plain answer still offers to describe new images of an existing character.
    expect(nextCharacterAuthoringStage(withPhotos, withPhotos, undefined, vision)).toBe('images');
    expect(nextCharacterAuthoringStage(draft, created(), 'profile', vision)).toBe('accounts');
    const finished = { ...described, apps: { ...described.apps, fotogram: { ...described.apps!.fotogram!, profileName: 'alex.coffee' } } };
    expect(nextCharacterAuthoringStage(described, finished, 'accounts', vision)).toBeUndefined();
    expect(nextCharacterAuthoringStage(finished, finished, undefined, vision)).toBeUndefined();
  });

  it('tells the accounts stage how to work with an empty or a described gallery', async () => {
    await runCharacterAuthoringStep('accounts', created(), 'Create MatchMe too', [], async (prompt) => {
      expect(prompt).toContain('The gallery is empty. Still create the accounts and tags');
      expect(prompt).toContain('MatchMe needs a photo');
      return response([{ op: 'replace', path: '/character/apps/fotogram/profileName', value: 'alex.coffee' }]);
    });
    await runCharacterAuthoringStep('accounts', created([photo('one', 'Alex smiling.')]), 'Create accounts', [], async (prompt) => {
      expect(prompt).toContain('decide yourself which image fits where');
      expect(prompt).not.toContain('The gallery is empty');
      return response([{ op: 'replace', path: '/character/apps/fotogram/profileName', value: 'alex.coffee' }]);
    });
  });

  it('routes creation to the profile stage and rejects recursive or reordered plans', async () => {
    const character = newAssistantCharacter();
    expect(characterAssistantPrompt(character, [], 'Create a barista', [], 'npc-characters')).toContain('return steps:["profile"] and patch:[]');
    expect(parseCharacterAssistantResult(response([]), character).steps).toEqual([]);
    expect(() => parseCharacterAssistantResult(response([], { steps: ['accounts', 'profile'] }), character)).toThrow('steps');
    await expect(runCharacterAuthoringStep('profile', character, 'Create', [], async () => response([], { steps: ['accounts'] }))).rejects.toThrow('delegate');
  });
});


it('resolves saved Storybook sources between bundled characters and local overrides', () => {
  const bundled = entry('bundled');
  const saved = entry('saved-storybook');
  saved.character.playable = true;
  const user = entry('user');
  expect(visibleLibraryEntries([bundled, saved])).toEqual([{ ...saved, editedBuiltIn: false }]);
  expect(effectiveLibraryEntry([bundled, saved], 'same')).toBe(saved);
  expect(buildCharacterRegistry([bundled, saved]).characters[0]).toMatchObject({
    provenance: { tier: 'saved-storybook' }, playerSelectable: false,
  });
  expect(buildCharacterRegistry([bundled, saved, user]).characters[0].provenance.tier).toBe('user');
  expect(buildCharacterRegistry([bundled, saved, user, { ...saved, tier: 'storybook' }]).characters[0])
    .toMatchObject({ provenance: { tier: 'storybook' }, playerSelectable: true });
  expect(characterProvenanceStages({ tier: 'saved-storybook', inStorybook: false, storybookEdited: false })[0].label)
    .toBe('From Storybook');
});


it('does not present a scanned Storybook copy as an import path for active Storybook characters', () => {
  expect(characterProvenanceStages({ tier: 'saved-storybook', inStorybook: true, storybookEdited: true })
    .map((stage) => stage.label)).toEqual(['Storybook']);
  expect(characterProvenanceStages({ tier: 'bundled', inStorybook: false, storybookEdited: false, retained: true, snapshotEdited: true })
    .map((stage) => stage.label)).toEqual(['Built-in', 'Story NPC']);
});

it('distinguishes current Opening History NPC versions from RP-only revisions', () => {
  const character = entry('bundled').character;
  const options = { inStorybook: false, retained: false, character };
  expect(characterStorageBadge(options)).toBeUndefined();
  expect(characterStorageBadge({ ...options, inStorybook: true })?.label).toBe('SB');
  expect(characterStorageBadge({ ...options, retained: true })?.label).toBe('RP');
  expect(characterStorageBadge({ ...options, retained: true, openingCharacter: structuredClone(character) })?.label).toBe('SB');
  expect(characterStorageBadge({ ...options, retained: true, openingCharacter: { ...character, description: 'Older revision' } })?.label).toBe('RP');
  expect(characterStorageBadge({ ...options, inStorybook: true, retained: true, openingCharacter: { ...character, description: 'Older revision' } })?.label).toBe('SB');
});
