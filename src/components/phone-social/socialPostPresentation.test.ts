import { describe, expect, it } from 'vitest';
import { npcSeedPostKey } from '../../characters/npcParticipants';
import { npcSeedPostEngagement } from './socialPostPresentation';

describe('NPC seed post presentation', () => {
  it('provides stable engagement previews within the intended ranges', () => {
    const postId = npcSeedPostKey('npc-fotogram', 'first-post');
    const first = npcSeedPostEngagement(postId);

    expect(first).toBeDefined();
    expect(first?.likeCount).toBeGreaterThanOrEqual(10);
    expect(first?.likeCount).toBeLessThanOrEqual(50);
    expect(first?.commentCount).toBeGreaterThanOrEqual(2);
    expect(first?.commentCount).toBeLessThanOrEqual(5);
    expect(npcSeedPostEngagement(postId)).toEqual(first);
  });

  it('does not simulate engagement for regular timeline posts', () => {
    expect(npcSeedPostEngagement('fotogram-post-01')).toBeUndefined();
  });
});
