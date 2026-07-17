import type { Dispatch, SetStateAction } from 'react';
import type { Edge } from '@xyflow/react';
import { executeGraph } from '../graph/executeGraph';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import { TextMetricsApi } from '../llm/tokenMetrics';
import type { NodeActions } from '../nodes/types';
import { resetCharacterStatsRuntimeData } from '../nodes/character-stats/runtime';
import {
  buildContextBuilderItems,
  combineTextInputs,
  combinerInputCount,
  combinerInputHandle,
  combinerPrefixes,
  combinerPreviews,
  contextBuilderInputCount,
  contextBuilderInputHandle,
  contextBuilderText,
  llmDecisionEntries,
  llmDecisionOutputHandle,
  llmDecisionOutputToggles,
  llmDecisionQuestions,
  llmPromptSwitchOutputHandle,
  maximumCombinerInputs,
  maximumLlmDecisionQuestions,
  maximumTextRouterNumberOutputs,
  minimumCombinerInputs,
  minimumLlmDecisionQuestions,
  minimumTextRouterNumberOutputs,
  normalizeCharacterStatsState,
  settingsValueEntries,
  textReplaceEntries,
  textSelectorInputCount,
  textSelectorTextInputHandle,
  textRouterNumberOutputCount,
  textRouterNumberOutputHandle,
  characterStatDefinitions,
  characterStatsStateText,
  formatChatHistory,
} from '../workflow';
import { lastMessageText } from './runOrchestration';
import type {
  ConnectionPreset,
  MessageRecord,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  SettingsValueDefinition,
  TextRouterMode,
  TurnRecord,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';
import type { TurnCheckpoint } from '../data-management/types';
import type { WorkflowVariableSetCommand } from '../workflow';
import type { ReferenceImageOptions } from '../chat/referenceImages';
import type { OutputFormatHelpKind } from '../nodes/output/formatHelp';
import type { PromptActionRuntimeSettings } from '../nodes/shared/promptActions';

type TextDialogView =
  | 'text'
  | 'output-highlighting'
  | 'character-stats-context'
  | 'character-stats-response'
  | 'character-stats-prompts'
  | 'character-stats-chart'
  | 'history-time-response'
  | 'event-manager-response'
  | 'event-manager-appointments';

type UseNodeActionsControllerOptions = {
  nodesRef: { current: WorkflowNode[] };
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<WorkflowNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setDefaultConnectionId: (connectionId: string) => void;
  settingsValueDefinitions: SettingsValueDefinition[];
  settingsValueDefinitionsRef: { current: SettingsValueDefinition[] };
  createId: () => string;
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  messages: MessageRecord[];
  messagesRef: { current: MessageRecord[] };
  setMessages: Dispatch<SetStateAction<MessageRecord[]>>;
  turnsRef: { current: TurnRecord[] };
  setTurns: Dispatch<SetStateAction<TurnRecord[]>>;
  turnCheckpointsRef: { current: TurnCheckpoint[] };
  setTurnCheckpoints: (nextCheckpoints: TurnCheckpoint[]) => void;
  draft: string;
  nodeLlm: NodeLlmApi;
  activeTokenEstimateBytesPerToken: number;
  connections: ConnectionPreset[];
  promptActionSettings: PromptActionRuntimeSettings;
  updateWorkflowComfyGenerationActive: (active: boolean) => void;
  workflowSettingsValuesForGraph: () => Record<string, string>;
  setWorkflowVariablesFromCommands: (commands: WorkflowVariableSetCommand[]) => void;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  nextTurnReferenceImageOptions: ReferenceImageOptions;
  setTextDialogView: Dispatch<SetStateAction<TextDialogView>>;
  setTextDialogNodeId: Dispatch<SetStateAction<string | null>>;
  setJsonDialogNodeId: Dispatch<SetStateAction<string | null>>;
  setOutputFormatHelpKind: Dispatch<SetStateAction<OutputFormatHelpKind | null>>;
  openStorybookCreator: (nodeId: string) => void;
  openStorybookEditor: (nodeId: string) => void;
  upgradeNode: (nodeId: string) => void;
  openCustomNodeAssistant: (nodeId: string) => void;
  runCustomNodeButton: (nodeId: string, label: string) => Promise<void>;
  loadStorybookFile: (nodeId: string) => Promise<boolean>;
  importSillyTavernCharacter: (nodeId: string) => Promise<void>;
};

export function useNodeActionsController({
  nodesRef,
  edges,
  setNodes,
  setEdges,
  setDefaultConnectionId,
  settingsValueDefinitions,
  settingsValueDefinitionsRef,
  createId,
  updateRuntimeNode,
  messages,
  messagesRef,
  setMessages,
  turnsRef,
  setTurns,
  turnCheckpointsRef,
  setTurnCheckpoints,
  draft,
  nodeLlm,
  activeTokenEstimateBytesPerToken,
  connections,
  promptActionSettings,
  updateWorkflowComfyGenerationActive,
  workflowSettingsValuesForGraph,
  setWorkflowVariablesFromCommands,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  nextTurnReferenceImageOptions,
  setTextDialogView,
  setTextDialogNodeId,
  setJsonDialogNodeId,
  setOutputFormatHelpKind,
  openStorybookCreator,
  openStorybookEditor,
  upgradeNode,
  openCustomNodeAssistant,
  runCustomNodeButton,
  loadStorybookFile,
  importSillyTavernCharacter,
}: UseNodeActionsControllerOptions) {
  function changePromptConnection(nodeId: string, value: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (node?.data.nodeType !== 'input' && node?.data.nodeType !== 'output') {
      setDefaultConnectionId(value);
    }
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, connectionId: value } } : node,
      ),
    );
  }

  function changeOutputOption(
    nodeId: string,
    field: 'streamOutputEnabled' | 'speakerAnalysisEnabled' | 'dialogueHighlightEnabled',
    value: boolean,
  ) {
    updateRuntimeNode(nodeId, {
      [field]: value,
      ...(field === 'speakerAnalysisEnabled' && !value
        ? { dialogueHighlightEnabled: false }
        : {}),
    });
  }

  function changeFixedNumberValue(nodeId: string, value: number | string) {
    updateRuntimeNode(nodeId, { fixedNumberValue: value });
  }

  function changeFixedBoolValue(nodeId: string, value: boolean) {
    updateRuntimeNode(nodeId, { fixedBoolValue: value });
  }

  function changeWriteTextValue(nodeId: string, value: string) {
    updateRuntimeNode(nodeId, {
      writeTextValue: value,
      preview: value.trim() ? 'Text ready' : 'No text written',
      fullText: value,
    });
  }

  function changeTextRouterMode(nodeId: string, mode: TextRouterMode) {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId && node.data.nodeType === 'phone-message-router'
          ? {
              ...node,
              data: {
                ...node.data,
                textRouterMode: mode,
                textRouterNumberOutputCount: textRouterNumberOutputCount(node.data),
                preview: 'Waiting for routed text ...',
                fullText: '',
              },
            }
          : node,
      ),
    );
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => {
        if (edge.target === nodeId && edge.targetHandle === 'condition') {
          return false;
        }
        if (edge.source !== nodeId) {
          return true;
        }
        if (mode === 'number') {
          return edge.sourceHandle !== 'false' && edge.sourceHandle !== 'true';
        }
        return !/^number-\d+$/.test(edge.sourceHandle ?? '');
      }),
    );
  }

  function changeTextRouterNumberOutputCount(nodeId: string, change: number) {
    const currentNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!currentNode || currentNode.data.nodeType !== 'phone-message-router') {
      return;
    }
    const nextCount = Math.min(
      maximumTextRouterNumberOutputs,
      Math.max(minimumTextRouterNumberOutputs, textRouterNumberOutputCount(currentNode.data) + change),
    );
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId && node.data.nodeType === 'phone-message-router'
          ? {
              ...node,
              data: {
                ...node.data,
                textRouterMode: 'number',
                textRouterNumberOutputCount: nextCount,
                preview: 'Waiting for routed text ...',
                fullText: '',
              },
            }
          : node,
      ),
    );
    if (change < 0) {
      setEdges((currentEdges) =>
        currentEdges.filter(
          (edge) =>
            edge.source !== nodeId ||
            !Array.from(
              { length: maximumTextRouterNumberOutputs - nextCount },
              (_, offset) => textRouterNumberOutputHandle(nextCount + offset),
            ).includes(edge.sourceHandle ?? ''),
        ),
      );
    }
  }

  function changeTextSelectorMode(nodeId: string, mode: TextRouterMode) {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId && node.data.nodeType === 'text-selector'
          ? {
              ...node,
              data: {
                ...node.data,
                textSelectorMode: mode,
                textSelectorInputCount: textSelectorInputCount(node.data),
                preview: 'Waiting for selected text ...',
                fullText: '',
              },
            }
          : node,
      ),
    );
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => {
        if (edge.target !== nodeId) {
          return true;
        }
        if (edge.targetHandle === 'condition') {
          return false;
        }
        if (mode === 'number') {
          return edge.targetHandle !== 'false' && edge.targetHandle !== 'true';
        }
        return !/^text-\d+$/.test(edge.targetHandle ?? '');
      }),
    );
  }

  function changeTextSelectorInputCount(nodeId: string, change: number) {
    const currentNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!currentNode || currentNode.data.nodeType !== 'text-selector') {
      return;
    }
    const nextCount = Math.min(
      maximumTextRouterNumberOutputs,
      Math.max(minimumTextRouterNumberOutputs, textSelectorInputCount(currentNode.data) + change),
    );
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId && node.data.nodeType === 'text-selector'
          ? {
              ...node,
              data: {
                ...node.data,
                textSelectorMode: 'number',
                textSelectorInputCount: nextCount,
                preview: 'Waiting for selected text ...',
                fullText: '',
              },
            }
          : node,
      ),
    );
    if (change < 0) {
      setEdges((currentEdges) =>
        currentEdges.filter(
          (edge) =>
            edge.target !== nodeId ||
            !Array.from(
              { length: maximumTextRouterNumberOutputs - nextCount },
              (_, offset) => textSelectorTextInputHandle(nextCount + offset),
            ).includes(edge.targetHandle ?? ''),
        ),
      );
    }
  }

  function addSettingsValue(nodeId: string) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        const entries = settingsValueEntries(node.data);
        const selectedKeys = new Set(entries.map((entry) => entry.optionKey));
        const definition =
          settingsValueDefinitions.find((candidate) => !selectedKeys.has(candidate.key)) ??
          settingsValueDefinitions[0];
        if (!definition) {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            settingsValueEntries: [
              ...entries,
              {
                id: `value-${createId()}`,
                optionKey: definition.key,
                label: definition.label,
              },
            ],
          },
        };
      }),
    );
  }

  function removeSettingsValue(nodeId: string, entryId: string) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        const entries = settingsValueEntries(node.data);
        return entries.length > 1
          ? { ...node, data: { ...node.data, settingsValueEntries: entries.filter((entry) => entry.id !== entryId) } }
          : node;
      }),
    );
  }

  function changeSettingsValueSelection(nodeId: string, entryId: string, optionKey: string) {
    const selectedDefinition = settingsValueDefinitions.find((definition) => definition.key === optionKey);
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                settingsValueEntries: settingsValueEntries(node.data).map((entry) =>
                  entry.id === entryId
                    ? { ...entry, optionKey, label: selectedDefinition?.label ?? entry.label }
                    : entry,
                ),
              },
            }
          : node,
      ),
    );
  }

  function changeSettingsValueLabel(nodeId: string, entryId: string, label: string) {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                settingsValueEntries: settingsValueEntries(node.data).map((entry) =>
                  entry.id === entryId ? { ...entry, label } : entry,
                ),
              },
            }
          : node,
      ),
    );
  }

  async function loadTextFile(nodeId: string) {
    try {
      const result = await window.rpgraph.loadTextFile();
      if (result.canceled) {
        return;
      }
      if (!result.fileName || result.contents === undefined) {
        throw new Error('The selected text file could not be read.');
      }
      updateRuntimeNode(nodeId, {
        loadedFileName: result.fileName,
        loadedText: result.contents,
        preview: `Loaded ${result.fileName}`,
      });
    } catch (error) {
      updateRuntimeNode(nodeId, {
        preview: `Load failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  function changeCombinerPrefix(nodeId: string, index: number, value: string) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.nodeType !== 'combiner') {
          return node;
        }
        const prefixes = combinerPrefixes(node.data);
        prefixes[index] = value;
        return {
          ...node,
          data: {
            ...node.data,
            combinerPrefixes: prefixes,
            fullText: combineTextInputs(prefixes, combinerPreviews(node.data)),
          },
        };
      }),
    );
  }

  function addTextReplaceEntry(nodeId: string) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.nodeType !== 'text-replace') {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            textReplaceEntries: [
              ...textReplaceEntries(node.data),
              { id: `text-replace-${createId()}`, source: '', replacement: '' },
            ],
          },
        };
      }),
    );
  }

  function removeTextReplaceEntry(nodeId: string, entryId: string) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.nodeType !== 'text-replace') {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            textReplaceEntries: textReplaceEntries(node.data).filter((entry) => entry.id !== entryId),
          },
        };
      }),
    );
  }

  function changeTextReplaceEntry(
    nodeId: string,
    entryId: string,
    field: 'source' | 'replacement',
    value: string,
  ) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.nodeType !== 'text-replace') {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            textReplaceEntries: textReplaceEntries(node.data).map((entry) =>
              entry.id === entryId ? { ...entry, [field]: value } : entry,
            ),
          },
        };
      }),
    );
  }

  async function loadContextBuilder(nodeId: string) {
    const selectorNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!selectorNode || selectorNode.data.nodeType !== 'context-builder') {
      return;
    }
    const inputEdges = Array.from({ length: contextBuilderInputCount }, (_, index) =>
      edges.find(
        (edge) => edge.target === nodeId && edge.targetHandle === contextBuilderInputHandle(index),
      ),
    );
    const connectedEdges = inputEdges.flatMap((edge, index) => edge ? [{ edge, index }] : []);
    if (connectedEdges.length === 0) {
      updateRuntimeNode(nodeId, {
        contextBuilderItems: [],
        contextBuilderStatus: 'No inputs connected',
        preview: 'Connect up to five text inputs, then load',
        fullText: '',
      });
      return;
    }
    updateRuntimeNode(nodeId, { contextBuilderStatus: 'Loading connected inputs ...' });
    try {
      const originalHistory = formatChatHistory(
        messages,
        false,
        rpDateTimeFormat,
        rpWeekdayLanguage,
      );
      const translatedHistory = formatChatHistory(
        messages,
        true,
        rpDateTimeFormat,
        rpWeekdayLanguage,
      );
      const values = await Promise.all(
        connectedEdges.map(async ({ edge, index }) => ({
          sourceIndex: index,
          sourceLabel: `Input ${index + 1} - ${
            nodesRef.current.find((node) => node.id === edge.source)?.data.label ?? 'Text'
          }`,
          text: await executeGraph({
            outputNodeId: edge.source,
            outputSourceHandle: edge.sourceHandle,
            nodes: nodesRef.current,
            edges,
            originalInput: draft,
            lastRpOutput: lastMessageText(messages, 'output'),
            originalHistory,
            translatedHistory,
            historyMessages: messages,
            llm: nodeLlm,
            textMetrics: new TextMetricsApi(activeTokenEstimateBytesPerToken),
            updateRuntimeNode,
            connections,
            promptActionSettings,
            onComfyGenerationActive: updateWorkflowComfyGenerationActive,
            settingsValues: workflowSettingsValuesForGraph(),
            settingsValueDefinitions: settingsValueDefinitionsRef.current,
            onWorkflowVariablesSet: setWorkflowVariablesFromCommands,
            rpDateTimeFormat,
            rpWeekdayLanguage,
            referenceImages: nextTurnReferenceImageOptions,
          }),
        })),
      );
      const items = buildContextBuilderItems(values, selectorNode.data.contextBuilderItems);
      const output = contextBuilderText(items);
      updateRuntimeNode(nodeId, {
        contextBuilderItems: items,
        contextBuilderStatus: `Loaded ${items.length} sections from ${values.length} inputs`,
        preview: output ? 'Selected context ready' : 'No non-empty context sections',
        fullText: output,
      });
    } catch (error) {
      updateRuntimeNode(nodeId, {
        contextBuilderStatus: `Load failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  function toggleContextBuilderItem(nodeId: string, itemId: string, enabled: boolean) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.nodeType !== 'context-builder') {
          return node;
        }
        const items = (node.data.contextBuilderItems ?? []).map((item) =>
          item.id === itemId ? { ...item, enabled } : item,
        );
        return {
          ...node,
          data: { ...node.data, contextBuilderItems: items, fullText: contextBuilderText(items) },
        };
      }),
    );
  }

  function reorderContextBuilderItem(
    nodeId: string,
    draggedId: string,
    targetId: string,
    placement: 'before' | 'after',
  ) {
    if (draggedId === targetId) {
      return;
    }
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.nodeType !== 'context-builder') {
          return node;
        }
        const items = [...(node.data.contextBuilderItems ?? [])];
        const fromIndex = items.findIndex((item) => item.id === draggedId);
        const toIndex = items.findIndex((item) => item.id === targetId);
        if (fromIndex < 0 || toIndex < 0) {
          return node;
        }
        const [dragged] = items.splice(fromIndex, 1);
        const targetIndex = items.findIndex((item) => item.id === targetId);
        items.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, dragged);
        const currentIds = (node.data.contextBuilderItems ?? []).map((item) => item.id);
        if (items.every((item, index) => item.id === currentIds[index])) {
          return node;
        }
        return {
          ...node,
          data: { ...node.data, contextBuilderItems: items, fullText: contextBuilderText(items) },
        };
      }),
    );
  }

  function changeCombinerInputCount(nodeId: string, change: number) {
    const currentNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!currentNode || currentNode.data.nodeType !== 'combiner') {
      return;
    }
    const nextCount = Math.min(
      maximumCombinerInputs,
      Math.max(minimumCombinerInputs, combinerInputCount(currentNode.data) + change),
    );
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.nodeType !== 'combiner') {
          return node;
        }
        const prefixes = Array.from(
          { length: nextCount },
          (_, index) => node.data.combinerPrefixes?.[index] ?? '',
        );
        const previews = combinerPreviews(node.data).slice(0, nextCount);
        return {
          ...node,
          data: {
            ...node.data,
            combinerInputCount: nextCount,
            combinerPrefixes: prefixes,
            combinerInputPreviews: previews,
            preview: `Waiting for ${nextCount} inputs ...`,
            fullText: combineTextInputs(prefixes, previews),
          },
        };
      }),
    );
    if (change < 0) {
      setEdges((currentEdges) =>
        currentEdges.filter(
          (edge) =>
            edge.target !== nodeId ||
            !Array.from(
              { length: maximumCombinerInputs - nextCount },
              (_, offset) => combinerInputHandle(nextCount + offset),
            ).includes(edge.targetHandle ?? ''),
        ),
      );
    }
  }

  function changeLlmDecisionQuestionCount(nodeId: string, change: number) {
    const currentNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!currentNode || currentNode.data.nodeType !== 'llm-decision') {
      return;
    }
    const currentCount = llmDecisionEntries(currentNode.data).length;
    const nextCount = Math.min(
      maximumLlmDecisionQuestions,
      Math.max(minimumLlmDecisionQuestions, currentCount + change),
    );
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.nodeType !== 'llm-decision') {
          return node;
        }
        const questions = Array.from(
          { length: nextCount },
          (_, index) => node.data.llmDecisionQuestions?.[index] ?? '',
        );
        const toggles = Array.from(
          { length: nextCount },
          (_, index) => llmDecisionOutputToggles(node.data)[index] ?? { bool: true, text: true, number: true },
        );
        return {
          ...node,
          data: {
            ...node.data,
            llmDecisionQuestions: questions,
            llmDecisionOutputToggles: toggles,
            llmDecisionBoolResults: node.data.llmDecisionBoolResults?.slice(0, nextCount),
            llmDecisionTextResults: node.data.llmDecisionTextResults?.slice(0, nextCount),
            llmDecisionNumberResults: node.data.llmDecisionNumberResults?.slice(0, nextCount),
            preview: 'Not run yet',
          },
        };
      }),
    );
    if (change < 0) {
      setEdges((currentEdges) =>
        currentEdges.filter((edge) => {
          if (edge.source !== nodeId) {
            return true;
          }
          return !(['bool', 'text', 'number'] as const).some((kind) =>
            Array.from({ length: maximumLlmDecisionQuestions - nextCount }, (_, offset) =>
              llmDecisionOutputHandle(nextCount + offset, kind),
            ).includes(edge.sourceHandle ?? ''),
          );
        }),
      );
    }
  }

  function changeLlmDecisionQuestion(nodeId: string, index: number, value: string) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.nodeType !== 'llm-decision') {
          return node;
        }
        const questions = llmDecisionQuestions(node.data);
        questions[index] = value;
        return { ...node, data: { ...node.data, llmDecisionQuestions: questions } };
      }),
    );
  }

  function changeLlmDecisionOutput(
    nodeId: string,
    index: number,
    field: 'bool' | 'text' | 'number',
    value: boolean,
  ) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.nodeType !== 'llm-decision') {
          return node;
        }
        const toggles = llmDecisionOutputToggles(node.data);
        toggles[index] = { ...toggles[index], [field]: value };
        return { ...node, data: { ...node.data, llmDecisionOutputToggles: toggles } };
      }),
    );
    if (!value) {
      setEdges((currentEdges) =>
        currentEdges.filter(
          (edge) =>
            edge.source !== nodeId ||
            edge.sourceHandle !== llmDecisionOutputHandle(index, field),
        ),
      );
    }
  }

  function clearCharacterStatsState(nodeId: string) {
    updateRuntimeNode(nodeId, {
      ...resetCharacterStatsRuntimeData(),
      characterStatsStatus: 'State cleared / initializes on next run',
    });
  }

  function clearHistoryTimeState(nodeId: string) {
    const withoutRpDateTime = (message: MessageRecord) => {
      const nextMessage = { ...message };
      delete nextMessage.rpDateTime;
      return nextMessage;
    };
    const nextTurns = turnsRef.current.map((turn) => ({
      ...turn,
      input: {
        ...turn.input,
        messages: turn.input.messages.map(withoutRpDateTime),
      },
      output: {
        ...turn.output,
        messages: turn.output.messages.map(withoutRpDateTime),
      },
    }));
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    setTurnCheckpoints(
      turnCheckpointsRef.current.map((checkpoint) => {
        const nodeSnapshot = checkpoint.nodeSnapshots[nodeId];
        if (!nodeSnapshot) {
          return checkpoint;
        }
        const patchSnapshot = (snapshot: Record<string, unknown>) => ({
          ...snapshot,
          historyCurrentRpDateTime: undefined,
          historyProcessedTurnIds: [],
          historyTimeStatus: 'Waiting for RP time update',
          historyLastPrompt: undefined,
          historyLastResponse: undefined,
          runPrepared: false,
        });
        return {
          ...checkpoint,
          nodeSnapshots: {
            ...checkpoint.nodeSnapshots,
            [nodeId]: {
              before: patchSnapshot(nodeSnapshot.before),
              after: patchSnapshot(nodeSnapshot.after),
            },
          },
        };
      }),
    );
    messagesRef.current = messagesRef.current.map(withoutRpDateTime);
    setMessages(messagesRef.current);
    updateRuntimeNode(nodeId, {
      historyCurrentRpDateTime: undefined,
      historyProcessedTurnIds: [],
      historyTimeStatus: 'Waiting for RP time update',
      historyLastPrompt: undefined,
      historyLastResponse: undefined,
      runPrepared: false,
    });
  }

  function openTextDialog(view: TextDialogView, nodeId: string) {
    setTextDialogView(view);
    setTextDialogNodeId(nodeId);
  }

  function showNodeText(nodeId: string, text?: string) {
    if (text !== undefined) {
      updateRuntimeNode(nodeId, { fullText: text });
    } else {
      const node = nodesRef.current.find((entry) => entry.id === nodeId);
      if (node?.data.nodeType === 'character-stats') {
        const statsState = node.data.characterStatsState
          ? normalizeCharacterStatsState(nodesRef.current, node.data.characterStatsState)
          : undefined;
        updateRuntimeNode(nodeId, {
          fullText: statsState
            ? characterStatsStateText(
                nodesRef.current,
                statsState,
                characterStatDefinitions(node.data),
                node.data.characterStatsBaselineState,
              )
            : 'State not initialized yet. Run the graph with initial context connected.',
        });
      }
    }
    openTextDialog('text', nodeId);
  }

  function removeLlmPromptSwitchOutputChannel(nodeId: string, index: number) {
    setEdges((currentEdges) =>
      currentEdges.flatMap((edge) => {
        if (edge.source !== nodeId || !edge.sourceHandle?.startsWith('output-channel-')) {
          return [edge];
        }
        const outputIndex = Number(edge.sourceHandle.replace('output-channel-', ''));
        if (!Number.isInteger(outputIndex)) {
          return [edge];
        }
        if (outputIndex === index) {
          return [];
        }
        if (outputIndex > index) {
          const currentHandle = edge.sourceHandle;
          const nextHandle = llmPromptSwitchOutputHandle(outputIndex - 1);
          return [{
            ...edge,
            id: edge.id.replace(currentHandle, nextHandle),
            sourceHandle: nextHandle,
          }];
        }
        return [edge];
      }),
    );
  }

  const nodeActions: NodeActions = {
    updateData: (nodeId, patch) => updateRuntimeNode(nodeId, patch as Partial<WorkflowNodeData>),
    changeConnection: changePromptConnection,
    changeOutputOption,
    changeFixedNumberValue,
    changeFixedBoolValue,
    changeWriteTextValue,
    changeTextRouterMode,
    changeTextRouterNumberOutputCount,
    changeTextSelectorMode,
    changeTextSelectorInputCount,
    textPreview: showNodeText,
    showJson: setJsonDialogNodeId,
    showCharacterStatsContext: (nodeId) => openTextDialog('character-stats-context', nodeId),
    showCharacterStatsResponse: (nodeId) => openTextDialog('character-stats-response', nodeId),
    showCharacterStatsPrompts: (nodeId) => openTextDialog('character-stats-prompts', nodeId),
    showCharacterStatsChart: (nodeId) => openTextDialog('character-stats-chart', nodeId),
    showHistoryTimeResponse: (nodeId) => openTextDialog('history-time-response', nodeId),
    showEventManagerResponse: (nodeId) => openTextDialog('event-manager-response', nodeId),
    showEventManagerAppointments: (nodeId) => openTextDialog('event-manager-appointments', nodeId),
    showOutputHighlighting: (nodeId) => openTextDialog('output-highlighting', nodeId),
    showOutputFormatHelp: setOutputFormatHelpKind,
    openStorybookCreator,
    openStorybookEditor,
    upgradeNode,
    openCustomNodeAssistant,
    runCustomNodeButton,
    loadStorybookFile,
    importSillyTavernCharacter,
    loadTextFile,
    loadContextBuilder,
    toggleContextBuilderItem,
    reorderContextBuilderItem,
    changeCombinerPrefix,
    changeCombinerInputCount,
    addTextReplaceEntry,
    removeTextReplaceEntry,
    changeTextReplaceEntry,
    changeLlmDecisionQuestionCount,
    changeLlmDecisionQuestion,
    changeLlmDecisionOutput,
    removeLlmPromptSwitchOutputChannel,
    addSettingsValue,
    removeSettingsValue,
    changeSettingsValueSelection,
    changeSettingsValueLabel,
    clearCharacterStatsState,
    clearHistoryTimeState,
  };

  return {
    nodeActions,
    loadTextFile,
    loadContextBuilder,
    clearHistoryTimeState,
  };
}
