import { expect, it } from 'vitest';
import type { TurnRecord, WorkflowFile } from '../types';
import { currentWorkflowFormatVersion } from '../workflow/version';
import { appStateFromSessionV2, sessionV2FromCurrentState } from './sessionStore';

it('round-trips an initiative as one output-only turn with its player and user exchange', () => {
  const turn: TurnRecord = {
    id: 'initiative', number: 1, createdAt: '2026-09-28T12:00:00Z', mode: 'user',
    messageFormat: 0, promptSlot: 6, playerCharacterId: 'morgan',
    userInteractions: [{ question: 'Anna blocks the door. What do you do?', answer: 'Original player answer', translatedAnswer: 'I ask her to move.', displayedQuestion: 'Localized question' }],
    input: { graphText: 'The user is playing Morgan.', messages: [] },
    output: { graphText: 'Anna steps aside after Morgan asks.', messages: [{
      id: 1, role: 'output', originalText: 'Anna steps aside after Morgan asks.',
      turnId: 'initiative', turnNumber: 1, turnPart: 'output', channel: 'rp',
    }] },
  };
  const workflow: WorkflowFile = {
    format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion,
    savedAt: turn.createdAt, nodes: [], edges: [],
  };
  const saved = sessionV2FromCurrentState({
    name: 'Initiative', settings: { englishProcessingEnabled: false, displayLanguage: 'English' },
    workflowVariables: {}, turns: [turn], turnCheckpoints: [], openingMessages: [],
  }, workflow, []);
  const restored = appStateFromSessionV2(JSON.parse(JSON.stringify(saved)));
  expect(restored.turns).toHaveLength(1);
  expect(restored.turns[0]).toMatchObject({
    id: turn.id, number: 1, messageFormat: 0, promptSlot: 6,
    playerCharacterId: turn.playerCharacterId, userInteractions: turn.userInteractions,
    input: { messages: [] }, output: { graphText: turn.output.graphText },
  });
  expect(restored.turns[0].output.messages).toHaveLength(1);
});
