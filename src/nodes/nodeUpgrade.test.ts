import { describe, it, expect } from 'vitest';
import { buildUpgradedNode, storybookOrSingletonUpgradeConflict } from './nodeUpgrade';
import type { UpgradeNodeContext } from './nodeUpgrade';
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

/** Unwraps a successful upgrade so the happy-path cases can assert on the node directly. */
function upgradedNode(node: WorkflowNode, context: UpgradeNodeContext): WorkflowNode {
  const result = buildUpgradedNode(node, context);
  if (result.status !== 'upgraded') {
    throw new Error(`Expected an upgraded node, got: ${result.status}`);
  }
  return result.node;
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
    const upgraded = upgradedNode(node, { createContext, hydrateContext });

    expect(upgraded.id).toBe(node.id);
    expect(upgraded.position).toEqual(node.position);
    expect(upgraded.data.kind).toBeUndefined();
    expect(upgraded.data.nodeType).toBe('write-text');
    expect(upgraded.data.writeTextValue).toBe('hello');
    expect(upgraded.data.nodeDataVersion).toBe(currentCoreNodeVersions['write-text']);
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
    const upgraded = upgradedNode(node, { createContext, hydrateContext });

    expect(upgraded.width).toBeUndefined();
    expect(upgraded.height).toBeUndefined();
    expect(upgraded.measured).toBeUndefined();
    const freshStyle = getRegisteredCoreNode('llm-prompt')!.create(createContext).style;
    expect(upgraded.style).toEqual(freshStyle);
    expect(upgraded.data.llmPromptBefore).toBe('keep me');
  });

  it('resolves a dangling connectionId to the default instead of transplanting it', () => {
    const node = incompatibleNode('llm-prompt', { connectionId: 'gone' });
    const upgraded = upgradedNode(node, {
      createContext,
      hydrateContext: { defaultConnectionId: 'default', connectionIds: new Set(['real']) },
    });

    expect(upgraded.data.connectionId).toBe('default');
  });

  it('drops fields the new version removed and defaults ones it added', () => {
    const node = incompatibleNode('note', { noteText: 'hi', legacyRemoved: 'x' });
    const data = upgradedNode(node, { createContext, hydrateContext }).data as Record<
      string,
      unknown
    >;

    expect(data.noteText).toBe('hi'); // matching field copied
    expect(data.noteFontSize).toBe(14); // field absent from storedData → default
    expect('legacyRemoved' in data).toBe(false); // unknown field dropped
  });

  it('aborts instead of substituting defaults when stored data is unreadable', () => {
    const node = incompatibleNode('rp-storybook', { storybookJson: 'not json' });
    const result = buildUpgradedNode(node, { createContext, hydrateContext });

    // Falling back to the fresh defaults here would silently drop the whole stored
    // storybook (characters, opening history, images) with no undo to recover it.
    expect(result.status).toBe('invalid-stored-data');
    expect(result).not.toHaveProperty('node');
    if (result.status === 'invalid-stored-data') {
      expect(result.message).toBeTruthy();
    }
  });

  it('reports not-upgradable for an unregistered node type', () => {
    const node = incompatibleNode('totally-unknown' as WorkflowNodeType, {});
    expect(buildUpgradedNode(node, { createContext, hydrateContext }).status).toBe(
      'not-upgradable',
    );
  });

  it('reports not-upgradable when the node is not an incompatible placeholder', () => {
    expect(
      buildUpgradedNode(liveNode('write-text'), { createContext, hydrateContext }).status,
    ).toBe('not-upgradable');
  });
});

describe('storybookOrSingletonUpgradeConflict', () => {
  it('flags upgrading a storybook source when a live source already exists', () => {
    const incompatible = incompatibleNode('rp-storybook');
    const live = liveNode('rp-storybook-editor');
    expect(storybookOrSingletonUpgradeConflict(incompatible, [incompatible, live])).toBe(true);
  });

  it('allows upgrading a storybook source when no live source exists', () => {
    const incompatible = incompatibleNode('rp-storybook');
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
