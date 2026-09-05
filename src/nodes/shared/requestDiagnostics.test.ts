import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '../../types';
import { TextMetricsApi } from '../../llm/tokenMetrics';
import { executeEventManagerNode } from '../event-manager/execute';
import { executeHistoryNode } from '../history/execute';
import type { ExecuteContext } from '../types';

const cases = [
  { nodeType: 'event-manager', execute: executeEventManagerNode, prompt: 'eventLastPrompt', response: 'eventLastResponse' },
  { nodeType: 'history', execute: executeHistoryNode, prompt: 'historyLastPrompt', response: 'historyLastResponse' },
] as const;

describe.each(cases)('$nodeType request diagnostics', ({ nodeType, execute, prompt, response }) => {
  function setup(complete: () => Promise<unknown>) {
    const node = {
      id: 'diagnostic-node', type: 'workflow', position: { x: 0, y: 0 },
      data: { nodeType, label: nodeType, description: '', preview: '', historyTimeTrackingEnabled: true, [prompt]: 'OLD PROMPT', [response]: 'OLD RESPONSE' },
    } as WorkflowNode;
    const context = {
      nodes: [node], edges: [], phase: 'prepare-next-turn', currentTurnId: 'turn-1',
      historyMessages: [{ id: 1, role: 'user', originalText: 'CURRENT INPUT', turnId: 'turn-1', turnNumber: 1 }],
      recentTurns: [], originalHistory: '', translatedHistory: '', rpDateTimeFormat: 'iso', rpWeekdayLanguage: 'en-US',
      textMetrics: new TextMetricsApi(), runScratch: new Map(), retryFormatErrorsEnabled: false,
      updateRuntimeData: (_id: string, patch: object) => Object.assign(node.data, patch),
      reportFormatResult: () => {}, llm: { complete },
    } as unknown as ExecuteContext;
    return { node, context };
  }

  it('records the new prompt and clears old response before a provider failure', async () => {
    const { node, context } = setup(async () => { throw new Error('Provider unavailable'); });
    await expect(execute(node, context)).rejects.toThrow('Provider unavailable');
    expect(node.data[prompt]).toBeTruthy();
    expect(node.data[prompt]).not.toBe('OLD PROMPT');
    expect(node.data[response]).toBe('');
  });

  it('retains the raw malformed response when parsing fails', async () => {
    const { node, context } = setup(async () => ({ text: 'MALFORMED CURRENT RESPONSE' }));
    await expect(execute(node, context)).rejects.toThrow('invalid JSON');
    expect(node.data[response]).toBe('MALFORMED CURRENT RESPONSE');
    expect(node.data[prompt]).not.toBe('OLD PROMPT');
  });
});
