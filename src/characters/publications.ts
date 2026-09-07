import { npcSeedPostKey } from './npcParticipants';
import type { Character } from './character';
import type { MessageRecord, SocialPostRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';

/** Initial posts are immutable starting content; live posts and engagement stay in the timeline. */
export function initialCharacterPosts(characters: StorybookCharacter[]): SocialPostRecord[] {
  return characters.flatMap((character) => (['fotogram', 'onlyfriends'] as const).flatMap((app) => {
    const account = character.apps?.[app];
    if (!account?.enabled) return [];
    return (account.initialPosts ?? []).map((post) => ({ app, postId: character.libraryNpc ? npcSeedPostKey(account.accountId, post.id) : post.id, author: character.name,
      authorHandle: account.username, authorCharacterId: character.sourceId, authorAccountId: account.accountId,
      caption: post.text, imageDescription: character.images?.find((image) => image.id === post.imageId)?.description, textOnly: !post.imageId, ...(post.imageId ? { imageId: post.imageId } : {}) }));
  }));
}

/** Whitelist own publication fields. Never copy messages, reactions, likes or match history. */
export function withPublicationSnapshot(character: Character, posts: SocialPostRecord[], gallery: Character['images']): Character {
  const copy = structuredClone(character);
  for (const app of ['fotogram', 'onlyfriends'] as const) {
    const account = copy.apps?.[app];
    if (!account) continue;
    const seeds = new Map((account.initialPosts ?? []).map((post) => [post.id, post]));
    for (const post of posts) {
      if (post.app !== app || (post.authorAccountId ? post.authorAccountId !== account.accountId :
        post.authorCharacterId ? post.authorCharacterId !== character.id :
        post.authorHandle.toLowerCase() !== account.username.toLowerCase() || post.author !== character.name)) continue;
      if (post.imageId && !copy.images.some((image) => image.id === post.imageId)) {
        const image = gallery.find((entry) => entry.id === post.imageId);
        if (!image) throw new Error(`Cannot export post ${post.postId}: missing gallery image ${post.imageId}.`);
        copy.images.push(structuredClone(image));
      }
      const seedId = sourceSeedId(post.postId, account.accountId);
      seeds.set(seedId, { id: seedId, text: post.caption, ...(post.imageId ? { imageId: post.imageId } : {}) });
    }
    account.initialPosts = [...seeds.values()];
  }
  return copy;
}

/** Decode only keys owned by this account; never rewrite another owner's source ID. */
function sourceSeedId(id: string, accountId: string) {
  if (id.startsWith('npc-seed:')) {
    try {
      const parsed: unknown = JSON.parse(id.slice('npc-seed:'.length));
      if (Array.isArray(parsed) && parsed.length === 2 && parsed[0] === accountId && typeof parsed[1] === 'string') return parsed[1];
    } catch { /* A literal source ID may also contain this prefix. */ }
  }
  return id;
}

export function postsWithInitialContent(characters: StorybookCharacter[], messages: MessageRecord[]): MessageRecord[] {
  const seeds = initialCharacterPosts(characters);
  const timeline = messages.map((message) => {
    const post = message.socialPost;
    if (!post) return message;
    const candidates = seeds.filter((seed) => seed.app === post.app &&
      (post.authorAccountId ? seed.authorAccountId === post.authorAccountId :
        post.authorCharacterId ? seed.authorCharacterId === post.authorCharacterId :
        seed.author === post.author && seed.authorHandle === post.authorHandle) &&
      (seed.postId === post.postId || sourceSeedId(seed.postId, seed.authorAccountId!) === post.postId));
    return candidates.length === 1 ? { ...message, socialPost: { ...post, postId: candidates[0].postId } } : message;
  });
  const stored = new Set(timeline.flatMap((entry) => entry.socialPost ? [`${entry.socialPost.app}/${entry.socialPost.postId}`] : []));
  return [...seeds.filter((post) => !stored.has(`${post.app}/${post.postId}`))
    .map((socialPost, index): MessageRecord => ({ id: -1 - index, role: 'user', originalText: '', socialPost })), ...timeline];
}
