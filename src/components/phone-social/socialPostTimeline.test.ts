import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '../../types';
import { socialPostTimeline, socialPostTimelineChanges, socialReactionRevealSchedule } from './socialPostTimeline';

function post(id: number): MessageRecord {
  return { id, role: 'output', originalText: '', socialPost: {
    app: 'fotogram', postId: 'post-1', author: 'Alice', authorHandle: 'alice', caption: 'Photo',
  } };
}
function reaction(id: number): MessageRecord {
  return { id, role: 'output', originalText: '', socialReactions: {
    app: 'fotogram', postId: 'post-1', likes: 2, comments: [],
  } };
}
const snapshot = (messages: MessageRecord[]) => socialPostTimeline(messages, 'fotogram');

describe('social post timeline presentation', () => {
  it('invalidates a post removed by complete-turn undo', () => {
    const changes = socialPostTimelineChanges(snapshot([post(1), reaction(2)]), snapshot([]));
    expect([...changes.reset]).toEqual(['post-1']);
    expect([...changes.added]).toEqual([]);
  });

  it('restarts regenerated posts even when their public post ID is reused', () => {
    const before = snapshot([post(1), reaction(2)]);
    const regenerated = snapshot([post(3), reaction(4)]);
    expect(socialPostTimelineChanges(before, regenerated)).toEqual({
      reset: new Set(['post-1']), added: new Set(['post-1']),
    });
    expect(socialPostTimelineChanges(regenerated, snapshot([])).reset).toEqual(new Set(['post-1']));
  });

  it('handles removal and republication in separate renders and reused IDs after undo', () => {
    const empty = snapshot([]);
    const existing = snapshot([post(1), reaction(2)]);
    expect(socialPostTimelineChanges(existing, empty).reset.has('post-1')).toBe(true);
    expect(socialPostTimelineChanges(empty, existing).added.has('post-1')).toBe(true);
  });

  it('clears thread reveal state on undo without deleting the retained post', () => {
    const changes = socialPostTimelineChanges(snapshot([post(1), reaction(2), reaction(3)]),
      snapshot([post(1), reaction(2)]));
    expect(changes.reset).toEqual(new Set(['post-1']));
    expect(changes.added.size).toBe(0);
  });

  it('does not reset presentations for appended reactions or unrelated apps', () => {
    const other = post(8);
    other.socialPost = { ...other.socialPost!, app: 'onlyfriends' };
    const changes = socialPostTimelineChanges(snapshot([post(1)]), snapshot([post(1), reaction(2), other]));
    expect(changes.reset.size).toBe(0);
    expect(changes.added.size).toBe(0);
  });
});

describe('moderation reveal timing', () => {
  it('shows moderation only after the last staggered comment plus a separate delay', () => {
    expect(socialReactionRevealSchedule(3, () => 3_000)).toEqual({
      comments: [{ count: 2, delay: 3_000 }, { count: 3, delay: 6_000 }],
      moderationDelay: 9_000,
    });
  });

  it.each([0, 1])('still delays moderation with %i comments', (total) => {
    expect(socialReactionRevealSchedule(total, () => 4_000)).toEqual({
      comments: [], moderationDelay: 4_000,
    });
  });
});
