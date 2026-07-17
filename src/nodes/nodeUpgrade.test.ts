import { describe, it, expect } from 'vitest';
import { buildUpgradedNode, storybookOrSingletonUpgradeConflict } from './nodeUpgrade';
import { getRegisteredCoreNode } from './registry';
import { currentCoreNodeVersions } from './nodeVersion';
import type { CreateNodeContext, HydrateContext } from './types';
import type { WorkflowNode, WorkflowNodeType } from '../types';

const createContext: CreateNodeContext = {
  defaultConnectionId: 'default',
  position: { x: 10, y: 20 },
  createId: (prefix) => `${prefix}-test`,
  readNodes: () => [],
  originalHistory: '',
  translatedHistory: '',
};

const hydrateContext: HydrateContext = {
  defaultConnectionId: 'default',
  connectionIds: new Set(['default']),
};

function incompatibleNode(
  nodeType: WorkflowNodeType,
  storedData: Record<string, unknown> = {},
  node: Partial<WorkflowNode> = {},
): WorkflowNode {
  return {
    id: `incompatible-${nodeType}`,
    type: 'workflow',
    position: { x: 10, y: 20 },
    data: {
      nodeType,
      nodeDataVersion: '0.0.1',
      currentNodeVersion: '1.0.0',
      label: 'Outdated Node',
      description: 'Saved by an older build',
      preview: 'Stored',
      kind: 'incompatible-core-node',
      storedData: {
        nodeType,
        nodeDataVersion: '0.0.1',
        label: 'Outdated Node',
        description: 'Saved by an older build',
        preview: 'Stored',
        ...storedData,
      },
    },
    ...node,
  };
}

function liveNode(nodeType: WorkflowNodeType, id = `live-${nodeType}`): WorkflowNode {
  return {
    id,
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      nodeDataVersion: currentCoreNodeVersions[nodeType],
      label: 'Live Node',
      description: 'Current version',
      preview: 'Ready',
    } as WorkflowNode['data'],
  };
}

describe('buildUpgradedNode', () => {
  it('copies matching user text into a live current-version node', () => {
    const node = incompatibleNode('write-text', { writeTextValue: 'hello' });
    const result = buildUpgradedNode(node, { createContext, hydrateContext });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(node.id);
    expect(result!.position).toEqual(node.position);
    expect(result!.data.kind).toBeUndefined();
    expect(result!.data.nodeType).toBe('write-text');
    expect(result!.data.writeTextValue).toBe('hello');
    expect(result!.data.nodeDataVersion).toBe(currentCoreNodeVersions['write-text']);
  });

  it('resets the stale saved size to the fresh definition style', () => {
    const node = incompatibleNode(
      'llm-prompt',
      { llmPromptBefore: 'keep me' },
      {
        style: { width: 548, height: 1140 },
        width: 548,
        height: 1140,
        measured: { width: 548, height: 1140 },
      },
    );
    const result = buildUpgradedNode(node, { createContext, hydrateContext });

    expect(result!.width).toBeUndefined();
    expect(result!.height).toBeUndefined();
    expect(result!.measured).toBeUndefined();
    const freshStyle = getRegisteredCoreNode('llm-prompt')!.create(createContext).style;
    expect(result!.style).toEqual(freshStyle);
    expect(result!.data.llmPromptBefore).toBe('keep me');
  });

  it('resolves a dangling connectionId to the default instead of transplanting it', () => {
    const node = incompatibleNode('llm-prompt', { connectionId: 'gone' });
    const result = buildUpgradedNode(node, {
      createContext,
      hydrateContext: { defaultConnectionId: 'default', connectionIds: new Set(['real']) },
    });

    expect(result!.data.connectionId).toBe('default');
  });

  it('drops fields the new version removed and defaults ones it added', () => {
    const node = incompatibleNode('note', { noteText: 'hi', legacyRemoved: 'x' });
    const result = buildUpgradedNode(node, { createContext, hydrateContext });
    const data = result!.data as Record<string, unknown>;

    expect(data.noteText).toBe('hi'); // matching field copied
    expect(data.noteFontSize).toBe(14); // field absent from storedData → default
    expect('legacyRemoved' in data).toBe(false); // unknown field dropped
  });

  it('falls back to fresh defaults when stored data is malformed', () => {
    const node = incompatibleNode('rp-storybook-v1', { storybookJson: 'not json' });
    let result: WorkflowNode | null = null;
    expect(() => {
      result = buildUpgradedNode(node, { createContext, hydrateContext });
    }).not.toThrow();

    expect(result!.data.kind).toBeUndefined();
    expect(result!.data.nodeType).toBe('rp-storybook-v1');
  });

  it('returns null for an unregistered node type', () => {
    const node = incompatibleNode('totally-unknown' as WorkflowNodeType, {});
    expect(buildUpgradedNode(node, { createContext, hydrateContext })).toBeNull();
  });

  it('returns null when the node is not an incompatible placeholder', () => {
    expect(buildUpgradedNode(liveNode('write-text'), { createContext, hydrateContext })).toBeNull();
  });
});

describe('storybookOrSingletonUpgradeConflict', () => {
  it('flags upgrading a storybook source when a live source already exists', () => {
    const incompatible = incompatibleNode('rp-storybook-v1');
    const live = liveNode('rp-storybook-editor');
    expect(storybookOrSingletonUpgradeConflict(incompatible, [incompatible, live])).toBe(true);
  });

  it('allows upgrading a storybook source when no live source exists', () => {
    const incompatible = incompatibleNode('rp-storybook-v1');
    expect(storybookOrSingletonUpgradeConflict(incompatible, [incompatible])).toBe(false);
  });

  it('flags upgrading a singleton when a live one of the same type exists', () => {
    const incompatible = incompatibleNode('input');
    const live = liveNode('input');
    expect(storybookOrSingletonUpgradeConflict(incompatible, [incompatible, live])).toBe(true);
  });

  it('allows upgrading a non-singleton node even with live peers of the same type', () => {
    const incompatible = incompatibleNode('write-text');
    const live = liveNode('write-text');
    expect(storybookOrSingletonUpgradeConflict(incompatible, [incompatible, live])).toBe(false);
  });
});
