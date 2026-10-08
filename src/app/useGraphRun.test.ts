import { describe, expect, it, vi } from 'vitest';
import { useGraphRun } from './useGraphRun';
import { NodeLlmApi } from '../llm/NodeLlmApi';
import type { WorkflowNode } from '../types';

type Options = Parameters<typeof useGraphRun>[0];
function harness() {
  const nodes = ['input', 'output', 'llm-prompt'].map((nodeType, index) => ({
    id: nodeType, data: { nodeType, label: nodeType, connectionId: index === 2 ? 'unused' : 'provider' },
  })) as WorkflowNode[];
  const translateText = vi.fn<Options['translateText']>((...args) => new Promise((_resolve, reject) => {
    args[6]!.addEventListener('abort', () => reject(new Error('The LLM request was cancelled.')), { once: true });
  }));
  const options = {
    nodesRef: { current: nodes }, edges: [], messages: [], messagesRef: { current: [] },
    activeRun: { current: null }, turnsRef: { current: [] }, activeTurnCollectorRef: { current: null },
    workflowSettingsValuesRef: { current: {} }, lastRunDebugRef: { current: null },
    characterStorybookNodes: [{}], phoneCharacters: [], selectedCharacter: { id: 'ari', name: 'Ari' },
    appCharacters: () => [], characterColors: new Map(),
    referenceImageOptionsForRun: () => [], nodeHasVision: () => false,
    setActiveRunId: vi.fn(), setIsRunning: vi.fn(), setIsPaused: vi.fn(), setRunHistory: vi.fn(),
    setRunStartTimeMs: vi.fn(), setRunDurationMs: vi.fn(),
    activeRunLlmReport: { current: null }, setRunLlmReport: vi.fn(), activeRunCancelReason: { current: 'cancel' },
    defaultConnectionId: 'provider', notifySystem: vi.fn(),
    runEndTimeRef: { current: null }, runStartTimeRef: { current: null },
    pendingRunRestart: { current: null }, applyTurnCheckpointRuntime: vi.fn(), applyTurnRuntime: vi.fn(),
    setDraft: vi.fn(), setDraftCommands: vi.fn(), setDraftImages: vi.fn(),
    clearAllRunActiveTimers: vi.fn(), setNodes: vi.fn(), updateRuntimeNode: vi.fn(),
    setOutputActionChoicesHiddenByTurn: vi.fn(), recordTurnTrace: vi.fn(),
    englishProcessingEnabled: true, displayLanguage: 'English', translateText,
    nodeLlm: new NodeLlmApi({ resolveConnection: async () => { throw new Error('Unexpected LLM call'); } }),
  } as unknown as Options;
  // No DOM is needed: orchestration receives its state through refs and callbacks.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return { options, translateText, run: useGraphRun(options).runGraph };
}

describe('on-demand run providers', () => {
  it('reaches the requested provider despite a disconnected offline LLM node', async () => {
    const { options, translateText, run } = harness();
    const pending = run('Hello');
    expect(translateText).toHaveBeenCalledWith('Hello', 'to-english', 'provider', 'input',
      undefined, 'English', expect.any(AbortSignal), expect.any(String));
    expect(options.notifySystem).not.toHaveBeenCalledWith('error', expect.stringContaining('offline'));
    options.activeRun.current!.controller.abort();
    await pending;
  });

  it('registers the run before the first provider request and cancels without waiting for health checks', async () => {
    const { options, run } = harness();
    const pending = run('Hello');
    expect(options.setIsRunning).toHaveBeenCalledWith(true);
    expect(await run('Duplicate')).toBe(false);
    options.activeRun.current!.controller.abort();
    expect(await pending).toBe(false);
    expect(options.activeRun.current).toBeNull();
    expect(options.activeTurnCollectorRef.current).toBeNull();
    expect(options.setIsRunning).toHaveBeenLastCalledWith(false);
    expect(options.applyTurnRuntime).toHaveBeenCalledTimes(1);
    expect(options.setDraft).toHaveBeenCalledWith('Hello');
  });

  it('runs a requested restart after cancelling the active provider request', async () => {
    const { run, options } = harness();
    const pending = run('Hello');
    const restart = vi.fn();
    options.pendingRunRestart.current = restart;
    options.activeRunCancelReason.current = 'restart';
    options.activeRun.current!.controller.abort();
    await pending;
    expect(restart).toHaveBeenCalledTimes(1);
    expect(options.pendingRunRestart.current).toBeNull();
    expect(options.setDraft).not.toHaveBeenCalled();
  });

  it('reports a failure of the requested provider and restores the input', async () => {
    const { run, options, translateText } = harness();
    translateText.mockRejectedValue(new Error('Connection refused'));
    expect(await run('Hello')).toBe(false);
    expect(options.notifySystem).toHaveBeenCalledWith('error', 'Input translation failed: Connection refused');
    expect(options.setDraft).toHaveBeenCalledWith('Hello');
    expect(options.applyTurnRuntime).toHaveBeenCalledTimes(1);
    expect(options.activeRun.current).toBeNull();
  });
});

it('restores a refused input before any run starts', async () => {
  const { run, options } = harness();
  options.nodesRef.current = [];
  expect(await run('Keep this draft')).toBe(false);
  expect(options.setDraft).toHaveBeenCalledWith('Keep this draft');
  expect(options.setIsRunning).not.toHaveBeenCalledWith(true);
});

it('finishes and reports errors thrown before the inner run try block', async () => {
  const { run, options } = harness();
  vi.mocked(options.setRunStartTimeMs).mockImplementation(() => { throw new Error('Early setup failure'); });
  expect(await run('Hello')).toBe(false);
  expect(options.activeRun.current).toBeNull();
  expect(options.setIsRunning).toHaveBeenLastCalledWith(false);
  expect(options.notifySystem).toHaveBeenCalledWith('error', 'Graph error: Early setup failure');
});
