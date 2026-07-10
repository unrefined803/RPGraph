import type {
  MessageRecord,
  SocialAppKind,
  SocialPostRecord,
  SocialReactionComment,
  SocialReactionsRecord,
} from '../types';

export const socialAppNames: Record<SocialAppKind, string> = {
  fotogram: 'Fotogram',
  onlyfriends: 'OnlyFriends',
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

function singleLine(text: string) {
  return text.replace(/\s+/g, ' ').trim();
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

/** Chat-history text that records the post itself. */
export function socialPostHistoryText(post: SocialPostRecord) {
  const kind = post.textOnly ? 'posted' : 'posted a photo';
  return `[${socialAppNames[post.app]}] ${post.author} (@${post.authorHandle}) ${kind}: "${post.caption}"`;
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
  warnings: string[];
};

/**
 * Parse the Social Media output of a post turn. Expected shape (tolerant):
 * {"reactions": {"postId": "...", "likes": 12, "comments": [{"from": "Name", "text": "..."}]}}
 * The wrapper object, postId, and comment handles are all optional; the post
 * the reactions belong to is known from the run.
 */
export function parseSocialReactionsOutput(
  text: string,
  post: SocialPostRecord,
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
  const likesValue = payload.likes;
  const likes =
    typeof likesValue === 'number' && Number.isFinite(likesValue)
      ? Math.max(0, Math.trunc(likesValue))
      : undefined;
  if (likes === undefined) {
    warnings.push('Social Media reactions are missing a numeric "likes" value; using 0.');
  }
  const comments: SocialReactionComment[] = [];
  if (Array.isArray(payload.comments)) {
    payload.comments.forEach((entry) => {
      if (!isRecord(entry) || typeof entry.text !== 'string' || !entry.text.trim()) {
        warnings.push('A Social Media comment without text was skipped.');
        return;
      }
      const from = typeof entry.from === 'string' && entry.from.trim() ? entry.from.trim() : 'Someone';
      const handle =
        typeof entry.handle === 'string' && entry.handle.trim()
          ? socialHandleForName(entry.handle)
          : socialHandleForName(from);
      comments.push({ from, handle, text: entry.text.trim() });
    });
  }
  return {
    reactions: {
      app: post.app,
      postId: post.postId,
      likes: likes ?? 0,
      comments,
    },
    warnings,
  };
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
      byPostId[message.socialReactions.postId] = message.socialReactions;
    }
  });
  return byPostId;
}
