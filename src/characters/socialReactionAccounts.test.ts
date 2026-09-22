import { describe, expect, it } from 'vitest';
import { socialReactionAccountContext } from './socialReactionAccounts';
import { appCharactersFromRegistry, recipientCharacterContext } from './appRuntime';
import { agencyTagCatalog } from '../../shared/agency-tags.cjs';
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
  it.each(['comment_troll', 'rage_baiter', 'contrarian_debater', 'shitposter'] as const)(
    'integrates %s into reaction eligibility and private prompt context', (tag) => {
      const characters = cast([person('Troll', [tag])]);
      const meaning = agencyTagCatalog.find((entry) => entry.id === tag)!.meaning;
      const context = socialReactionAccountContext(characters, app, true);
      if (app === 'onlyfriends' && tag === 'contrarian_debater') {
        expect(context.lines).toEqual([]);
        expect(context.text).not.toContain(meaning);
      } else {
        expect(context.lines).toEqual([`- Troll (@Troll.${app}) [NPC] [Agency tags: ${tag}]`]);
        expect(context.text).toContain(`Agency meaning (${tag}): ${meaning}`);
      }
      expect(recipientCharacterContext(characters[0])).toContain(`- ${tag}: ${meaning}`);
      characters[0].apps![app]!.accountRole = 'creator';
      expect(socialReactionAccountContext(characters, app, true).lines).toEqual([]);
    },
  );

  it('shows authored character tags for eligible NPCs, with private profile context', () => {
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
    expect(text).toContain('Never disclose hidden agency');
    expect(text).toContain('private messages triggered');
    for (const value of ['PRIVATE_DESCRIPTION', 'PRIVATE_PERSONALITY', 'PRIVATE_SPEECH_STYLE', 'PRIVATE_MOTIVE', 'PRIVATE_BIO']) expect(text).toContain(value);
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
    expect(context.text).toContain('private messages triggered');
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
  expect(context.lines).toHaveLength(5);
  for (const line of context.lines) {
    const owner = characters.find((character) => line.startsWith(`- ${character.name} (`))!;
    expect(owner.apps!.onlyfriends!.accountRole).toBe('user');
    expect(context.text).toContain(owner.profile.personality);
  }
  expect(context.text).not.toContain('paper.lantern');
  expect(context.text).not.toContain('copper.spoon');

});

describe('small social audiences', () => {
  const population = () => cast(Array.from({ length: 15 }, (_, i) => person(`Person${i}`)), person('Author'));

  it('samples five eligible characters randomly, including Storybook candidates in the cap', () => {
    const first = socialReactionAccountContext(population(), 'fotogram', true, { handle: 'Author.fotogram' }, undefined, () => 0.1);
    const second = socialReactionAccountContext(population(), 'fotogram', true, { handle: 'Author.fotogram' }, undefined, () => 0.9);
    expect(first.lines).toHaveLength(5);
    expect(second.lines).toHaveLength(5);
    expect(first.lines).not.toEqual(second.lines);
    expect(first.text).not.toContain('- Author ');
  });

  it('retains four previous commenters and adds two, with separate author context', () => {
    const context = socialReactionAccountContext(population(), 'fotogram', false, undefined, {
      authorHandle: 'Author.fotogram', participantHandles: ['Person0.fotogram', 'Person1.fotogram', 'Person2.fotogram', 'Person3.fotogram', 'Person0.fotogram'],
    }, () => 0.5);
    expect(context.lines).toHaveLength(7);
    for (const name of ['Author', 'Person0', 'Person1', 'Person2', 'Person3']) expect(context.text).toContain(`- ${name} (`);
    expect(new Set(context.lines).size).toBe(7);
  });

  it('adds at most two newcomers and stops when six have commented', () => {
    for (const count of [0, 1, 4, 5, 6]) {
      const handles = Array.from({ length: count }, (_, i) => `Person${i}.fotogram`);
      const context = socialReactionAccountContext(population(), 'fotogram', false, undefined, { authorHandle: 'Author.fotogram', participantHandles: handles });
      expect(context.lines).toHaveLength(1 + Math.min(count + 2, 6));
      for (let i = 0; i < count; i++) expect(context.text).toContain(`- Person${i} (`);
    }
  });

  it('bounds legacy threads by the six most recently active distinct commenters', () => {
    const context = socialReactionAccountContext(population(), 'fotogram', false, undefined, {
      authorHandle: 'Author.fotogram', participantHandles: [...Array.from({ length: 10 }, (_, i) => `Person${i}.fotogram`), 'Person0.fotogram'],
    });
    expect(context.lines).toHaveLength(7);
    for (const i of [0, 5, 6, 7, 8, 9]) expect(context.text).toContain(`- Person${i} (`);
    expect(context.text).not.toContain('- Person1 (');
  });

  it('handles a small pool and missing or disabled prior accounts without fabricating identities', () => {
    const people = population().slice(0, 2);
    people[0].apps!.fotogram!.enabled = false;
    const context = socialReactionAccountContext(people, 'fotogram', false, undefined, {
      authorHandle: 'missing', participantHandles: ['Person0.fotogram', 'unknown'],
    });
    expect(context.lines).toHaveLength(1);
    expect(context.text).not.toContain('- Person0 ');
  });
});
