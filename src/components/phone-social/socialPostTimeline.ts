import type { MessageRecord, SocialAppKind } from '../../types';

export function socialPostTimeline(messages: MessageRecord[], app: SocialAppKind) {
  const posts = new Map<string, number>();
  const reactions = new Map<number, string>();
  for (const message of messages) {
    if (message.socialPost?.app === app) posts.set(message.socialPost.postId, message.id);
    if (message.socialReactions?.app === app) reactions.set(message.id, message.socialReactions.postId);
    if (message.socialThreadAction?.app === app) reactions.set(message.id, message.socialThreadAction.postId);
  }
  return { posts, reactions };
}

export function socialPostTimelineChanges(
  previous: ReturnType<typeof socialPostTimeline>,
  current: ReturnType<typeof socialPostTimeline>,
) {
  const reset = new Set<string>();
  const added = new Set<string>();
  previous.posts.forEach((messageId, postId) => {
    if (current.posts.get(postId) !== messageId) reset.add(postId);
  });
  previous.reactions.forEach((postId, messageId) => {
    if (!current.reactions.has(messageId)) reset.add(postId);
  });
  current.posts.forEach((messageId, postId) => {
    if (previous.posts.get(postId) !== messageId) added.add(postId);
  });
  return { reset, added };
}

/** The first comment appears with the card; moderation follows the last comment. */
export function socialReactionRevealSchedule(total: number, nextDelay: () => number) {
  let elapsed = 0;
  const comments: { count: number; delay: number }[] = [];
  for (let count = 2; count <= total; count += 1) {
    elapsed += nextDelay();
    comments.push({ count, delay: elapsed });
  }
  return { comments, moderationDelay: elapsed + nextDelay() };
}
