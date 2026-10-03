import { phoneConversationInfoFromMessages } from '../data-management/selectors';
import { normalizePhoneReadState, remapPhoneReadState } from '../chat/phoneReadState';
import { datingAccountId } from '../chat/datingAccounts';
import { matchMePairId, matchMeState, unreadMatchMeMatches } from '../chat/matchMe';
import type { StorybookCharacter } from './runtime';
import { describe, expect, it } from 'vitest';
import { visibleMessageRecords } from '../data-management/selectors';
import { defaultRpStorybookCharacterBanking, emptyRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import type { MessageRecord, TurnRecord, WorkflowNode } from '../types';
import {
  openingHistoryReadStateFromNodes,
  openingHistoryTurnsFromNodes,
  remapOpeningTurnMessageIds,
  turnsForStorybookOpeningHistory,
} from './openingHistoryRuntime';

describe('Opening History social message links', () => {
  it.each(['fotogram', 'onlyfriends', 'matchme'] as const)(
    'keeps %s DMs linked and visible only inside their bubble after repeated reloads',
    (app) => {
      const direct: MessageRecord = {
        id: 42, role: 'output', originalText: 'Hello',
        socialDirectMessage: {
          app, messageId: 'dm-42', from: 'Alice', fromHandle: 'alice',
          to: 'Bob', toHandle: 'bob', text: 'Hello', sentAt: '2026-09-09T12:00:00Z',
        },
      };
      const parent: MessageRecord = {
        id: 41, role: 'output', originalText: 'She checks her phone.',
        embeddedSocialMessages: [{ socialMessageId: direct.id, app, from: 'Alice', to: 'Bob', message: 'Hello' }],
      };
      let turns: TurnRecord[] = [{
        id: 'turn-1', number: 1, createdAt: '2026-09-09T12:00:00Z',
        input: { graphText: '', messages: [] },
        output: { graphText: '', messages: [parent, direct] },
      }];

      for (const startId of [100, 200]) {
        const stored = turnsForStorybookOpeningHistory(turns, []);
        const node: WorkflowNode = {
          id: 'book', type: 'workflow', position: { x: 0, y: 0 },
          data: {
            nodeType: 'rp-storybook',
            storybookJson: rpStorybookJsonText({
              ...emptyRpStorybook,
              openingHistory: { ...emptyRpStorybook.openingHistory, ...stored },
            }),
          },
        } as WorkflowNode;
        const loaded = openingHistoryTurnsFromNodes([node]);
        const snapshot = structuredClone(loaded);
        const result = remapOpeningTurnMessageIds(loaded, startId);
        turns = result.remappedTurns;
        const messages = turns.flatMap((turn) => [...turn.input.messages, ...turn.output.messages]);
        const link = messages[0].embeddedSocialMessages![0];
        expect(messages.find((message) => message.id === link.socialMessageId)?.socialDirectMessage)
          .toEqual(direct.socialDirectMessage);
        expect(visibleMessageRecords(messages).map((message) => message.id)).toEqual([startId]);
        expect(result.nextId).toBe(startId + 2);
        expect(loaded).toEqual(snapshot);
      }
      expect(parent.embeddedSocialMessages![0].socialMessageId).toBe(42);
    },
  );
});

it('loads legacy Storybooks without requiring read metadata', () => {
  const node = { id: 'book', data: { nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText(emptyRpStorybook) } } as WorkflowNode;
  expect(openingHistoryReadStateFromNodes([node])).toEqual(normalizePhoneReadState(undefined));
});

it('starts legacy Opening History read across phone apps while leaving future messages unread', () => {
  const character: StorybookCharacter = {
    id: 'book:alice', sourceId: 'alice', name: 'Alice', kind: 'character',
    storybookNodeId: 'book', label: 'Alice', phoneSettings: { wallpaperId: '' },
    banking: defaultRpStorybookCharacterBanking(),
    profile: { name: 'Alice', personality: '', speechStyle: '', description: '', role: '' },
    social: { fotogramUsername: 'alice', onlyfriendsUsername: 'alice', plotTwist: {
      name: 'Alice', age: 25, bio: '', interests: '', decisions: {}, photoIds: [],
    } },
  };
  const owner = datingAccountId(character);
  const messages: MessageRecord[] = [
    { id: 10, role: 'output', originalText: 'Hello', channel: 'phone', phoneMessage: true,
      phoneFrom: 'Bob', phoneTo: 'Alice' },
    ...(['fotogram', 'onlyfriends', 'matchme'] as const).map((app, index): MessageRecord => ({
      id: 20 + index, role: 'output', originalText: 'DM', socialDirectMessage: {
        app, messageId: `dm-${app}`, from: 'Bob', to: 'Alice', fromHandle: 'BobHandle', toHandle: 'alice',
        fromAccountId: 'bob-account', toAccountId: owner, text: 'DM', sentAt: '2026-10-03T00:00:00Z',
      },
    })),
    { id: 30, role: 'output', originalText: 'Match', matchMeMatch: {
      id: matchMePairId(owner, 'demo-alex'), accountIds: [owner, 'demo-alex'],
      matchedAt: '2026-10-03T00:00:00Z', status: 'active',
    } },
  ];
  const turns: TurnRecord[] = [{ id: 'turn', number: 1, createdAt: '2026-10-03T00:00:00Z',
    input: { graphText: '', messages: [] }, output: { graphText: '', messages } }];
  const book = { ...emptyRpStorybook, openingHistory: { ...emptyRpStorybook.openingHistory, turns } };
  const node = { id: 'book', data: { nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText(book) } } as WorkflowNode;
  const state = openingHistoryReadStateFromNodes([node], [character]);
  expect(phoneConversationInfoFromMessages(messages, state.phoneSeenByConversation).get('alice::bob')?.unreadCount).toBe(0);
  expect(state.phoneDividerAfterByConversation['alice::bob']).toBe(10);
  expect(state.bankingSeenByCharacter[character.id]).toBe(30);
  for (const app of ['notes', 'ai', 'fotogram', 'onlyfriends']) {
    expect(state.phoneAppSeenByCharacter[`${character.id}:${app}`]).toBe(30);
  }
  for (const app of ['fotogram', 'onlyfriends', 'matchme']) {
    const handle = app === 'matchme' ? 'BobHandle' : 'bobhandle';
    expect(state.phoneAppSeenByCharacter[`${character.id}:${app}:dm:${handle}`]).toBe(30);
  }
  const dating = matchMeState([character], messages);
  expect(unreadMatchMeMatches(owner, dating, messages, () => 0)).toEqual({ 'demo-alex': 30 });
  expect(unreadMatchMeMatches(owner, dating, messages,
    partner => state.phoneAppSeenByCharacter[`${character.id}:matchme:dm:${partner}`] ?? 0)).toEqual({});
  const remapped = remapOpeningTurnMessageIds(openingHistoryTurnsFromNodes([node]), 100);
  const mappedState = remapPhoneReadState(state, remapped.idMap);
  expect(Object.values(mappedState).flatMap(Object.values).every(marker => marker < remapped.nextId)).toBe(true);
  const nextMessages = [...messages, { ...messages[0], id: 31 }];
  expect(phoneConversationInfoFromMessages(nextMessages, state.phoneSeenByConversation).get('alice::bob')?.unreadCount).toBe(1);

  // An explicitly saved empty state means unread, not a legacy Storybook.
  node.data.storybookJson = rpStorybookJsonText({ ...book, openingHistory: {
    ...book.openingHistory, readState: normalizePhoneReadState(undefined),
  } });
  expect(openingHistoryReadStateFromNodes([node], [character])).toEqual(normalizePhoneReadState(undefined));
});

it('restores read and unread prefixes after repeated imports with reordered message IDs', () => {
  let turns: TurnRecord[] = [{ id: 'turn', number: 1, createdAt: '2026-10-03T00:00:00Z',
    input: { graphText: '', messages: [] }, output: { graphText: '', messages: [110, 100, 120].map(id => ({
      id, role: 'output' as const, originalText: String(id),
    })) } }];
  let readState = normalizePhoneReadState({
    phoneSeenByConversation: { 'alice::bob': 110 }, bankingSeenByCharacter: { alice: 100 },
    phoneAppSeenByCharacter: { 'alice:fotogram:dm:bob': 110, 'alice:onlyfriends:dm:bob': 100,
      'alice:matchme:dm:bob': 110, 'alice:notes': 120, 'alice:ai': 0 },
    phoneDividerAfterByConversation: { 'alice::bob': 100 },
  });
  for (const startId of [5, 25]) {
    const node = { id: 'other-workflow-book', data: { nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText({
      ...emptyRpStorybook, openingHistory: { ...emptyRpStorybook.openingHistory, turns, readState },
    }) } } as WorkflowNode;
    const result = remapOpeningTurnMessageIds(openingHistoryTurnsFromNodes([node]), startId);
    readState = remapPhoneReadState(openingHistoryReadStateFromNodes([node]), result.idMap);
    turns = result.remappedTurns;
    const ids = turns[0].output.messages.map(message => message.id);
    expect(ids).toEqual([startId + 1, startId, startId + 2]);
    expect(ids.map(id => id > readState.phoneAppSeenByCharacter['alice:fotogram:dm:bob'])).toEqual([false, false, true]);
    expect(ids.map(id => id > readState.bankingSeenByCharacter.alice)).toEqual([true, false, true]);
    expect(readState.phoneDividerAfterByConversation['alice::bob']).toBe(startId);
    expect(readState.phoneAppSeenByCharacter['alice:notes']).toBe(startId + 2);
    expect(readState.phoneAppSeenByCharacter['alice:ai']).toBe(0);
  }
});

it('restores WhatsUp read boundaries instead of marking the entire conversation read', () => {
  const turns: TurnRecord[] = [{ id: 'turn', number: 1, createdAt: '2026-10-03T00:00:00Z',
    input: { graphText: '', messages: [] }, output: { graphText: '', messages: [100, 110].map(id => ({
      id, role: 'output' as const, originalText: 'Hello', channel: 'phone' as const,
      phoneMessage: true, phoneFrom: 'Bob', phoneTo: 'Alice',
    })) } }];
  const messages = turns[0].output.messages;
  const [key] = phoneConversationInfoFromMessages(messages, {}).keys();
  const book = { ...emptyRpStorybook, openingHistory: { ...emptyRpStorybook.openingHistory, turns,
    readState: normalizePhoneReadState({ phoneSeenByConversation: { [key]: 100 } }),
  } };
  const node = { id: 'book', data: { nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText(book) } } as WorkflowNode;
  const loaded = openingHistoryTurnsFromNodes([node]);
  const remapped = remapOpeningTurnMessageIds(loaded, 1);
  const markers = remapPhoneReadState(openingHistoryReadStateFromNodes([node]), remapped.idMap);
  const counts = phoneConversationInfoFromMessages(remapped.remappedTurns[0].output.messages, markers.phoneSeenByConversation);
  expect(counts.get(key)?.unreadCount).toBe(1);
  expect(phoneConversationInfoFromMessages(messages, {}).get(key)?.unreadCount).toBe(2);
});
