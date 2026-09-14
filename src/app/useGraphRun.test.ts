import { describe, expect, it, vi } from 'vitest';
import { useGraphRun } from './useGraphRun';
import type { ProviderConnectionHealth, WorkflowNode } from '../types';

type Options = Parameters<typeof useGraphRun>[0];
function harness(check: Options['checkProviderConnections']) {
  const nodes = ['input', 'output'].map((nodeType) => ({ id: nodeType, data: { nodeType, connectionId: 'provider' } })) as WorkflowNode[];
  const options = {
    nodesRef: { current: nodes }, messages: [], activeRun: { current: null },
    characterStorybookNodes: [{}], phoneCharacters: [], selectedCharacter: { id: 'ari' },
    referenceImageOptionsForRun: () => [], nodeHasVision: () => false,
    setActiveRunId: vi.fn(), setIsRunning: vi.fn(), setRunHistory: vi.fn(),
    setRunStartTimeMs: vi.fn(), setRunDurationMs: vi.fn(),
    activeRunLlmReport: { current: null }, setRunLlmReport: vi.fn(), activeRunCancelReason: { current: 'cancel' },
    checkProviderConnections: check, connections: [{ id: 'provider', label: 'Provider' }],
    isLlmConnection: () => true, notifySystem: vi.fn(),
    runEndTimeRef: { current: null }, runStartTimeRef: { current: null },
    pendingRunRestart: { current: null }, applyTurnCheckpointRuntime: vi.fn(),
    setDraft: vi.fn(), setDraftCommands: vi.fn(), setDraftImages: vi.fn(),
  } as unknown as Options;
  // No React runtime is needed: this orchestration function receives state through refs and callbacks.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return { options, run: useGraphRun(options).runGraph };
}

describe('run preflight', () => {
  it('shows a pending health check as running, rejects a duplicate and cancels without mutation', async () => {
    let resolve!: (health: Record<string, ProviderConnectionHealth>) => void;
    const check = vi.fn(() => new Promise<Record<string, ProviderConnectionHealth>>((done) => { resolve = done; }));
    const { run, options } = harness(check);
    const nodes = options.nodesRef.current;
    const pending = run('Hello');
    expect(options.setIsRunning).toHaveBeenCalledWith(true);
    expect(await run('Duplicate')).toBe(false);
    options.activeRun.current!.controller.abort();
    resolve({});
    expect(await pending).toBe(false);
    expect(options.activeRun.current).toBeNull();
    expect(options.setIsRunning).toHaveBeenLastCalledWith(false);
    expect(options.nodesRef.current).toBe(nodes);
    expect(options.applyTurnCheckpointRuntime).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledTimes(1);
    expect(options.setDraft).toHaveBeenCalledWith('Hello');
  });

  it.each(['offline', 'throw'])('does not rewind a replacement when provider preflight fails: %s', async (mode) => {
    const { run, options } = harness(async () => {
      if (mode === 'throw') throw new Error('IPC unavailable');
      return { provider: { status: 'offline' } as ProviderConnectionHealth };
    });
    const replacement = { turn: { id: 'old' }, replaceInput: false } as NonNullable<Parameters<typeof run>[8]>;
    expect(await run('Hello', [], undefined, [], undefined, undefined, undefined, undefined, replacement)).toBe(false);
    expect(options.applyTurnCheckpointRuntime).not.toHaveBeenCalled();
    expect(options.activeRun.current).toBeNull();
    expect(options.setIsRunning).toHaveBeenLastCalledWith(false);
  });

  it('runs a requested restart after cancelled preflight settles', async () => {
    let resolve!: (health: Record<string, ProviderConnectionHealth>) => void;
    const { run, options } = harness(() => new Promise((done) => { resolve = done; }));
    const pending = run('Hello');
    const restart = vi.fn();
    options.pendingRunRestart.current = restart;
    options.activeRunCancelReason.current = 'restart';
    options.activeRun.current!.controller.abort();
    resolve({});
    await pending;
    expect(restart).toHaveBeenCalledTimes(1);
    expect(options.pendingRunRestart.current).toBeNull();
  });
});
