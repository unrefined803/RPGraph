import type { WorkflowNodeData } from '../types';
import {
  combinerInputCount,
  combinerPrefixes,
  characterStatDefinitions,
  characterStatsMaxChange,
  llmDecisionOutputToggles,
  llmDecisionQuestions,
  llmPromptSwitchOutputTitles,
  llmPromptSwitchPromptAftersByOutput,
  llmPromptSwitchPromptBeforesByOutput,
  llmPromptSwitchPromptTitlesByOutput,
  llmPromptSwitchSelectedOutputChannel,
  llmPromptSwitchSelectedPromptSlot,
  settingsValueEntries,
  textReplaceEntries,
  textSelectorInputCount,
  textSelectorMode,
  textRouterMode,
  textRouterNumberOutputCount,
} from '../workflow/nodeHelpers';
import { autoTurnInstructionSaveSettings, autoTurnInstructionSettings } from '../chat/instructions';
import { eventManagerPromptSaveSettings, eventManagerPromptSettings } from './event-manager/prompt';
import { historyRpTimePromptSaveSettings, historyRpTimePromptSettings } from './history/rpTimePrompt';
import {
  outputSpeakerPromptSaveSettings,
  outputSpeakerPromptSettings,
  outputSpeakerResponseFormat,
} from './output/speakerPrompt';
import {
  defaultContextCompressionLengthWords,
  defaultContextCompressionRatio,
  defaultContextCompressionTokenLimit,
} from '../workflow/defaults';
import {
  emptyRpStorybookV1,
  parseRpStorybookJson,
  rpStorybookFormattedTextSettings,
  rpStorybookJsonText,
} from './rp-storybook-v1/model';
import type { CoreNodeType, HydrateContext } from './types';
import { customNodeDefinition } from './custom-node/model';
import { lastRpOutputPersistence } from './last-rp-output/persistence';
import { lastUserInputPersistence } from './last-user-input/persistence';
import { promptActionConfigs, promptActionSaveConfigs } from './shared/promptActions';
import { promptCommandConfigs, promptCommandSaveConfigs } from './shared/promptCommands';

export type CorePersistence = {
  saveData: (data: WorkflowNodeData) => WorkflowNodeData;
  hydrateData: (data: WorkflowNodeData, context: HydrateContext) => WorkflowNodeData;
};

function baseData(data: WorkflowNodeData, preview: string): WorkflowNodeData {
  return {
    nodeType: data.nodeType,
    label: data.label,
    description: data.description,
    preview,
  } as WorkflowNodeData;
}

function connectionId(data: WorkflowNodeData, context: HydrateContext) {
  return data.connectionId && context.connectionIds.has(data.connectionId)
    ? data.connectionId
    : context.defaultConnectionId;
}

function preservedData(data: WorkflowNodeData, preview: string, fields: Partial<WorkflowNodeData>) {
  return { ...baseData(data, preview), ...fields } as WorkflowNodeData;
}

export const corePersistence: Record<CoreNodeType, CorePersistence> = {
  input: {
    saveData: (data) => preservedData(data, 'Waiting for input ...', {
      connectionId: data.connectionId,
      autoTurnInstructions: autoTurnInstructionSaveSettings(data.autoTurnInstructions),
    }),
    hydrateData: (data, context) => preservedData(data, 'Waiting for input ...', {
      connectionId: connectionId(data, context),
      autoTurnInstructions: autoTurnInstructionSettings(data.autoTurnInstructions),
    }),
  },
  note: {
    saveData: (data) => preservedData(data, data.noteText?.trim() ? 'Note written' : 'Empty note', {
      noteText: data.noteText ?? '',
      noteFontSize: data.noteFontSize ?? 14,
    }),
    hydrateData: (data) => preservedData(data, data.noteText?.trim() ? 'Note written' : 'Empty note', {
      noteText: data.noteText ?? '',
      noteFontSize: data.noteFontSize ?? 14,
    }),
  },
  group: {
    saveData: (data) => {
      const title = data.groupTitle?.trim() || data.label || 'Node Group';
      return preservedData(data, 'Group header', {
        label: title,
        groupTitle: title,
      });
    },
    hydrateData: (data) => {
      const title = data.groupTitle?.trim() || data.label || 'Node Group';
      return preservedData(data, 'Group header', {
        label: title,
        groupTitle: title,
      });
    },
  },
  custom: {
    saveData: (data) => preservedData(data, 'Ready for Node Assistant', {
      connectionId: data.connectionId,
      customNodeDefinition: customNodeDefinition(data.customNodeDefinition),
      runAfterRpOutput: data.runAfterRpOutput ?? false,
    }),
    hydrateData: (data, context) => preservedData(data, 'Ready for Node Assistant', {
      connectionId: connectionId(data, context),
      customNodeDefinition: customNodeDefinition(data.customNodeDefinition),
      runAfterRpOutput: data.runAfterRpOutput ?? false,
    }),
  },
  'last-user-input': lastUserInputPersistence,
  'last-rp-output': lastRpOutputPersistence,
  'event-manager': {
    saveData: (data) => preservedData(data, 'No event context connected', {
      connectionId: data.connectionId,
      eventStatus: 'Waiting for event update',
      eventManagerPrompt: eventManagerPromptSaveSettings(data.eventManagerPrompt),
      runAfterRpOutput: data.runAfterRpOutput ?? true,
    }),
    hydrateData: (data, context) => preservedData(data, 'No event context connected', {
      connectionId: connectionId(data, context),
      eventStatus: 'Waiting for event update',
      eventManagerPrompt: eventManagerPromptSettings(data.eventManagerPrompt),
      runAfterRpOutput: data.runAfterRpOutput ?? true,
    }),
  },
  history: {
    saveData: (data) => preservedData(data, 'No conversation yet', {
      connectionId: data.connectionId,
      historyTimeTrackingEnabled: data.historyTimeTrackingEnabled ?? false,
      historyTimeStatus: data.historyTimeTrackingEnabled ? 'Waiting for RP time update' : 'RP Time: Disabled',
      historyLastTurnsCount: data.historyLastTurnsCount ?? 5,
      historyRpTimePrompt: historyRpTimePromptSaveSettings(data.historyRpTimePrompt),
      runAfterRpOutput: data.runAfterRpOutput ?? true,
    }),
    hydrateData: (data, context) => preservedData(data, 'No conversation yet', {
      connectionId: connectionId(data, context),
      historyTimeTrackingEnabled: data.historyTimeTrackingEnabled ?? false,
      historyTimeStatus: data.historyTimeTrackingEnabled ? 'Waiting for RP time update' : 'RP Time: Disabled',
      historyLastTurnsCount: data.historyLastTurnsCount ?? 5,
      historyRpTimePrompt: historyRpTimePromptSettings(data.historyRpTimePrompt),
      runAfterRpOutput: data.runAfterRpOutput ?? true,
    }),
  },
  'phone-message-router': {
    saveData: (data) => preservedData(data, 'Waiting for routed text ...', {
      textRouterMode: textRouterMode(data),
      textRouterNumberOutputCount: textRouterNumberOutputCount(data),
      fullText: '',
    }),
    hydrateData: (data) => preservedData(data, 'Waiting for routed text ...', {
      textRouterMode: textRouterMode(data),
      textRouterNumberOutputCount: textRouterNumberOutputCount(data),
      fullText: '',
    }),
  },
  'text-selector': {
    saveData: (data) => preservedData(data, 'Waiting for selected text ...', {
      textSelectorMode: textSelectorMode(data),
      textSelectorInputCount: textSelectorInputCount(data),
      fullText: '',
    }),
    hydrateData: (data) => preservedData(data, 'Waiting for selected text ...', {
      textSelectorMode: textSelectorMode(data),
      textSelectorInputCount: textSelectorInputCount(data),
      fullText: '',
    }),
  },
  'llm-prompt': {
    saveData: (data) => preservedData(data, 'Not run yet', {
      llmPromptBefore: data.llmPromptBefore,
      llmPromptAfter: data.llmPromptAfter,
      llmPromptAutoFormatJson: data.llmPromptAutoFormatJson ?? true,
      llmPromptActions: promptActionSaveConfigs(data.llmPromptActions),
      llmPromptCommands: promptCommandSaveConfigs(data.llmPromptCommands),
      connectionId: data.connectionId,
      runAfterRpOutput: data.runAfterRpOutput ?? false,
    }),
    hydrateData: (data, context) => preservedData(data, 'Not run yet', {
      llmPromptBefore: data.llmPromptBefore,
      llmPromptAfter: data.llmPromptAfter,
      llmPromptAutoFormatJson: data.llmPromptAutoFormatJson ?? true,
      llmPromptActions: promptActionConfigs(data.llmPromptActions),
      llmPromptCommands: promptCommandConfigs(data.llmPromptCommands),
      connectionId: connectionId(data, context),
      runAfterRpOutput: data.runAfterRpOutput ?? false,
    }),
  },
  'llm-prompt-switch': {
    saveData: (data) => preservedData(data, 'Not run yet', {
      llmPromptSwitchOutputTitles: llmPromptSwitchOutputTitles(data),
      llmPromptSwitchPromptTitlesByOutput: llmPromptSwitchPromptTitlesByOutput(data),
      llmPromptSwitchPromptBeforesByOutput: llmPromptSwitchPromptBeforesByOutput(data),
      llmPromptSwitchPromptAftersByOutput: llmPromptSwitchPromptAftersByOutput(data),
      llmPromptSwitchSelectedOutputChannel: llmPromptSwitchSelectedOutputChannel(data),
      llmPromptSwitchSelectedPromptSlot: llmPromptSwitchSelectedPromptSlot(data),
      llmPromptSwitchAutoShowPrompt: data.llmPromptSwitchAutoShowPrompt ?? true,
      llmPromptSwitchAutoFormatJson: data.llmPromptSwitchAutoFormatJson ?? true,
      llmPromptActions: promptActionSaveConfigs(data.llmPromptActions),
      llmPromptCommands: promptCommandSaveConfigs(data.llmPromptCommands),
      connectionId: data.connectionId,
      runAfterRpOutput: data.runAfterRpOutput ?? false,
    }),
    hydrateData: (data, context) => preservedData(data, 'Not run yet', {
      llmPromptSwitchOutputTitles: llmPromptSwitchOutputTitles(data),
      llmPromptSwitchPromptTitlesByOutput: llmPromptSwitchPromptTitlesByOutput(data),
      llmPromptSwitchPromptBeforesByOutput: llmPromptSwitchPromptBeforesByOutput(data),
      llmPromptSwitchPromptAftersByOutput: llmPromptSwitchPromptAftersByOutput(data),
      llmPromptSwitchSelectedOutputChannel: llmPromptSwitchSelectedOutputChannel(data),
      llmPromptSwitchSelectedPromptSlot: llmPromptSwitchSelectedPromptSlot(data),
      llmPromptSwitchAutoShowPrompt: data.llmPromptSwitchAutoShowPrompt ?? true,
      llmPromptSwitchAutoFormatJson: data.llmPromptSwitchAutoFormatJson ?? true,
      llmPromptActions: promptActionConfigs(data.llmPromptActions),
      llmPromptCommands: promptCommandConfigs(data.llmPromptCommands),
      connectionId: connectionId(data, context),
      runAfterRpOutput: data.runAfterRpOutput ?? false,
    }),
  },
  combiner: {
    saveData: (data) => {
      const count = combinerInputCount(data);
      return preservedData(data, `Waiting for ${count} inputs ...`, {
        combinerInputCount: count,
        combinerPrefixes: combinerPrefixes(data),
      });
    },
    hydrateData: (data) => {
      const count = combinerInputCount(data);
      return preservedData(data, `Waiting for ${count} inputs ...`, {
        description: 'Merge ordered text inputs',
        combinerInputCount: count,
        combinerPrefixes: combinerPrefixes(data),
      });
    },
  },
  'text-replace': {
    saveData: (data) => preservedData(data, data.preview, {
      textReplaceEntries: textReplaceEntries(data),
    }),
    hydrateData: (data) => preservedData(data, data.preview, {
      textReplaceEntries: textReplaceEntries(data),
    }),
  },
  'load-text': {
    saveData: (data) => preservedData(data, data.preview, {
      loadedText: data.loadedText ?? '',
      loadedFileName: data.loadedFileName,
      loadTextWrapPreview: data.loadTextWrapPreview ?? true,
    }),
    hydrateData: (data) => preservedData(data, data.preview, {
      loadedText: data.loadedText ?? '',
      loadedFileName: data.loadedFileName,
      loadTextWrapPreview: data.loadTextWrapPreview ?? true,
    }),
  },
  'write-text': {
    saveData: (data) => preservedData(data, data.writeTextValue ? 'Text ready' : 'No text written', {
      writeTextValue: data.writeTextValue ?? '',
    }),
    hydrateData: (data) => preservedData(data, data.writeTextValue ? 'Text ready' : 'No text written', {
      writeTextValue: data.writeTextValue ?? '',
    }),
  },
  'memory-slot': {
    saveData: (data) => preservedData(data, 'No stored text yet', {
      memorySlotName: data.memorySlotName,
      memorySlotText: '',
      memorySlotMode: data.memorySlotMode,
      fullText: '',
    }),
    hydrateData: (data) => preservedData(data, 'No stored text yet', {
      memorySlotName: data.memorySlotName,
      memorySlotText: '',
      memorySlotMode: data.memorySlotMode,
      fullText: '',
    }),
  },
  'text-preview': {
    saveData: (data) => baseData(data, 'Waiting for text ...'),
    hydrateData: (data) => baseData(data, 'Waiting for text ...'),
  },
  'context-builder': {
    saveData: (data) => preservedData(data, 'Connect up to five text inputs, then load', {
      contextBuilderItems: data.contextBuilderItems ?? [],
      contextBuilderStatus: 'Loaded from workflow',
    }),
    hydrateData: (data) => preservedData(data, 'Connect up to five text inputs, then load', {
      contextBuilderItems: data.contextBuilderItems ?? [],
      contextBuilderStatus: data.contextBuilderItems?.length ? 'Loaded from workflow' : 'Not loaded yet',
    }),
  },
  'llm-decision': {
    saveData: (data) => preservedData(data, 'Not run yet', {
      connectionId: data.connectionId,
      runAfterRpOutput: data.runAfterRpOutput ?? true,
      llmDecisionQuestions: llmDecisionQuestions(data),
      llmDecisionOutputToggles: llmDecisionOutputToggles(data),
    }),
    hydrateData: (data, context) => preservedData(data, 'Not run yet', {
      connectionId: connectionId(data, context),
      runAfterRpOutput: data.runAfterRpOutput ?? true,
      llmDecisionQuestions: llmDecisionQuestions(data),
      llmDecisionOutputToggles: llmDecisionOutputToggles(data),
    }),
  },
  'context-compression': {
    saveData: (data) => preservedData(data, 'Waiting for text ...', {
      connectionId: data.connectionId,
      contextCompressionMaxTokens: data.contextCompressionMaxTokens,
      contextCompressionRatio: data.contextCompressionRatio,
      contextCompressionLengthWords: data.contextCompressionLengthWords,
      runAfterRpOutput: data.runAfterRpOutput ?? data.compressAfterOutput ?? false,
    }),
    hydrateData: (data, context) => preservedData(data, 'Waiting for text ...', {
      connectionId: connectionId(data, context),
      contextCompressionMaxTokens:
        data.contextCompressionMaxTokens ?? defaultContextCompressionTokenLimit,
      contextCompressionRatio:
        data.contextCompressionRatio ?? defaultContextCompressionRatio,
      contextCompressionLengthWords:
        data.contextCompressionLengthWords ?? defaultContextCompressionLengthWords,
      runAfterRpOutput: data.runAfterRpOutput ?? data.compressAfterOutput ?? false,
    }),
  },
  'character-stats': {
    saveData: (data) => preservedData(data, 'Waiting for automatic initialization', {
      connectionId: data.connectionId,
      characterStatDefinitions: characterStatDefinitions(data),
      characterStatsMaxChange: characterStatsMaxChange(data),
      characterStatsStatus: 'Initializes from connected context',
      characterStatsPrimaryId: data.characterStatsPrimaryId,
      runAfterRpOutput: data.runAfterRpOutput ?? true,
    }),
    hydrateData: (data, context) => preservedData(data, 'Waiting for automatic initialization', {
      connectionId: connectionId(data, context),
      characterStatDefinitions: characterStatDefinitions(data),
      characterStatsMaxChange: characterStatsMaxChange(data),
      characterStatsStatus: 'Initializes from connected context',
      characterStatsPrimaryId: data.characterStatsPrimaryId,
      runAfterRpOutput: data.runAfterRpOutput ?? true,
    }),
  },
  'fixed-number': {
    saveData: (data) => preservedData(data, data.preview, {
      fixedNumberValue: data.fixedNumberValue ?? defaultContextCompressionTokenLimit,
    }),
    hydrateData: (data) => preservedData(data, data.preview, {
      fixedNumberValue: data.fixedNumberValue ?? defaultContextCompressionTokenLimit,
    }),
  },
  'fixed-bool': {
    saveData: (data) => preservedData(data, data.preview, {
      fixedBoolValue: data.fixedBoolValue ?? false,
    }),
    hydrateData: (data) => preservedData(data, data.preview, {
      fixedBoolValue: data.fixedBoolValue ?? false,
    }),
  },
  'settings-value': {
    saveData: (data) => preservedData(data, 'Values are edited in Options', {
      settingsValueEntries: settingsValueEntries(data),
    }),
    hydrateData: (data) => preservedData(data, 'Values are edited in Options', {
      settingsValueEntries: settingsValueEntries(data),
    }),
  },
  'rp-storybook-v1': {
    saveData: (data) => {
      const storybook = data.storybookJson
        ? parseRpStorybookJson(data.storybookJson)
        : emptyRpStorybookV1;
      return preservedData(data, 'No storybook loaded', {
        connectionId: data.connectionId,
        storybookJson: rpStorybookJsonText(storybook),
        storybookStatus: storybook.title ? 'Embedded storybook' : 'Ready',
        storybookFormattedTextSettings: rpStorybookFormattedTextSettings(data.storybookFormattedTextSettings),
      });
    },
    hydrateData: (data, context) => {
      const storybook = data.storybookJson
        ? parseRpStorybookJson(data.storybookJson)
        : emptyRpStorybookV1;
      return preservedData(data, 'No storybook loaded', {
        connectionId: connectionId(data, context),
        storybookJson: rpStorybookJsonText(storybook),
        storybookStatus: storybook.title ? 'Loaded embedded storybook' : 'Ready',
        storybookFormattedTextSettings: rpStorybookFormattedTextSettings(data.storybookFormattedTextSettings),
      });
    },
  },
  'rp-storybook-editor': {
    saveData: (data) => {
      const storybook = data.storybookJson
        ? parseRpStorybookJson(data.storybookJson)
        : emptyRpStorybookV1;
      return preservedData(data, 'No storybook loaded', {
        storybookJson: rpStorybookJsonText(storybook),
        storybookStatus: storybook.title ? 'Embedded storybook' : 'Ready',
        storybookFormattedTextSettings: rpStorybookFormattedTextSettings(data.storybookFormattedTextSettings),
      });
    },
    hydrateData: (data) => {
      const storybook = data.storybookJson
        ? parseRpStorybookJson(data.storybookJson)
        : emptyRpStorybookV1;
      return preservedData(data, 'No storybook loaded', {
        storybookJson: rpStorybookJsonText(storybook),
        storybookStatus: storybook.title ? 'Loaded embedded storybook' : 'Ready',
        storybookFormattedTextSettings: rpStorybookFormattedTextSettings(data.storybookFormattedTextSettings),
      });
    },
  },
  output: {
    saveData: (data) => preservedData(data, 'No output yet', {
      connectionId: data.connectionId,
      streamOutputEnabled: data.streamOutputEnabled ?? false,
      speakerAnalysisEnabled: data.speakerAnalysisEnabled ?? false,
      dialogueHighlightEnabled:
        (data.speakerAnalysisEnabled ?? false) && (data.dialogueHighlightEnabled ?? false),
      outputSpeakerResponseFormat: outputSpeakerResponseFormat(data.outputSpeakerResponseFormat),
      outputSpeakerPrompt: outputSpeakerPromptSaveSettings(data.outputSpeakerPrompt),
    }),
    hydrateData: (data, context) => preservedData(data, 'No output yet', {
      connectionId: connectionId(data, context),
      streamOutputEnabled: data.streamOutputEnabled ?? false,
      speakerAnalysisEnabled: data.speakerAnalysisEnabled ?? false,
      dialogueHighlightEnabled:
        (data.speakerAnalysisEnabled ?? false) && (data.dialogueHighlightEnabled ?? false),
      outputSpeakerResponseFormat: outputSpeakerResponseFormat(data.outputSpeakerResponseFormat),
      outputSpeakerPrompt: outputSpeakerPromptSettings(data.outputSpeakerPrompt),
    }),
  },
  'phone-apps': {
    saveData: (data) => preservedData(data, 'Used directly by phone apps', {
      connectionId: data.connectionId,
      phoneAppsNotesConnectionId: data.phoneAppsNotesConnectionId,
    }),
    hydrateData: (data, context) => preservedData(data, 'Used directly by phone apps', {
      connectionId: connectionId(data, context),
      phoneAppsNotesConnectionId:
        data.phoneAppsNotesConnectionId && context.connectionIds.has(data.phoneAppsNotesConnectionId)
          ? data.phoneAppsNotesConnectionId
          : context.defaultConnectionId,
    }),
  },
};
