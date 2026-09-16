import { describe, expect, it } from 'vitest';
import { socialReactionAccountContext } from './socialReactionAccounts';
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
  it('shows only app-specific reaction tags for eligible NPCs, with no additional profile context', () => {
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
      `- Regular (@Regular.${app}) [NPC] [Agency tags: friendly_regular]`,
      `- Lurker (@Lurker.${app}) [NPC] [Agency tags: social_lurker]`,
      `- Author (@Author.${app}) [Storybook character]`,
    ]);
    expect(text).toContain('tone, wording and intent');
    expect(text).toContain('Never print agency tag labels');
    expect(text).toContain('not private messages');
    expect(text).not.toContain('PRIVATE_');
    expect(text).not.toContain('slow_to_trust');
    expect(text).not.toContain('good_listener');
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

  it('preserves the existing untagged account context for comment-thread runs', () => {
    const characters = cast([person('Creator', ['fan_engager'], 'creator'), person('PrivateOnly', ['shy_user'])]);
    const context = socialReactionAccountContext(characters, app, false);
    expect(context.lines).toEqual([
      `- Creator (@Creator.${app}) [NPC]`, `- PrivateOnly (@PrivateOnly.${app}) [NPC]`,
    ]);
    expect(context.text).not.toContain('Agency tags');
    expect(context.text).not.toContain('fan_engager');
    expect(context.text).not.toContain('private messages');
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
  expect(context.lines).toContain('- Chloe Lane (@afterglow.tempo) [NPC] [Agency tags: friendly_regular]');
  expect(context.lines).toContain('- Nika Brooks (@silver.margin) [NPC] [Agency tags: boundary_setter]');
  expect(context.lines).toContain('- Noah Blake (@quiet.compass) [NPC] [Agency tags: respectful_admirer]');
  expect(context.text).not.toContain('paper.lantern');
  expect(context.text).not.toContain('copper.spoon');
  expect(context.text).not.toContain('slow_to_trust');
});
