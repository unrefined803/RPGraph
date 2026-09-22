import { afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agencyTagCatalog, agencyTagSupports, validateAccountAgency, validateCharacterAgency, type AgencyTagId } from '../../shared/agency-tags.cjs';
import { characterAgencyDraft, withCharacterAgency } from './agency';
import { createAuthoredCharacter } from './creator';
import { normalizeCharacterApps, validateCharacterContainer, type Character } from './character';
import { characterContentEqual } from './contentComparison';
import { withCharacterAppProfile } from './profiles';
import { parseCharacterAssistantResult, runCharacterAuthoringSteps } from './assistant';
import { buildCharacterRegistry } from './registry';
import { appCharactersFromRegistry, recipientCharacterContext } from './appRuntime';
import { captureNpcParticipants, parseNpcParticipantSnapshots } from './npcParticipants';
import { planCharacterCardImport, rpCharacterCardForCharacter } from '../storybook/characterCard';
import { emptyRpStorybook, normalizeRpStorybook, normalizeRpStorybookCharacter, parseRpStorybookJson, rpStorybookJsonText,
  parseRpStorybookAssistantResult, rpStorybookFormattedText } from '../nodes/rp-storybook/model';

const run = promisify(execFile);
const directory = mkdtempSync(join(tmpdir(), 'rpgraph-agency-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const fixture = JSON.parse(readFileSync('src/characters/fixtures/stage4-npc.json', 'utf8'));

function tagged(): Character {
  const source = normalizeRpStorybookCharacter(createAuthoredCharacter(fixture.character, () => '').character, 0, new Set());
  delete source.social;
  const draft = characterAgencyDraft(source);
  draft.agencyTags = ['friendly_regular', 'boundary_setter'];
  for (const account of Object.values(draft.apps)) account.agencyTags = ['friendly_regular'];
  draft.apps.fotogram!.accountRole = 'creator';
  draft.apps.onlyfriends = { accountRole: 'user', agencyTags: ['boundary_setter'] };
  source.apps!.onlyfriends = { accountId: 'onlyfriends-test', enabled: true, profileName: 'test.private', bio: 'Private profile' };
  return withCharacterAgency(source, draft);
}

const patchFor = (character: Character) => [
  { op: 'add', path: '/character/agencyTags', value: character.agencyTags },
  ...Object.entries(character.apps ?? {}).flatMap(([app, account]) => [
    { op: 'add', path: `/character/apps/${app}`, value: account },
  ]),
];

describe('agency catalog and container contract', () => {
  it('defines every documented tag exactly once with supported role/action combinations', () => {
    const document = readFileSync('docs/architecture/npc-agency-tags.md', 'utf8');
    const original = document.slice(document.indexOf('## Original agency tag reference'));
    const ids = original.split('\n').filter((line) => line.startsWith('| `')).map((line) => line.split('|')[5].trim().replace(/`/g, ''));
    expect(agencyTagCatalog.map((tag) => tag.id)).toEqual(ids);
    expect(new Set(ids).size).toBe(54);
    for (const tag of agencyTagCatalog) {
      expect(tag.meaning).not.toBe('');
      for (const [app, roles] of Object.entries(tag.apps)) {
        for (const [role, actions] of Object.entries(roles)) {
          expect(actions.length).toBeGreaterThan(0);
          expect(new Set(actions).size).toBe(actions.length);
          expect(actions.every((action) => ['react', 'dm_reply', 'dm_initiate', 'publish'].includes(action))).toBe(true);
          if (app === 'whatsup' || app === 'matchme') {
            expect(role).toBe('user'); expect(actions).not.toContain('react'); expect(actions).not.toContain('publish');
          }
          if (actions.includes('publish')) expect(role).toBe('creator');
        }
      }
    }
  });

  it('distinguishes user reactions, replies, initiation and future creator publication', () => {
    for (const tag of ['social_lurker', 'loyal_supporter', 'respectful_admirer', 'parasocial_fan',
      'genuine_user', 'friendly_regular', 'attention_seeker', 'boundary_setter']) {
      expect(agencyTagSupports(tag, 'onlyfriends', 'user', 'react')).toBe(true);
    }
    expect(agencyTagSupports('shy_user', 'onlyfriends', 'user', 'dm_reply')).toBe(true);
    expect(agencyTagSupports('shy_user', 'onlyfriends', 'user', 'dm_initiate')).toBe(false);
    expect(agencyTagSupports('shy_user', 'onlyfriends', 'user', 'react')).toBe(false);
    expect(agencyTagSupports('fan_engager', 'onlyfriends', 'user')).toBe(false);
    expect(agencyTagSupports('fan_engager', 'onlyfriends', 'creator', 'publish')).toBe(true);
    expect(agencyTagSupports('fan_engager', 'whatsup', 'user', 'dm_initiate')).toBe(true);
    expect(agencyTagSupports('__proto__', 'fotogram')).toBe(false);
  });

  it.each(['comment_troll', 'rage_baiter', 'contrarian_debater', 'shitposter'] as const)(
    'supports the intended messaging and reaction actions for %s', (tag) => {
      for (const app of ['whatsup', 'fotogram', 'onlyfriends', 'matchme'] as const) {
        expect(agencyTagSupports(tag, app, 'user', 'dm_reply')).toBe(true);
        expect(agencyTagSupports(tag, app, 'user', 'dm_initiate')).toBe(true);
        expect(agencyTagSupports(tag, app, 'user', 'publish')).toBe(false);
        expect(agencyTagSupports(tag, app, 'user', 'react')).toBe(
          app === 'fotogram' || (app === 'onlyfriends' && tag !== 'contrarian_debater'),
        );
      }
    },
  );

  it.each([
    { agencyTags: ['missing'] }, { agencyTags: 'shy_user' }, { agencyTags: null },
    { agencyTags: ['shy_user', 'shy_user'] }, { agencyTags: ['shy_user', 'loyal_friend', 'casual_chatter'] },
    { agencyTags: [], apps: { fotogram: { enabled: true, agencyTags: ['shy_user'] } } },
    { agencyTags: ['shy_user'], apps: { fotogram: { enabled: true } } },
    { agencyTags: ['shy_user'], apps: { fotogram: { enabled: true, agencyTags: ['shy_user'], accountRole: 'creator' } } },
    { apps: { whatsup: { accountRole: 'user' } } }, { apps: { matchme: { accountRole: 'creator' } } },
    { apps: { fotogram: { accountRole: 'both' } } }, { apps: { fotogram: { agencyTags: null } } },
  ])('rejects malformed or contradictory agency data: %j', (value) => {
    expect(() => validateCharacterAgency(value)).toThrow(/agencyTags|accountRole/);
  });

  it('preserves legacy absence and disabled standard accounts, rejecting data before normalization', () => {
    const legacy = normalizeRpStorybookCharacter(createAuthoredCharacter(fixture.character, () => '').character, 0, new Set());
    expect(legacy.agencyTags).toBeUndefined();
    expect(legacy.apps!.fotogram?.accountRole).toBeUndefined();
    const source = tagged();
    source.apps!.fotogram!.enabled = false;
    source.apps!.fotogram!.agencyTags = [];
    const container = createAuthoredCharacter(source, () => '');
    expect(container.character.apps.fotogram).toMatchObject({ enabled: false, agencyTags: [], accountRole: 'creator' });
    expect(() => normalizeCharacterApps({ fotogram: { accountRole: 'bad' } }, undefined, 'x', 'X')).toThrow('accountRole');
    expect(() => normalizeRpStorybook({ ...emptyRpStorybook, characters: [{ ...source, agencyTags: ['unknown'] }] })).toThrow('agencyTags');
    expect(() => createAuthoredCharacter({ name: 'Missing assignments', agencyTags: ['friendly_regular'] }, () => 'x')).toThrow('agencyTags');
  });

  it('round trips tags and roles through containers, Storybooks, CLI editing and pinned revisions without changing media', async () => {
    const source = tagged();
    const card = createAuthoredCharacter(source, () => '');
    validateCharacterContainer(card);
    const imported = planCharacterCardImport(card, structuredClone(emptyRpStorybook));
    const restored = parseRpStorybookJson(rpStorybookJsonText(imported.storybook));
    const exported = rpCharacterCardForCharacter(restored.characters[0], { includePosts: true });
    expect(exported.character.agencyTags).toEqual(source.agencyTags);
    expect(exported.character.apps).toMatchObject(card.character.apps);
    expect(exported.character.images).toEqual(card.character.images);
    expect(rpStorybookFormattedText(restored)).not.toContain('friendly_regular');
    const entries = [{ tier: 'bundled' as const, source: 'test', character: source }];
    const snapshots = captureNpcParticipants({}, entries, [{ kind: 'character', id: source.id }]);
    const saved = parseNpcParticipantSnapshots(JSON.parse(JSON.stringify(snapshots)));
    expect(saved[source.id].character.agencyTags).toEqual(source.agencyTags);
    expect(saved[source.id].character.apps).toEqual(card.character.apps);
    const runtime = appCharactersFromRegistry(buildCharacterRegistry(entries))[0];
    expect(runtime.agencyTags).toEqual(source.agencyTags);
    expect(recipientCharacterContext(runtime)).toContain('- friendly_regular: Frequently interacts');
    const input = join(directory, 'source.json'), spec = join(directory, 'edit.json'), output = join(directory, 'result.json');
    writeFileSync(input, JSON.stringify(card));
    await run(process.execPath, ['scripts/inspect-character-container.mjs', '--input', input, '--output', spec]);
    const edit = JSON.parse(readFileSync(spec, 'utf8'));
    expect(JSON.stringify(edit)).not.toContain('data:image');
    edit.character.apps.onlyfriends.agencyTags = ['friendly_regular'];
    writeFileSync(spec, JSON.stringify(edit));
    await run(process.execPath, ['scripts/edit-character-container.mjs', '--input', input, '--spec', spec, '--output', output]);
    const result = JSON.parse(readFileSync(output, 'utf8'));
    validateCharacterContainer(result);
    expect(result.character.apps.onlyfriends.agencyTags).toEqual(['friendly_regular']);
    expect(result.character.images).toEqual(card.character.images);
    expect(result.character.id).toBe(source.id);
    for (const [app, account] of Object.entries(source.apps!)) expect(result.character.apps[app].accountId).toBe(account.accountId);
  });

  it('treats default roles and tag order equivalently, but detects changed assignments', () => {
    const legacy = normalizeRpStorybookCharacter(createAuthoredCharacter(fixture.character, () => '').character, 0, new Set());
    expect(characterContentEqual(legacy, { ...legacy, agencyTags: [], apps: { ...legacy.apps,
      fotogram: { ...legacy.apps!.fotogram!, accountRole: 'user', agencyTags: [] } } })).toBe(true);
    const source = tagged(), next = structuredClone(source);
    next.agencyTags!.reverse();
    expect(characterContentEqual(source, next)).toBe(true);
    next.apps!.onlyfriends!.agencyTags = ['friendly_regular'];
    expect(characterContentEqual(source, next)).toBe(false);
  });

  it('retains agency during profile edits and initializes new accounts from compatible authored tags', () => {
    const source = tagged();
    const { accountRole: _role, agencyTags: _tags, ...profile } = source.apps!.fotogram!;
    const edited = withCharacterAppProfile(source, 'fotogram', { ...profile, bio: 'Updated biography' });
    expect(edited.apps!.fotogram).toMatchObject({ accountRole: 'creator', agencyTags: ['friendly_regular'] });
    delete source.apps!.onlyfriends;
    const added = withCharacterAppProfile(source, 'onlyfriends', {
      accountId: 'new-onlyfriends', enabled: true, profileName: 'new.profile', bio: '',
    });
    expect(added.apps!.onlyfriends!.agencyTags).toEqual(['friendly_regular', 'boundary_setter']);
    expect(source.apps!.onlyfriends).toBeUndefined();
    expect(() => withCharacterAppProfile(added, 'onlyfriends', { ...added.apps!.onlyfriends!, agencyTags: [] })).toThrow('agencyTags');
  });

  it('applies authoring forms and assistant patches atomically and rejects inconsistent removals', async () => {
    const source = tagged();
    const legacy = normalizeRpStorybookCharacter(createAuthoredCharacter(fixture.character, () => '').character, 0, new Set());
    const result = parseCharacterAssistantResult(JSON.stringify({ reply: 'Updated', patch: patchFor(source) }), legacy);
    expect(result.character.agencyTags).toEqual(source.agencyTags);
    const specialist = await runCharacterAuthoringSteps({ ...result, steps: ['accounts'] }, 'Keep agency tags', [], async (_step, prompt) => {
      expect(prompt).toContain('agencyTags');
      return JSON.stringify({ reply: 'Updated', patch: [{ op: 'replace', path: '/character/agencyTags', value: source.agencyTags }] });
    });
    expect(specialist.character.agencyTags).toEqual(source.agencyTags);
    const story = normalizeRpStorybook({ ...emptyRpStorybook, characters: [legacy] });
    const patched = parseRpStorybookAssistantResult(JSON.stringify({ reply: 'Updated', changedFields: ['agencyTags'],
      patch: patchFor(source).map((op) => ({ ...op, path: op.path.replace('/character/', '/characters/0/') })) }), story);
    expect(patched.storybook.characters[0].agencyTags).toEqual(source.agencyTags);
    expect(() => parseCharacterAssistantResult(JSON.stringify({ reply: 'Invalid', patch: [
      { op: 'remove', path: '/character/agencyTags' },
    ] }), source)).toThrow('agencyTags');
    const draft = characterAgencyDraft(source);
    draft.agencyTags = ['shy_user'];
    expect(() => withCharacterAgency(source, draft)).toThrow('agencyTags');
    expect(source.agencyTags).toEqual(['friendly_regular', 'boundary_setter']);
    const cleared = characterAgencyDraft(source);
    cleared.agencyTags = [];
    Object.values(cleared.apps).forEach((app) => { app.agencyTags = []; });
    expect(withCharacterAgency(source, cleared).agencyTags).toEqual([]);
    const bad = structuredClone(source);
    bad.agencyTags = ['not-a-tag' as AgencyTagId];
    expect(() => parseNpcParticipantSnapshots({ [source.id]: { character: bad, source: 'invalid' } })).toThrow('agencyTags');
  });
});


it('explains incompatible account roles with catalog-derived alternatives', () => {
  expect(() => validateAccountAgency('fotogram', { agencyTags: ['fan_engager'] }))
    .toThrow('Effective accountRole: user (default). fan_engager supports fotogram roles: creator.');
  expect(() => validateAccountAgency('fotogram', { agencyTags: ['fan_engager'] }))
    .toThrow('compatible examples for this role: casual_chatter');
  expect(() => validateAccountAgency('fotogram', { accountRole: 'creator', agencyTags: ['fan_engager'] })).not.toThrow();
});
