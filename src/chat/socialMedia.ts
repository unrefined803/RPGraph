import type {
  MessageRecord,
  SocialAppKind,
  SocialPostRecord,
  SocialReactionComment,
  SocialReactionsRecord,
  SocialThreadActionRecord,
} from '../types';
import type { StorybookCharacter } from '../storybook/runtime';

export const socialAppNames: Record<SocialAppKind, string> = {
  fotogram: 'Fotogram',
  onlyfriends: 'OnlyFriends',
};

export type SocialThreadRunContext = {
  existingComments: SocialReactionComment[];
  likeCount: number;
};

/** Derive a handle-looking nickname from a character name, e.g. "Nova Reyes" → "nova.reyes". */
export function socialHandleForName(name: string) {
  const handle = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return handle || 'user';
}

export function socialIdentityMatches(left: string, right: string) {
  return left.trim().replace(/^@/, '').toLowerCase() ===
    right.trim().replace(/^@/, '').toLowerCase();
}

export function socialHandleForCharacter(
  character: StorybookCharacter,
  app: SocialAppKind,
) {
  const storedHandle = app === 'fotogram'
    ? character.social.fotogramUsername
    : character.social.onlyfriendsUsername;
  return storedHandle || socialHandleForName(character.name);
}

export function socialCharacterForPost(
  post: SocialPostRecord,
  storyCharacters: StorybookCharacter[],
) {
  return storyCharacters.find((character) =>
    socialIdentityMatches(socialHandleForCharacter(character, post.app), post.authorHandle),
  ) ?? storyCharacters.find((character) =>
    socialIdentityMatches(character.name, post.author),
  );
}

/** Key for the per-character, per-app liked-post store in the RP save. */
export function socialLikeAccountKey(characterId: string, app: SocialAppKind) {
  return `${characterId}/${app}`;
}

/** Social reaction/history records remain available to the LLM but are folded into the post card in Chat. */
export function socialMessageHiddenFromChat(message: MessageRecord) {
  return !message.socialPost && (!!message.socialThreadAction || !!message.socialReactions);
}

function singleLine(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function compactHistorySummary(text: string) {
  const summary = singleLine(text);
  return summary.length <= 280 ? summary : `${summary.slice(0, 277).trimEnd()}...`;
}

/** LLM-facing input text for a "user posted something" turn (Message Format 3). */
export function socialPostInputText(post: SocialPostRecord) {
  return [
    '[SOCIAL MEDIA POST]',
    `App: ${socialAppNames[post.app]}`,
    `Post ID: ${post.postId}`,
    `Author: ${post.author} (@${post.authorHandle})`,
    `Post text: ${singleLine(post.caption)}`,
    ...(post.textOnly
      ? ['Content: text-only post, no image']
      : [
          'Content: photo post',
          ...(post.imageDescription
            ? [`Image description (what the photo shows): ${singleLine(post.imageDescription)}`]
            : []),
        ]),
  ].join('\n');
}

/**
 * Read the post text back out of the (possibly translated) graph input block.
 * The run translates the whole [SOCIAL MEDIA POST] block into English, so
 * this returns the English post text for the chat history.
 */
export function socialPostTextFromInput(inputText: string) {
  const match = inputText.match(/^Post text: (.*)$/m);
  return match?.[1]?.trim() || undefined;
}

/** Read the translated user comment back out of a thread-action input block. */
export function socialThreadCommentTextFromInput(inputText: string) {
  const match = inputText.match(/^New comment from the actor: (.*)$/m);
  return match?.[1]?.trim() || undefined;
}

/** Chat-history text that records the post itself. */
export function socialPostHistoryText(post: SocialPostRecord) {
  const kind = post.textOnly ? 'posted' : 'posted a photo';
  return `[${socialAppNames[post.app]}] ${post.author} (@${post.authorHandle}) ${kind}: "${post.caption}"`;
}

/** LLM-facing input for writing or loading comments in an existing thread. */
export function socialThreadActionInputText(
  action: SocialThreadActionRecord,
  existingComments: SocialReactionComment[],
  likeCount = 0,
) {
  const actorOwnsPost =
    action.actor.trim().toLowerCase() === action.postAuthor.trim().toLowerCase() ||
    action.actorHandle.trim().toLowerCase() === action.postAuthorHandle.trim().toLowerCase();
  const commentContext = existingComments.map(
    (comment) => `- ${comment.from} (@${comment.handle}): ${singleLine(comment.text)}`,
  );
  return [
    '[SOCIAL MEDIA THREAD ACTION]',
    `App: ${socialAppNames[action.app]}`,
    `Action ID: ${action.actionId}`,
    `Actor: ${action.actor} (@${action.actorHandle})`,
    `Post ID: ${action.postId}`,
    `Post author: ${action.postAuthor} (@${action.postAuthorHandle})`,
    `Post ownership: ${actorOwnsPost ? "actor's own post" : "another person's post"}`,
    `Post text: ${singleLine(action.postCaption)}`,
    `Likes: ${Math.max(0, Math.trunc(likeCount))}`,
    `Comment count: ${existingComments.length}`,
    'Existing comments:',
    ...(commentContext.length ? commentContext : ['- None']),
    `Action: ${action.action === 'comment' ? 'Write a comment' : 'Load more comments'}`,
    ...(action.action === 'comment'
      ? [`New comment from the actor: ${singleLine(action.commentText ?? '')}`]
      : ['Request: Generate additional comments for this existing thread.']),
  ].join('\n');
}

/** Chat-history text that records the generated reactions to a post. */
export function socialReactionsHistoryText(reactions: SocialReactionsRecord, post: SocialPostRecord) {
  const comments = reactions.comments
    .map((comment) => `${comment.from} (@${comment.handle}): "${comment.text}"`)
    .join(' | ');
  const base = `[${socialAppNames[reactions.app]}] Reactions to @${post.authorHandle}'s post: ${reactions.likes} like${
    reactions.likes === 1 ? '' : 's'
  }`;
  return comments ? `${base}. Comments: ${comments}` : `${base}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export type SocialReactionsParseResult = {
  reactions?: SocialReactionsRecord;
  historySummary?: string;
  warnings: string[];
};

type SocialReactionTarget = Pick<SocialPostRecord, 'app' | 'postId'> & {
  append?: boolean;
};

/**
 * Parse initial-post or append-only thread reactions. The wrapper object,
 * postId, comment handles, and alternate historySummary name are tolerated;
 * the target post is already known from the run.
 */
export function parseSocialReactionsOutput(
  text: string,
  target: SocialReactionTarget,
): SocialReactionsParseResult {
  if (!text.trim()) {
    return { warnings: ['Social Media output was empty; no reactions were generated.'] };
  }
  const parsed = extractJsonObject(text);
  if (!isRecord(parsed)) {
    return { warnings: ['Social Media output could not be parsed as JSON.'] };
  }
  const payload = isRecord(parsed.reactions) ? parsed.reactions : parsed;
  const warnings: string[] = [];
  const likesValue = target.append ? payload.additionalLikes ?? payload.likes : payload.likes;
  const likes =
    typeof likesValue === 'number' && Number.isFinite(likesValue)
      ? Math.max(0, Math.trunc(likesValue))
      : undefined;
  if (likes === undefined) {
    warnings.push(
      `Social Media reactions are missing a numeric "${target.append ? 'additionalLikes' : 'likes'}" value; using 0.`,
    );
  }
  const comments: SocialReactionComment[] = [];
  if (Array.isArray(payload.comments)) {
    payload.comments.forEach((entry) => {
      if (!isRecord(entry) || typeof entry.text !== 'string' || !entry.text.trim()) {
        warnings.push('A Social Media comment without text was skipped.');
        return;
      }
      const rawFrom = typeof entry.from === 'string' && entry.from.trim() ? entry.from.trim() : 'Someone';
      const embeddedHandle = rawFrom.match(/^(.*?)\s*\(@([^()]+)\)\s*$/);
      const from = embeddedHandle?.[1]?.trim() || rawFrom;
      const handle =
        typeof entry.handle === 'string' && entry.handle.trim()
          ? socialHandleForName(entry.handle)
          : embeddedHandle?.[2]
            ? socialHandleForName(embeddedHandle[2])
          : socialHandleForName(from);
      comments.push({ from, handle, text: entry.text.trim() });
    });
  }
  const summaryValue = isRecord(parsed) ? parsed.summary ?? parsed.historySummary : undefined;
  const compactSummary = typeof summaryValue === 'string'
    ? compactHistorySummary(summaryValue)
    : '';
  const historySummary = compactSummary || undefined;
  if (target.append && !historySummary) {
    warnings.push('Social Media thread output is missing a short history summary.');
  }
  return {
    reactions: {
      app: target.app,
      postId: target.postId,
      likes: likes ?? 0,
      comments,
      append: target.append || undefined,
    },
    historySummary,
    warnings,
  };
}

/** Compact chat-history line for a comment/load-more turn. */
export function socialThreadHistoryText(
  action: SocialThreadActionRecord,
  reactions: SocialReactionsRecord,
  generatedSummary?: string,
) {
  const summary = singleLine(generatedSummary ?? '').replace(/^\[[^\]]+\]\s*/, '');
  if (summary) {
    return `[${socialAppNames[action.app]}] ${summary}`;
  }
  const activity = action.action === 'comment'
    ? `${action.actor} commented on @${action.postAuthorHandle}'s post`
    : `${action.actor} loaded more comments on @${action.postAuthorHandle}'s post`;
  const reactionCount = reactions.comments.length;
  return `[${socialAppNames[action.app]}] ${activity}; the thread added ${reactionCount} comment${
    reactionCount === 1 ? '' : 's'
  }.`;
}

/** All messages that carry a social post for the given app, oldest first. */
export function socialPostMessages(app: SocialAppKind, messages: MessageRecord[]) {
  return messages.filter(
    (message): message is MessageRecord & { socialPost: SocialPostRecord } =>
      message.socialPost?.app === app,
  );
}

/** Generated reactions per post id for the given app. */
export function socialReactionsByPostId(app: SocialAppKind, messages: MessageRecord[]) {
  const byPostId: Record<string, SocialReactionsRecord> = {};
  messages.forEach((message) => {
    if (message.socialReactions?.app === app) {
      const next = message.socialReactions;
      const current = byPostId[next.postId];
      if (!current || !next.append) {
        byPostId[next.postId] = {
          ...next,
          comments: [...next.comments],
        };
      } else {
        byPostId[next.postId] = {
          app,
          postId: next.postId,
          likes: current.likes + next.likes,
          comments: [...current.comments, ...next.comments],
        };
      }
    }
  });
  return byPostId;
}

export function socialPostEngagementByPostId(
  app: SocialAppKind,
  messages: MessageRecord[],
  likesByAccount: Record<string, string[]> = {},
) {
  const reactionsByPostId = socialReactionsByPostId(app, messages);
  const engagementByPostId: Record<string, { likeCount: number; commentCount: number }> =
    Object.fromEntries(
      Object.entries(reactionsByPostId).map(([postId, reactions]) => [
        postId,
        {
          likeCount: reactions.likes,
          commentCount: reactions.comments.length,
        },
      ]),
    );
  messages.forEach((message) => {
    const action = message.socialThreadAction;
    if (action?.app !== app || action.action !== 'comment') {
      return;
    }
    const current = engagementByPostId[action.postId] ?? { likeCount: 0, commentCount: 0 };
    const actorWasEchoed = message.socialReactions?.app === app &&
      message.socialReactions.comments.some((comment) =>
        socialIdentityMatches(comment.from, action.actor) ||
        socialIdentityMatches(comment.handle, action.actorHandle),
      );
    engagementByPostId[action.postId] = {
      ...current,
      // The phone thread replaces a malformed LLM echo with the user's real
      // comment, so an echoed actor must not increase the visible total twice.
      commentCount: current.commentCount + (actorWasEchoed ? 0 : 1),
    };
  });
  // Player-character likes are stored per "characterId/app" account; each
  // liking account adds one like to the visible total.
  Object.entries(likesByAccount).forEach(([accountKey, postIds]) => {
    if (!accountKey.endsWith(`/${app}`)) {
      return;
    }
    postIds.forEach((postId) => {
      const current = engagementByPostId[postId] ?? { likeCount: 0, commentCount: 0 };
      engagementByPostId[postId] = { ...current, likeCount: current.likeCount + 1 };
    });
  });
  return engagementByPostId;
}
