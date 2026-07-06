import {
  combinerInputCount,
  combinerInputHandle,
  contextCompressionMaxTokensHandle,
  contextLengthMaxOptionKey,
  contextBuilderInputCount,
  contextBuilderInputHandle,
  defaultCharacterStatDefinitions,
  defaultCharacterStatsMaxChange,
  defaultLlmPromptSwitchOutputTitles,
  defaultLlmPromptSwitchPromptAftersByOutput,
  defaultLlmPromptSwitchPromptBeforesByOutput,
  defaultLlmPromptSwitchPromptTitlesByOutput,
  llmPromptSwitchOutputTitles,
  llmPromptSwitchOutputHandle,
  llmDecisionEntries,
  llmDecisionOutputHandle,
  defaultContextCompressionLengthWords,
  defaultContextCompressionRatio,
  defaultContextCompressionTokenLimit,
  minimumCombinerInputs,
  settingsValueEntries,
  settingsValueHandle,
  textRouterMode,
  textRouterNumberOutputCount,
  textRouterNumberOutputHandle,
  textSelectorInputCount,
  textSelectorMode,
  textSelectorTextInputHandle,
} from '../workflow';
import { CharacterStatsNodeCard } from './character-stats/Card';
import { runCharacterStatsNode } from './character-stats/run';
import { CombinerNodeCard } from './combiner/Card';
import { executeCombinerNode } from './combiner/execute';
import { ContextCompressionNodeCard } from './context-compression/Card';
import { runContextCompressionNode } from './context-compression/run';
import { ContextBuilderNodeCard } from './context-builder/Card';
import { executeContextBuilderNode } from './context-builder/execute';
import { CustomNodeCard } from './custom-node/Card';
import { executeCustomNode } from './custom-node/execute';
import { customNodeDefinition, defaultCustomNodeDefinition } from './custom-node/model';
import { EventManagerNodeCard } from './event-manager/Card';
import { executeEventManagerNode } from './event-manager/execute';
import { defaultEventManagerPromptSettings } from './event-manager/prompt';
import { LlmDecisionNodeCard } from './llm-decision/Card';
import { executeLlmDecisionNode } from './llm-decision/execute';
import { LlmPromptSwitchNodeCard } from './llm-prompt-switch/Card';
import {
  executeLlmPromptSwitchNode,
  promptSwitchOutputChannelHandle,
  promptSwitchPromptSlotHandle,
  promptSwitchTextHandle,
} from './llm-prompt-switch/execute';
import { HistoryNodeCard } from './history/Card';
import { executeHistoryNode } from './history/execute';
import { defaultHistoryRpTimePromptSettings } from './history/rpTimePrompt';
import { GroupNodeCard } from './group/Card';
import { executeGroupNode } from './group/execute';
import { InputNodeCard } from './input/Card';
import { executeInputNode } from './input/execute';
import { defaultAutoTurnInstructionSettings } from '../chat/instructions';
import { LastRpOutputNodeCard } from './last-rp-output/Card';
import { executeLastRpOutputNode } from './last-rp-output/execute';
import { LastUserInputNodeCard } from './last-user-input/Card';
import { executeLastUserInputNode } from './last-user-input/execute';
import { LoadTextNodeCard } from './load-text/Card';
import { executeLoadTextNode } from './load-text/execute';
import { WriteTextNodeCard } from './write-text/Card';
import { executeWriteTextNode } from './write-text/execute';
import { MemorySlotNodeCard } from './memory-slot/Card';
import { executeMemorySlotNode } from './memory-slot/execute';
import { nextWireLinkName, wireLinkMode, wireLinkStyle } from './memory-slot/model';
import { PhoneMessageRouterNodeCard } from './phone-message-router/Card';
import { executePhoneMessageRouterNode } from './phone-message-router/execute';
import { NoteNodeCard } from './note/Card';
import { executeNoteNode } from './note/execute';
import { TextSelectorNodeCard } from './text-selector/Card';
import { executeTextSelectorNode } from './text-selector/execute';
import { FixedNumberNodeCard } from './fixed-number/Card';
import { executeFixedNumberNode } from './fixed-number/execute';
import { FixedBoolNodeCard } from './fixed-bool/Card';
import { executeFixedBoolNode } from './fixed-bool/execute';
import { SettingsValueNodeCard } from './settings-value/Card';
import { executeSettingsValueNode } from './settings-value/execute';
import { OutputNodeCard } from './output/Card';
import { executeOutputNode } from './output/execute';
import {
  defaultOutputSpeakerPromptSettings,
  defaultOutputSpeakerResponseFormat,
} from './output/speakerPrompt';
import { LlmPromptNodeCard } from './llm-prompt/Card';
import { runLlmPromptNode } from './llm-prompt/run';
import { RpStorybookV1NodeCard } from './rp-storybook-v1/Card';
import { executeRpStorybookV1Node } from './rp-storybook-v1/execute';
import {
  defaultRpStorybookFormattedTextSettings,
  emptyRpStorybookV1,
  rpStorybookJsonText,
} from './rp-storybook-v1/model';
import { TextPreviewNodeCard } from './text-preview/Card';
import { executeTextPreviewNode } from './text-preview/execute';
import type { CoreNodeCreationDefinition, PortDefinition } from './types';
import { corePersistence } from './corePersistence';
import { currentCoreNodeVersions } from './nodeVersion';

export const coreNodeLayout = {
  standardWidth: 365,
  rpStorybookWidth: 365,
  contextCompressionWidth: 365,
  characterStatsWidth: 430,
  textCombinerWidth: 365,
  llmPromptWidth: 548,
  llmPromptHeight: 1140,
  loadTextWidth: 380,
  loadTextHeight: 390,
  writeTextWidth: 365,
  writeTextHeight: 390,
  noteWidth: 320,
  noteHeight: 220,
  groupWidth: 560,
  groupHeight: 260,
  memorySlotWidth: 218,
  memorySlotHeight: 72,
  phoneMessageRouterWidth: 365,
  llmPromptSwitchWidth: 548,
  llmPromptSwitchHeight: 1140,
  textPreviewWidth: 365,
  textPreviewHeight: 455,
  lastMessageWidth: 365,
  eventManagerWidth: 365,
  contextBuilderWidth: 430,
  contextBuilderHeight: 620,
  llmDecisionWidth: 390,
  customNodeWidth: 365,
} as const;

const legacyPromptTokenSettingsNodeHeight = 660;
const legacyTextPreviewNodeWidth = 390;
const legacyTextPreviewNodeHeight = 350;

function input(id: string, valueType: PortDefinition['valueType'], label: string): PortDefinition {
  return { id, direction: 'input', valueType, label };
}

function output(id: string, valueType: PortDefinition['valueType'], label: string): PortDefinition {
  return { id, direction: 'output', valueType, label };
}

const coreNodeCreationDefinitions: Array<Omit<CoreNodeCreationDefinition, 'saveData' | 'hydrateData'>> = [
  {
    type: 'input',
    dataVersion: currentCoreNodeVersions['input'],
    label: 'User Input',
    description: 'Chat message',
    menuDescription: 'Single chat input',
    origin: 'core',
    singleton: true,
    usesLlm: true,
    ports: () => [
      output('default', 'text', 'Text'),
      output('image', 'image', 'Image'),
      output('message-format', 'number', 'Message Format'),
      output('turn-mode', 'number', 'Turn Mode'),
    ],
    Component: InputNodeCard,
    execute: executeInputNode,
    create: ({ defaultConnectionId, position }) => ({
      id: 'user-input',
      type: 'workflow',
      position,
      data: {
        label: 'User Input',
        description: 'Chat message',
        preview: 'Waiting for input ...',
        nodeType: 'input',
        connectionId: defaultConnectionId,
        autoTurnInstructions: defaultAutoTurnInstructionSettings(),
      },
    }),
  },
  {
    type: 'note',
    dataVersion: currentCoreNodeVersions['note'],
    label: 'Infobox',
    description: 'Markdown info box',
    menuDescription: 'Write formatted Markdown in an info box',
    origin: 'core',
    ports: () => [],
    Component: NoteNodeCard,
    execute: executeNoteNode,
    create: ({ position, createId }) => ({
      id: createId('note'),
      type: 'workflow',
      position,
      style: {
        width: coreNodeLayout.noteWidth,
        height: coreNodeLayout.noteHeight,
      },
      data: {
        label: 'Infobox',
        description: 'Markdown info box',
        preview: 'Empty note',
        nodeType: 'note',
        noteText: '',
        noteFontSize: 14,
      },
    }),
  },
  {
    type: 'group',
    dataVersion: currentCoreNodeVersions['group'],
    label: 'Node Group',
    description: 'Visual workflow group',
    menuDescription: 'Frame and label a group of nodes',
    origin: 'core',
    ports: () => [],
    Component: GroupNodeCard,
    execute: executeGroupNode,
    create: ({ position, createId }) => ({
      id: createId('group'),
      type: 'workflow',
      position,
      style: {
        width: coreNodeLayout.groupWidth,
        height: coreNodeLayout.groupHeight,
      },
      data: {
        label: 'Node Group',
        description: 'Visual workflow group',
        preview: 'Empty group',
        nodeType: 'group',
        groupTitle: 'Node Group',
      },
    }),
  },
  {
    type: 'custom',
    dataVersion: currentCoreNodeVersions['custom'],
    label: 'Custom Node',
    description: 'Assistant-built modular node',
    menuDescription: 'Build a modular node with an assistant',
    origin: 'core',
    usesLlm: true,
    requiresPostOutputPermission: true,
    ports: (data) => {
      const definition = customNodeDefinition(data.customNodeDefinition);
      return [...definition.inputs, ...definition.outputs];
    },
    Component: CustomNodeCard,
    execute: executeCustomNode,
    create: ({ defaultConnectionId, position, createId }) => ({
      id: createId('custom-node'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.customNodeWidth },
      data: {
        label: 'Custom Node',
        description: 'Assistant-built modular node',
        preview: 'Ready for Node Assistant',
        nodeType: 'custom',
        connectionId: defaultConnectionId,
        customNodeDefinition: defaultCustomNodeDefinition(),
        runAfterRpOutput: false,
      },
    }),
  },
  {
    type: 'last-user-input',
    dataVersion: currentCoreNodeVersions['last-user-input'],
    label: 'Last User Input',
    description: 'Latest user message',
    menuDescription: 'Latest user message as text',
    origin: 'core',
    ports: () => [output('default', 'text', 'Text')],
    Component: LastUserInputNodeCard,
    execute: executeLastUserInputNode,
    create: ({ position, createId }) => ({
      id: createId('last-user-input'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.lastMessageWidth },
      data: {
        label: 'Last User Input',
        description: 'Latest user message',
        preview: 'No user input yet',
        nodeType: 'last-user-input',
        fullText: '',
        includeRpDateTime: false,
      },
    }),
  },
  {
    type: 'last-rp-output',
    dataVersion: currentCoreNodeVersions['last-rp-output'],
    label: 'Last RP Output',
    description: 'Latest RP output',
    menuDescription: 'Latest RP output as text',
    origin: 'core',
    ports: () => [output('default', 'text', 'Text')],
    Component: LastRpOutputNodeCard,
    execute: executeLastRpOutputNode,
    create: ({ position, createId }) => ({
      id: createId('last-rp-output'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.lastMessageWidth },
      data: {
        label: 'Last RP Output',
        description: 'Latest RP output',
        preview: 'No RP output yet',
        nodeType: 'last-rp-output',
        fullText: '',
        includeRpDateTime: false,
      },
    }),
  },
  {
    type: 'event-manager',
    dataVersion: currentCoreNodeVersions['event-manager'],
    label: 'Event Manager',
    description: 'Scheduled event tracking and context',
    menuDescription: 'Track and run scheduled roleplay events',
    origin: 'core',
    singleton: true,
    usesLlm: true,
    contributesToTokenCalibration: true,
    requiresPostOutputPermission: true,
    ports: () => [
      input('default', 'text', 'Event Context'),
      output('appointments', 'text', 'Events'),
    ],
    Component: EventManagerNodeCard,
    execute: executeEventManagerNode,
    create: ({ defaultConnectionId, position }) => ({
      id: 'event-manager',
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.eventManagerWidth },
      data: {
        label: 'Event Manager',
        description: 'Scheduled event tracking and context',
        preview: 'No event context connected',
        nodeType: 'event-manager',
        fullText: '',
        connectionId: defaultConnectionId,
        eventStatus: 'Waiting for event update',
        eventManagerPrompt: defaultEventManagerPromptSettings(),
        runAfterRpOutput: true,
      },
    }),
  },
  {
    type: 'history',
    dataVersion: currentCoreNodeVersions['history'],
    label: 'Chat History',
    description: 'Previous conversation context',
    menuDescription: 'Previous canonical turns',
    origin: 'core',
    singleton: true,
    usesLlm: true,
    contributesToTokenCalibration: true,
    requiresPostOutputPermission: true,
    ports: () => [
      output('original', 'text', 'Formatted Chat History'),
      output('last-turns', 'text', 'Last X Turns'),
    ],
    Component: HistoryNodeCard,
    execute: executeHistoryNode,
    create: ({ defaultConnectionId, position, originalHistory, translatedHistory }) => ({
      id: 'chat-history',
      type: 'workflow',
      position,
      data: {
        label: 'Chat History',
        description: 'Previous conversation context',
        preview: 'No conversation yet',
        nodeType: 'history',
        rawHistory: originalHistory,
        originalHistory,
        translatedHistory,
        lastTurnsHistory: originalHistory,
        historyLastTurnsCount: 5,
        connectionId: defaultConnectionId,
        historyTimeTrackingEnabled: false,
        historyTimeStatus: 'RP Time: Disabled',
        historyRpTimePrompt: defaultHistoryRpTimePromptSettings(),
        runAfterRpOutput: true,
      },
    }),
  },
  {
    type: 'phone-message-router',
    dataVersion: currentCoreNodeVersions['phone-message-router'],
    label: 'Text Router',
    description: 'Route text by bool or number',
    menuDescription: 'Split text into bool or numbered paths',
    origin: 'core',
    ports: (data) => [
      input('text', 'text', 'Text Input'),
      textRouterMode(data) === 'number'
        ? input('condition', 'number', 'Number')
        : input('condition', 'boolean', 'Bool'),
      ...(textRouterMode(data) === 'number'
        ? Array.from({ length: textRouterNumberOutputCount(data) }, (_, index) =>
            output(textRouterNumberOutputHandle(index), 'text', `Number ${index} Text`),
          )
        : [
            output('false', 'text', 'False Text'),
            output('true', 'text', 'True Text'),
          ]),
    ],
    Component: PhoneMessageRouterNodeCard,
    execute: executePhoneMessageRouterNode,
    create: ({ position, createId }) => ({
      id: createId('phone-message-router'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.phoneMessageRouterWidth },
      data: {
        label: 'Text Router',
        description: 'Route text by bool or number',
        preview: 'Waiting for routed text ...',
        nodeType: 'phone-message-router',
        textRouterMode: 'bool',
        textRouterNumberOutputCount: 5,
        fullText: '',
      },
    }),
  },
  {
    type: 'text-selector',
    dataVersion: currentCoreNodeVersions['text-selector'],
    label: 'Text Selector',
    description: 'Select text by bool or number',
    menuDescription: 'Choose one text input by bool or number',
    origin: 'core',
    ports: (data) => [
      textSelectorMode(data) === 'number'
        ? input('condition', 'number', 'Select Number')
        : input('condition', 'boolean', 'Bool'),
      ...(textSelectorMode(data) === 'number'
        ? Array.from({ length: textSelectorInputCount(data) }, (_, index) =>
            input(textSelectorTextInputHandle(index), 'text', `Number ${index} Text`),
          )
        : [
            input('false', 'text', 'False Text'),
            input('true', 'text', 'True Text'),
          ]),
      output('default', 'text', 'Text'),
    ],
    Component: TextSelectorNodeCard,
    execute: executeTextSelectorNode,
    create: ({ position, createId }) => ({
      id: createId('text-selector'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.phoneMessageRouterWidth },
      data: {
        label: 'Text Selector',
        description: 'Select text by bool or number',
        preview: 'Waiting for selected text ...',
        nodeType: 'text-selector',
        textSelectorMode: 'bool',
        textSelectorInputCount: 5,
        fullText: '',
      },
    }),
  },
  {
    type: 'llm-prompt-switch',
    dataVersion: currentCoreNodeVersions['llm-prompt-switch'],
    label: 'LLM Prompt Switch',
    description: 'Select an LLM prompt by output channel and prompt slot',
    menuDescription: 'Select an LLM prompt from a channel matrix',
    origin: 'core',
    usesLlm: true,
    contributesToTokenCalibration: true,
    requiresPostOutputPermission: true,
    requiresPreparedInputEdge: true,
    hydrateStyle: (node) => ({
      ...node.style,
      width: coreNodeLayout.llmPromptSwitchWidth,
      height:
        typeof node.style?.height === 'number'
          ? Math.max(node.style.height, coreNodeLayout.llmPromptSwitchHeight)
          : coreNodeLayout.llmPromptSwitchHeight,
    }),
    ports: (data) => [
      input(promptSwitchTextHandle, 'text', 'Text Input'),
      input('image', 'image', 'Image Input'),
      input(promptSwitchOutputChannelHandle, 'number', 'Output Channel'),
      input(promptSwitchPromptSlotHandle, 'number', 'Prompt Slot'),
      ...llmPromptSwitchOutputTitles(data).map((title, index) =>
        output(llmPromptSwitchOutputHandle(index), 'mixed', title.trim() || `Output ${index}`),
      ),
    ],
    Component: LlmPromptSwitchNodeCard,
    execute: executeLlmPromptSwitchNode,
    create: ({ defaultConnectionId, position, createId }) => ({
      id: createId('llm-prompt-switch'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.llmPromptSwitchWidth, height: coreNodeLayout.llmPromptSwitchHeight },
      data: {
        label: 'LLM Prompt Switch',
        description: 'Select an LLM prompt by output channel and prompt slot',
        preview: 'Not run yet',
        nodeType: 'llm-prompt-switch',
        llmPromptSwitchOutputTitles: defaultLlmPromptSwitchOutputTitles(),
        llmPromptSwitchPromptTitlesByOutput: defaultLlmPromptSwitchPromptTitlesByOutput(),
        llmPromptSwitchPromptBeforesByOutput: defaultLlmPromptSwitchPromptBeforesByOutput(),
        llmPromptSwitchPromptAftersByOutput: defaultLlmPromptSwitchPromptAftersByOutput(),
        llmPromptSwitchSelectedOutputChannel: 0,
        llmPromptSwitchSelectedPromptSlot: 0,
        llmPromptSwitchAutoShowPrompt: true,
        llmPromptSwitchAutoFormatJson: true,
        llmPromptActions: [],
        runAfterRpOutput: false,
        connectionId: defaultConnectionId,
      },
    }),
  },
  {
    type: 'llm-prompt',
    dataVersion: currentCoreNodeVersions['llm-prompt'],
    label: 'LLM Prompt',
    description: 'LLM provider call',
    menuDescription: 'LLM prompt step',
    origin: 'core',
    usesLlm: true,
    contributesToTokenCalibration: true,
    requiresPostOutputPermission: true,
    requiresPreparedInputEdge: true,
    hydrateStyle: (node) => ({
      ...node.style,
      width: coreNodeLayout.llmPromptWidth,
      height:
        typeof node.style?.height === 'number'
          ? node.style.height === legacyPromptTokenSettingsNodeHeight
            ? coreNodeLayout.llmPromptHeight
            : Math.max(node.style.height, coreNodeLayout.llmPromptHeight)
          : coreNodeLayout.llmPromptHeight,
    }),
    ports: () => [
      input('default', 'text', 'Text Input'),
      input('image', 'image', 'Image Input'),
      output('default', 'mixed', 'Text'),
    ],
    Component: LlmPromptNodeCard,
    execute: runLlmPromptNode,
    create: ({ defaultConnectionId, position, createId }) => ({
      id: createId('llm-prompt'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.llmPromptWidth, height: coreNodeLayout.llmPromptHeight },
      data: {
        label: 'LLM Prompt',
        description: 'LLM provider call',
        preview: 'Not run yet',
        nodeType: 'llm-prompt',
        llmPromptBefore: '',
        llmPromptAfter: '',
        llmPromptAutoFormatJson: true,
        llmPromptActions: [],
        runAfterRpOutput: false,
        connectionId: defaultConnectionId,
      },
    }),
  },
  {
    type: 'combiner',
    dataVersion: currentCoreNodeVersions['combiner'],
    label: 'Text Combiner',
    description: 'Merge ordered text inputs',
    menuDescription: 'Merge ordered text inputs',
    origin: 'core',
    ports: (data) => [
      ...Array.from({ length: combinerInputCount(data) }, (_, index) =>
        input(combinerInputHandle(index), 'text', `Input ${index + 1}`),
      ),
      output('default', 'text', 'Text'),
    ],
    Component: CombinerNodeCard,
    execute: executeCombinerNode,
    create: ({ position, createId }) => ({
      id: createId('text-combiner'),
      type: 'workflow',
      position,
      data: {
        label: 'Text Combiner',
        description: 'Merge ordered text inputs',
        preview: 'Waiting for 2 inputs ...',
        nodeType: 'combiner',
        combinerInputCount: minimumCombinerInputs,
        combinerPrefixes: ['', ''],
        combinerInputPreviews: ['', ''],
      },
    }),
  },
  {
    type: 'load-text',
    dataVersion: currentCoreNodeVersions['load-text'],
    label: 'Load Text',
    description: 'Load a text-based file as workflow input',
    menuDescription: 'Load TXT, JSON and other text files',
    origin: 'core',
    ports: () => [output('default', 'text', 'Text')],
    Component: LoadTextNodeCard,
    execute: executeLoadTextNode,
    create: ({ position, createId }) => ({
      id: createId('load-text'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.loadTextWidth, height: coreNodeLayout.loadTextHeight },
      data: {
        label: 'Load Text',
        description: 'Load a text-based file as workflow input',
        preview: 'No file loaded',
        nodeType: 'load-text',
        loadedText: '',
        loadTextWrapPreview: true,
      },
    }),
  },
  {
    type: 'write-text',
    dataVersion: currentCoreNodeVersions['write-text'],
    label: 'Write Text',
    description: 'Write reusable text directly in the node',
    menuDescription: 'Write static text as workflow input',
    origin: 'core',
    ports: () => [output('default', 'text', 'Text')],
    Component: WriteTextNodeCard,
    execute: executeWriteTextNode,
    create: ({ position, createId }) => ({
      id: createId('write-text'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.writeTextWidth, height: coreNodeLayout.writeTextHeight },
      data: {
        label: 'Write Text',
        description: 'Write reusable text directly in the node',
        preview: 'No text written',
        nodeType: 'write-text',
        writeTextValue: '',
      },
    }),
  },
  {
    type: 'memory-slot',
    dataVersion: currentCoreNodeVersions['memory-slot'],
    label: 'Wire Link',
    description: 'Store and reuse text through a linked pair',
    menuDescription: 'Store and reuse text through a linked pair',
    origin: 'core',
    requiresPreparedInputEdge: true,
    hydrateStyle: (node) => {
      if (node.data.kind !== undefined || node.data.nodeType !== 'memory-slot') {
        return node.style;
      }
      return { ...node.style, ...wireLinkStyle(wireLinkMode(node.data)) };
    },
    ports: (data) => {
      const mode = wireLinkMode(data);
      return [
        ...(mode === 'output' ? [] : [input('default', 'text', 'Save Text')]),
        ...(mode === 'input' ? [] : [output('default', 'text', 'Stored Text')]),
      ];
    },
    Component: MemorySlotNodeCard,
    execute: executeMemorySlotNode,
    create: ({ position, createId, readNodes }) => ({
      id: createId('memory-slot'),
      type: 'workflow',
      position,
      style: wireLinkStyle('joined'),
      data: {
        label: 'Wire Link',
        description: 'Store and reuse text through a linked pair',
        preview: 'No stored text yet',
        nodeType: 'memory-slot',
        memorySlotName: nextWireLinkName(readNodes()),
        memorySlotText: '',
        memorySlotMode: 'joined',
        fullText: '',
      },
    }),
  },
  {
    type: 'text-preview',
    dataVersion: currentCoreNodeVersions['text-preview'],
    label: 'Text Preview',
    description: 'Display passing text and estimated context size',
    menuDescription: 'Display passing text and token estimate',
    origin: 'core',
    passiveRuntime: true,
    requiresPreparedInputEdge: true,
    hydrateStyle: (node) => ({
      ...node.style,
      width:
        node.style?.width === undefined ||
        (node.style.width === legacyTextPreviewNodeWidth &&
          node.style?.height === legacyTextPreviewNodeHeight)
          ? coreNodeLayout.textCombinerWidth
          : node.style.width,
      height:
        node.style?.height === undefined ||
        (node.style.width === legacyTextPreviewNodeWidth &&
          node.style.height === legacyTextPreviewNodeHeight)
          ? coreNodeLayout.textPreviewHeight
          : node.style.height,
    }),
    ports: () => [input('default', 'mixed', 'Mixed Input'), output('default', 'mixed', 'Mixed')],
    Component: TextPreviewNodeCard,
    execute: executeTextPreviewNode,
    create: ({ position, createId }) => ({
      id: createId('text-preview'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.textPreviewWidth, height: coreNodeLayout.textPreviewHeight },
      data: {
        label: 'Text Preview',
        description: 'Display passing text and estimated context size',
        preview: 'Waiting for text ...',
        nodeType: 'text-preview',
        fullText: '',
      },
    }),
  },
  {
    type: 'context-builder',
    dataVersion: currentCoreNodeVersions['context-builder'],
    label: 'Context Builder',
    description: 'Select and arrange structured context sections',
    menuDescription: 'Select and arrange structured context',
    origin: 'core',
    hydrateStyle: (node) => ({
      ...node.style,
      width: node.style?.width ?? coreNodeLayout.contextBuilderWidth,
      height: node.style?.height ?? coreNodeLayout.contextBuilderHeight,
    }),
    ports: () => [
      ...Array.from({ length: contextBuilderInputCount }, (_, index) =>
        input(contextBuilderInputHandle(index), 'json', `JSON Input ${index + 1}`),
      ),
      output('default', 'text', 'Text'),
    ],
    Component: ContextBuilderNodeCard,
    execute: executeContextBuilderNode,
    create: ({ position, createId }) => ({
      id: createId('context-builder'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.contextBuilderWidth, height: coreNodeLayout.contextBuilderHeight },
      data: {
        label: 'Context Builder',
        description: 'Select and arrange structured context sections',
        preview: 'Connect up to five text inputs, then load',
        nodeType: 'context-builder',
        contextBuilderItems: [],
        contextBuilderStatus: 'Not loaded yet',
      },
    }),
  },
  {
    type: 'llm-decision',
    dataVersion: currentCoreNodeVersions['llm-decision'],
    label: 'LLM Decision',
    description: 'Ask LLM questions and output bool, text and number',
    menuDescription: 'LLM bool/text/number decisions',
    origin: 'core',
    usesLlm: true,
    contributesToTokenCalibration: true,
    requiresPostOutputPermission: true,
    requiresPreparedInputEdge: true,
    ports: (data) => [
      input('default', 'text', 'Text Input'),
      input('image', 'image', 'Image Input'),
      ...llmDecisionEntries(data).flatMap((entry) =>
        ([
          entry.outputs.bool ? output(llmDecisionOutputHandle(entry.index, 'bool'), 'boolean', `Bool ${entry.index + 1}`) : undefined,
          entry.outputs.text ? output(llmDecisionOutputHandle(entry.index, 'text'), 'text', `Text ${entry.index + 1}`) : undefined,
          entry.outputs.number ? output(llmDecisionOutputHandle(entry.index, 'number'), 'number', `Number ${entry.index + 1}`) : undefined,
        ]).filter((port): port is PortDefinition => !!port),
      ),
    ],
    Component: LlmDecisionNodeCard,
    execute: executeLlmDecisionNode,
    create: ({ defaultConnectionId, position, createId }) => ({
      id: createId('llm-decision'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.llmDecisionWidth },
      data: {
        label: 'LLM Decision',
        description: 'Ask LLM questions and output bool, text and number',
        preview: 'Not run yet',
        nodeType: 'llm-decision',
        connectionId: defaultConnectionId,
        runAfterRpOutput: true,
        llmDecisionQuestions: [''],
        llmDecisionOutputToggles: [{ bool: true, text: true, number: true }],
      },
    }),
  },
  {
    type: 'context-compression',
    dataVersion: currentCoreNodeVersions['context-compression'],
    label: 'Context Compression',
    description: 'Summarize text when its context budget is reached',
    menuDescription: 'Summarize text above a token limit',
    origin: 'core',
    usesLlm: true,
    requiresPreparedInputEdge: true,
    ports: () => [
      input('default', 'text', 'Text Input'),
      input(contextCompressionMaxTokensHandle, 'number', 'Max Tokens'),
      output('default', 'text', 'Text'),
    ],
    Component: ContextCompressionNodeCard,
    execute: runContextCompressionNode,
    create: ({ defaultConnectionId, position, createId }) => ({
      id: createId('context-compression'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.contextCompressionWidth },
      data: {
        label: 'Context Compression',
        description: 'Summarize text when its context budget is reached',
        preview: 'Waiting for text ...',
        nodeType: 'context-compression',
        connectionId: defaultConnectionId,
        contextCompressionMaxTokens: defaultContextCompressionTokenLimit,
        contextCompressionRatio: defaultContextCompressionRatio,
        contextCompressionLengthWords: defaultContextCompressionLengthWords,
        runAfterRpOutput: false,
      },
    }),
  },
  {
    type: 'character-stats',
    dataVersion: currentCoreNodeVersions['character-stats'],
    label: 'Character Stats Tracker',
    description: 'Track character stats',
    menuDescription: 'Track character stats',
    origin: 'core',
    usesLlm: true,
    contributesToTokenCalibration: true,
    requiresPostOutputPermission: true,
    requiresPreparedInputEdge: true,
    hydrateStyle: (node) => ({
      ...node.style,
      width: coreNodeLayout.characterStatsWidth,
      height: undefined,
    }),
    ports: () => [
      input('initial-context', 'text', 'Initial Context'),
      input('last-message', 'text', 'Last Message'),
      output('default', 'text', 'Stats State'),
      output('context', 'text', 'Context + Stats'),
    ],
    Component: CharacterStatsNodeCard,
    execute: runCharacterStatsNode,
    create: ({ defaultConnectionId, position, createId }) => ({
      id: createId('character-stats'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.characterStatsWidth },
      data: {
        label: 'Character Stats Tracker',
        description: 'Track character stats',
        preview: 'Waiting for automatic initialization',
        nodeType: 'character-stats',
        connectionId: defaultConnectionId,
        characterStatDefinitions: defaultCharacterStatDefinitions,
        characterStatsMaxChange: defaultCharacterStatsMaxChange,
        characterStatsStatus: 'Initializes from connected context',
        runAfterRpOutput: true,
      },
    }),
  },
  {
    type: 'fixed-number',
    dataVersion: currentCoreNodeVersions['fixed-number'],
    label: 'Fixed Number',
    description: 'Numeric workflow parameter',
    menuDescription: 'Drive numeric node inputs',
    origin: 'core',
    ports: () => [output('default', 'number', 'Number')],
    Component: FixedNumberNodeCard,
    execute: executeFixedNumberNode,
    create: ({ position, createId }) => ({
      id: createId('fixed-number'),
      type: 'workflow',
      position,
      data: {
        label: 'Fixed Number',
        description: 'Numeric workflow parameter',
        preview: '',
        nodeType: 'fixed-number',
        fixedNumberValue: defaultContextCompressionTokenLimit,
      },
    }),
  },
  {
    type: 'fixed-bool',
    dataVersion: currentCoreNodeVersions['fixed-bool'],
    label: 'Fixed Bool',
    description: 'Boolean workflow parameter',
    menuDescription: 'Drive bool node inputs',
    origin: 'core',
    ports: () => [output('default', 'boolean', 'Bool')],
    Component: FixedBoolNodeCard,
    execute: executeFixedBoolNode,
    create: ({ position, createId }) => ({
      id: createId('fixed-bool'),
      type: 'workflow',
      position,
      data: {
        label: 'Fixed Bool',
        description: 'Boolean workflow parameter',
        preview: '',
        nodeType: 'fixed-bool',
        fixedBoolValue: false,
      },
    }),
  },
  {
    type: 'settings-value',
    dataVersion: currentCoreNodeVersions['settings-value'],
    label: 'Workflow Variable',
    description: 'Output values configured in Options',
    menuDescription: 'Output centrally configured variables',
    origin: 'core',
    ports: (data) => settingsValueEntries(data).map((entry) =>
      output(settingsValueHandle(entry.id), 'mixed', entry.label),
    ),
    Component: SettingsValueNodeCard,
    execute: executeSettingsValueNode,
    create: ({ position, createId }) => ({
      id: createId('settings-value'),
      type: 'workflow',
      position,
      data: {
        label: 'Workflow Variable',
        description: 'Output values configured in Options',
        preview: 'Values are edited in Options',
        nodeType: 'settings-value',
        settingsValueEntries: [{
          id: 'context-length-max',
          optionKey: contextLengthMaxOptionKey,
          label: 'Context Length Max',
        }],
      },
    }),
  },
  {
    type: 'rp-storybook-v1',
    dataVersion: currentCoreNodeVersions['rp-storybook-v1'],
    label: 'RP Storybook V1',
    description: 'Complete roleplay storybook',
    menuDescription: 'Load or create complete roleplay story data',
    origin: 'core',
    singleton: true,
    usesLlm: true,
    requiresPreparedInputEdge: true,
    ports: () => [
      output('json', 'json', 'JSON'),
      output('formatted-text', 'text', 'Formatted Text'),
      output('character-info', 'text', 'Character Info'),
    ],
    Component: RpStorybookV1NodeCard,
    execute: executeRpStorybookV1Node,
    create: ({ defaultConnectionId, position, createId }) => ({
      id: createId('rp-storybook-v1'),
      type: 'workflow',
      position,
      style: { width: coreNodeLayout.rpStorybookWidth },
      data: {
        label: 'RP Storybook V1',
        description: 'Complete roleplay storybook',
        preview: 'No storybook loaded',
        nodeType: 'rp-storybook-v1',
        connectionId: defaultConnectionId,
        storybookJson: rpStorybookJsonText(emptyRpStorybookV1),
        storybookStatus: 'Ready',
        storybookFormattedTextSettings: defaultRpStorybookFormattedTextSettings,
      },
    }),
  },
  {
    type: 'output',
    dataVersion: currentCoreNodeVersions['output'],
    label: 'RP Output',
    description: 'Roleplay response',
    menuDescription: 'Single chat output',
    origin: 'core',
    singleton: true,
    usesLlm: true,
    ports: () => [
      input('default', 'text', 'Normal RP'),
      input('phone-message', 'text', 'Phone Message'),
      input('output-actions', 'mixed', 'Output Actions'),
      input('highlighting-context', 'text', 'Highlighting Context'),
    ],
    Component: OutputNodeCard,
    execute: executeOutputNode,
    create: ({ defaultConnectionId, position }) => ({
      id: 'rp-output',
      type: 'workflow',
      position,
      data: {
        label: 'RP Output',
        description: 'Roleplay response',
        preview: 'No output yet',
        nodeType: 'output',
        connectionId: defaultConnectionId,
        streamOutputEnabled: false,
        speakerAnalysisEnabled: false,
        dialogueHighlightEnabled: false,
        outputSpeakerResponseFormat: defaultOutputSpeakerResponseFormat,
        outputSpeakerPrompt: defaultOutputSpeakerPromptSettings(),
      },
    }),
  },
];

export const coreNodeDefinitions: CoreNodeCreationDefinition[] =
  coreNodeCreationDefinitions.map((definition) => ({
    ...definition,
    saveData: (data) => ({
      ...corePersistence[definition.type].saveData(data),
      nodeDataVersion: definition.dataVersion,
    }),
    hydrateData: (data, context) => ({
      ...corePersistence[definition.type].hydrateData(data, context),
      nodeDataVersion: definition.dataVersion,
    }),
  }));
