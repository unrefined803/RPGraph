import { describe, expect, it, vi } from 'vitest';
import { runCustomNodeCodeInSandbox } from '../nodes/custom-node/sandbox';
import { customNodeDefinition, defaultCustomNodeDefinition } from '../nodes/custom-node/model';

vi.mock('../nodes/custom-node/sandbox', () => ({ runCustomNodeCodeInSandbox: vi.fn() }));
import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../types';
import { NodeLlmApi } from '../llm/NodeLlmApi';
import { TextMetricsApi } from '../llm/tokenMetrics';
import { combinerInputHandle } from '../workflow';
import { executeGraph } from './executeGraph';

function node(id: string, nodeType: WorkflowNode['data']['nodeType']): WorkflowNode {
  return { id, type: 'workflow', position: { x: 0, y: 0 }, data: { nodeType, label: id } } as WorkflowNode;
}

function edge(source: string, target: string, targetHandle?: string): Edge {
  return { id: `${source}-${target}-${targetHandle}`, source, target, targetHandle };
}

function run(nodes: WorkflowNode[], edges: Edge[], outputNodeId: string, postOutputRun = false) {
  return executeGraph({
    nodes, edges, outputNodeId, originalInput: 'true', originalHistory: '', translatedHistory: '',
    llm: new NodeLlmApi({ resolveConnection: async () => { throw new Error('Unexpected LLM call'); } }),
    textMetrics: new TextMetricsApi(), updateRuntimeNode: () => {},
    postOutputRun, postOutputNodeIds: ['selector', 'replace'],
  });
}

describe('graph dependency cycles', () => {
  const nodes = [node('input', 'input'), node('selector', 'text-selector'), node('replace', 'text-replace')];
  const edges = [edge('input', 'selector', 'condition'), edge('replace', 'selector', 'true'), edge('selector', 'replace')];

  it('rejects a cycle reached after resolving the selector condition', async () => {
    await expect(run(nodes, edges, 'selector')).rejects.toThrow('The graph contains a cycle.');
  }, 1000);

  it('rejects cycles between independently started parallel branches', async () => {
    await expect(run(nodes, edges, 'selector', true)).rejects.toThrow('The graph contains a cycle.');
  }, 1000);

  it('allows parallel branches to share an in-flight dependency', async () => {
    const nodes = [node('input', 'input'), node('left', 'text-replace'), node('right', 'text-replace'), node('out', 'combiner')];
    const edges = [edge('input', 'left'), edge('input', 'right'), edge('left', 'out', combinerInputHandle(0)), edge('right', 'out', combinerInputHandle(1))];
    await expect(run(nodes, edges, 'out')).resolves.toContain('true');
  });
});


describe('custom node outputs', () => {
  function custom() {
    const custom = node('custom', 'custom');
    custom.data.customNodeDefinition = {
      ...defaultCustomNodeDefinition(), code: 'return {};', inputs: [],
      outputs: ['a', 'b'].map((id) => ({ id, label: id, direction: 'output' as const, valueType: 'text' as const })),
    };
    return custom;
  }

  it('runs code once for parallel outputs and again on the next graph run', async () => {
    const sandbox = vi.mocked(runCustomNodeCodeInSandbox);
    sandbox.mockReset();
    sandbox.mockResolvedValue({ outputs: { a: 'first', b: 'second' }, displays: {}, state: { count: 1 } });
    const nodes = [custom(), node('out', 'combiner')];
    const edges = ['a', 'b'].map((sourceHandle, index) => ({ ...edge('custom', 'out', combinerInputHandle(index)), sourceHandle }));
    const output = await run(nodes, edges, 'out');
    expect(output).toContain('first');
    expect(output).toContain('second');
    expect(sandbox).toHaveBeenCalledTimes(1);
    await run(nodes, edges, 'out');
    expect(sandbox).toHaveBeenCalledTimes(2);
  });

  it('rejects a dependency on another output of the same custom execution', async () => {
    const source = custom();
    customNodeDefinition(source.data.customNodeDefinition).inputs = [{ id: 'in', label: 'Input', direction: 'input', valueType: 'text' }];
    await expect(run([source], [{ ...edge('custom', 'custom', 'in'), sourceHandle: 'b' }], 'custom')).rejects.toThrow('The graph contains a cycle.');
  }, 1000);
});
