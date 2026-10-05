import { describe, expect, it } from 'vitest';
import { socialThreadActionInputText, socialThreadRunContextFromInput } from './socialMedia';
import { appCharactersFromRegistry } from '../characters/appRuntime';
import { buildCharacterRegistry } from '../characters/registry';
import type { Character } from '../characters/character';
import type { SocialThreadActionRecord } from '../types';

it('still reads legacy stored comment inputs', () => {
  expect(socialThreadRunContextFromInput('Likes: 2\nExisting comments:\n- Espen Harper (@espen.harper): Hello!\nAction: Load more comments')).toEqual({
    likeCount: 2, existingComments: [{ from: 'Espen Harper', handle: 'espen.harper', text: 'Hello!' }],
  });
});

describe.each(['fotogram', 'onlyfriends'] as const)('%s full thread input', (app) => {
  it('preserves every supplied NPC comment and repeated speaker when another character loads the post', () => {
    const comments = Array.from({ length: 9 }, (_, index) => ({
      from: `NPC ${index % 3}`, handle: `npc${index % 3}`, text: `Discussion contribution ${index}: "Really?"\nYes; indeed.`,
    }));
    const action: SocialThreadActionRecord = {
      actionId: 'load-again', action: 'load-more', app, postId: 'original-post',
      postAuthor: 'Original Author', postAuthorHandle: 'original', postCaption: 'Original photo caption',
      actor: 'Different Player', actorHandle: 'different',
    };
    const characters = appCharactersFromRegistry(buildCharacterRegistry(Array.from({ length: 3 }, (_, index) => ({
      character: { id: `npc_${index}`, name: `NPC ${index}`, images: [],
        description: '', personality: '', speechStyle: '', role: 'NPC',
        apps: { [app]: { enabled: true, accountId: `account_${index}`, profileName: `npc${index}`, privacyMode: index === 1 } },
      } as Character, tier: 'bundled' as const, source: `npc_${index}`,
    }))));
    const input = socialThreadActionInputText(action, comments, 12, characters);
    expect(input).toContain('Post ID: original-post');
    expect(input).toContain('Post author: Original Author (@original)');
    expect(input).toContain('Post text: Original photo caption');
    expect(input).toContain('Actor: Different Player (@different)');
    expect(input).toContain('Comment count: 9');
    expect(input).not.toContain('account ID:');
    expect(input).not.toContain('[EXISTING THREAD PARTICIPANTS]');
    for (const comment of comments) {
      const index = Number(comment.handle.slice(3));
      expect(input).toContain(`- "${comment.from}"; character ID: "npc_${index}"; profile name: "${comment.handle}"; privacy: ${index === 1 ? 'anonymous' : 'public'}; ${JSON.stringify(comment.text)}`);
    }
    expect(socialThreadRunContextFromInput(input)).toEqual({ existingComments: comments, likeCount: 12 });
  });
});
