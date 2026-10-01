import { describe, expect, it } from 'vitest';
import { socialReactionAccountContext } from './socialReactionAccounts';
import { appCharactersFromRegistry, recipientCharacterContext } from './appRuntime';
import { agencyTagCatalog } from '../../shared/agency-tags.cjs';
import { buildCharacterRegistry } from './registry';
import { browserNpcLibrarySnapshot } from './npcLibrary';
import type { Character } from './character';
import type { SocialAppKind } from '../types';

function person(id: string, tags: Character['agencyTags'] = ['friendly_regular']): Character {
  return { id, name: id, description: 'PRIVATE_DESCRIPTION', personality: 'PRIVATE_PERSONALITY', speechStyle: 'PRIVATE_SPEECH_STYLE',
    hiddenAgency: 'PRIVATE_MOTIVE', agencyTags: tags, role: 'NPC', images: [],
    apps: Object.fromEntries((['fotogram', 'onlyfriends'] as const).map((app) => [app, {
      accountId: `${id}:${app}`, enabled: true, profileName: `${id}.${app}`, bio: 'PRIVATE_BIO',
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
    'integrates %s into the private prompt context', (tag) => {
      const characters = cast([person('Troll', [tag])]);
      const meaning = agencyTagCatalog.find((entry) => entry.id === tag)!.meaning;
      const context = socialReactionAccountContext(characters, app, true);
      expect(context.lines).toEqual([`- Troll (@Troll.${app}) [NPC] [Agency tags: ${tag}]`]);
      expect(context.text).toContain(`Agency meaning (${tag}): ${meaning}`);
      expect(recipientCharacterContext(characters[0])).toContain(`- ${tag}: ${meaning}`);
    },
  );

  it('offers every enabled account whatever its tags, with private profile context', () => {
    const regular = person('Regular', ['friendly_regular', 'slow_to_trust']);
    const disabled = person('Disabled'); disabled.apps![app]!.enabled = false;
    const absent = person('Absent'); delete absent.apps![app];
    const characters = cast([regular, disabled, absent, person('Seller', ['upseller']),
      person('Untagged', [])], person('Author', []));
    const { lines, text } = socialReactionAccountContext(characters, app, true);
    expect(lines).toEqual([
      `- Regular (@Regular.${app}) [NPC] [Agency tags: friendly_regular, slow_to_trust]`,
      // Fotogram is a standard account: a missing one is provisioned for the character.
      ...(app === 'fotogram' ? ['- Absent (@absent.Absent) [NPC] [Agency tags: friendly_regular]'] : []),
      `- Seller (@Seller.${app}) [NPC] [Agency tags: upseller]`,
      `- Untagged (@Untagged.${app}) [NPC]`,
      `- Author (@Author.${app}) [Storybook character]`,
    ]);
    expect(text).toContain('tone, wording and intent');
    expect(text).toContain('Never disclose hidden agency');
    expect(text).toContain('private messages triggered');
    for (const value of ['PRIVATE_DESCRIPTION', 'PRIVATE_PERSONALITY', 'PRIVATE_SPEECH_STYLE', 'PRIVATE_MOTIVE', 'PRIVATE_BIO']) expect(text).toContain(value);
    expect(text).toContain('slow_to_trust');
    expect(text).toContain(`Agency meaning (upseller): ${agencyTagCatalog.find((entry) => entry.id === 'upseller')!.meaning}`);
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

  it('labels promoted NPCs and Storybook characters by origin', () => {
    const characters = cast([], person('Promoted', ['fan_engager']));
    expect(socialReactionAccountContext(characters, app, true).lines).toEqual([
      `- Promoted (@Promoted.${app}) [Storybook character] [Agency tags: fan_engager]`,
    ]);
    characters[0].npcOrigin = true;
    expect(socialReactionAccountContext(characters, app, true).lines).toEqual([
      `- Promoted (@Promoted.${app}) [NPC] [Agency tags: fan_engager]`,
    ]);
  });

  it('shows tags for comment-thread participants', () => {
    const characters = cast([person('Creator', ['fan_engager']), person('PrivateOnly', ['shy_user'])]);
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

it('samples the bundled OnlyFriends audience from every enabled account', async () => {
  const library = await browserNpcLibrarySnapshot();
  const characters = appCharactersFromRegistry(buildCharacterRegistry(library.entries));
  const enabled = characters.filter((character) => character.apps?.onlyfriends?.enabled).length;
  expect(enabled).toBeGreaterThan(5);
  const context = socialReactionAccountContext(characters, 'onlyfriends', true);
  expect(context.lines).toHaveLength(5);
  for (const line of context.lines) {
    const owner = characters.find((character) => line.startsWith(`- ${character.name} (`))!;
    expect(owner.apps!.onlyfriends!.enabled).toBe(true);
    expect(context.text).toContain(owner.profile.personality);
  }
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
