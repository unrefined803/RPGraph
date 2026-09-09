import { describe, expect, it } from 'vitest';
import { visibleMessageRecords } from '../data-management/selectors';
import { emptyRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import type { MessageRecord, TurnRecord, WorkflowNode } from '../types';
import {
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
