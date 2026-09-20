import { appCharacterImage } from '../characters/appRuntime';
import { postsWithInitialContent } from '../characters/publications';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, SocialAppKind, SocialPostRecord } from '../types';
import type { ParsedSocialPost } from './phoneMessages';
import { nextSocialPostId } from './socialMedia';
import { resolveSocialMessageIdentity } from './socialMessageValidation';

/** Bind publication commands to the same accounts and gallery images as the phone composer. */
export function resolveSocialPostCommand(
  command: ParsedSocialPost,
  characters: StorybookCharacter[],
  messages: MessageRecord[],
  reservedPostIds: string[] = [],
): { post: SocialPostRecord; error?: never } | { post?: never; error: string } {
  const author = resolveSocialMessageIdentity({ characters, messages, app: command.app, identity: command.from });
  if (!author.available || !author.character || !author.handle) {
    return { error: author.reason ?? 'The post author needs an existing enabled app account.' };
  }
  const image = command.textOnly ? undefined
    : appCharacterImage(characters, command.imageId, author.character.sourceId);
  if (!command.textOnly && !image?.dataUrl) {
    return { error: `Image "${command.imageId}" was not found in the post author's gallery.` };
  }
  return { post: {
    app: command.app,
    postId: nextSocialPostId(command.app, postsWithInitialContent(characters, messages), reservedPostIds),
    author: author.name,
    authorHandle: author.handle,
    authorCharacterId: author.characterId,
    authorAccountId: author.accountId,
    caption: command.text,
    ...(command.textOnly ? { textOnly: true } : { imageId: image!.id, imageDescription: image!.description }),
  } };
}


export type SocialPostCommandBinding = {
  app: SocialAppKind;
  postRef?: string;
  post?: SocialPostRecord;
};

/** Local references never fall back to history or another app when publication fails. */
export function resolveSocialPostReference(
  app: SocialAppKind,
  postId: string,
  bindings: SocialPostCommandBinding[],
  messages: MessageRecord[],
): SocialPostRecord | undefined {
  if (postId.startsWith('new:')) {
    const ref = postId.slice(4);
    if (!/^[A-Za-z0-9_-]+$/.test(ref)) return undefined;
    const matches = bindings.filter((binding) => binding.app === app && binding.postRef === ref);
    return matches.length === 1 ? matches[0].post : undefined;
  }
  return messages.find((message) => message.socialPost?.app === app && message.socialPost.postId === postId)?.socialPost;
}
