import { describe, expect, it } from 'vitest';
import { captureStoryNpcParticipants } from './storyNpcParticipants';
import { buildCharacterRegistry, type CharacterRegistryEntry } from './registry';
import { appCharactersFromRegistry } from './appRuntime';
import { interactedNpcIds } from './messageExchanges';
import { legacyStoryNpcIds } from '../../shared/storyNpcReferences.cjs';
import fixture from './fixtures/stage4-npc.json';
import type { Character } from './character';
import type { MessageRecord } from '../types';

const person = (id: string): Character => ({ ...(structuredClone(fixture.character) as Character), id, name: id,
  apps: { fotogram: { accountId: `${id}-fg`, enabled: true, username: id, displayName: id, bio: '' },
    whatsup: { accountId: `${id}-wa`, enabled: true, username: id, displayName: id, bio: '' } },
});
const entries: CharacterRegistryEntry[] = [
  { character: person('player'), tier: 'storybook', source: 'book' },
  { character: person('npc'), tier: 'saved-storybook', source: 'other.json' },
  { character: person('idle'), tier: 'saved-storybook', source: 'other.json' },
];
const characters = appCharactersFromRegistry(buildCharacterRegistry(entries));
const message = (fields: Partial<MessageRecord>): MessageRecord => ({ id: 1, role: 'output', originalText: '', ...fields });
const dm = (from: string, to: string) => message({ socialDirectMessage: {
  app: 'fotogram', messageId: `${from}-${to}`, from, to, fromHandle: from, toHandle: to,
  fromAccountId: `${from}-fg`, toAccountId: `${to}-fg`, text: 'Hello', sentAt: '2026-10-01T00:00:00Z',
} });

describe('story NPC retention', () => {
  it('pins an incoming DM immediately without granting Interacted status', () => {
    const messages = [dm('npc', 'player')];
    const snapshots = captureStoryNpcParticipants({}, entries, messages);
    expect(Object.keys(snapshots)).toEqual(['npc']);
    expect(interactedNpcIds(messages, characters)).toEqual([]);
    expect(interactedNpcIds([...messages, dm('player', 'npc')], characters)).toEqual(['npc']);
    expect(captureStoryNpcParticipants(snapshots, entries, messages)).toBe(snapshots);
  });

  it('pins a legacy WhatsUp sender resolved by name', () => {
    expect(Object.keys(captureStoryNpcParticipants({}, entries, [message({
      phoneMessage: true, phoneFrom: 'npc', phoneTo: 'player',
    })]))).toEqual(['npc']);
  });

  it('pins comment authors but not idle NPCs, likes, posts, or matches', () => {
    const passive = [message({ socialPost: { app: 'fotogram', postId: 'p', author: 'idle', authorHandle: 'idle',
      authorAccountId: 'idle-fg', caption: 'A post' } }), message({ socialReactions: {
      app: 'fotogram', postId: 'p', likes: 3, comments: [],
    } }), message({ matchMeAction: { from: 'player', to: 'idle', decision: 'superlike' } })];
    expect(captureStoryNpcParticipants({}, entries, passive)).toEqual({});
    const comment = message({ socialReactions: { app: 'fotogram', postId: 'player-post', likes: 0,
      comments: [{ from: 'npc', handle: 'npc', text: 'Nice!' }] } });
    expect(Object.keys(captureStoryNpcParticipants({}, entries, [...passive, comment]))).toEqual(['npc']);
    expect(interactedNpcIds([comment], characters)).toEqual([]);
    expect(legacyStoryNpcIds([comment], entries.map(entry => entry.character))).toEqual(['npc']);
  });

  it('pins the owner of a live post when the player comments on it', () => {
    const messages = [message({ socialPost: { app: 'fotogram', postId: 'live', author: 'npc', authorHandle: 'npc',
      authorAccountId: 'npc-fg', caption: 'A post' } }), message({ socialReactions: {
      app: 'fotogram', postId: 'live', likes: 0, comments: [{ from: 'player', handle: 'player', text: 'Hello!' }],
    } })];
    expect(Object.keys(captureStoryNpcParticipants({}, entries, messages))).toEqual(['npc']);
  });

  it('ignores demo DMs, failed messages and loading more comments', () => {
    const direct = dm('npc', 'player');
    const messages = [message({ ...direct, role: 'error' }), message({
      socialDirectMessage: { ...direct.socialDirectMessage!, demo: true },
    }), message({ socialThreadAction: { app: 'fotogram', action: 'load-more', actionId: 'more', postId: 'post',
      postAuthor: 'npc', postAuthorHandle: 'npc', postCaption: '', actor: 'player', actorHandle: 'player' } })];
    expect(captureStoryNpcParticipants({}, entries, messages)).toEqual({});
  });
});
