import {
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  MarkerType,
  addEdge,
  reconnectEdge,
  type Connection,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import { formatChatHistory, workflowPendingColor } from '../workflow';
import { removeCompetingInputEdges } from '../graph/edges';
import { validatePortConnection } from '../graph/portCompatibility';
import { wireLinkLayout, wireLinkMode, wireLinkStyle } from '../nodes/memory-slot/model';
import { getRegisteredCoreNode, getRegisteredCoreNodes } from '../nodes/registry';
import { isStorybookSourceNode } from '../storybook/runtime';
import type {
  AddNodeType,
  MessageRecord,
  NodeMenu,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  SettingsValueDefinition,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';

type UseNodePaletteOptions = {
  nodes: WorkflowNode[];
  nodesRef: { current: WorkflowNode[] };
  edgesRef: { current: Edge[] };
  setNodes: Dispatch<SetStateAction<WorkflowNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  flowInstance: ReactFlowInstance<WorkflowNode> | null;
  defaultConnectionId: string;
  messages: MessageRecord[];
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  settingsValueDefinitions: SettingsValueDefinition[];
  createId: () => string;
  notifySystem: (level: 'info' | 'warning' | 'error', text: string) => void;
};

const nodeDragDataType = 'application/x-rpgraph-node';
const defaultFavoriteNodeTypes: AddNodeType[] = ['memory-slot', 'text-preview'];
const favoriteNodeTypesStorageKey = 'rpgraph.favoriteNodeTypes';

const addableNodeItems = getRegisteredCoreNodes().map((definition) => ({
  type: definition.type,
  version: definition.dataVersion,
  label: definition.label,
  description: definition.menuDescription,
}));
type AddableNodeItem = (typeof addableNodeItems)[number];

function loadFavoriteNodeTypes(): AddNodeType[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(favoriteNodeTypesStorageKey) ?? 'null');
    if (!Array.isArray(parsed)) {
      return defaultFavoriteNodeTypes;
    }
    const validTypes = new Set(addableNodeItems.map((item) => item.type));
    const favorites = parsed.filter((value): value is AddNodeType => validTypes.has(value));
    return favorites.length ? favorites : defaultFavoriteNodeTypes;
  } catch {
    return defaultFavoriteNodeTypes;
  }
}

const nodePaletteGroups: Array<{
  title: string;
  types: AddNodeType[];
}> = [
  {
    title: 'Input & Output',
    types: ['input', 'last-user-input', 'last-rp-output', 'history', 'output', 'text-preview', 'load-text'],
  },
  {
    title: 'LLM & Logic',
    types: ['custom', 'llm-prompt', 'llm-prompt-switch', 'llm-decision', 'context-compression', 'event-manager', 'character-stats', 'phone-apps'],
  },
  {
    title: 'Text & Values',
    types: ['note', 'group', 'combiner', 'text-replace', 'memory-slot', 'phone-message-router', 'text-selector', 'write-text', 'fixed-number', 'fixed-bool', 'settings-value'],
  },
  {
    title: 'Story Context',
    types: ['rp-storybook-v1', 'rp-storybook-editor', 'context-builder'],
  },
];

const groupedNodePaletteItems = nodePaletteGroups
  .map((group) => ({
    ...group,
    items: group.types
      .map((type) => addableNodeItems.find((item) => item.type === type))
      .filter((item): item is AddableNodeItem => !!item),
  }))
  .filter((group) => group.items.length > 0);

export function useNodePalette({
  nodes,
  nodesRef,
  edgesRef,
  setNodes,
  setEdges,
  flowInstance,
  defaultConnectionId,
  messages,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  settingsValueDefinitions,
  createId,
  notifySystem,
}: UseNodePaletteOptions) {
  const [nodeMenu, setNodeMenu] = useState<NodeMenu | null>(null);
  const [favoriteNodeTypes, setFavoriteNodeTypes] = useState<AddNodeType[]>(loadFavoriteNodeTypes);
  const reconnectSuccessful = useRef(true);
  const favoriteNodeTypeSet = useMemo(() => new Set(favoriteNodeTypes), [favoriteNodeTypes]);
  const favoriteNodeItems = addableNodeItems.filter((item) => favoriteNodeTypeSet.has(item.type));

  useEffect(() => {
    window.localStorage.setItem(favoriteNodeTypesStorageKey, JSON.stringify(favoriteNodeTypes));
  }, [favoriteNodeTypes]);

  function splitWireLink(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (node?.data.kind !== undefined || node?.data.nodeType !== 'memory-slot') {
      return;
    }

    const mode = wireLinkMode(node.data);
    const counterpartMode = mode === 'output' ? 'input' : 'output';
    const originalMode = mode === 'joined' ? 'input' : mode;
    const counterpartId = `memory-slot-${createId()}`;
    const counterpart: WorkflowNode = {
      ...node,
      id: counterpartId,
      position: {
        x:
          node.position.x +
          (counterpartMode === 'output' ? wireLinkLayout.spawnOffset : -wireLinkLayout.spawnOffset),
        y: node.position.y,
      },
      selected: false,
      style: wireLinkStyle(counterpartMode),
      data: {
        ...node.data,
        label: 'Wire Link',
        description: 'Store and reuse text through a linked pair',
        memorySlotMode: counterpartMode,
      },
    };
    const nextNodes = [
      ...nodesRef.current.map((entry) =>
        entry.id === nodeId
          ? {
              ...entry,
              style: wireLinkStyle(originalMode),
              data: {
                ...entry.data,
                label: 'Wire Link',
                description: 'Store and reuse text through a linked pair',
                memorySlotMode: originalMode,
              } as WorkflowNodeData,
            }
          : entry,
      ),
      counterpart,
    ];
    nodesRef.current = nextNodes;
    setNodes(nextNodes);

    if (mode === 'joined') {
      const nextEdges = edgesRef.current.map((edge) =>
        edge.source === nodeId ? { ...edge, source: counterpartId } : edge,
      );
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
    }
  }

  function splitJoinedWireLink(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (
      node &&
      node.data.kind === undefined &&
      node.data.nodeType === 'memory-slot' &&
      wireLinkMode(node.data) === 'joined'
    ) {
      splitWireLink(nodeId);
    }
  }

  function connectNodes(connection: Connection) {
    const compatibility = validatePortConnection(
      nodesRef.current,
      edgesRef.current,
      connection,
      undefined,
      settingsValueDefinitions,
    );
    if (!compatibility.ok) {
      notifySystem('warning', compatibility.reason);
      return;
    }
    if (connection.target) {
      splitJoinedWireLink(connection.target);
    }
    setEdges((currentEdges) =>
      addEdge(
        {
          ...connection,
          markerEnd: { type: MarkerType.ArrowClosed, color: workflowPendingColor },
          style: { stroke: workflowPendingColor, strokeWidth: 2 },
        },
        removeCompetingInputEdges(currentEdges, connection),
      ),
    );
  }

  function reconnectNodes(oldEdge: Edge, connection: Connection) {
    const compatibility = validatePortConnection(
      nodesRef.current,
      edgesRef.current,
      connection,
      oldEdge.id,
      settingsValueDefinitions,
    );
    if (!compatibility.ok) {
      reconnectSuccessful.current = true;
      notifySystem('warning', compatibility.reason);
      return;
    }
    reconnectSuccessful.current = true;
    if (connection.target) {
      splitJoinedWireLink(connection.target);
    }
    setEdges((currentEdges) =>
      reconnectEdge(
        oldEdge,
        connection,
        removeCompetingInputEdges(currentEdges, connection, oldEdge.id),
      ),
    );
  }

  function startReconnect() {
    reconnectSuccessful.current = false;
  }

  function finishReconnect(_event: MouseEvent | TouchEvent, edge: Edge) {
    if (!reconnectSuccessful.current) {
      setEdges((currentEdges) => currentEdges.filter((entry) => entry.id !== edge.id));
    }
    reconnectSuccessful.current = true;
  }

  function openNodeMenu(event: MouseEvent | ReactMouseEvent<Element>) {
    const target = event.target as HTMLElement;
    if (!flowInstance || !target.classList.contains('react-flow__pane')) {
      return;
    }

    event.preventDefault();
    setNodeMenu({
      screen: { x: event.clientX, y: event.clientY },
      flow: flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  }

  function nodeTypeUnavailable(nodeType: AddNodeType) {
    const definition = getRegisteredCoreNode(nodeType);
    // Storybook sources are mutually exclusive: a graph holds at most one, be it
    // `rp-storybook-v1` or `rp-storybook-editor` (never both, never two).
    if (nodeType === 'rp-storybook-v1' || nodeType === 'rp-storybook-editor') {
      return nodes.some(isStorybookSourceNode);
    }
    return (
      definition?.singleton === true &&
      nodes.some(
        (node) =>
          node.data.nodeType === nodeType &&
          node.data.kind !== 'incompatible-core-node',
      )
    );
  }

  function addNode(nodeType: AddNodeType, dropPosition = nodeMenu?.flow) {
    if (!dropPosition) {
      return;
    }

    const definition = getRegisteredCoreNode(nodeType);
    if (!definition || nodeTypeUnavailable(nodeType)) {
      return;
    }

    const node = definition.create({
      defaultConnectionId,
      position: dropPosition,
      createId: (prefix) => `${prefix}-${createId()}`,
      readNodes: () => nodesRef.current,
      originalHistory: formatChatHistory(messages, false, rpDateTimeFormat, rpWeekdayLanguage),
      translatedHistory: formatChatHistory(messages, true, rpDateTimeFormat, rpWeekdayLanguage),
    });

    setNodes((currentNodes) => [...currentNodes, node]);
    setNodeMenu(null);
  }

  function toggleFavoriteNodeType(nodeType: AddNodeType) {
    setFavoriteNodeTypes((current) =>
      current.includes(nodeType)
        ? current.filter((type) => type !== nodeType)
        : [...current, nodeType],
    );
  }

  function startNodeDrag(event: ReactDragEvent<HTMLButtonElement>, nodeType: AddNodeType) {
    event.dataTransfer.setData(nodeDragDataType, nodeType);
    event.dataTransfer.effectAllowed = 'copy';
  }

  function allowNodeDrop(event: ReactDragEvent<Element>) {
    if (event.dataTransfer.types.includes(nodeDragDataType)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  function dropNode(event: ReactDragEvent<Element>) {
    if (!flowInstance) {
      return;
    }

    const nodeType = event.dataTransfer.getData(nodeDragDataType) as AddNodeType;
    if (!addableNodeItems.some((item) => item.type === nodeType)) {
      return;
    }

    event.preventDefault();
    addNode(
      nodeType,
      flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    );
  }

  return {
    groupedNodePaletteItems,
    nodeMenu,
    setNodeMenu,
    favoriteNodeTypeSet,
    favoriteNodeItems,
    splitWireLink,
    connectNodes,
    reconnectNodes,
    startReconnect,
    finishReconnect,
    openNodeMenu,
    nodeTypeUnavailable,
    addNode,
    toggleFavoriteNodeType,
    startNodeDrag,
    allowNodeDrop,
    dropNode,
  };
}
