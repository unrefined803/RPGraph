import { describe, expect, it } from 'vitest';
import { appCharactersFromRegistry } from './appRuntime';
import { buildCharacterRegistry } from './registry';
import { resolveWhatsUpMessageParticipants, resolveWhatsUpRecipient } from './messageIdentity';
import { phoneRuntimeCharactersFromMessages } from '../chat/phoneCharacters';
import type { MessageRecord } from '../types';

const characters = () => appCharactersFromRegistry(buildCharacterRegistry(['Nova Test', 'Nova Other'].map((name, index) => ({
  tier: 'storybook', source: 'book', character: {
    id: `person-${index}`, name, description: '', personality: '', speechStyle: '', role: '', images: [],
    apps: { whatsup: { accountId: `wa-${index}`, enabled: true, username: `phone.${index}`, displayName: name, bio: '' } },
  },
}))));

describe('WhatsUp delivery identity', () => {
  it('rejects fuzzy, unknown and ambiguous senders while resolving stable IDs first', () => {
    const cast = characters();
    for (const from of ['Nova', 'Unknown', '@missing']) {
      expect(() => resolveWhatsUpMessageParticipants(cast, [], { from, to: 'wa-1' })).toThrow('Unknown');
    }
    cast[1].name = cast[0].name;
    expect(() => resolveWhatsUpMessageParticipants(cast, [], { from: cast[0].name, to: 'wa-1' })).toThrow('Ambiguous');
    cast[1].name = 'wa-0';
    expect(resolveWhatsUpMessageParticipants(cast, [], { from: 'wa-0', to: '@phone.1' }))
      .toMatchObject({ from: { name: 'Nova Test', accountId: 'wa-0' }, to: { name: 'wa-0', accountId: 'wa-1' } });
  });

  it('rejects disabled accounts by ID, name, username and history', () => {
    const cast = characters();
    cast[0].apps!.whatsup!.enabled = false;
    const history: MessageRecord[] = [{ id: 1, role: 'output', originalText: '', phoneMessage: true,
      phoneFrom: cast[0].name, phoneTo: cast[1].name, phoneFromAccountId: 'old-wa' }];
    for (const identity of ['wa-0', 'Nova Test', '@phone.0', 'old-wa']) {
      expect(() => resolveWhatsUpRecipient(cast, history, identity)).toThrow('Unavailable');
    }
    cast[0].apps!.whatsup!.accountId = 'wa-1';
    expect(() => resolveWhatsUpRecipient(cast, [], '@phone.1')).toThrow('Ambiguous');
  });

  it('keeps historical contacts bound when temporary phone views exist and when resolving twice', () => {
    const cast = characters();
    for (const savedId of [undefined, 'saved-contact']) {
      const history: MessageRecord[] = [{ id: 1, role: 'output', originalText: '', channel: 'phone', phoneMessage: true,
        phoneFrom: 'Old Friend', phoneTo: cast[0].name, phoneFromAccountId: savedId }];
      const runtime = phoneRuntimeCharactersFromMessages(cast, history);
      const resolved = resolveWhatsUpMessageParticipants(runtime, history, { from: 'Old Friend', to: 'wa-0' });
      expect(resolved.from.accountId).toBe(savedId ?? 'whatsup:contact:Old%20Friend');
      expect(resolveWhatsUpMessageParticipants(runtime, history, {
        from: resolved.from.accountId, to: resolved.to.accountId,
      })).toEqual(resolved);
    }
  });

  it('keeps implicit legacy Storybook phone IDs stable across delivery boundaries', () => {
    const cast = characters();
    delete cast[0].apps!.whatsup;
    const first = resolveWhatsUpMessageParticipants(cast, [], { from: cast[0].name, to: 'wa-1' });
    expect(resolveWhatsUpRecipient(cast, [], first.from.accountId)).toEqual(first.from);
    cast[0].libraryNpc = true;
    expect(() => resolveWhatsUpRecipient(cast, [], cast[0].name)).toThrow('Unavailable');
  });
});
