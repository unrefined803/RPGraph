import { expect, it } from 'vitest';
import { clampPhoneReadState, normalizePhoneReadState, rekeyPhoneReadState, remapPhoneReadState } from './phoneReadState';

it('accepts absent and partial legacy metadata and discards invalid markers', () => {
  expect(normalizePhoneReadState(undefined)).toEqual({ phoneSeenByConversation: {}, bankingSeenByCharacter: {},
    phoneAppSeenByCharacter: {}, phoneDividerAfterByConversation: {} });
  expect(normalizePhoneReadState({ phoneAppSeenByCharacter: { valid: 12, negative: -1, string: '12', fraction: 1.5, infinite: Infinity } })
    .phoneAppSeenByCharacter).toEqual({ valid: 12 });
});

it('keeps read boundaries through gaps and changed IDs without suppressing future messages', () => {
  const state = normalizePhoneReadState({
    phoneSeenByConversation: { read: 100, unread: 0, deleted: 105, future: 999 },
    bankingSeenByCharacter: { owner: 100 }, phoneAppSeenByCharacter: { 'owner:fotogram:dm:npc': 110 },
    phoneDividerAfterByConversation: { read: 99 },
  });
  expect(remapPhoneReadState(state, new Map([[100, 10], [110, 11]]))).toEqual({
    phoneSeenByConversation: { read: 10, unread: 0, deleted: 10, future: 11 },
    bankingSeenByCharacter: { owner: 10 }, phoneAppSeenByCharacter: { 'owner:fotogram:dm:npc': 11 },
    phoneDividerAfterByConversation: { read: 0 },
  });
});

it('caps boundaries left above the highest remaining message so reused IDs stay unread', () => {
  const state = normalizePhoneReadState({
    phoneSeenByConversation: { undone: 20, read: 12 }, bankingSeenByCharacter: { owner: 20 },
    phoneAppSeenByCharacter: { 'owner:notes': 19, 'owner:ai': 0 }, phoneDividerAfterByConversation: { undone: 20 },
  });
  const clamped = clampPhoneReadState(state, 18);
  expect(clamped).toEqual({
    phoneSeenByConversation: { undone: 18, read: 12 }, bankingSeenByCharacter: { owner: 18 },
    phoneAppSeenByCharacter: { 'owner:notes': 18, 'owner:ai': 0 }, phoneDividerAfterByConversation: { undone: 18 },
  });
  // The next allocated ID after a load is 19 and must exceed every boundary.
  expect(Object.values(clamped).flatMap(markers => Object.values(markers)).every(marker => marker < 19)).toBe(true);
});

it('moves owner keys to a different workflow without changing DM partner identities', () => {
  const state = normalizePhoneReadState({ bankingSeenByCharacter: { 'old:character:alice': 10 },
    phoneAppSeenByCharacter: { 'old:character:alice:matchme:dm:character:bob:matchme': 12,
      'old:character:alice:fotogram:dm:bob': 9, 'library-npc:notes': 3 } });
  const saved = rekeyPhoneReadState(state, [{ id: 'old:character:alice', sourceId: 'alice' }], 'store');
  expect(saved.phoneAppSeenByCharacter['alice:matchme:dm:character:bob:matchme']).toBe(12);
  const restored = rekeyPhoneReadState(saved, [{ id: 'new:character:alice', sourceId: 'alice' }], 'load');
  expect(restored.bankingSeenByCharacter).toEqual({ 'new:character:alice': 10 });
  expect(restored.phoneAppSeenByCharacter).toEqual({
    'new:character:alice:matchme:dm:character:bob:matchme': 12,
    'new:character:alice:fotogram:dm:bob': 9, 'library-npc:notes': 3,
  });
});
