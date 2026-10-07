import { afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agencyTagCatalog, agencyTagSupports, validateCharacterAgency, type AgencyTagId } from '../../shared/agency-tags.cjs';
import { agencyAuthoringInstructions, withCharacterAgencyTags } from './agency';
import { createAuthoredCharacter } from './creator';
import { validateCharacterContainer, type Character } from './character';
import { characterContentEqual } from './contentComparison';
import { withCharacterAppProfile } from './profiles';
import { parseCharacterAssistantResult, runCharacterAuthoringStep } from './assistant';
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
  source.apps!.onlyfriends = { accountId: 'onlyfriends-test', enabled: true, profileName: 'test.private', bio: 'Private profile' };
  return withCharacterAgencyTags(source, ['friendly_regular', 'boundary_setter']);
}

/** Per-account tags and roles as older files stored them. */
const legacyAccount = (account: object, agencyTags: string[], accountRole?: string) =>
  ({ ...account, agencyTags, ...(accountRole ? { accountRole } : {}) });

describe('agency catalog and container contract', () => {
  it('defines every catalog tag exactly once with supported role/action combinations', () => {
    const ids = agencyTagCatalog.map((tag) => tag.id);
    expect(ids).toHaveLength(56);
    expect(new Set(ids).size).toBe(56);
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

  it.each(['comment_troll', 'rage_baiter', 'contrarian_debater', 'shitposter', 'comment_hater', 'online_scammer'] as const)(
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
  ])('rejects malformed character tags: %j', (value) => {
    expect(() => validateCharacterAgency(value)).toThrow('agencyTags');
  });

  it('accepts every catalog tag whichever accounts exist', () => {
    const untagged = normalizeRpStorybookCharacter(createAuthoredCharacter(fixture.character, () => '').character, 0, new Set());
    delete untagged.social;
    expect(untagged.agencyTags).toBeUndefined();
    for (const tag of agencyTagCatalog) {
      const character = withCharacterAgencyTags(untagged, [tag.id]);
      expect(() => validateCharacterContainer(createAuthoredCharacter(character, () => ''))).not.toThrow();
    }
    // Creator-style tags neither need nor block an OnlyFriends account.
    const flexer = withCharacterAgencyTags(untagged, ['status_flexer', 'clout_chaser']);
    const added = withCharacterAppProfile(flexer, 'onlyfriends', {
      accountId: 'new-onlyfriends', enabled: true, profileName: 'new.profile', bio: '',
    });
    expect(added.agencyTags).toEqual(['status_flexer', 'clout_chaser']);
    expect(added.apps!.onlyfriends).toMatchObject({ enabled: true, profileName: 'new.profile' });
    expect(() => createAuthoredCharacter({ name: 'No accounts', agencyTags: ['friendly_regular'] }, () => 'x')).not.toThrow();
    expect(() => normalizeRpStorybook({ ...emptyRpStorybook, characters: [{ ...flexer, agencyTags: ['unknown'] }] }))
      .toThrow('Not in the catalog: unknown.');
    expect(() => withCharacterAgencyTags(untagged, ['not-a-tag' as AgencyTagId])).toThrow('agencyTags');
  });

  it('ignores per-account tags and roles from older files and drops them on normalization', () => {
    const source = tagged();
    const stored = { ...source, apps: {
      ...source.apps,
      whatsup: legacyAccount(source.apps!.whatsup!, ['not_in_character_tags']),
      fotogram: legacyAccount(source.apps!.fotogram!, [], 'creator'),
      onlyfriends: legacyAccount(source.apps!.onlyfriends!, ['boundary_setter', 'retired_tag'], 'both'),
    } };
    expect(() => validateCharacterAgency(stored)).not.toThrow();
    const loaded = normalizeRpStorybookCharacter(stored, 0, new Set());
    expect(loaded.agencyTags).toEqual(source.agencyTags);
    for (const account of Object.values(loaded.apps!)) {
      expect(account).not.toHaveProperty('agencyTags');
      expect(account).not.toHaveProperty('accountRole');
    }
    expect(characterContentEqual(source, stored as unknown as Character)).toBe(true);
  });

  it('round trips tags through containers, Storybooks, CLI editing and pinned revisions without changing media', async () => {
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
    edit.character.agencyTags = ['friendly_regular'];
    writeFileSync(spec, JSON.stringify(edit));
    await run(process.execPath, ['scripts/edit-character-container.mjs', '--input', input, '--spec', spec, '--output', output]);
    const result = JSON.parse(readFileSync(output, 'utf8'));
    validateCharacterContainer(result);
    expect(result.character.agencyTags).toEqual(['friendly_regular']);
    expect(result.character.images).toEqual(card.character.images);
    expect(result.character.id).toBe(source.id);
    for (const [app, account] of Object.entries(source.apps!)) expect(result.character.apps[app].accountId).toBe(account.accountId);
  });

  it('treats tag order equivalently, but detects changed tags', () => {
    const untagged = normalizeRpStorybookCharacter(createAuthoredCharacter(fixture.character, () => '').character, 0, new Set());
    expect(characterContentEqual(untagged, { ...untagged, agencyTags: [] })).toBe(true);
    const source = tagged(), next = structuredClone(source);
    next.agencyTags!.reverse();
    expect(characterContentEqual(source, next)).toBe(true);
    next.agencyTags = ['friendly_regular'];
    expect(characterContentEqual(source, next)).toBe(false);
  });

  it('keeps tags during profile edits and applies assistant patches to character tags only', async () => {
    const source = tagged();
    const edited = withCharacterAppProfile(source, 'fotogram', { ...source.apps!.fotogram!, bio: 'Updated biography' });
    expect(edited.agencyTags).toEqual(source.agencyTags);
    const untagged = normalizeRpStorybookCharacter(createAuthoredCharacter(fixture.character, () => '').character, 0, new Set());
    const patch = [{ op: 'add', path: '/character/agencyTags', value: source.agencyTags }];
    const result = parseCharacterAssistantResult(JSON.stringify({ reply: 'Updated', patch }), untagged);
    expect(result.character.agencyTags).toEqual(source.agencyTags);
    const specialist = await runCharacterAuthoringStep('accounts', result.character, 'Retag', [], async (prompt) => {
      expect(prompt).toContain('- fan_engager: ');
      return JSON.stringify({ reply: 'Updated', patch: [{ op: 'replace', path: '/character/agencyTags', value: ['fan_engager'] }] });
    });
    expect(specialist.character.agencyTags).toEqual(['fan_engager']);
    const story = normalizeRpStorybook({ ...emptyRpStorybook, characters: [untagged] });
    const patched = parseRpStorybookAssistantResult(JSON.stringify({ reply: 'Updated',
      patch: [{ op: 'add', path: '/characters/0/agencyTags', value: source.agencyTags },
        // A model that still writes the retired per-account fields must not fail the edit.
        { op: 'add', path: '/characters/0/apps/fotogram/accountRole', value: 'creator' },
        { op: 'add', path: '/characters/0/apps/fotogram/agencyTags', value: ['upseller'] }] }), story);
    expect(patched.storybook.characters[0].agencyTags).toEqual(source.agencyTags);
    expect(patched.storybook.characters[0].apps!.fotogram).not.toHaveProperty('accountRole');
    expect(patched.storybook.characters[0].apps!.fotogram).not.toHaveProperty('agencyTags');
    const cleared = parseCharacterAssistantResult(JSON.stringify({ reply: 'Cleared', patch: [
      { op: 'remove', path: '/character/agencyTags' },
    ] }), source).character;
    expect(cleared.agencyTags).toBeUndefined();
    const bad = structuredClone(source);
    bad.agencyTags = ['not-a-tag' as AgencyTagId];
    expect(() => parseNpcParticipantSnapshots({ [source.id]: { character: bad, source: 'invalid' } })).toThrow('agencyTags');
  });
});

describe('agency authoring instructions', () => {
  it('lists every tag without account constraints', () => {
    for (const tag of agencyTagCatalog) expect(agencyAuthoringInstructions).toContain(`- ${tag.id}: ${tag.meaning}`);
    expect(agencyAuthoringInstructions).toContain('Every catalog tag is valid for every character');
    expect(agencyAuthoringInstructions).not.toContain('dm_reply');
    expect(agencyAuthoringInstructions).not.toContain('creator)');
  });
});
