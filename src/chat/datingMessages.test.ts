import { describe, expect, it } from 'vitest';
import { normalizeDatingMessages, type DatingMessage } from './datingMessages';
import { rpStorybookCharacterSocial } from '../nodes/rp-storybook/model';

const legacyMessages: DatingMessage[] = [
  { id: 'legacy-out', matchId: 'demo-alex', sender: 'owner', text: 'Hello 😊', sentAt: '2026-09-06T10:00:00.000Z' },
  { id: 'legacy-in', matchId: 'demo-alex', sender: 'match', text: 'Demo reply', sentAt: '2026-09-06T10:00:01.000Z', demo: true },
];

describe('Legacy MatchMe conversations', () => {
  it('stores both directions and emoji text through Storybook normalization', () => {
    const messages = legacyMessages;
    const social = rpStorybookCharacterSocial({ plotTwist: {
      name: 'Player', age: 25, bio: 'Hello', photoIds: ['photo-1'], messages,
    } });
    expect(rpStorybookCharacterSocial(JSON.parse(JSON.stringify(social))).plotTwist?.messages).toEqual(messages);
    expect(messages.map((message) => message.sender)).toEqual(['owner', 'match']);
    expect(messages[0].text).toBe('Hello 😊');
    expect(messages[1].demo).toBe(true);
  });
  it('filters corrupt and duplicate records without losing valid conversations', () => {
    const messages = legacyMessages;
    expect(normalizeDatingMessages([null, ...messages, messages[0], { ...messages[0], id: 'bad', sender: 'unknown' }, { ...messages[0], id: 'bad-date', sentAt: 'invalid' }])).toEqual(messages);
  });
});
