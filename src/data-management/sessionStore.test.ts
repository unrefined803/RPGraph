import { isRpgraphSessionV2 } from './validation';
import { expect, it } from 'vitest';
import { appStateFromSessionV2, sessionV2FromCurrentState } from './sessionStore';
import { currentWorkflowFormatVersion } from '../workflow/version';
import { unreadBankTransferCountForCharacter } from '../chat/bankTransfers';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, TurnRecord } from '../types';

function save(messages: MessageRecord[]) {
  const turn: TurnRecord = {
    id: 'turn-1', number: 1, createdAt: '2026-10-03T10:00:00Z',
    input: { graphText: '', messages: [] }, output: { graphText: '', messages },
  };
  return JSON.parse(JSON.stringify(sessionV2FromCurrentState({
    name: 'Round trip', settings: { englishProcessingEnabled: false, displayLanguage: 'English' },
    workflowVariables: {}, turns: [turn], turnCheckpoints: [], openingMessages: [],
    bankingSeenByCharacter: { alice: 100 }, phoneSeenByConversation: { 'Alice::Bob': 100 },
    phoneAppSeenByCharacter: { 'alice:fotogram': 100 }, phoneDividerAfterByConversation: { 'Alice::Bob': 100 },
  }, { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion,
    savedAt: turn.createdAt, nodes: [], edges: [] }, []))) as ReturnType<typeof sessionV2FromCurrentState>;
}

function message(id: number): MessageRecord {
  return { id, role: 'output', originalText: 'Transfer', turnId: 'turn-1', turnNumber: 1,
    turnPart: 'output', bankTransfer: { from: 'Bob', to: 'Alice', amount: 1 } };
}

it('preserves unread messages, read boundaries and future notifications across repeated loads', () => {
  const character = { id: 'alice', name: 'Alice' } as StorybookCharacter;
  let messages = [message(100), message(101)];
  for (let round = 0; round < 2; round += 1) {
    const restored = appStateFromSessionV2(save(messages));
    messages = restored.turns[0].output.messages;
    expect(messages.map(entry => entry.id)).toEqual([100, 101]);
    expect(restored.phoneSeenByConversation['Alice::Bob']).toBe(100);
    expect(restored.phoneAppSeenByCharacter['alice:fotogram']).toBe(100);
    expect(restored.phoneDividerAfterByConversation['Alice::Bob']).toBe(100);
    expect(unreadBankTransferCountForCharacter(character, messages, restored.bankingSeenByCharacter.alice)).toBe(1);
    const newMessage = message(Math.max(...messages.map(entry => entry.id)) + 1);
    expect(unreadBankTransferCountForCharacter(character, [...messages, newMessage],
      restored.bankingSeenByCharacter.alice)).toBe(2);
  }
});

it('preserves nonsequential ids and reply and embedded phone references', () => {
  const phone = { ...message(100), phoneMessage: true, phoneFrom: 'Bob', phoneTo: 'Alice' };
  const reply = { ...message(110), phoneMessage: true, phoneFrom: 'Alice', phoneTo: 'Bob', replyToMessageId: 100 };
  const bubble = { ...message(90), embeddedPhoneMessages: [{ phoneMessageId: 100, from: 'Bob', to: 'Alice', message: 'Transfer' }] };
  const restored = appStateFromSessionV2(save([bubble, reply, phone])).turns[0].output.messages;
  expect(restored.map(entry => entry.id)).toEqual([90, 110, 100]);
  expect(restored[0].embeddedPhoneMessages![0].phoneMessageId).toBe(restored[2].id);
  expect(restored[1].replyToMessageId).toBe(restored[2].id);
});

it('allocates collision-free fallback ids for imported timeline identifiers', () => {
  const session = save([message(10), message(1), message(20)]);
  session.timeline[0].id = 'external-message';
  session.timeline[2].id = 'turn-2-output-1';
  const restored = appStateFromSessionV2(session).turns[0].output.messages;
  expect(restored.map(entry => entry.id)).toEqual([2, 1, 3]);
});

it('preserves Fotogram removal and pre-removal comments across save/load', () => {
  const reactions: MessageRecord = {
    id: 115, role: 'output', originalText: 'Post blocked',
    socialReactions: {
      app: 'fotogram', postId: 'fotogram-post-02', likes: 1,
      moderation: { blocked: true, reason: 'nudity' },
      comments: [{ from: 'Bob', handle: 'bob', text: 'Wrong app!' }],
    },
  };
  const session = save([reactions]);
  expect(isRpgraphSessionV2(session)).toBe(true);
  const restored = appStateFromSessionV2(session).turns[0].output.messages;
  expect(restored[0].socialReactions).toEqual(reactions.socialReactions);
});
