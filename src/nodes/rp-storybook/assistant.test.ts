import { describe, expect, it } from 'vitest';
import { storybookAssistantConversationContext } from '../../storybook/assistantConversation';
import { characterPayload, validateCharacterPayload } from '../../characters/character';
import { normalizeDatingProfile } from '../../chat/datingProfile';
import {
  defaultRpStorybookImageDescriptionPrompt,
  normalizeRpStorybook,
  rpStorybookImageDescriptionContext,
  rpStorybookImageRevisionPrompt,
  parseRpStorybookAssistantResult,
  rpStorybookEditPrompt,
  rpStorybookIdentityLockViolations,
  rpStorybookJsonText,
  parseRpStorybookJson,
  rpStorybookPromptJsonText,
  starterRpStorybook,
} from './model';

function apply(patch: unknown[], fallback = starterRpStorybook, changedFields = ['invented']) {
  return parseRpStorybookAssistantResult(JSON.stringify({ reply: 'Done.', changedFields, patch }), fallback);
}

describe('Storybook assistant patches', () => {
  it('adds, edits and clears optional hidden agency through saved Storybooks', () => {
    const added = apply([{ op: 'add', path: '/characters/0/hiddenAgency', value: 'Protect a concealed ally.' }]).storybook;
    const restored = parseRpStorybookJson(rpStorybookJsonText(added));
    expect(restored.characters[0].hiddenAgency).toBe('Protect a concealed ally.');
    expect(JSON.parse(rpStorybookPromptJsonText(restored)).characters[0].hiddenAgency).toBe('Protect a concealed ally.');
    const edited = apply([{ op: 'replace', path: '/characters/0/hiddenAgency', value: 'Find the missing witness.' }], restored).storybook;
    expect(edited.characters[0].hiddenAgency).toBe('Find the missing witness.');
    const cleared = apply([{ op: 'replace', path: '/characters/0/hiddenAgency', value: '' }], edited).storybook;
    expect(cleared.characters[0].hiddenAgency).toBe('');
    expect(starterRpStorybook.characters[0].hiddenAgency).toBeUndefined();
  });

  it('clears image-generation settings without restoring the old values', () => {
    const book = normalizeRpStorybook({ ...starterRpStorybook, characters: [{
      ...starterRpStorybook.characters[0],
      comfyConfig: { loraName: 'portrait.safetensors', loraUrl: 'https://example.com/lora', appearance: 'Red hair' },
    }] });
    const result = apply(['loraName', 'loraUrl', 'appearance'].map((field) => ({
      op: 'replace', path: `/characters/0/comfyConfig/${field}`, value: '',
    })), book);
    expect(result.storybook.characters[0].comfyConfig).toEqual({ loraName: '', loraUrl: '', appearance: '' });
    expect(book.characters[0].comfyConfig?.appearance).toBe('Red hair');
  });

  it('reports actual changes instead of trusting the response metadata', () => {
    expect(apply([{ op: 'replace', path: '/title', value: 'Changed' }]).changedFields).toEqual(['title']);
    expect(apply([]).changedFields).toEqual([]);
    expect(apply([{ op: 'replace', path: '/title', value: starterRpStorybook.title }]).changedFields).toEqual([]);
    expect(apply([{ op: 'replace', path: '/openingHistory/summary', value: 'Ignored' }]).changedFields).toEqual([]);
  });

  it('identifies a failing operation and leaves the original document untouched', () => {
    const before = JSON.stringify(starterRpStorybook);
    expect(() => apply([
      { op: 'replace', path: '/title', value: 'Changed' },
      { op: 'replace', path: '/characters/mira/name', value: 'Mara' },
    ])).toThrow('Patch operation 2 (/characters/mira/name) failed:');
    expect(JSON.stringify(starterRpStorybook)).toBe(before);
  });

  it.each(['', '01', '-1', '1.0', '-', '99'])('rejects invalid array index %j', (index) => {
    expect(() => apply([{ op: 'replace', path: `/characters/${index}/name`, value: 'Wrong' }])).toThrow();
  });

  it.each(['__proto__', 'constructor/prototype'])('rejects inherited property traversal through %s', (path) => {
    expect(() => apply([{ op: 'add', path: `/${path}/storybookPatchProbe`, value: true }])).toThrow('forbidden property');
    expect(Object.prototype).not.toHaveProperty('storybookPatchProbe');
  });

  it.each(['add', 'replace', 'test'])('requires a value for %s', (op) => {
    expect(() => apply([{ op, path: '/title' }])).toThrow('requires a value');
  });

  it('rejects invalid pointer escapes and moves into descendant paths', () => {
    expect(() => apply([{ op: 'add', path: '/bad~2field', value: '' }])).toThrow('must escape');
    expect(() => apply([{ op: 'move', from: '/characters/0', path: '/characters/0/nested' }])).toThrow('own child');
  });

  it('supports appending a character followed by an edit at its numeric index', () => {
    const result = apply([
      { op: 'add', path: '/characters/-', value: { id: 'new-person', name: 'New Person', images: [] } },
      { op: 'replace', path: '/characters/2/name', value: 'Alex' },
    ]);
    expect(result.storybook.characters[2]).toMatchObject({ id: 'new-person', name: 'Alex' });
    expect(result.storybook.characters.slice(0, 2)).toEqual(starterRpStorybook.characters);
  });
});

it('provides a consistent editing contract to the model', () => {
  const prompt = rpStorybookEditPrompt(rpStorybookPromptJsonText(starterRpStorybook), 'Rename Mira.', true);
  expect(prompt).toContain('/characters/{index}/name');
  expect(prompt).toContain('zero-based array indices');
  expect(prompt).toContain('Character identity is locked');
  expect(prompt).toContain('never patch them, even on request');
  expect(prompt).toContain('do not repeat earlier edits');
});


describe('assistant app profile lifecycle', () => {
  const account = (app: string) => ({
    accountId: `character:${starterRpStorybook.characters[0].id}:${app}`,
    enabled: true, username: 'nova.profile', displayName: 'Nova online', bio: 'Hello there',
  });

  it('creates, edits and deletes OnlyFriends without restoring the legacy account', () => {
    const created = apply([{ op: 'add', path: '/characters/0/apps/onlyfriends', value: account('onlyfriends') }]).storybook;
    expect(created.characters[0].social?.onlyfriendsUsername).toBe('nova.profile');
    const edited = apply([
      { op: 'replace', path: '/characters/0/apps/onlyfriends/displayName', value: 'New display' },
      { op: 'replace', path: '/characters/0/apps/onlyfriends/bio', value: '' },
    ], created).storybook;
    expect(edited.characters[0].name).toBe(starterRpStorybook.characters[0].name);
    expect(edited.characters[0].apps?.onlyfriends).toMatchObject({
      accountId: account('onlyfriends').accountId, enabled: true, profileName: 'New display', bio: '',
      legacyHandles: expect.arrayContaining(['nova.profile', 'Nova online']),
    });
    expect(edited.characters[0].apps?.onlyfriends).not.toHaveProperty('username');
    expect(edited.characters[0].apps?.onlyfriends).not.toHaveProperty('displayName');
    const deleted = apply([{ op: 'remove', path: '/characters/0/apps/onlyfriends' }], edited).storybook;
    expect(deleted.characters[0].apps?.onlyfriends).toBeUndefined();
    expect(deleted.characters[0].social?.onlyfriendsUsername).toBe('');
    expect(rpStorybookIdentityLockViolations(edited, deleted).length).toBeGreaterThan(0);
    expect(rpStorybookIdentityLockViolations(created, edited)).toEqual([]);
  });

  it.each([false, true])('activates photo-less OnlyFriends with privacyMode=%s through storage', (privacyMode) => {
    const book = normalizeRpStorybook({ ...starterRpStorybook, characters: [{
      ...starterRpStorybook.characters[0], images: [], profileImage: undefined,
    }] });
    const created = apply([{ op: 'add', path: '/characters/0/apps/onlyfriends', value: {
      accountId: account('onlyfriends').accountId, enabled: true,
      profileName: 'nova.private', bio: '', privacyMode,
    } }], book).storybook;
    const character = parseRpStorybookJson(rpStorybookJsonText(created)).characters[0];
    expect(character.apps?.onlyfriends).toMatchObject({ enabled: true, privacyMode, profileName: 'nova.private' });
    expect(character.apps?.onlyfriends?.avatarImageId).toBeUndefined();
    expect(character.images).toEqual([]);
    expect(character.profileImage).toBeUndefined();
    expect(character.social?.onlyfriendsUsername).toBe('nova.private');
    expect(() => validateCharacterPayload(characterPayload(character))).not.toThrow();
  });

  it('creates and updates MatchMe with gallery references, then removes its runtime projection', () => {
    const book = normalizeRpStorybook({ ...starterRpStorybook, characters: [{
      ...starterRpStorybook.characters[0],
      images: [{ id: 'profile-photo', name: 'Portrait', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==', description: 'Portrait' }],
    }] });
    const photoId = book.characters[0].images[0].id;
    const profile = { name: 'Nova online', age: 25, bio: 'Hello there', interests: 'Music', photoIds: [photoId], decisions: {} };
    const created = apply([{ op: 'add', path: '/characters/0/apps/matchme', value: { ...account('matchme'), profile } }], book).storybook;
    expect(created.characters[0].social?.plotTwist).toMatchObject(profile);
    const edited = apply([
      { op: 'replace', path: '/characters/0/apps/matchme/displayName', value: 'New display' },
      { op: 'replace', path: '/characters/0/apps/matchme/profile/name', value: 'New display' },
      { op: 'add', path: '/characters/0/apps/fotogram/avatarImageId', value: photoId },
    ], created).storybook;
    expect(edited.characters[0].social?.plotTwist?.name).toBe('New display');
    expect(edited.characters[0].name).toBe(book.characters[0].name);
    expect(edited.characters[0].images).toEqual(book.characters[0].images);
    expect(edited.characters[0].apps?.fotogram?.avatarImageId).toBe(photoId);
    const deleted = apply([
      { op: 'remove', path: '/characters/0/apps/matchme' },
      { op: 'remove', path: '/characters/0/apps/fotogram/avatarImageId' },
    ], edited).storybook;
    expect(deleted.characters[0].apps?.matchme).toBeUndefined();
    expect(deleted.characters[0].social?.plotTwist).toBeUndefined();
    expect(deleted.characters[0].apps?.fotogram?.avatarImageId).toBeUndefined();
  });

  it('deactivates and reactivates Fotogram while retaining its identity', () => {
    const disabled = apply([{ op: 'replace', path: '/characters/0/apps/fotogram/enabled', value: false }]).storybook;
    expect(disabled.characters[0].social?.fotogramUsername).toBe('');
    const enabled = apply([{ op: 'replace', path: '/characters/0/apps/fotogram/enabled', value: true }], disabled).storybook;
    expect(enabled.characters[0].apps?.fotogram).toEqual(starterRpStorybook.characters[0].apps?.fotogram);
    expect(rpStorybookIdentityLockViolations(starterRpStorybook, disabled).length).toBeGreaterThan(0);
  });
});


it('preserves a photo-less MatchMe draft through patches and storage until activation', () => {
  const profile = { name: 'Ryan online', age: 28, bio: 'Hello', interests: 'Music', seeking: ['woman'], photoIds: [], decisions: {} };
  const result = apply([{ op: 'add', path: '/characters/0/apps/matchme', value: {
    accountId: `character:${starterRpStorybook.characters[0].id}:matchme`,
    enabled: false, username: 'ryan.online', displayName: profile.name, bio: profile.bio, profile,
  } }]).storybook;
  const reloaded = parseRpStorybookJson(rpStorybookJsonText(result));
  const character = reloaded.characters[0];
  expect(character.apps?.matchme?.profile).toMatchObject(profile);
  expect(character.social?.plotTwist).toBeUndefined();
  expect(() => validateCharacterPayload(characterPayload(character))).not.toThrow();
  expect(normalizeDatingProfile(character.apps?.matchme?.profile, true)).toMatchObject(profile);
  expect(normalizeDatingProfile(character.apps?.matchme?.profile)).toBeUndefined();
  expect(() => validateCharacterPayload({ ...characterPayload(character), apps: {
    ...character.apps, matchme: { ...character.apps!.matchme!, enabled: true },
  } })).toThrow('Invalid MatchMe profile');
});

it('instructs the assistant to prefer the marked portrait and save drafts without photos', () => {
  const prompt = rpStorybookEditPrompt(rpStorybookPromptJsonText(starterRpStorybook), 'Create profiles');
  expect(prompt).toContain('prioritize characters[].profileImage.imageId');
  expect(prompt).toContain('Otherwise choose the first available image');
  expect(prompt).toContain('profile.photoIds: []');
  expect(prompt).toContain('Fotogram and OnlyFriends can be enabled without avatarImageId');
});


it('activates a prepared MatchMe account with a single portrait using only enabled', () => {
  const book = normalizeRpStorybook({ ...starterRpStorybook, characters: [{
    ...starterRpStorybook.characters[0],
    images: [{ id: 'portrait', name: 'Portrait', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==', description: 'Portrait', size: 1 }],
    profileImage: { imageId: 'portrait' },
    apps: { ...starterRpStorybook.characters[0].apps, matchme: {
      accountId: 'ryan-matchme', enabled: false, username: 'ryan', displayName: 'Ryan', bio: 'Hello',
      avatarImageId: 'portrait',
      profile: { name: 'Ryan', age: 28, bio: 'Hello', interests: 'Music', gender: 'man', seeking: ['woman'], photoIds: ['portrait'], decisions: {} },
    } },
  }] });
  expect(book.characters[0].social?.plotTwist).toBeUndefined();
  const result = apply([{ op: 'replace', path: '/characters/0/apps/matchme/enabled', value: true }], book).storybook;
  const reloaded = parseRpStorybookJson(rpStorybookJsonText(result));
  expect(reloaded.characters[0].apps?.matchme?.enabled).toBe(true);
  expect(reloaded.characters[0].social?.plotTwist?.photoIds).toEqual(['portrait']);
  expect(normalizeDatingProfile(reloaded.characters[0].social?.plotTwist)).toBeDefined();
  expect(() => validateCharacterPayload(characterPayload(reloaded.characters[0]))).not.toThrow();
  expect(rpStorybookIdentityLockViolations(book, result)).toEqual([]);
});

it('explicitly requires activation with one photo, including existing drafts', () => {
  const prompt = rpStorybookEditPrompt(rpStorybookPromptJsonText(starterRpStorybook), 'Create MatchMe');
  expect(prompt).toContain('ONE existing gallery photo is sufficient');
  expect(prompt).toContain('explicitly set apps.matchme.enabled to true in the same patch');
  expect(prompt).toContain('Also set enabled to true when completing an existing disabled draft');
  expect(prompt).toContain('there are ZERO usable images');
});


it('keeps story creation valid across base, accounts and agency stages', () => {
  const base = apply([{ op: 'add', path: '/characters/-', value: {
    id: 'student', name: 'Morgan', age: 21, gender: 'woman', description: 'Student',
    personality: 'Outgoing', speechStyle: 'Informal', role: 'Friend', apps: {}, images: [],
  } }]).storybook;
  const index = base.characters.length - 1;
  const path = `/characters/${index}`;
  expect(base.characters[index].apps?.whatsup?.enabled).toBe(true);
  expect(base.characters[index].apps?.fotogram?.enabled).toBe(true);
  const accounts = apply([{ op: 'add', path: `${path}/apps/onlyfriends`, value: {
    accountId: 'character:student:onlyfriends', enabled: true, profileName: 'morgan', bio: '', privacyMode: true,
  } }], base).storybook;
  const tagged = apply([{ op: 'add', path: `${path}/agencyTags`, value: ['fan_engager', 'social_lurker'] }], accounts).storybook;
  const saved = parseRpStorybookJson(rpStorybookJsonText(tagged)).characters[index];
  expect(() => validateCharacterPayload(characterPayload(saved))).not.toThrow();
  expect(saved).toMatchObject({ name: 'Morgan', age: 21, gender: 'woman', agencyTags: ['fan_engager', 'social_lurker'] });
});

it('lets tagged characters gain any account and reports unknown tags with their owner', () => {
  const tagged = apply([{ op: 'add', path: '/characters/1/agencyTags', value: ['status_flexer', 'clout_chaser'] }]).storybook;
  const created = apply([{ op: 'add', path: '/characters/1/apps/onlyfriends', value: {
    accountId: 'character:mira:onlyfriends', enabled: true, profileName: 'MiraVIP', bio: '',
  } }], tagged).storybook;
  expect(created.characters[1]).toMatchObject({ agencyTags: ['status_flexer', 'clout_chaser'],
    apps: { onlyfriends: { enabled: true, profileName: 'MiraVIP' } } });
  expect(apply([{ op: 'add', path: '/characters/1/agencyTags', value: [] }], created).storybook.characters[1].agencyTags).toEqual([]);
  expect(() => apply([{ op: 'add', path: '/characters/1/agencyTags', value: ['influencer'] }]))
    .toThrow('Character "Mira": Character agencyTags must contain at most two unique known tag IDs. Not in the catalog: influencer.');
  const upserted = apply([{ op: 'replace', path: '/characters/1/agencyTags', value: ['shy_user'] },
    { op: 'replace', path: '/characters/1/age', value: 24 }]).storybook.characters[1];
  expect(upserted).toMatchObject({ agencyTags: ['shy_user'], age: 24 });
  expect(() => apply([{ op: 'replace', path: '/characters/1/nickname', value: 'Mi' }]))
    .toThrow('use add to create a missing one');
});

it('describes agency tags as character traits without account rules', () => {
  const prompt = rpStorybookEditPrompt(rpStorybookPromptJsonText(starterRpStorybook), 'Tag everyone');
  expect(prompt).toContain('Every catalog tag is valid for every character');
  expect(prompt).toContain('one add operation per character at /characters/{index}/agencyTags');
  expect(prompt).toContain('- social_lurker: ');
  for (const retired of ['changedFields', 'dm_initiate', 'account role', 'creator account']) expect(prompt).not.toContain(retired);
});

it('includes stage confirmations and application errors in the next request context', () => {
  const context = storybookAssistantConversationContext([
    { role: 'user', text: 'Create a student story with OnlyFriends.' },
    { role: 'assistant', text: 'Base created. Configure OnlyFriends next?' },
    { role: 'user', text: 'Yes.' },
    { role: 'error', text: 'Invalid account role.' },
  ]);
  const prompt = rpStorybookEditPrompt(rpStorybookPromptJsonText(starterRpStorybook), `${context}\nCurrent user message: Retry.`);
  expect(prompt).toContain('ASSISTANT: Base created. Configure OnlyFriends next?');
  expect(prompt).toContain('USER: Yes.');
  expect(prompt).toContain('APP ERROR: Invalid account role.');
  expect(prompt).toContain('Current user message: Retry.');
});

describe('image description revision prompt', () => {
  it('combines the style rules, current description, and user instruction', () => {
    const prompt = rpStorybookImageRevisionPrompt(
      'Keep it short.',
      'Mia smiles at the camera.',
      ' The left person is Mia, the right one is Tom. This was at her birthday. ',
    );
    expect(prompt).toContain('Style rules:\nKeep it short.');
    expect(prompt).toContain('Current description:\nMia smiles at the camera.');
    expect(prompt.endsWith('User instruction:\nThe left person is Mia, the right one is Tom. This was at her birthday.')).toBe(true);
  });

  it('falls back to the default style rules and marks a missing description', () => {
    const prompt = rpStorybookImageRevisionPrompt('', '', 'Taken at the beach.');
    expect(prompt).toContain(defaultRpStorybookImageDescriptionPrompt);
    expect(prompt).toContain('Current description:\n(none)');
  });
});

describe('image description context', () => {
  const character = (id: string, name: string, extra: object = {}) => ({
    id, name, description: `${name} description`, personality: '', speechStyle: '', role: '', images: [], ...extra,
  });
  const storybook = {
    ...starterRpStorybook,
    scenario: { summary: 'A shared flat.', openingSituation: '', currentSituation: 'Party night.' },
    characters: [
      character('mia', 'Mia', {
        personality: 'Warm',
        relationships: [
          { characterId: 'tom', description: 'Best friend since school.', apps: { whatsup: true } },
          { characterId: 'missing', description: 'Unknown person.', apps: {} },
        ],
      }),
      character('tom', 'Tom'),
    ],
  };

  it('formats the owner card, relationships, cast, and scenario as plain text', () => {
    expect(rpStorybookImageDescriptionContext(storybook, 'mia')).toBe([
      'Image owner (the character this image library belongs to):',
      'Name: Mia',
      'Description: Mia description',
      'Personality: Warm',
      '',
      "Mia's contacts and relationships:",
      '- Tom: Best friend since school.',
      '',
      'Other Storybook characters:',
      '- Tom: Tom description',
      '',
      'Scenario:',
      'Summary: A shared flat.',
      'Current situation: Party night.',
    ].join('\n'));
  });

  it('keeps the fallback name when the owner is not in the Storybook', () => {
    expect(rpStorybookImageDescriptionContext({ ...storybook, characters: [] }, 'ghost', 'Ghost'))
      .toContain('Name: Ghost');
  });
});
