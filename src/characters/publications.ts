import type { Character } from './character';
import type { MessageRecord, SocialPostRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';

/** Initial posts are immutable starting content; live posts and engagement stay in the timeline. */
export function initialCharacterPosts(characters: StorybookCharacter[]): SocialPostRecord[] {
  return characters.flatMap((character) => (['fotogram', 'onlyfriends'] as const).flatMap((app) => {
    const account = character.apps?.[app];
    if (!account?.enabled) return [];
    return (account.initialPosts ?? []).map((post) => ({ app, postId: post.id, author: character.name,
      authorHandle: account.username, authorCharacterId: character.sourceId, authorAccountId: account.accountId,
      caption: post.text, textOnly: !post.imageId, ...(post.imageId ? { imageId: post.imageId } : {}) }));
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
      seeds.set(post.postId, { id: post.postId, text: post.caption, ...(post.imageId ? { imageId: post.imageId } : {}) });
    }
    account.initialPosts = [...seeds.values()];
  }
  return copy;
}

export function postsWithInitialContent(characters: StorybookCharacter[], messages: MessageRecord[]): MessageRecord[] {
  const stored = new Set(messages.flatMap((entry) => entry.socialPost ? [`${entry.socialPost.app}/${entry.socialPost.postId}`] : []));
  return [...initialCharacterPosts(characters).filter((post) => !stored.has(`${post.app}/${post.postId}`))
    .map((socialPost, index): MessageRecord => ({ id: -1 - index, role: 'user', originalText: '', socialPost })), ...messages];
}
