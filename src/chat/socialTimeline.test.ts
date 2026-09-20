import { describe, expect, it } from 'vitest';
import type { MessageRecord, SocialMessengerAppKind } from '../types';
import { visibleMessageRecords } from '../data-management/selectors';
import { socialMessageHiddenFromChat } from './socialMedia';
import { socialTimelineGroups, socialTimelineMessageText } from './socialTimeline';

function dm(id: number, app: SocialMessengerAppKind = 'fotogram', day = '2026-09-09'): MessageRecord {
  return {
    id, role: id % 2 ? 'user' : 'output', originalText: 'DM history', rpDateTime: `${day}T12:00`,
    socialDirectMessage: {
      app, messageId: `dm-${id}`, from: 'Alice', fromHandle: 'alice', to: 'Bob', toHandle: 'bob',
      text: `Message ${id}`, displayText: `Translation ${id}`, sentAt: `${day}T12:00:00Z`,
    },
  };
}

describe('standalone social DM timeline', () => {
  it.each(['fotogram', 'onlyfriends', 'matchme'] as const)('groups command-only %s outputs with adjacent DMs without duplicating linked records', (app) => {
    const parent: MessageRecord = {
      id: 3, role: 'output', originalText: ' \n', rpDateTime: '2026-09-09T12:01',
      embeddedPhoneTextBefore: '', embeddedPhoneTextAfter: ' ',
      embeddedSocialMessages: [{ socialMessageId: 4, app, from: 'Alice', to: 'Bob', message: 'Message 4' }],
    };
    const visible = visibleMessageRecords([dm(1, app), dm(2, app), parent, dm(4, app), dm(5, app)], {
      hideMessage: socialMessageHiddenFromChat,
    });
    const grouped = socialTimelineGroups(visible);
    expect([...grouped.groups.keys()]).toEqual([1]);
    expect(grouped.groups.get(1)?.map((link) => link.socialMessageId)).toEqual([1, 2, 4, 5]);
    expect([...grouped.skippedIds]).toEqual([2, 3, 5]);
    expect(socialTimelineGroups([parent]).groups.get(3)).toEqual(parent.embeddedSocialMessages);
    expect([...socialTimelineGroups([dm(1, app), { ...parent, rpDateTime: '2026-09-10T12:01' }]).groups.keys()])
      .toEqual([1, 3]);

    for (const extra of [
      { originalText: 'She checks her phone.' },
      { embeddedPhoneTextBefore: 'She checks her phone.' },
      { embeddedPhoneTextAfter: 'She puts her phone away.' },
      { embeddedPhoneTranslatedTextBefore: 'Translated narration.' },
      { embeddedPhoneTranslatedTextAfter: 'Translated narration.' },
      { translatedText: 'Translated narration.' },
      { outputActionInfoBoxes: [{ title: 'Notice', text: 'Something happened.' }] },
      { embeddedPhoneMessages: [{ phoneMessageId: 6, from: 'Alice', to: 'Bob', message: 'Hello' }] },
    ] satisfies Partial<MessageRecord>[]) {
      const interrupted = socialTimelineGroups([dm(1, app), { ...parent, ...extra }, dm(5, app)], true);
      expect([...interrupted.groups.keys()]).toEqual([1, 5]);
      expect(interrupted.skippedIds.has(parent.id)).toBe(false);
    }
  });

  it.each(['fotogram', 'onlyfriends', 'matchme'] as const)('groups consecutive %s DMs across replies and splits around other content and days', (app) => {
    const messages = [dm(1, app), dm(2, app), { id: 3, role: 'output', originalText: 'An interruption.' } as MessageRecord,
      dm(4, app), dm(5, app), dm(6, app, '2026-09-10')];
    const { groups, skippedIds } = socialTimelineGroups(visibleMessageRecords(messages, { hideMessage: socialMessageHiddenFromChat }));
    expect([...groups.keys()]).toEqual([1, 4, 6]);
    expect([...skippedIds]).toEqual([2, 5]);
    expect(groups.get(1)?.map((link) => link.socialMessageId)).toEqual([1, 2]);
    expect(groups.get(1)?.[0]).toMatchObject({ app, message: 'Message 1', translatedMessage: 'Translation 1' });
  });

  it.each(['fotogram', 'onlyfriends', 'matchme'] as const)('merges %s conversation turns across invisible workflow outputs', (app) => {
    const empty: MessageRecord = { id: 3, role: 'output', originalText: '', rpDateTime: '2026-09-09T12:01' };
    const messages = [dm(1, app), dm(2, app), empty, dm(4, app), dm(5, app)];
    const grouped = socialTimelineGroups(messages);
    expect([...grouped.groups.keys()]).toEqual([1]);
    expect(grouped.groups.get(1)?.map((link) => link.socialMessageId)).toEqual([1, 2, 4, 5]);
    expect([...grouped.skippedIds]).toEqual([2, 4, 5]);

    for (const interruption of [
      { ...empty, originalText: 'The door opens.' },
      { ...empty, outputActionInfoBoxes: [{ title: 'Notice', text: 'Something happened.' }] },
      { ...empty, embeddedPhoneMessages: [{ phoneMessageId: 30, from: 'Alice', to: 'Bob', message: 'A phone message.' }] },
      { ...empty, rpDateTime: '2026-09-10T00:00' },
    ] satisfies MessageRecord[]) {
      expect([...socialTimelineGroups([messages[0], messages[1], interruption, ...messages.slice(3)]).groups.keys()]).toEqual([1, 4]);
    }
  });

  it('keeps embedded DMs visible once and hides match events without deleting history', () => {
    const direct = dm(2, 'matchme');
    const parent: MessageRecord = { id: 1, role: 'output', originalText: 'She checks her phone.',
      embeddedSocialMessages: [{ socialMessageId: 2, app: 'matchme', from: 'Alice', to: 'Bob', message: 'Message 2' }] };
    const match = { id: 3, role: 'user', originalText: 'A match', matchMeMatch: {} } as MessageRecord;
    const history = [parent, direct, match, dm(4, 'matchme')];
    const visible = visibleMessageRecords(history, { hideMessage: socialMessageHiddenFromChat });
    expect(visible.map((message) => message.id)).toEqual([1, 4]);
    expect([...socialTimelineGroups(visible).groups.keys()]).toEqual([4]);
    expect(history).toHaveLength(4);
  });
});

describe('social timeline display translation', () => {
  it('uses the app display text with input-only translation and preserves embedded fallbacks', () => {
    const record = dm(1).socialDirectMessage!;
    const link = { socialMessageId: 1, app: record.app, from: record.from, to: record.to,
      message: 'Original input', translatedMessage: 'Embedded translation' };
    expect(socialTimelineMessageText(link, record, false)).toBe('Translation 1');
    expect(socialTimelineMessageText(link, record, true)).toBe('Translation 1');
    expect(socialTimelineMessageText(link, undefined, false)).toBe('Original input');
    expect(socialTimelineMessageText(link, undefined, true)).toBe('Embedded translation');
  });
});
