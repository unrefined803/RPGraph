import type {
  MessageRecord,
  SocialAppKind,
  SocialDirectMessageRecord,
  SocialPostRecord,
  SocialReactionComment,
  SocialReactionsRecord,
  SocialThreadActionRecord,
} from '../types';
import type { BankTransferRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import {
  hasIncomingSocialDirectMessagesKey,
  jsonObjectRanges,
  messengerAppMessageKeys,
  parseEmbeddedBankTransfersObject,
  parseMessengerAppMessagesObject,
  parseIncomingSocialDirectMessagesObject,
  type ParsedIncomingSocialDirectMessage,
  type ParsedPhoneMessage,
} from './phoneMessages';

export const socialAppNames: Record<SocialAppKind, string> = {
  fotogram: 'Fotogram',
  onlyfriends: 'OnlyFriends',
};

export type SocialThreadRunContext = {
  existingComments: SocialReactionComment[];
  likeCount: number;
};

export type SocialDirectMessageParseResult = {
  message?: SocialDirectMessageRecord;
  /** Extra standalone phoneMessages blocks emitted next to the DM reply. */
  phoneMessages: ParsedPhoneMessage[];
  /** Extra standalone bankTransfers blocks emitted next to the DM reply. */
  bankTransfers: BankTransferRecord[];
  warnings: string[];
};

/** Shared messenger-app JSON key the DM reply block must use. */
const socialDirectMessageJsonKeys: Record<SocialAppKind, string> = {
  fotogram: messengerAppMessageKeys.fotogram,
  onlyfriends: messengerAppMessageKeys.onlyfriends,
};

/** Structured-input header for a DM turn, per social app. */
const socialDirectMessageInputHeaders: Record<SocialAppKind, string> = {
  fotogram: '[FOTOGRAM DIRECT MESSAGE]',
  onlyfriends: '[ONLYFRIENDS DIRECT MESSAGE]',
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

function normalizedSocialName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function findSocialAccountByExactIdentity(
  characters: StorybookCharacter[],
  app: SocialAppKind,
  query: string,
  excludedCharacterId?: string,
) {
  const normalizedQueryName = normalizedSocialName(query);
  const normalizedQueryHandle = query.trim().replace(/^@/, '').toLowerCase();
  if (!normalizedQueryName || !normalizedQueryHandle) {
    return undefined;
  }
  return characters.find((character) => {
    if (character.id === excludedCharacterId) {
      return false;
    }
    const storedHandle = app === 'fotogram'
      ? character.social.fotogramUsername.trim()
      : character.social.onlyfriendsUsername.trim();
    return !!storedHandle && (
      normalizedSocialName(character.name) === normalizedQueryName ||
      storedHandle.replace(/^@/, '').toLowerCase() === normalizedQueryHandle
    );
  });
}

export function socialPostVisibleToViewer(
  post: SocialPostRecord,
  viewerName: string,
  viewerHandle: string,
  discoveredIdentities: string[],
) {
  return socialIdentityMatches(post.author, viewerName) ||
    socialIdentityMatches(post.authorHandle, viewerHandle) ||
    discoveredIdentities.some((identity) =>
      socialIdentityMatches(post.author, identity) ||
      socialIdentityMatches(post.authorHandle, identity)
    );
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
  return !!message.socialDirectMessage ||
    (!message.socialPost && (!!message.socialThreadAction || !!message.socialReactions));
}

function singleLine(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function compactHistorySummary(text: string) {
  const summary = singleLine(text);
  return summary.length <= 280 ? summary : `${summary.slice(0, 277).trimEnd()}...`;
}

/** LLM-facing input for a direct-message turn, including only this app conversation. */
export function socialDirectMessageInputText(
  message: SocialDirectMessageRecord,
  historyMessages: MessageRecord[],
) {
  const conversation = historyMessages.flatMap((entry) => {
    const directMessage = entry.socialDirectMessage;
    if (
      !directMessage ||
      directMessage.app !== message.app ||
      !(
        socialIdentityMatches(directMessage.fromHandle, message.fromHandle) &&
        socialIdentityMatches(directMessage.toHandle, message.toHandle) ||
        socialIdentityMatches(directMessage.fromHandle, message.toHandle) &&
        socialIdentityMatches(directMessage.toHandle, message.fromHandle)
      )
    ) {
      return [];
    }
    return [
      `- ${directMessage.from} (@${directMessage.fromHandle}): ${singleLine(
        directMessage.internalText ?? directMessage.text,
      )}`,
    ];
  });
  return [
    socialDirectMessageInputHeaders[message.app],
    `App: ${socialAppNames[message.app]}`,
    `Sender: ${message.from} (@${message.fromHandle})`,
    `Recipient: ${message.to} (@${message.toHandle})`,
    'Existing conversation:',
    ...(conversation.length ? conversation : ['- No previous messages']),
    ...(message.origin
      ? [
          message.origin.commentText
            ? 'Conversation origin: comment on a social post'
            : 'Conversation origin: a social post',
          `Post ID: ${message.origin.postId}`,
          `Post author: ${message.origin.postAuthor} (@${message.origin.postAuthorHandle})`,
          `Post text: ${singleLine(message.origin.postCaption)}`,
          ...(message.origin.postImageDescription
            ? [`Post image description: ${singleLine(message.origin.postImageDescription)}`]
            : []),
          ...(message.origin.commentText
            ? [
                `Original comment from ${message.origin.commentAuthor ?? 'someone'} (@${message.origin.commentAuthorHandle ?? 'unknown'}): ${singleLine(message.origin.commentText)}`,
                'The sender opened this DM from that comment. Treat the new message as a reply in that context.',
              ]
            : ['This conversation is about that post. Treat the new message in that context.']),
        ]
      : []),
    `New message: ${singleLine(message.text)}`,
  ].join('\n');
}

export function socialDirectMessageHistoryText(message: SocialDirectMessageRecord) {
  return `[${socialAppNames[message.app]} DM] ${message.from} (@${message.fromHandle}) to ${message.to} (@${message.toHandle}): "${message.text}"`;
}

/** LLM-facing input text for a "user posted something" turn (Message Format 2). */
export function socialPostInputText(post: SocialPostRecord) {
  return [
    '[SOCIAL MEDIA POST]',
    `App: ${socialAppNames[post.app]}`,
    `Post ID: ${post.postId}`,
    ...(!post.textOnly && post.imageId ? [`Image ID: ${post.imageId}`] : []),
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

/** Chat-history text that records the post itself, including its visible post id. */
export function socialPostHistoryText(post: SocialPostRecord) {
  const kind = post.textOnly ? 'posted' : 'posted a photo';
  const references = [
    `Post ID: ${post.postId}`,
    ...(!post.textOnly && post.imageId ? [`Image ID: ${post.imageId}`] : []),
  ];
  return `[${socialAppNames[post.app]}] ${post.author} (@${post.authorHandle}) ${kind} (${references.join(', ')}): "${post.caption}"`;
}

/**
 * Next visible per-app post id, e.g. "fotogram-post-01". Derived from the
 * stored posts so the sequence survives reloads and undo.
 */
export function nextSocialPostId(
  app: SocialAppKind,
  messages: MessageRecord[],
  extraPostIds: string[] = [],
) {
  const pattern = new RegExp(`^${app}-post-(\\d+)$`);
  const highestOf = (current: number, postId: string) => {
    const match = postId.match(pattern);
    return match ? Math.max(current, Number(match[1])) : current;
  };
  const highest = extraPostIds.reduce(
    highestOf,
    messages.reduce((current, message) => {
      const post = message.socialPost;
      return post?.app === app ? highestOf(current, post.postId) : current;
    }, 0),
  );
  return `${app}-post-${String(highest + 1).padStart(2, '0')}`;
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

/** Recover the stored thread context from a structured Social Media input for regeneration. */
export function socialThreadRunContextFromInput(inputText: string): SocialThreadRunContext {
  const likesMatch = inputText.match(/^Likes:\s*(\d+)\s*$/m);
  const commentsBlock = inputText.match(
    /^Existing comments:\s*\n([\s\S]*?)(?=^Action:|^Request:|^New comment from the actor:)/m,
  )?.[1] ?? '';
  const existingComments = commentsBlock
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^-\s*(.*?)\s*\(@([^()]+)\):\s*(.+)$/);
      if (!match?.[1] || !match[2] || !match[3]) {
        return [];
      }
      return [{ from: match[1].trim(), handle: match[2].trim(), text: match[3].trim() }];
    });
  return {
    existingComments,
    likeCount: likesMatch ? Number(likesMatch[1]) : 0,
  };
}

/** Chat-history text that records the generated reactions to a post. */
export function socialReactionsHistoryText(reactions: SocialReactionsRecord, post: SocialPostRecord) {
  const comments = reactions.comments
    .map((comment) => `${comment.from} (@${comment.handle}): "${comment.text}"`)
    .join(' | ');
  const base = `[${socialAppNames[reactions.app]}] Reactions to @${post.authorHandle}'s post (${post.postId}): ${reactions.likes} like${
    reactions.likes === 1 ? '' : 's'
  }`;
  return comments ? `${base}. Comments: ${comments}` : `${base}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function withoutJsonCodeFences(text: string) {
  return text.replace(/^\s*```(?:json)?\s*$/gim, '');
}

/**
 * Parse one AI DM reply plus optional standalone messenger/bank-transfer
 * blocks. The reply must use the app-specific messenger key; sender and recipient
 * identities always come from the requested conversation.
 */
export function parseSocialDirectMessageOutput(
  text: string,
  userMessage: SocialDirectMessageRecord,
  sentAt = new Date().toISOString(),
): SocialDirectMessageParseResult {
  const result: SocialDirectMessageParseResult = {
    phoneMessages: [],
    bankTransfers: [],
    warnings: [],
  };
  if (!text.trim()) {
    result.warnings.push('Social Media DM output was empty.');
    return result;
  }
  const expectedKey = socialDirectMessageJsonKeys[userMessage.app];
  const wrongAppKey = socialDirectMessageJsonKeys[
    userMessage.app === 'fotogram' ? 'onlyfriends' : 'fotogram'
  ];
  const cleaned = withoutJsonCodeFences(text);
  const ranges = jsonObjectRanges(cleaned);
  let sawAnyJson = false;
  for (const range of ranges) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned.slice(range.start, range.end)) as unknown;
    } catch {
      continue;
    }
    sawAnyJson = true;
    if (!isRecord(parsed)) {
      result.warnings.push('A Social Media DM output block is not a JSON object; it was skipped.');
      continue;
    }
    if (Array.isArray(parsed[expectedKey])) {
      const expectedEntries = parsed[expectedKey];
      if (result.message) {
        result.warnings.push(`Only one ${expectedKey} block is applied; an extra one was skipped.`);
        continue;
      }
      if (expectedEntries.length !== 1) {
        result.warnings.push(
          `${expectedKey} must contain exactly one message; received ${expectedEntries.length}.`,
        );
      }
      const messages = parseMessengerAppMessagesObject(parsed).socialDirectMessages;
      const payload = messages.find((message) => message.app === userMessage.app);
      if (!payload) {
        result.warnings.push(`The ${expectedKey} block is missing a message text.`);
        continue;
      }
      result.message = {
        app: userMessage.app,
        messageId: `${userMessage.app}-dm-reply-${userMessage.messageId}`,
        from: userMessage.to,
        fromHandle: userMessage.toHandle,
        to: userMessage.from,
        toHandle: userMessage.fromHandle,
        text: payload.text,
        sentAt,
        replyToMessageId: userMessage.messageId,
        origin: userMessage.origin,
        ...(payload.tip !== undefined ? { tip: payload.tip } : {}),
      };
      continue;
    }
    if (Array.isArray(parsed[wrongAppKey]) || isRecord(parsed.directMessage)) {
      const usedKey = Array.isArray(parsed[wrongAppKey]) ? wrongAppKey : 'directMessage';
      result.warnings.push(
        `Social Media DM output used "${usedKey}" but this ${socialAppNames[userMessage.app]} conversation requires "${expectedKey}".`,
      );
      continue;
    }
    const whatsUpEntries = parsed[messengerAppMessageKeys.whatsup];
    if (Array.isArray(whatsUpEntries)) {
      const phoneMessages = parseMessengerAppMessagesObject(parsed).phoneMessages;
      if (phoneMessages.length !== whatsUpEntries.length) {
        result.warnings.push('A whatsUpApp entry is missing from, to, or message; it was skipped.');
      }
      result.phoneMessages.push(...phoneMessages);
      continue;
    }
    if (Array.isArray(parsed.bankTransfers)) {
      const bankTransfers = parseEmbeddedBankTransfersObject(parsed);
      if (bankTransfers.length !== parsed.bankTransfers.length) {
        result.warnings.push('A bankTransfers entry needs from, to, and a positive amount; it was skipped.');
      }
      result.bankTransfers.push(...bankTransfers);
      continue;
    }
    result.warnings.push(
      `Unknown Social Media DM output block with keys ${Object.keys(parsed).join(', ') || '(none)'}; it was skipped.`,
    );
  }
  if (!sawAnyJson) {
    result.warnings.push('Social Media DM output could not be parsed as JSON.');
    return result;
  }
  if (!result.message) {
    result.warnings.push(`Social Media DM output is missing the ${expectedKey} block.`);
  }
  return result;
}

export type SocialReactionsParseResult = {
  reactions?: SocialReactionsRecord;
  historySummary?: string;
  /** Incoming DMs the LLM sent alongside the reactions. */
  directMessages: ParsedIncomingSocialDirectMessage[];
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
  const directMessages: ParsedIncomingSocialDirectMessage[] = [];
  const warnings: string[] = [];
  if (!text.trim()) {
    return {
      directMessages,
      warnings: ['Social Media output was empty; no reactions were generated.'],
    };
  }
  // Reactions and direct messages may share one outer object or arrive as
  // separate standalone top-level JSON objects.
  const cleaned = withoutJsonCodeFences(text);
  let parsed: Record<string, unknown> | undefined;
  for (const range of jsonObjectRanges(cleaned)) {
    let block: unknown;
    try {
      block = JSON.parse(cleaned.slice(range.start, range.end)) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(block)) {
      warnings.push('A Social Media output block is not a JSON object; it was skipped.');
      continue;
    }
    const hasDirectMessages = hasIncomingSocialDirectMessagesKey(block);
    if (hasDirectMessages) {
      const blockDirectMessages = parseIncomingSocialDirectMessagesObject(block);
      if (blockDirectMessages.length === 0) {
        warnings.push('A social messenger block has no valid entries (each needs from, to, and message).');
      }
      directMessages.push(...blockDirectMessages);
    }
    const hasReactions = isRecord(block.reactions) ||
      block.likes !== undefined ||
      block.additionalLikes !== undefined ||
      block.comments !== undefined;
    if (hasDirectMessages && !hasReactions) {
      continue;
    }
    if (!parsed) {
      parsed = block;
      continue;
    }
    warnings.push(
      `Unknown Social Media output block with keys ${Object.keys(block).join(', ') || '(none)'}; it was skipped.`,
    );
  }
  if (!parsed) {
    if (directMessages.length > 0) {
      warnings.push('Social Media output is missing the reactions block.');
      return { directMessages, warnings };
    }
    return {
      directMessages,
      warnings: [...warnings, 'Social Media output could not be parsed as JSON.'],
    };
  }
  const payload = isRecord(parsed.reactions) ? parsed.reactions : parsed;
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
          ? entry.handle.trim().replace(/^@/, '').toLowerCase()
          : embeddedHandle?.[2]
            ? embeddedHandle[2].trim().replace(/^@/, '').toLowerCase()
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
    directMessages,
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
    ? `${action.actor} commented on @${action.postAuthorHandle}'s post (${action.postId})`
    : `${action.actor} loaded more comments on @${action.postAuthorHandle}'s post (${action.postId})`;
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
