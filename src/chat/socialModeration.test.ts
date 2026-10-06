import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isSocialPostModeration } from './socialModeration';
import { parseSocialReactionsOutput, socialPostVisibleToViewer, socialReactionsByPostId, socialReactionsHistoryText } from './socialMedia';
import type { MessageRecord, SocialPostRecord, WorkflowFile } from '../types';

const post: SocialPostRecord = {
  app: 'fotogram', postId: 'fotogram-post-02', author: 'Alice', authorHandle: 'alice', caption: 'New photo',
};
const blocked = { blocked: true, reason: 'nudity' } as const;
const comments = [{ from: 'Bob', handle: 'bob', text: 'Wrong app for this photo!' }];
function parse(moderation?: unknown, app = post.app) {
  return parseSocialReactionsOutput(JSON.stringify({ reactions: {
    postId: post.postId, likes: 1, comments, ...(moderation === undefined ? {} : { moderation }),
  } }), { ...post, app });
}

describe('Fotogram moderation', () => {
  it('keeps pre-removal reactions and adds removal context to history', () => {
    const parsed = parse(blocked);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.reactions).toMatchObject({ moderation: blocked, likes: 1, comments });
    expect(socialReactionsHistoryText(parsed.reactions!, post)).toContain('Only the author can view it');
    expect(socialReactionsHistoryText(parsed.reactions!, post)).toContain(comments[0].text);
  });

  it('accepts legacy and allowed reactions without applying Fotogram rules to OnlyFriends', () => {
    expect(parse().reactions?.moderation).toBeUndefined();
    expect(parse({ blocked: false }).reactions?.moderation).toEqual({ blocked: false });
    expect(parse(blocked, 'onlyfriends').reactions?.moderation).toBeUndefined();
  });

  it.each([null, {}, { blocked: 'true', reason: 'nudity' }, { blocked: true },
    { blocked: true, reason: 'unknown' }, { blocked: true, reason: 'toString' }])('rejects malformed moderation %j without losing comments', (value) => {
    expect(isSocialPostModeration(value)).toBe(false);
    expect(parse(value).warnings).toHaveLength(1);
    expect(parse(value).reactions?.comments).toEqual(comments);
    expect(parse(value).reactions?.moderation).toBeUndefined();
  });

  it.each(['nudity', 'graphic_violence', 'hate_harassment', 'spam_scam'])('accepts reason %s', (reason) => {
    expect(parse({ blocked: true, reason }).warnings).toEqual([]);
  });

  it('hides removed posts from followers, recommendations, and matching display names', () => {
    expect(socialPostVisibleToViewer(post, 'Bob', 'bob', ['alice'], blocked)).toBe(false);
    expect(socialPostVisibleToViewer(post, 'Alice', 'someone.else', ['alice'], blocked)).toBe(false);
    expect(socialPostVisibleToViewer(post, 'Renamed', '@ALICE', [], blocked)).toBe(true);
    const identified = { ...post, authorAccountId: 'account-a', authorCharacterId: 'char-a' };
    expect(socialPostVisibleToViewer(identified, 'Alice', 'alice', ['alice'], blocked, 'account-b', 'char-b')).toBe(false);
    expect(socialPostVisibleToViewer(identified, 'Renamed', 'changed', [], blocked, 'account-a', 'char-a')).toBe(true);
    expect(socialPostVisibleToViewer(identified, 'Renamed', 'changed', [], blocked,
      'account-new', 'char-a', ['account-a'])).toBe(true);
    expect(socialPostVisibleToViewer(identified, 'Alice', 'alice', ['alice'], blocked,
      'account-b', 'char-a', ['unrelated-account'])).toBe(false);
    expect(socialPostVisibleToViewer(post, 'Bob', 'bob', ['alice'])).toBe(true);
  });

  it('preserves removal when later append records omit or contradict moderation; regeneration can replace it', () => {
    const messages: MessageRecord[] = [
      { id: 1, role: 'output', originalText: '', socialReactions: parse(blocked).reactions },
      { id: 2, role: 'output', originalText: '', socialReactions: { ...parse().reactions!, append: true } },
      { id: 3, role: 'output', originalText: '', socialReactions: { ...parse({ blocked: false }).reactions!, append: true } },
    ];
    expect(socialReactionsByPostId('fotogram', messages)[post.postId]).toMatchObject({ moderation: blocked, likes: 3 });
    messages.push({ id: 4, role: 'output', originalText: '', socialReactions: parse({ blocked: false }).reactions });
    expect(socialReactionsByPostId('fotogram', messages)[post.postId].moderation?.blocked).toBe(false);
  });

  it.each(['normal', 'planning'])('authors the moderation contract in the %s Fotogram slot only', (name) => {
    const workflow = JSON.parse(readFileSync(`resources/default-content/default_${name}_v42.json`, 'utf8')) as WorkflowFile;
    const node = workflow.nodes.find((entry) => entry.data.nodeType === 'llm-prompt-switch')!;
    const titles = node.data.llmPromptSwitchPromptTitlesByOutput!;
    const row = titles.findIndex((entries) => entries[0] === 'Fotogram Post');
    const prompts = node.data.llmPromptSwitchPromptAftersByOutput![row];
    expect(prompts[0]).toContain('"moderation": { "blocked": false }');
    expect(prompts[0]).toContain('For a blocked post, keep the same two groups and limits: up to two contacts plus three additional people');
    expect(prompts[0]).toContain('short, photo-specific, in-character reactions');
    expect(prompts[0]).toContain('"graphic_violence"');
    expect(prompts[1]).not.toContain('Fotogram moderation (roleplay platform rules)');
  });
});
