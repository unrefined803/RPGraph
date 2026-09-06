import { matchMeState, incomingMatchMeMessage } from './matchMe';
import { resolveDatingAccount } from './datingAccounts';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, SocialAppKind, SocialMessengerAppKind, SocialDirectMessageRecord } from '../types';
import { bundledSocialIdentities } from './socialCatalogs';
import { buildSocialDirectory, type SocialDirectoryUser } from './socialDirectory';
import { jsonObjectRanges, messengerAppMessageKeys } from './phoneMessages';
import { parseSocialReactionsOutput, type SocialReactionTarget } from './socialMedia';

function cleanHandle(value: string) {
  return value.trim().replace(/^@/, '');
}

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function compactIdentity(value: string, germanTransliteration = false) {
  let normalized = cleanHandle(value).toLocaleLowerCase();
  if (germanTransliteration) {
    normalized = normalized
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss');
  }
  return normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function handleAliasesForName(name: string) {
  return new Set([
    compactIdentity(name),
    compactIdentity(name, true),
    compactIdentity(name.replace(/[^a-z0-9]+/gi, '.')),
  ].filter(Boolean));
}

function storedHandle(character: StorybookCharacter, app: SocialAppKind) {
  const value = app === 'fotogram'
    ? character.social.fotogramUsername
    : character.social.onlyfriendsUsername;
  return cleanHandle(value) || undefined;
}

function identityLooksLikeHandle(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('@') || !/\s/.test(trimmed);
}

function uniqueCharacter(matches: StorybookCharacter[]) {
  const unique = Array.from(new Map(matches.map((character) => [character.id, character])).values());
  return unique.length === 1 ? unique[0] : undefined;
}

/** Match a Storybook character by exact name, any stored app handle, or a name-like handle. */
function storybookCharacterForSocialIdentity(
  characters: StorybookCharacter[],
  app: SocialAppKind,
  identity: string,
) {
  const cleanIdentity = cleanHandle(identity);
  const exactNameMatches = characters.filter(
    (character) => normalizedName(character.name) === normalizedName(identity),
  );
  const exactNameMatch = uniqueCharacter(exactNameMatches);
  if (exactNameMatch) {
    return exactNameMatch;
  }

  const normalizedHandle = cleanIdentity.toLocaleLowerCase();
  const exactHandleMatches = characters.filter((character) =>
    storedHandle(character, app)?.toLocaleLowerCase() === normalizedHandle
  );
  const exactHandleMatch = uniqueCharacter(exactHandleMatches);
  if (exactHandleMatch) {
    return exactHandleMatch;
  }

  // A handle in the requested app takes precedence over an alias from the
  // other app. Cross-app aliases still identify characters lacking an account.
  const otherApp = app === 'fotogram' ? 'onlyfriends' : 'fotogram';
  const otherAppHandleMatch = uniqueCharacter(characters.filter((character) =>
    storedHandle(character, otherApp)?.toLocaleLowerCase() === normalizedHandle
  ));
  if (otherAppHandleMatch) {
    return otherAppHandleMatch;
  }

  if (!identityLooksLikeHandle(identity)) {
    return undefined;
  }
  const compactHandle = compactIdentity(identity);
  const germanCompactHandle = compactIdentity(identity, true);
  return uniqueCharacter(characters.filter((character) => {
    const aliases = handleAliasesForName(character.name);
    return aliases.has(compactHandle) || aliases.has(germanCompactHandle);
  }));
}

export type ResolvedSocialMessageIdentity = {
  available: boolean;
  name: string;
  handle?: string;
  source: 'storybook' | 'directory' | 'new-npc';
  character?: StorybookCharacter;
  reason?: string;
};

function directoryIdentity(
  users: SocialDirectoryUser[],
  app: SocialAppKind,
  value: string,
) {
  const normalizedValue = cleanHandle(value).toLocaleLowerCase();
  const normalizedValueName = normalizedName(value);
  return users.find((user) =>
    user.handles[app]?.toLocaleLowerCase() === normalizedValue
  ) ?? users.find((user) => normalizedName(user.name) === normalizedValueName);
}

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
  const cleanIdentity = cleanHandle(identity).toLocaleLowerCase();
  const exactBundledIdentity = identityLooksLikeHandle(identity)
    ? bundledSocialIdentities[options.app].find(
        (entry) => entry.handle.toLocaleLowerCase() === cleanIdentity,
      )
    : undefined;
  if (exactBundledIdentity) {
    return {
      available: true,
      name: exactBundledIdentity.name,
      handle: exactBundledIdentity.handle,
      source: 'directory',
    };
  }
  const character = storybookCharacterForSocialIdentity(
    options.characters,
    options.app,
    identity,
  );
  if (character) {
    const handle = storedHandle(character, options.app);
    return handle
      ? {
          available: true,
          name: character.name,
          handle,
          source: 'storybook',
          character,
        }
      : {
          available: false,
          name: character.name,
          source: 'storybook',
          character,
          reason: `${character.name} has no ${options.app === 'fotogram' ? 'Fotogram' : 'OnlyFriends'} account.`,
        };
  }

  const directory = buildSocialDirectory({
    storyCharacters: options.characters,
    messages: options.messages,
  });
  const directoryUser = directoryIdentity(directory.users, options.app, identity);
  const directoryHandle = directoryUser?.handles[options.app];
  if (directoryUser && directoryHandle) {
    return {
      available: true,
      name: directoryUser.name,
      handle: directoryHandle,
      source: 'directory',
    };
  }

  if (identityLooksLikeHandle(identity)) {
    return {
      available: true,
      name: cleanHandle(identity),
      handle: cleanHandle(identity),
      source: 'new-npc',
    };
  }
  return {
    available: true,
    name: identity.replace(/\s+/g, ' '),
    source: 'new-npc',
  };
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
    'New NPC display names and usernames are accepted only for Fotogram and OnlyFriends. MatchMe requires existing accounts and an active application-provided match; never invent either.',
    'Do not mention this validation or the discarded response.',
    '[/SOCIAL MESSAGE VALIDATION]',
  ].join('\n');
}
