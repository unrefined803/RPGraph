import { describe, expect, it } from 'vitest';
import { socialReactionAccountContext } from './socialReactionAccounts';
import { appCharactersFromRegistry } from './appRuntime';
import { agencyTagCatalog } from '../../shared/agency-tags.cjs';
import { buildCharacterRegistry } from './registry';
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

describe('small social audiences', () => {
  const population = () => cast(Array.from({ length: 15 }, (_, i) => person(`Person${i}`)), person('Author'));

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

describe.each(['fotogram', 'onlyfriends'] as const)('%s post discovery', (app: SocialAppKind) => {
  it('lists directed contacts and relationships with enabled app accounts, regardless of playability', () => {
    const author = person('Author');
    author.relationships = [
      { characterId: 'Sister', description: 'My sister', apps: {} },
      { characterId: 'Followed', description: '', apps: { [app]: true } },
      { characterId: 'Disabled', description: 'My friend', apps: {} },
      { characterId: 'OtherApp', description: '', apps: { whatsup: true } },
    ];
    const incoming = person('Incoming');
    incoming.relationships = [{ characterId: 'Author', description: 'My colleague', apps: {} }];
    const disabled = person('Disabled'); disabled.apps![app]!.enabled = false;
    const characters = cast([author, person('Sister'), person('Followed'), incoming, disabled,
      person('OtherApp'), person('Unknown', ['shitposter'])], person('Playable'));
    const context = socialReactionAccountContext(characters, app, true, { accountId: `Author:${app}` });
    expect(context.lines).toHaveLength(3);
    expect(context.text).toContain('Poster to contact: My sister');
    expect(context.text).toContain('Contact to poster: My colleague');
    expect(context.text).toContain('follows on this app: true');
    expect(context.text).toContain(`"Sister:${app}"`);
    expect(context.text).toContain('Additional accounts outside the contact list: 3');
    expect(context.text).toContain('#shitposter (1)');
    for (const omitted of ['Disabled', 'OtherApp', 'Unknown', 'Playable', 'PRIVATE_', '[PLAYABLE SOCIAL ACCOUNTS]']) {
      expect(context.text).not.toContain(omitted);
    }
    for (const tag of agencyTagCatalog) {
      expect(context.text).toContain(`#${tag.id} (`);
      expect(context.text).not.toContain(tag.meaning);
    }
  });

  it('uses account availability for this app and does not invent contacts without a resolved author', () => {
    const author = person('Author');
    author.relationships = [{ characterId: 'Contact', description: 'My friend', apps: {} }];
    const contact = person('Contact'); contact.apps![app]!.enabled = false;
    const characters = cast([author, contact]);
    for (const identity of [{ characterId: characters[0].id }, { accountId: `Author:${app}` }, { handle: `@author.${app}` }]) {
      const context = socialReactionAccountContext(characters, app, true, identity);
      expect(context.lines).toEqual([]);
      expect(context.text).toContain('excluding the author: 0');
    }
    expect(socialReactionAccountContext(characters, app, true).lines).toEqual([]);
    expect(socialReactionAccountContext([], app, true).text).toContain('excluding the author: 0');
  });

  it('includes incoming app contacts without claiming a reciprocal friendship', () => {
    const author = person('Author');
    const follower = person('Follower');
    follower.relationships = [{ characterId: 'Author', description: '', apps: { [app]: true } }];
    const context = socialReactionAccountContext(cast([author, follower]), app, true, { characterId: 'Author' });
    expect(context.lines).toHaveLength(1);
    expect(context.text).toContain('Contact to poster: No relationship description; follows on this app: true');
    expect(context.text).toContain('a follow alone does not establish friendship');
    expect(context.text).toContain('#friendly_regular (0)');
  });
});
