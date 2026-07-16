import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, SocialAppKind } from '../types';
import { bundledSocialIdentities } from './socialCatalogs';
import { socialHandleForName, socialIdentityMatches } from './socialMedia';

export type SocialDirectoryUser = {
  id: string;
  name: string;
  handles: Partial<Record<SocialAppKind, string>>;
  source: 'bundled' | 'storybook' | 'dynamic';
  characterId?: string;
};

export type DynamicSocialUsers = Record<string, SocialDirectoryUser>;

export type SocialConnectionsByCharacter = Record<
  string,
  Partial<Record<SocialAppKind, string[]>>
>;

function normalizedIdentity(value: string) {
  return value.trim().replace(/^@/, '').replace(/\s+/g, ' ').toLowerCase();
}

function matchingRecordedHandle(
  expectedName: string,
  recordedName: string | undefined,
  recordedHandle: string | undefined,
) {
  if (
    !recordedName ||
    !recordedHandle ||
    normalizedIdentity(recordedName) !== expectedName
  ) {
    return undefined;
  }
  return recordedHandle.trim().replace(/^@/, '') || undefined;
}

/** Recover the most recently recorded app handle for one display name. */
export function establishedSocialHandle(
  messages: MessageRecord[],
  app: SocialAppKind,
  name: string,
) {
  const normalizedName = normalizedIdentity(name);
  if (!normalizedName) {
    return undefined;
  }
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    const directMessage = message.socialDirectMessage;
    if (directMessage?.app === app) {
      const directHandle = matchingRecordedHandle(
        normalizedName,
        directMessage.from,
        directMessage.fromHandle,
      ) ?? matchingRecordedHandle(
        normalizedName,
        directMessage.to,
        directMessage.toHandle,
      );
      if (directHandle) {
        return directHandle;
      }
    }
    const post = message.socialPost;
    if (post?.app === app) {
      const postHandle = matchingRecordedHandle(normalizedName, post.author, post.authorHandle);
      if (postHandle) {
        return postHandle;
      }
    }
    const threadAction = message.socialThreadAction;
    if (threadAction?.app === app) {
      const threadHandle = matchingRecordedHandle(
        normalizedName,
        threadAction.actor,
        threadAction.actorHandle,
      ) ?? matchingRecordedHandle(
        normalizedName,
        threadAction.postAuthor,
        threadAction.postAuthorHandle,
      );
      if (threadHandle) {
        return threadHandle;
      }
    }
    const reactions = message.socialReactions;
    if (reactions?.app === app) {
      for (
        let commentIndex = reactions.comments.length - 1;
        commentIndex >= 0;
        commentIndex -= 1
      ) {
        const comment = reactions.comments[commentIndex];
        const commentHandle = matchingRecordedHandle(
          normalizedName,
          comment.from,
          comment.handle,
        );
        if (commentHandle) {
          return commentHandle;
        }
      }
    }
  }
  return undefined;
}

function socialUserSlug(value: string) {
  return normalizedIdentity(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user';
}

function bundledUsersForApp(app: SocialAppKind): SocialDirectoryUser[] {
  return bundledSocialIdentities[app].map(({ name, handle }) => ({
    id: `bundled:${app}:${normalizedIdentity(handle)}`,
    name,
    handles: { [app]: handle },
    source: 'bundled',
  }));
}

export const bundledSocialUsers: SocialDirectoryUser[] = [
  ...bundledUsersForApp('fotogram'),
  ...bundledUsersForApp('onlyfriends'),
];

function validSocialDirectoryUser(value: unknown): value is SocialDirectoryUser {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const entry = value as Partial<SocialDirectoryUser>;
  const handles = entry.handles;
  return typeof entry.id === 'string' && entry.id.startsWith('dynamic:') &&
    typeof entry.name === 'string' && !!entry.name.trim() &&
    entry.source === 'dynamic' &&
    !!handles && typeof handles === 'object' && !Array.isArray(handles) &&
    (handles.fotogram === undefined || typeof handles.fotogram === 'string') &&
    (handles.onlyfriends === undefined || typeof handles.onlyfriends === 'string');
}

export function normalizeDynamicSocialUsers(value: unknown): DynamicSocialUsers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, entry]) => {
      if (!validSocialDirectoryUser(entry) || entry.id !== id) {
        return [];
      }
      return [[id, {
        id,
        name: entry.name.trim(),
        handles: {
          ...(entry.handles.fotogram?.trim()
            ? { fotogram: entry.handles.fotogram.trim().replace(/^@/, '') }
            : {}),
          ...(entry.handles.onlyfriends?.trim()
            ? { onlyfriends: entry.handles.onlyfriends.trim().replace(/^@/, '') }
            : {}),
        },
        source: 'dynamic' as const,
      }]];
    }),
  );
}

export function normalizeSocialConnectionsByCharacter(
  value: unknown,
): SocialConnectionsByCharacter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([characterId, apps]) => {
      if (!apps || typeof apps !== 'object' || Array.isArray(apps)) {
        return [];
      }
      const record = apps as Record<string, unknown>;
      const normalized = (app: SocialAppKind) => Array.isArray(record[app])
        ? [...new Set(record[app].filter((entry): entry is string =>
            typeof entry === 'string' && !!entry.trim()
          ).map((entry) => entry.trim()))]
        : [];
      const fotogram = normalized('fotogram');
      const onlyfriends = normalized('onlyfriends');
      return [[characterId, {
        ...(fotogram.length ? { fotogram } : {}),
        ...(onlyfriends.length ? { onlyfriends } : {}),
      }]];
    }),
  );
}

function storybookSocialUsers(characters: StorybookCharacter[]): SocialDirectoryUser[] {
  return characters.flatMap((character) => {
    const fotogram = character.social.fotogramUsername.trim().replace(/^@/, '');
    const onlyfriends = character.social.onlyfriendsUsername.trim().replace(/^@/, '');
    if (!fotogram && !onlyfriends) {
      return [];
    }
    return [{
      id: `storybook:${character.id}`,
      name: character.name,
      handles: {
        ...(fotogram ? { fotogram } : {}),
        ...(onlyfriends ? { onlyfriends } : {}),
      },
      source: 'storybook' as const,
      characterId: character.id,
    }];
  });
}

function findDirectoryUser(
  users: Iterable<SocialDirectoryUser>,
  name: string,
  app?: SocialAppKind,
  handle?: string,
) {
  const allUsers = Array.from(users);
  const normalizedName = normalizedIdentity(name);
  const normalizedHandle = normalizedIdentity(handle ?? '');
  if (normalizedHandle && app) {
    const handleMatch = allUsers.find((user) =>
      normalizedIdentity(user.handles[app] ?? '') === normalizedHandle
    );
    if (handleMatch) {
      return handleMatch;
    }
    // A phone-discovered identity can receive its first exact app handle later
    // in the same directory build. Do not overwrite an established account
    // merely because a different person uses the same display name.
    return allUsers.find((user) =>
      user.source === 'dynamic' &&
      normalizedIdentity(user.name) === normalizedName &&
      !user.handles[app]
    );
  }
  return allUsers.find((user) =>
    normalizedName && normalizedIdentity(user.name) === normalizedName
  );
}

function nextDynamicUserId(users: Map<string, SocialDirectoryUser>, name: string) {
  const base = `dynamic:${socialUserSlug(name)}`;
  let id = base;
  let suffix = 2;
  while (users.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function uniqueHandle(
  users: Iterable<SocialDirectoryUser>,
  app: SocialAppKind,
  name: string,
  ownId: string,
) {
  const base = socialHandleForName(name);
  let handle = base;
  let suffix = 2;
  const used = () => Array.from(users).some((user) =>
    user.id !== ownId && socialIdentityMatches(user.handles[app] ?? '', handle)
  );
  while (used()) {
    handle = `${base}.${suffix}`;
    suffix += 1;
  }
  return handle;
}

export function buildSocialDirectory(options: {
  storyCharacters: StorybookCharacter[];
  messages: MessageRecord[];
  savedDynamicUsers?: DynamicSocialUsers;
}) {
  const users = new Map<string, SocialDirectoryUser>();
  bundledSocialUsers.forEach((user) => users.set(user.id, structuredClone(user)));
  storybookSocialUsers(options.storyCharacters).forEach((user) => users.set(user.id, user));
  Object.values(normalizeDynamicSocialUsers(options.savedDynamicUsers)).forEach((user) => {
    users.set(user.id, structuredClone(user));
  });

  const register = (name: string, app?: SocialAppKind, handle?: string) => {
    const cleanName = name.trim().replace(/\s+/g, ' ');
    const cleanHandle = handle?.trim().replace(/^@/, '');
    if (!cleanName && !cleanHandle) {
      return;
    }
    const existing = findDirectoryUser(users.values(), cleanName, app, cleanHandle);
    if (existing) {
      if (
        existing.source === 'dynamic' &&
        app &&
        cleanHandle &&
        !socialIdentityMatches(existing.handles[app] ?? '', cleanHandle)
      ) {
        users.set(existing.id, {
          ...existing,
          handles: { ...existing.handles, [app]: cleanHandle },
        });
      }
      return;
    }
    // A known Storybook character without an account must remain absent from
    // social search. Phone messages alone do not create an account for them.
    const isKnownCharacterWithoutAccount = options.storyCharacters.some((character) =>
      normalizedIdentity(character.name) === normalizedIdentity(cleanName)
    );
    if (isKnownCharacterWithoutAccount && !cleanHandle) {
      return;
    }
    const resolvedName = cleanName || cleanHandle || 'Unknown user';
    const id = nextDynamicUserId(users, resolvedName);
    users.set(id, {
      id,
      name: resolvedName,
      handles: app && cleanHandle ? { [app]: cleanHandle } : {},
      source: 'dynamic',
    });
  };

  options.messages.forEach((message) => {
    if (message.channel === 'phone') {
      register(message.phoneFrom ?? message.speakerName ?? '');
      register(message.phoneTo ?? '');
    }
    const post = message.socialPost;
    if (post) {
      register(post.author, post.app, post.authorHandle);
    }
    const directMessage = message.socialDirectMessage;
    if (directMessage) {
      register(directMessage.from, directMessage.app, directMessage.fromHandle);
      register(directMessage.to, directMessage.app, directMessage.toHandle);
    }
    const threadAction = message.socialThreadAction;
    if (threadAction) {
      register(threadAction.actor, threadAction.app, threadAction.actorHandle);
      register(threadAction.postAuthor, threadAction.app, threadAction.postAuthorHandle);
    }
    const reactions = message.socialReactions;
    reactions?.comments.forEach((comment) => {
      register(comment.from, reactions.app, comment.handle);
    });
  });

  for (const user of users.values()) {
    if (user.source !== 'dynamic') {
      continue;
    }
    users.set(user.id, {
      ...user,
      handles: {
        fotogram: user.handles.fotogram ?? uniqueHandle(users.values(), 'fotogram', user.name, user.id),
        onlyfriends: user.handles.onlyfriends ?? uniqueHandle(users.values(), 'onlyfriends', user.name, user.id),
      },
    });
  }

  const allUsers = Array.from(users.values());
  const dynamicUsers = Object.fromEntries(
    allUsers.filter((user) => user.source === 'dynamic').map((user) => [user.id, user]),
  );
  return { users: allUsers, dynamicUsers };
}

export function searchSocialDirectory(
  users: SocialDirectoryUser[],
  app: SocialAppKind,
  query: string,
  excludedCharacterId?: string,
  limit = 8,
) {
  const search = normalizedIdentity(query);
  if (search.length < 3) {
    return [];
  }
  return users
    .filter((user) =>
      user.characterId !== excludedCharacterId &&
      !!user.handles[app] &&
      (
        normalizedIdentity(user.name).includes(search) ||
        normalizedIdentity(user.handles[app] ?? '').includes(search)
      )
    )
    .sort((left, right) => {
      const leftStarts = normalizedIdentity(left.name).startsWith(search) ||
        normalizedIdentity(left.handles[app] ?? '').startsWith(search);
      const rightStarts = normalizedIdentity(right.name).startsWith(search) ||
        normalizedIdentity(right.handles[app] ?? '').startsWith(search);
      return Number(rightStarts) - Number(leftStarts) || left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

export function socialConnectionIds(
  connections: SocialConnectionsByCharacter,
  characterId: string | undefined,
  app: SocialAppKind,
) {
  return characterId ? connections[characterId]?.[app] ?? [] : [];
}

export function withSocialConnectionAdded(
  connections: SocialConnectionsByCharacter,
  characterId: string,
  app: SocialAppKind,
  socialUserId: string,
) {
  const current = connections[characterId]?.[app] ?? [];
  if (current.includes(socialUserId)) {
    return connections;
  }
  return {
    ...connections,
    [characterId]: {
      ...connections[characterId],
      [app]: [...current, socialUserId],
    },
  };
}

export function withSocialDirectoryConnectionAdded(
  connections: SocialConnectionsByCharacter,
  users: SocialDirectoryUser[],
  characterId: string,
  app: SocialAppKind,
  socialUserId: string,
) {
  let next = withSocialConnectionAdded(connections, characterId, app, socialUserId);
  if (app !== 'fotogram') {
    return next;
  }
  const targetUser = users.find((user) => user.id === socialUserId);
  const ownerUser = users.find((user) =>
    user.source === 'storybook' && user.characterId === characterId && !!user.handles.fotogram
  );
  if (targetUser?.source !== 'storybook' || !targetUser.characterId || !ownerUser) {
    return next;
  }
  next = withSocialConnectionAdded(
    next,
    targetUser.characterId,
    'fotogram',
    ownerUser.id,
  );
  return next;
}
