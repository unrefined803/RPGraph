import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { NodeContextMenu, PendingBulkNodeRemoval, WorkflowNode } from '../types';

type UseNodeContextMenuOptions = {
  nodesRef: { current: WorkflowNode[] };
  flowInstanceRef: { current: ReactFlowInstance<WorkflowNode> | null };
};

// A deletion of this many nodes or more prompts for confirmation, regardless of
// how it was triggered (context menu, keyboard Delete, or any future path).
const bulkRemovalThreshold = 2;

export function useNodeContextMenu({ nodesRef, flowInstanceRef }: UseNodeContextMenuOptions) {
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenu | null>(null);
  const [pendingBulkNodeRemoval, setPendingBulkNodeRemoval] = useState<PendingBulkNodeRemoval | null>(null);
  // Resolves the promise returned to xyflow's onBeforeDelete while the confirmation
  // dialog is open; non-null means a confirmation is currently in flight.
  const bulkRemovalResolverRef = useRef<((approved: boolean) => void) | null>(null);

  function resolvePendingBulkRemoval(approved: boolean) {
    const resolve = bulkRemovalResolverRef.current;
    bulkRemovalResolverRef.current = null;
    setPendingBulkNodeRemoval(null);
    resolve?.(approved);
  }

  // Single gate for every node deletion. xyflow calls this (awaited) from
  // deleteElements — used by the context menu, the keyboard Delete handler, and
  // anything else — so the confirmation applies uniformly.
  async function handleBeforeNodeDelete({ nodes }: { nodes: WorkflowNode[]; edges: Edge[] }) {
    if (bulkRemovalResolverRef.current) {
      // A confirmation is already pending; block a concurrent delete (e.g. a
      // second Delete keypress) from racing behind the open dialog.
      return false;
    }
    if (nodes.length < bulkRemovalThreshold) {
      return true;
    }
    setPendingBulkNodeRemoval({ nodeCount: nodes.length });
    return new Promise<boolean>((resolve) => {
      bulkRemovalResolverRef.current = resolve;
    });
  }

  function openNodeContextMenu(event: ReactMouseEvent, node: WorkflowNode) {
    event.preventDefault();
    const selectedNodes = nodesRef.current.filter((candidate) => candidate.selected);
    const isBulkTarget = Boolean(node.selected) && selectedNodes.length >= bulkRemovalThreshold;
    setNodeContextMenu({
      nodeId: node.id,
      screen: { x: event.clientX, y: event.clientY },
      selectedNodeIds: isBulkTarget ? selectedNodes.map((candidate) => candidate.id) : [node.id],
    });
  }

  // Right-clicking the NodesSelection overlay that xyflow renders after a
  // marquee (box) selection dispatches here rather than onNodeContextMenu.
  function openSelectionContextMenu(event: ReactMouseEvent, nodes: WorkflowNode[]) {
    if (nodes.length === 0) {
      return;
    }
    event.preventDefault();
    setNodeContextMenu({
      nodeId: nodes[0].id,
      screen: { x: event.clientX, y: event.clientY },
      selectedNodeIds: nodes.map((node) => node.id),
    });
  }

  function closeNodeContextMenu() {
    setNodeContextMenu(null);
  }

  // Fully tear down the menu and any pending confirmation — used by workflow
  // load/reset paths so a stale menu can't act on a replaced graph.
  function resetNodeContextMenuState() {
    setNodeContextMenu(null);
    resolvePendingBulkRemoval(false);
  }

  function removeNodes(nodeIds: string[]) {
    setNodeContextMenu(null);
    if (nodeIds.length === 0) {
      return;
    }
    // Routes through handleBeforeNodeDelete, so a bulk removal still prompts.
    void flowInstanceRef.current?.deleteElements({ nodes: nodeIds.map((id) => ({ id })) });
  }

  function cancelBulkNodeRemoval() {
    resolvePendingBulkRemoval(false);
  }

  function confirmBulkNodeRemoval() {
    resolvePendingBulkRemoval(true);
  }

  return {
    nodeContextMenu,
    closeNodeContextMenu,
    resetNodeContextMenuState,
    openNodeContextMenu,
    openSelectionContextMenu,
    handleBeforeNodeDelete,
    removeNodes,
    pendingBulkNodeRemoval,
    cancelBulkNodeRemoval,
    confirmBulkNodeRemoval,
  };
}
