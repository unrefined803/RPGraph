import { afterEach, describe, expect, it, vi } from 'vitest';
import { decode } from '@toon-format/toon';
import { formatContextValue } from '../data-management/formatters';
import { NodeLlmApi } from '../llm/NodeLlmApi';
import { TextMetricsApi } from '../llm/tokenMetrics';
import type { ConnectionPreset, TurnRecord, WorkflowNode } from '../types';
import { createTurnTrace, createTurnTraceRecorder, turnTraceCopyPayload } from './turnTrace';
import { socialMediaMessageFormat } from '../chat/messageFormats';
import { pruneToRecentTurns } from './useTurnTraceState';

const connection: ConnectionPreset = {
  id: 'connection', label: 'Test', baseUrl: 'http://localhost', apiKey: 'PRIVATE KEY', model: 'test', vision: false,
};
const turn: TurnRecord = {
  id: 'turn-1', number: 1, createdAt: '2026-09-05T08:00:00Z', mode: 'user',
  input: { graphText: 'Graph input', messages: [{ id: 1, role: 'user', originalText: 'Input', includeInHistory: false }] },
  output: { graphText: 'Graph output', messages: [] },
};
const run = { runId: 'run-1', startedAt: '2026-09-05T09:00:00Z', calls: [] };
const longText = 'Synthetic diagnostic context with useful details. '.repeat(200);
const metrics = new TextMetricsApi();
const completedAt = '2026-09-05T09:01:00Z';
const image = { id: 'image-1', name: 'Reference', mimeType: 'image/png', size: 20, dataUrl: 'data:image/png;base64,SECRETDATA' };

function nodeWithPass(text: string): WorkflowNode {
  return {
    id: 'prompt', type: 'workflow', position: { x: 0, y: 0 },
    data: {
      nodeType: 'llm-prompt-switch', label: 'Switch', description: '', preview: '',
      llmPromptSwitchDebug: {
        inputValue: text, promptBefore: '', promptAfter: '', combinedPrompt: text, generatedText: '',
        outputChannelValue: 'invalid route', promptSlotValue: '3', selectedOutputChannel: 0, selectedPromptSlot: 3,
        promptPasses: [{ label: 'Planning', sections: [
          { label: 'Text Input', text, parts: [{ text, actionInserted: true, stepOutputInserted: 'planning' }] },
        ] }],
      },
    },
  } as WorkflowNode;
}

function setup(node = nodeWithPass('First input')) {
  const recorder = createTurnTraceRecorder((id) => id === node.id ? node : undefined);
  const completion = vi.fn().mockResolvedValue({ text: 'Raw result', stats: { inputTokens: 23, totalTokens: 31, durationMs: 10 } });
  vi.stubGlobal('window', { rpgraph: { chatCompletion: completion } });
  const api = new NodeLlmApi({ resolveConnection: async () => connection }).withRequestObserver(recorder.observe('response'));
  return { recorder, completion, api, node };
}

function checkReferences(value: unknown) {
  const visit = (entry: unknown) => {
    if (!entry || typeof entry !== 'object') return;
    if ('$ref' in entry) {
      const pointer = String(entry.$ref);
      let target: unknown = value;
      for (const part of pointer.slice(2).split('/')) {
        target = (target as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
        expect(target).toBeDefined();
      }
      expect(target).not.toHaveProperty('$ref');
    }
    Object.values(entry).forEach(visit);
  };
  visit(value);
}

afterEach(() => vi.unstubAllGlobals());

describe('turn trace request capture', () => {
  it('captures requests and raw responses independently of later node changes and preparation', async () => {
    const { node, recorder, api } = setup();
    await api.complete({ nodeId: node.id, label: 'Planning', prompt: 'First input', images: [image] });
    node.data.llmPromptSwitchDebug!.promptPasses![0].sections![0].parts![0].text = 'MUTATED';
    node.data.llmPromptSwitchDebug!.selectedPromptSlot = 9;
    await api.withRequestObserver(recorder.observe('prepare-next-turn')).complete({ nodeId: node.id, label: 'Prepare', prompt: 'Next input' });
    const trace = createTurnTrace({ turn, run, status: 'completed', capturedSteps: recorder.steps, completedAt });
    expect(trace.steps[0]).toMatchObject({
      capture: 'request-boundary', phase: 'response', selectedPromptSlot: 3,
      routing: { outputChannelValue: 'invalid route' }, dispatched: true,
      usage: { inputTokens: 23, durationMs: 10 },
      requestSettings: { model: 'test', connectionId: 'connection' },
      promptPasses: [{ prompt: 'First input', images: [], sections: [{ parts: [{ text: 'First input', actionInserted: true }] }] }],
      outputPasses: [{ text: 'Raw result' }],
    });
    expect(trace.steps[1]).toMatchObject({ phase: 'prepare-next-turn', promptPasses: [{ prompt: 'Next input' }] });
    expect(trace.steps[1].routing).toBeUndefined();
    expect(trace.input.messages[0].includeInHistory).toBe(false);
    expect(trace.turnCreatedAt).not.toBe(trace.startedAt);
    recorder.steps[0].promptPasses![0].sections![0].parts![0].text = 'CHANGED AFTER SAVE';
    expect(JSON.stringify(trace)).not.toMatch(/MUTATED|CHANGED AFTER SAVE|PRIVATE KEY|SECRETDATA/);
  });

  it('keeps a failed later pass, its changed input, and all earlier output', async () => {
    const { api, recorder, completion } = setup();
    await api.complete({ nodeId: 'prompt', label: 'Step', prompt: 'First input' });
    completion.mockRejectedValueOnce(new Error('Provider failure'));
    await expect(api.complete({ nodeId: 'prompt', label: 'Replay', prompt: 'Changed input', stage: { kind: 'step', name: 'main', replay: 1 } }))
      .rejects.toThrow('Provider failure');
    const trace = createTurnTrace({ turn, run, status: 'error', error: 'Provider failure', capturedSteps: recorder.steps });
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0].outputPasses![0].text).toBe('Raw result');
    expect(trace.steps[1]).toMatchObject({ status: 'error', error: 'Provider failure', dispatched: true, promptPasses: [{ prompt: 'Changed input' }] });
    expect(trace.steps[1].outputPasses).toBeUndefined();
  });

  it('records only vision-enabled image metadata and preserves raw invalid responses with parse errors', async () => {
    const recorder = createTurnTraceRecorder(() => undefined);
    const api = new NodeLlmApi({ resolveConnection: async () => ({ ...connection, vision: true }) })
      .withRequestObserver(recorder.observe('response'));
    vi.stubGlobal('window', { rpgraph: { chatCompletion: async () => ({ text: 'NOT JSON', stats: { durationMs: 1 } }) } });
    await api.complete({ label: 'Parse response', prompt: 'Return JSON', images: [image] });
    const detail = `Parser context ${longText} ERROR AT END`;
    const trace = createTurnTrace({ turn, run, status: 'error', error: 'Invalid JSON', capturedSteps: recorder.steps,
      traceEvents: [{ kind: 'format', name: 'JSON', status: 'error', detail, preview: 'NOT JSON' }],
    });
    expect(trace.steps[0].promptPasses![0].images).toEqual([{ index: 1, id: image.id, name: image.name }]);
    expect(trace.steps[0].outputPasses![0].text).toBe('NOT JSON');
    expect(JSON.stringify(trace)).not.toContain('SECRETDATA');
    expect(JSON.stringify(turnTraceCopyPayload([trace]))).toContain('ERROR AT END');
  });

  it('captures action results at node completion without borrowing unobserved node diagnostics', async () => {
    const { api, recorder, node } = setup();
    node.data.llmPromptSwitchDebug!.actionResults = ['Old action'];
    const event = { nodeId: node.id, nodeLabel: 'Switch', phase: 'response' as const,
      status: 'completed' as const, at: completedAt, atMs: 1, output: 'Reply',
    };
    expect(recorder.captureNodeExecution(event).actionResults).toBeUndefined();
    await api.complete({ nodeId: node.id, label: 'Main', prompt: 'First input' });
    node.data.llmPromptSwitchDebug!.actionResults = ['Current action result'];
    const captured = recorder.captureNodeExecution(event);
    node.data.llmPromptSwitchDebug!.actionResults[0] = 'Later mutation';
    expect(captured.actionResults).toEqual(['Current action result']);
  });

  it('records resolution failures and cancellation before dispatch without a fake completed call', async () => {
    const recorder = createTurnTraceRecorder(() => undefined);
    const api = new NodeLlmApi({ resolveConnection: async () => { throw new Error('No connection'); } })
      .withRequestObserver(recorder.observe('response'));
    await expect(api.complete({ label: 'Resolve', prompt: 'Actual input' })).rejects.toThrow('No connection');
    const controller = new AbortController();
    controller.abort();
    await expect(api.withAbortSignal(controller.signal).complete({ label: 'Cancelled', prompt: 'Retry input' })).rejects.toThrow('cancelled');
    expect(recorder.steps.map((step) => [step.status, step.dispatched])).toEqual([['error', false], ['cancelled', false]]);
  });

  it('captures scoped helper calls through API copies and stops observing after the run', async () => {
    const recorder = createTurnTraceRecorder(() => undefined);
    const api = new NodeLlmApi({ resolveConnection: async () => connection });
    vi.stubGlobal('window', { rpgraph: { chatCompletion: async () => ({ text: 'Translation', stats: { durationMs: 1 } }) } });
    const controller = new AbortController();
    const stop = api.observeRequestsForSignal(controller.signal, recorder.observe('response'));
    await api.withAbortSignal(controller.signal).complete({ label: 'Translate', prompt: 'Translate input' });
    await api.complete({ label: 'Unrelated', prompt: 'Separate task' });
    stop();
    await api.withAbortSignal(controller.signal).complete({ label: 'Later', prompt: 'Later task' });
    expect(recorder.steps.map((step) => step.prompt)).toEqual(['Translate']);
  });

  it('retains a partial streamed response on cancellation and preserves empty successful responses', async () => {
    const { api, recorder } = setup();
    const controller = new AbortController();
    vi.stubGlobal('window', { rpgraph: {
      streamChatCompletion: async (_request: unknown, onChunk: (text: string) => void) => {
        onChunk('Partial raw response'); controller.abort(); throw new Error('Cancelled');
      },
      chatCompletion: async () => ({ text: '', stats: { durationMs: 1 } }),
    } });
    await expect(api.withAbortSignal(controller.signal).complete({ label: 'Stream', prompt: 'Input', onChunk: () => {} })).rejects.toThrow('Cancelled');
    expect(recorder.steps[0]).toMatchObject({ status: 'cancelled', partialResponse: 'Partial raw response' });
    await api.complete({ label: 'Empty', prompt: '' });
    expect(recorder.steps[1].outputPasses).toEqual([{ label: 'Raw response', text: '' }]);
  });

  it('orders overlapping calls by start and matches reports by occurrence without reading stale nodes', async () => {
    const { recorder, api, completion } = setup();
    let resolveFirst!: (value: unknown) => void;
    completion.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const first = api.complete({ nodeId: 'prompt', label: 'Same label', prompt: 'First' });
    await api.complete({ nodeId: 'prompt', label: 'Same label', prompt: 'Second' });
    resolveFirst({ text: 'First response', stats: { durationMs: 2 } });
    await first;
    const calls = recorder.steps.map((step) => ({ order: step.order, nodeId: step.nodeId, nodeLabel: step.nodeLabel, label: step.prompt, startedAtMs: step.startedAtMs }));
    const trace = createTurnTrace({ turn, run: { ...run, calls: calls.reverse() }, status: 'completed', capturedSteps: recorder.steps });
    expect(trace.steps.map((step) => step.promptPasses![0].prompt)).toEqual(['First', 'Second']);
    expect(createTurnTrace({ turn, run: { ...run, calls }, status: 'completed' }).steps[0].capture).toBe('run-report-only');
  });
});

describe('turn trace exports and retention', () => {
  it('keeps references local to each selected range and measures a smaller actual export', () => {
    const trace = createTurnTrace({ turn: { ...turn, input: { graphText: longText, messages: [] } }, run, status: 'error', error: 'Invalid JSON', capturedSteps: [
      { order: 1, nodeId: 'node/~', nodeLabel: 'Prompt', prompt: 'Main', promptPasses: [{ label: 'Main', prompt: longText, sections: [
        { label: 'Text Input', text: longText, parts: [{ text: longText, actionInserted: true }] },
      ] }], outputPasses: [{ label: 'Raw', text: 'Invalid response' }], routing: { outputChannelValue: 'bad', promptSlotValue: '3' } },
    ] });
    const later = { ...trace, traceId: 'run-2', turnId: 'turn-2', turnNumber: 2 };
    const together = turnTraceCopyPayload([later, trace], metrics, completedAt);
    expect(together).toEqual(turnTraceCopyPayload([trace, later], metrics, completedAt));
    for (const payload of [together, turnTraceCopyPayload([later], metrics, completedAt)]) {
      checkReferences(payload);
      expect(JSON.stringify(payload)).toContain('Invalid JSON');
      expect(JSON.stringify(payload)).toContain('actionInserted');
      expect(JSON.stringify(payload)).toContain('outputChannelValue');
      expect(JSON.stringify(payload)).toContain('omittedCharacters');
      expect(decode(formatContextValue(payload, 'toon'), { expandPaths: 'safe' })).toEqual(JSON.parse(JSON.stringify(payload)));
    }
    expect(metrics.measure(JSON.stringify(together, null, 2)).tokens)
      .toBeLessThan(metrics.measure(JSON.stringify({ traces: [trace, later] }, null, 2)).tokens / 2);
    expect(trace.input.graphText).toBe(longText);
  });

  it('keeps the initiating channel when the turn also emits phone messages', () => {
    const mixedTurn = { ...turn, output: { graphText: '', messages: [{ id: 2, role: 'output' as const, originalText: 'Phone reply', channel: 'phone' as const }] } };
    const trace = createTurnTrace({ turn: mixedTurn, run, status: 'completed' });
    expect(trace.channel).toBe('rp');
    expect(trace.output.messages[0].channel).toBe('phone');
    expect(createTurnTrace({ turn: { ...mixedTurn, messageFormat: socialMediaMessageFormat }, run, status: 'completed' }).channel).toBe('social-media');
  });

  it('never discards passes or ordered warning events and bounds repeated failed attempts', () => {
    const trace = createTurnTrace({ turn, run, status: 'error', traceEvents: Array.from({ length: 110 }, (_, index) => ({ kind: 'warning', message: `Warning ${index}` })) });
    trace.steps = [{ order: 1, nodeId: 'node', nodeLabel: 'Node', prompt: 'Passes', promptPasses: Array.from({ length: 110 }, (_, index) => ({ label: `Pass ${index}`, prompt: 'Input' })) }];
    const payload = turnTraceCopyPayload([trace]);
    expect(payload.traces[0]).toHaveProperty('events.length', 110);
    expect(payload.traces[0]).toHaveProperty('steps.0.promptPasses.length', 110);
    const attempts = Array.from({ length: 120 }, (_, index) => ({ ...trace, traceId: `attempt-${index}` }));
    expect(pruneToRecentTurns(attempts)).toHaveLength(90);
    expect(pruneToRecentTurns(attempts)[89].traceId).toBe('attempt-119');
    expect(pruneToRecentTurns(attempts.map((entry, index) => ({ ...entry, turnNumber: index })))).toHaveLength(30);
  });
});
