import { describe, expect, it } from 'vitest';
import { agencyTagCatalog } from '../../shared/agency-tags.cjs';
import { socialReactionAccountContext, socialAgencyTone } from './socialReactionAccounts';
import { appCharactersFromRegistry } from './appRuntime';
import { buildCharacterRegistry } from './registry';
import { browserNpcLibrarySnapshot } from './npcLibrary';
import type { Character } from './character';
import type { SocialAppKind } from '../types';

function person(id: string, tags: Character['agencyTags'] = ['friendly_regular'], role: 'user' | 'creator' = 'user'): Character {
  return { id, name: id, description: 'PRIVATE_DESCRIPTION', personality: 'PRIVATE_PERSONALITY', speechStyle: 'PRIVATE_SPEECH_STYLE',
    hiddenAgency: 'PRIVATE_MOTIVE', agencyTags: tags, role: 'NPC', images: [],
    apps: Object.fromEntries((['fotogram', 'onlyfriends'] as const).map((app) => [app, {
      accountId: `${id}:${app}`, enabled: true, profileName: `${id}.${app}`, bio: 'PRIVATE_BIO', accountRole: role,
      agencyTags: tags,
    }])),
  };
}

function cast(people: Character[], storybook?: Character) {
  return appCharactersFromRegistry(buildCharacterRegistry([
    ...people.map((character) => ({ character, tier: 'bundled' as const, source: character.id })),
    ...(storybook ? [{ character: storybook, tier: 'storybook' as const, source: 'book' }] : []),
  ]));
}

describe.each(['fotogram', 'onlyfriends'] as const)('%s post agency context', (app: SocialAppKind) => {
  it('shows authored character tags for eligible NPCs, with no additional profile context', () => {
    const regular = person('Regular', ['friendly_regular', 'slow_to_trust']);
    const lurker = person('Lurker', ['social_lurker', 'good_listener']);
    const disabled = person('Disabled'); disabled.apps![app]!.enabled = false;
    const absent = person('Absent'); delete absent.apps![app];
    const characters = cast([regular, lurker, disabled, absent, person('Creator', ['fan_engager'], 'creator'),
      person('PrivateOnly', ['shy_user']), person('Legacy', undefined)], person('Author', []));
    // Explicitly model a genuinely unclassified older entry rather than the fixture's default argument.
    const legacy = characters.find((entry) => entry.name === 'Legacy')!;
    legacy.agencyTags = undefined; legacy.apps![app]!.agencyTags = undefined;
    const { lines, text } = socialReactionAccountContext(characters, app, true);
    expect(lines).toEqual([
      `- Regular (@Regular.${app}) [NPC] [Agency tags: friendly_regular, slow_to_trust]`,
      `- Lurker (@Lurker.${app}) [NPC] [Agency tags: social_lurker, good_listener]`,
      `- Author (@Author.${app}) [Storybook character]`,
    ]);
    expect(text).toContain('tone, wording and intent');
    expect(text).toContain('Never print agency tag labels');
    expect(text).toContain('not private messages');
    expect(text).not.toContain('PRIVATE_');
    expect(text).toContain('slow_to_trust');
    expect(text).toContain('good_listener');
  });

  it('does not borrow another app assignment or a character-level-only tag', () => {
    const source = person('Mixed', ['friendly_regular', 'shy_user']);
    source.apps![app]!.agencyTags = ['shy_user'];
    const characters = cast([source]);
    expect(socialReactionAccountContext(characters, app, true).lines).toEqual([]);
    characters[0].apps![app]!.agencyTags = ['boundary_setter'];
    expect(socialReactionAccountContext(characters, app, true).lines).toEqual([]);
  });

  it('excludes the post author by stable identity or exact handle', () => {
    const characters = cast([person('First'), person('Second')]);
    expect(socialReactionAccountContext(characters, app, true, {
      accountId: `First:${app}`,
    }).lines).toEqual([
      `- Second (@Second.${app}) [NPC] [Agency tags: friendly_regular]`,
    ]);
    expect(socialReactionAccountContext(characters, app, true, {
      handle: `@second.${app}`,
    }).lines).toEqual([
      `- First (@First.${app}) [NPC] [Agency tags: friendly_regular]`,
    ]);
  });

  it('keeps promoted NPC origin subject to reaction eligibility and missing roles default to user', () => {
    const characters = cast([person('Regular')], person('Promoted', ['fan_engager'], 'creator'));
    delete characters[0].apps![app]!.accountRole;
    characters[1].npcOrigin = true;
    expect(socialReactionAccountContext(characters, app, true).lines).toEqual([
      `- Regular (@Regular.${app}) [NPC] [Agency tags: friendly_regular]`,
    ]);
  });

  it('excludes creator accounts even when they belong to Storybook characters', () => {
    const characters = cast([], person('StoryCreator', ['fan_engager'], 'creator'));
    expect(socialReactionAccountContext(characters, app, true).lines).toEqual([]);
  });

  it('shows tags for comment-thread participants including creators and DM-oriented characters', () => {
    const characters = cast([person('Creator', ['fan_engager'], 'creator'), person('PrivateOnly', ['shy_user'])]);
    const context = socialReactionAccountContext(characters, app, false);
    expect(context.lines).toEqual([
      `- Creator (@Creator.${app}) [NPC] [Agency tags: fan_engager]`, `- PrivateOnly (@PrivateOnly.${app}) [NPC] [Agency tags: shy_user]`,
    ]);
    expect(context.text).toContain('Agency tags');
    expect(context.text).toContain('fan_engager');
    expect(context.text).toContain('not private messages');
  });

  it('emits explicit empty-audience instructions without inventing participants', () => {
    const context = socialReactionAccountContext([], app, true);
    expect(context.lines).toEqual([]);
    expect(context.text).toContain('return empty comments');
    expect(context.text).toContain('Never invent social participants');
  });
});

it('uses real bundled OnlyFriends assignments rather than adding creator or DM-only NPCs', async () => {
  const library = await browserNpcLibrarySnapshot();
  const characters = appCharactersFromRegistry(buildCharacterRegistry(library.entries));
  const context = socialReactionAccountContext(characters, 'onlyfriends', true);
  expect(context.lines).toContain('- Chloe Lane (@afterglow.tempo) [NPC] [Agency tags: friendly_regular, hobby_friend]');
  expect(context.lines).toContain(`- Nika Brooks (@silver.margin) [NPC] [Agency tags: ${characters.find((character) => character.name === 'Nika Brooks')!.agencyTags!.join(', ')}]`);
  expect(context.lines).toContain(`- Noah Blake (@quiet.compass) [NPC] [Agency tags: ${characters.find((character) => character.name === 'Noah Blake')!.agencyTags!.join(', ')}]`);
  expect(context.text).not.toContain('paper.lantern');
  expect(context.text).not.toContain('copper.spoon');

});

describe('balanced social audiences', () => {
  it('classifies every catalog tag', () => {
    expect(Object.keys(socialAgencyTone).sort()).toEqual(agencyTagCatalog.map((tag) => tag.id).sort());
  });

  const population = () => cast([
    ...Array.from({ length: 25 }, (_, i) => person(`Positive${i}`)),
    ...Array.from({ length: 12 }, (_, i) => person(`Neutral${i}`, ['social_lurker'])),
    ...Array.from({ length: 12 }, (_, i) => person(`Negative${i}`, ['catfish'])),
  ], person('Story', ['emotional_supporter', 'quick_replier']));

  it('caps NPCs at twenty with a 10/5/5 mix and adds tagged Storybook characters', () => {
    const context = socialReactionAccountContext(population(), 'fotogram', false, undefined, undefined, () => 0.4);
    expect(context.lines).toHaveLength(21);
    expect(context.lines.filter((line) => line.includes('- Positive'))).toHaveLength(10);
    expect(context.lines.filter((line) => line.includes('- Neutral'))).toHaveLength(5);
    expect(context.lines.filter((line) => line.includes('- Negative'))).toHaveLength(5);
    expect(context.lines).toContain('- Story (@Story.fotogram) [Storybook character] [Agency tags: emotional_supporter, quick_replier]');
    expect(socialReactionAccountContext(population(), 'fotogram', false, undefined, undefined, () => 0.9).lines)
      .not.toEqual(context.lines);
  });

  it('keeps the author and previous participants while honoring the cap', () => {
    const context = socialReactionAccountContext(population(), 'fotogram', false, undefined, {
      authorHandle: '@negative11.fotogram',
      participantHandles: ['Positive24.fotogram', 'Positive24.fotogram', 'missing'],
    }, () => 0);
    expect(context.lines).toHaveLength(21);
    expect(context.text).toContain('- Negative11 ');
    expect(context.text).toContain('- Positive24 ');
    const crowded = socialReactionAccountContext(population(), 'fotogram', false, undefined, {
      authorHandle: 'Negative11.fotogram',
      participantHandles: Array.from({ length: 25 }, (_, i) => `Positive${i}.fotogram`),
    });
    expect(crowded.lines).toHaveLength(21);
    expect(crowded.text).toContain('- Negative11 ');
  });

  it('fills shortages from other categories and counts mixed negative tags as negative', () => {
    const characters = cast(Array.from({ length: 30 }, (_, i) => person(`Mixed${i}`, ['friendly_regular', 'catfish'])));
    const context = socialReactionAccountContext(characters, 'fotogram', true);
    expect(context.lines).toHaveLength(20);
    const mixed = population();
    mixed.filter((character) => character.name.startsWith('Negative')).forEach((character) => {
      character.agencyTags = ['friendly_regular', 'catfish'];
    });
    expect(socialReactionAccountContext(mixed, 'fotogram', false).lines.filter((line) => line.includes('- Negative'))).toHaveLength(5);
  });
});
