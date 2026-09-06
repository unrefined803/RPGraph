import { matchMeState, incomingMatchMeMessage } from './matchMe';
import { resolveDatingAccount } from './datingAccounts';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, SocialAppKind, SocialMessengerAppKind, SocialDirectMessageRecord } from '../types';
import { buildSocialDirectory } from './socialDirectory';
import { jsonObjectRanges, messengerAppMessageKeys } from './phoneMessages';
import { parseSocialReactionsOutput, type SocialReactionTarget } from './socialMedia';

function cleanHandle(value: string) {
  return value.trim().replace(/^@/, '');
}

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function storedHandle(character: StorybookCharacter, app: SocialAppKind) {
  return cleanHandle(app === 'fotogram' ? character.social.fotogramUsername : character.social.onlyfriendsUsername) || undefined;
}

export type ResolvedSocialMessageIdentity = {
  available: boolean;
  accountId?: string;
  characterId?: string;
  name: string;
  handle?: string;
  source: 'storybook' | 'directory' | 'new-npc';
  character?: StorybookCharacter;
  reason?: string;
};

/** Resolve an LLM-supplied name or nickname without inventing accounts for known characters. */
export function resolveSocialMessageIdentity(options: {
  characters: StorybookCharacter[];
  messages: MessageRecord[];
  app: SocialMessengerAppKind;
  identity: string;
}): ResolvedSocialMessageIdentity {
  const identity = options.identity.trim();
  if (options.app === 'matchme') {
    const account = resolveDatingAccount(identity, matchMeState(options.characters, options.messages).accounts);
    return account ? { available: true, name: account.name, handle: account.id, source: 'directory' }
      : { available: false, name: identity, source: 'directory', reason: 'Unknown or ambiguous MatchMe account.' };
  }
  const key = cleanHandle(identity).toLowerCase();
  const app = options.app;
  const characters = options.characters.filter((character) => character.id === identity || character.sourceId === identity ||
    character.apps?.[app]?.accountId === identity || normalizedName(character.name) === normalizedName(identity) ||
    storedHandle(character, app)?.toLowerCase() === key);
  const directory = buildSocialDirectory({ storyCharacters: options.characters, messages: options.messages });
  const users = directory.users.filter((user) => user.source !== 'storybook' &&
    (user.id === identity || user.handles[app]?.toLowerCase() === key || normalizedName(user.name) === normalizedName(identity)));
  if (!characters.length && !users.length) {
    const otherApp = app === 'fotogram' ? 'onlyfriends' : 'fotogram';
    const crossApp = options.characters.filter((entry) => storedHandle(entry, otherApp)?.toLowerCase() === key);
    if (crossApp.length === 1) return { available: false, name: crossApp[0].name, character: crossApp[0], source: 'storybook',
      reason: `${crossApp[0].name} has no matching ${app === 'fotogram' ? 'Fotogram' : 'OnlyFriends'} username. Use the full character name or the username in this app.` };
  }
  if (characters.length + users.length !== 1) return { available: false, name: identity, source: 'directory',
    reason: characters.length + users.length > 1 ? `Ambiguous ${app} recipient "${identity}". Use a unique app username or account ID.` : `Unknown ${app} recipient "${identity}". Use an existing full character name or app username.` };
  const character = characters[0];
  if (character) {
    const handle = storedHandle(character, app);
    return { available: !!handle, name: character.name, handle, source: 'storybook', character,
      characterId: character.sourceId, accountId: character.apps?.[app]?.accountId ?? `character:${character.sourceId}:${app}`,
      ...(!handle ? { reason: `${character.name} has no ${app === 'fotogram' ? 'Fotogram' : 'OnlyFriends'} account.` } : {}) };
  }
  const user = users[0];
  return { available: !!user.handles[app], name: user.name, handle: user.handles[app], accountId: user.id,
    source: 'directory', ...(!user.handles[app] ? { reason: `${user.name} has no ${app} account.` } : {}) };

}

export type SocialMessageValidationIssue = {
  app: SocialMessengerAppKind;
  identity: string;
  role: 'sender' | 'recipient';
  resolved: ResolvedSocialMessageIdentity;
};

/** Apply the DM account rules before post or thread reactions enter the timeline. */
export function parseValidatedSocialReactionsOutput(
  text: string,
  target: SocialReactionTarget,
  context: { characters: StorybookCharacter[]; messages: MessageRecord[] },
) {
  const parsed = parseSocialReactionsOutput(text, target);
  if (!parsed.reactions) {
    return parsed;
  }
  let discardedComment = false;
  const comments = parsed.reactions.comments.flatMap((comment) => {
    const resolve = (identity: string) => resolveSocialMessageIdentity({
      ...context, app: target.app, identity,
    });
    const byName = resolve(comment.from);
    const byHandle = resolve(`@${comment.handle}`);
    // A fabricated handle must not create an account for a known character.
    // Conversely, a real character handle must keep its canonical owner name.
    const resolved = byName.character ? byName : byHandle.character ? byHandle : byName;
    if (!byName.character && !byHandle.character && byName.reason?.startsWith('Unknown ') && byHandle.reason?.startsWith('Unknown ')) return [comment];
    if (!resolved.available) {
      discardedComment = true;
      parsed.warnings.push(`Social Media comment from "${comment.from}" was ignored. ${resolved.reason}`);
      return [];
    }
    return [{
      ...comment,
      ...(resolved.character ? { from: resolved.name, handle: resolved.handle! } : {}),
    }];
  });
  return {
    ...parsed,
    reactions: { ...parsed.reactions, comments },
    // A model summary may describe a rejected comment as if it happened.
    historySummary: discardedComment ? undefined : parsed.historySummary,
  };
}

export type SocialMessageValidationResult = {
  issues: SocialMessageValidationIssue[];
  sanitizedText: string;
};

function socialAppName(app: SocialMessengerAppKind) {
  return app === 'matchme' ? 'MatchMe' : app === 'fotogram' ? 'Fotogram' : 'OnlyFriends';
}

function expandedJsonRange(text: string, range: { start: number; end: number }) {
  let start = range.start;
  let end = range.end;
  const opening = text.slice(0, start).match(/(?:^|\n)[ \t]*```(?:json)?[ \t]*\n[ \t]*$/i);
  if (opening?.index !== undefined) {
    start = opening.index;
  }
  const closing = text.slice(end).match(/^[ \t]*\n?[ \t]*```[ \t]*(?=\n|$)/);
  if (closing) {
    end += closing[0].length;
  }
  return { start, end };
}

/** Validate generated social messages before they leave the LLM node. */
export function validateSocialMessengerAccounts(options: {
  text: string;
  directMessage?: SocialDirectMessageRecord;
  characters: StorybookCharacter[];
  messages: MessageRecord[];
}): SocialMessageValidationResult {
  const issues: SocialMessageValidationIssue[] = [];
  const invalidRanges: Array<{ start: number; end: number }> = [];
  const ranges = jsonObjectRanges(options.text);
  const directReplyBlockCount = options.directMessage ? ranges.filter((range) => {
    try { return Array.isArray(JSON.parse(options.text.slice(range.start, range.end))?.matchMeApp); }
    catch { return false; }
  }).length : 0;
  for (const range of ranges) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.text.slice(range.start, range.end)) as unknown;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const rangeIssues: SocialMessageValidationIssue[] = [];
    if (options.directMessage && ['fotogramApp', 'onlyFriendsApp'].some((key) => key in record)) {
      rangeIssues.push({ app: 'matchme', identity: '', role: 'sender', resolved: { available: false, name: '', source: 'directory', reason: 'This direct reply must use matchMeApp only.' } });
    }
    if (options.directMessage && Array.isArray(record.matchMeApp) && (directReplyBlockCount !== 1 || record.matchMeApp.length !== 1 ||
      record.matchMeApp.some((entry) => !entry || typeof entry !== 'object' ||
        entry.from !== options.directMessage?.toAccountId || entry.to !== options.directMessage?.fromAccountId))) {
      rangeIssues.push({ app: 'matchme', identity: '', role: 'sender', resolved: { available: false, name: '', source: 'directory', reason: `Return exactly one matchMeApp message from ${options.directMessage.toAccountId} to ${options.directMessage.fromAccountId}. Do not change the replying account.` } });
    }

    for (const app of ['fotogram', 'onlyfriends', 'matchme'] as const) {
      const entries = record[messengerAppMessageKeys[app]];
      if (!Array.isArray(entries)) {
        continue;
      }
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          continue;
        }
        const message = entry as Record<string, unknown>;
        if (app === 'matchme' && (!incomingMatchMeMessage(
          typeof message.from === 'string' ? message.from : '', typeof message.to === 'string' ? message.to : '',
          typeof message.message === 'string' ? message.message : '', matchMeState(options.characters, options.messages), 'validation', new Date().toISOString()) ||
          ['postId', 'isVoiceMessage', 'sendImageId', 'tip'].some((key) => key in message))) {
          rangeIssues.push({ app, identity: String(message.from ?? ''), role: 'sender',
            resolved: { available: false, name: String(message.from ?? ''), source: 'directory', reason: 'MatchMe requires existing unambiguous accounts with an active match and plain message text.' } });
        }
        for (const [field, role] of [['from', 'sender'], ['to', 'recipient']] as const) {
          const identity = message[field];
          if (typeof identity !== 'string' || !identity.trim()) {
            continue;
          }
          const resolved = resolveSocialMessageIdentity({
            characters: options.characters,
            messages: options.messages,
            app,
            identity,
          });
          if (!resolved.available) {
            rangeIssues.push({ app, identity: identity.trim(), role, resolved });
          }
        }
      }
    }
    if (rangeIssues.length) {
      issues.push(...rangeIssues);
      invalidRanges.push(expandedJsonRange(options.text, range));
    }
  }
  const sanitizedText = invalidRanges.reduceRight(
    (text, range) => `${text.slice(0, range.start)}${text.slice(range.end)}`,
    options.text,
  ).replace(/\n{3,}/g, '\n\n').trim();
  return { issues, sanitizedText };
}

/** Targeted private context for one discarded response and its correction replay. */
export function socialMessageCorrectionContext(issues: SocialMessageValidationIssue[]) {
  const uniqueIssues = Array.from(new Map(
    issues.map((issue) => [`${issue.app}:${issue.role}:${issue.identity}`, issue]),
  ).values());
  return [
    '[SOCIAL MESSAGE VALIDATION]',
    'The previous response was discarded before any message was sent.',
    ...uniqueIssues.map((issue) =>
      `- ${socialAppName(issue.app)} ${issue.role} "${issue.identity}": ${issue.resolved.reason}`
    ),
    'Rewrite the complete response. A known Storybook character may send or receive in an app only when that exact app account exists.',
    'Use an existing full character name, app username or stable account ID. Unknown or ambiguous recipients are rejected. MatchMe requires existing accounts and an active application-provided match; never invent either.',
    'Do not mention this validation or the discarded response.',
    '[/SOCIAL MESSAGE VALIDATION]',
  ].join('\n');
}
