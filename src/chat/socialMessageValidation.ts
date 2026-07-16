import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, SocialAppKind } from '../types';
import { bundledSocialIdentities } from './socialCatalogs';
import { buildSocialDirectory, type SocialDirectoryUser } from './socialDirectory';
import { jsonObjectRanges, messengerAppMessageKeys } from './phoneMessages';

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
  const exactHandleMatches = characters.filter((character) => [
    storedHandle(character, app),
    storedHandle(character, app === 'fotogram' ? 'onlyfriends' : 'fotogram'),
  ].some((handle) => handle?.toLocaleLowerCase() === normalizedHandle));
  const exactHandleMatch = uniqueCharacter(exactHandleMatches);
  if (exactHandleMatch) {
    return exactHandleMatch;
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
  app: SocialAppKind;
  identity: string;
}): ResolvedSocialMessageIdentity {
  const identity = options.identity.trim();
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
  app: SocialAppKind;
  identity: string;
  role: 'sender' | 'recipient';
  resolved: ResolvedSocialMessageIdentity;
};

export type SocialMessageValidationResult = {
  issues: SocialMessageValidationIssue[];
  sanitizedText: string;
};

function socialAppName(app: SocialAppKind) {
  return app === 'fotogram' ? 'Fotogram' : 'OnlyFriends';
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

/** Validate every generated Fotogram/OnlyFriends message before it leaves the LLM node. */
export function validateSocialMessengerAccounts(options: {
  text: string;
  characters: StorybookCharacter[];
  messages: MessageRecord[];
}): SocialMessageValidationResult {
  const issues: SocialMessageValidationIssue[] = [];
  const invalidRanges: Array<{ start: number; end: number }> = [];
  for (const range of jsonObjectRanges(options.text)) {
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
    for (const app of ['fotogram', 'onlyfriends'] as const) {
      const entries = record[messengerAppMessageKeys[app]];
      if (!Array.isArray(entries)) {
        continue;
      }
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          continue;
        }
        const message = entry as Record<string, unknown>;
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
    'New NPC display names and usernames are accepted. Never invent an app account for a known Storybook character.',
    'Do not mention this validation or the discarded response.',
    '[/SOCIAL MESSAGE VALIDATION]',
  ].join('\n');
}
