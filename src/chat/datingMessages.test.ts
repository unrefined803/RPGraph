import { describe, expect, it } from 'vitest';
import { createDatingDemoExchange, normalizeDatingMessages } from './datingMessages';
import { rpStorybookCharacterSocial } from '../nodes/rp-storybook/model';

describe('MatchMe conversations', () => {
  it('stores both directions and emoji text through Storybook normalization', () => {
    const messages = createDatingDemoExchange('demo-alex', 'Hello 😊', []);
    const social = rpStorybookCharacterSocial({ plotTwist: {
      name: 'Player', age: 25, bio: 'Hello', photoIds: ['photo-1'], messages,
    } });
    expect(rpStorybookCharacterSocial(JSON.parse(JSON.stringify(social))).plotTwist?.messages).toEqual(messages);
    expect(messages.map((message) => message.sender)).toEqual(['owner', 'match']);
    expect(messages[0].text).toBe('Hello 😊');
    expect(messages[1].demo).toBe(true);
  });
  it('keeps replies scoped to the selected match and rejects empty messages', () => {
    const alex = createDatingDemoExchange('demo-alex', 'Hey', []);
    const robin = createDatingDemoExchange('demo-robin', 'Hello', alex);
    expect(robin.every((message) => message.matchId === 'demo-robin')).toBe(true);
    expect(robin[1].text).toContain('afternoon');
    expect(createDatingDemoExchange('demo-alex', '  ', alex)).toEqual([]);
  });
  it('filters corrupt and duplicate records without losing valid conversations', () => {
    const messages = createDatingDemoExchange('demo-alex', 'Hi', []);
    expect(normalizeDatingMessages([null, ...messages, messages[0], { ...messages[0], id: 'bad', sender: 'unknown' }, { ...messages[0], id: 'bad-date', sentAt: 'invalid' }])).toEqual(messages);
  });
});
