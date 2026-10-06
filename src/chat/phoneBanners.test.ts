import { describe, expect, it } from 'vitest';
import type { SocialDirectMessageRecord } from '../types';
import {
  bankTransferPhoneBanner,
  directMessagePhoneBanner,
  pendingPhoneBanners,
  socialReactionsPhoneBanner,
  whatsUpPhoneBanner,
} from './phoneBanners';

const directMessage: SocialDirectMessageRecord = {
  app: 'onlyfriends',
  messageId: 'dm-7',
  from: 'Mara',
  fromHandle: 'Mara.Official',
  to: 'Jonas',
  toHandle: 'jonas',
  text: '  Write me on\nWhatsUp  ',
  sentAt: '2026-01-01T10:00:00.000Z',
};

describe('phone banners', () => {
  it('names sender, recipient and amount of a received transfer', () => {
    const banner = bankTransferPhoneBanner(12, { from: 'Mara', to: 'Jonas', amount: 50, note: 'Rent' });
    expect(banner).toMatchObject({
      key: 'banking:12',
      messageId: 12,
      text: '$50.00 from Mara to Jonas · Rent',
      target: { kind: 'app', app: 'banking' },
    });
  });

  it('summarizes a direct-message thread by its latest message', () => {
    const banner = directMessagePhoneBanner(9, { ...directMessage, tip: 5 }, 3);
    expect(banner.title).toBe('Mara');
    expect(banner.text).toBe('Write me on WhatsUp · Tip $5.00 · 3 new messages');
    expect(banner.target).toEqual({
      kind: 'directMessage',
      app: 'onlyfriends',
      participantName: 'Mara',
      participantHandle: 'Mara.Official',
      messageId: 'dm-7',
    });
  });

  it('falls back when a message carries no text', () => {
    expect(directMessagePhoneBanner(9, { ...directMessage, text: '', imageIds: ['img'] }, 1).text).toBe('Sent a photo');
    expect(whatsUpPhoneBanner({
      character: { id: 'c1', name: 'Mara' }, conversationKey: 'jonas::mara', latestPhoneId: 4, preview: '',
    }).text).toBe('New message');
  });

  it('counts reactions on an own post', () => {
    const banner = socialReactionsPhoneBanner(20, {
      app: 'fotogram', postId: 'p1', likes: 1, comments: [{ from: 'Mara', handle: 'mara', text: 'Nice' }],
    });
    expect(banner.title).toBe('Your post: 1 new comment, 1 new like');
    expect(banner.text).toBe('Mara: Nice');
    expect(banner.target).toEqual({ kind: 'post', app: 'fotogram', postId: 'p1' });
  });

  it('announces only unhandled events newer than the baseline, oldest first', () => {
    const banners = [30, 10, 20, 25].map((id) => bankTransferPhoneBanner(id, { from: 'Mara', to: 'Jonas', amount: id }));
    expect(pendingPhoneBanners(banners, 10, new Set(['banking:25'])).map((banner) => banner.messageId)).toEqual([20, 30]);
  });
});
