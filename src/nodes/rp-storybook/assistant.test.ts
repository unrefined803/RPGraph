import { describe, expect, it } from 'vitest';
import { characterPayload, validateCharacterPayload } from '../../characters/character';
import { normalizeDatingProfile } from '../../chat/datingProfile';
import {
  normalizeRpStorybook,
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
    expect(edited.characters[0].apps?.onlyfriends).toEqual({ ...account('onlyfriends'), displayName: 'New display', bio: '' });
    const deleted = apply([{ op: 'remove', path: '/characters/0/apps/onlyfriends' }], edited).storybook;
    expect(deleted.characters[0].apps?.onlyfriends).toBeUndefined();
    expect(deleted.characters[0].social?.onlyfriendsUsername).toBe('');
    expect(rpStorybookIdentityLockViolations(edited, deleted).length).toBeGreaterThan(0);
    expect(rpStorybookIdentityLockViolations(created, edited)).toEqual([]);
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
