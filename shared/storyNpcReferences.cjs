/** Only committed communication pins story characters; discovery and passive activity do not. */
function storyNpcReferences(messages) {
  const references = [];
  const posts = messages.flatMap((message) => message.socialPost ? [message.socialPost] : []);
  const postOwner = (app, id) => {
    const post = posts.find((entry) => entry.app === app && entry.postId === id);
    if (post) account(app, post.authorAccountId, post.authorHandle);
  };
  const account = (app, id, handle) => {
    if (id || handle) references.push({ kind: 'account', app, id: id || handle, canonical: !!id });
  };
  for (const message of messages) {
    if (!['user', 'output', 'assistant'].includes(message.role)) continue;
    const dm = message.socialDirectMessage;
    if (dm && !dm.demo) {
      account(dm.app, dm.fromAccountId, dm.fromHandle || dm.from);
      account(dm.app, dm.toAccountId, dm.toHandle || dm.to);
    }
    if (message.phoneMessage) {
      account('whatsup', message.phoneFromAccountId, message.phoneFrom);
      account('whatsup', message.phoneToAccountId, message.phoneTo);
    }
    const thread = message.socialThreadAction;
    if (thread?.action === 'comment' && thread.commentText?.trim()) {
      account(thread.app, undefined, thread.actorHandle);
      account(thread.app, undefined, thread.postAuthorHandle);
      references.push({ kind: 'post', app: thread.app, id: thread.postId });
      postOwner(thread.app, thread.postId);
    }
    const reactions = message.socialReactions;
    const comments = reactions?.comments?.filter((comment) => comment.text?.trim()) ?? [];
    if (comments.length) {
      references.push({ kind: 'post', app: reactions.app, id: reactions.postId });
      postOwner(reactions.app, reactions.postId);
      comments.forEach((comment) => account(reactions.app, undefined, comment.handle));
    }
  }
  return references;
}

/** Compact legacy-save preview: resolve only unique identities from the old import archive. */
function legacyStoryNpcIds(messages, characters) {
  const normalize = (value) => String(value ?? '').trim().replace(/^@/, '').toLowerCase();
  const ids = new Set();
  for (const reference of storyNpcReferences(messages)) {
    let postId = reference.id;
    let accountId;
    if (reference.kind === 'post' && postId.startsWith('npc-seed:')) {
      try { [accountId, postId] = JSON.parse(postId.slice('npc-seed:'.length)); } catch { continue; }
    }
    const matches = characters.filter((character) => {
      const account = character.apps?.[reference.app];
      if (!account) return false;
      if (reference.kind === 'post') return (!accountId || account.accountId === accountId) &&
        account.initialPosts?.some((post) => post.id === postId);
      if (account.accountId === reference.id) return true;
      if (reference.canonical) return false;
      return [account.profileName, account.username, account.displayName, ...(account.legacyHandles ?? []),
        ...(reference.app === 'whatsup' ? [character.name] : [])]
        .some((name) => name && normalize(name) === normalize(reference.id));
    });
    if (matches.length === 1) ids.add(matches[0].id);
  }
  return [...ids];
}

module.exports = { storyNpcReferences, legacyStoryNpcIds };
