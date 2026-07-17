import type {
  CharacterStatDefinition,
  CharacterStatsChanges,
  CharacterStatsState,
  CharacterStatsTimelineEntry,
  RpAppointment,
  WorkflowFile,
  WorkflowNode,
  WorkflowNodeData,
  WorkflowNodeType,
} from '../types';
import type { RpgraphSessionV2 } from '../data-management/types';
import { isRpgraphSessionV2 } from '../data-management/validation';
import { isMissingPluginTypeId } from '../nodes/extensions/typeIdPolicy';
import { coreNodeTypes } from '../nodes/coreNodeTypes';
import {
  areNodeVersionsCompatible,
  currentCoreNodeVersions,
  isNodeVersion,
} from '../nodes/nodeVersion';
import { isCustomNodeDefinition } from '../nodes/custom-node/model';
import { isPromptActionConfig } from '../nodes/shared/promptActions';
import { isPromptCommandConfig } from '../nodes/shared/promptCommands';
import { contextBuilderInputCount } from './defaults';
import {
  isCurrentWorkflowFormatVersion,
} from './version';

const workflowNodeTypes = new Set<WorkflowNodeType>(coreNodeTypes);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function isOptionalBoolean(value: unknown) {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalFiniteNumber(value: unknown) {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalFiniteNumberOrString(value: unknown) {
  return isOptionalFiniteNumber(value) || typeof value === 'string';
}

function isWireLinkMode(value: unknown) {
  return value === 'joined' || value === 'input' || value === 'output';
}

function isTextRouterMode(value: unknown) {
  return value === 'bool' || value === 'number';
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isStringMatrix(value: unknown) {
  return Array.isArray(value) && value.every(isStringArray);
}

function isPromptActionConfigArray(value: unknown) {
  return Array.isArray(value) && value.every(isPromptActionConfig);
}

function isPromptCommandConfigArray(value: unknown) {
  return Array.isArray(value) && value.every(isPromptCommandConfig);
}

function isBooleanArray(value: unknown) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'boolean');
}

function isNumberArray(value: unknown) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function isStringRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function isRpAppointment(value: unknown): value is RpAppointment {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isOptionalString(value.scheduledAt) &&
    typeof value.title === 'string' &&
    isOptionalString(value.condition) &&
    isOptionalString(value.details) &&
    (value.channel === undefined || value.channel === 'chat' || value.channel === 'phone') &&
    isOptionalString(value.phoneFrom) &&
    isOptionalString(value.phoneTo) &&
    isOptionalString(value.phoneRequester) &&
    isOptionalString(value.phoneMessenger) &&
    isOptionalString(value.phoneRecipient) &&
    isOptionalString(value.phoneAction) &&
    isOptionalString(value.requestedBy) &&
    isOptionalString(value.assignedTo) &&
    typeof value.sourceTurnId === 'string' &&
    isOptionalFiniteNumber(value.sourceTurnNumber) &&
    isOptionalString(value.sourceNote) &&
    (value.status === 'upcoming' || value.status === 'completed' || value.status === 'cancelled')
  );
}

function isLlmDecisionOutputTogglesArray(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every((entry) =>
      isRecord(entry) &&
      typeof entry.bool === 'boolean' &&
      typeof entry.text === 'boolean' &&
      typeof entry.number === 'boolean',
    )
  );
}

function isRpStorybookFormattedTextSettings(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.title === 'boolean' &&
    typeof value.introduction === 'boolean' &&
    typeof value.scenario === 'boolean' &&
    typeof value.characters === 'boolean' &&
    typeof value.openingHistory === 'boolean' &&
    typeof value.characterImages === 'boolean'
  );
}

function isCharacterStatDefinition(value: unknown): value is CharacterStatDefinition {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.enabled === 'boolean'
  );
}

function isLlmCallStatsArray(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every(
      (call) =>
        isRecord(call) &&
        typeof call.label === 'string' &&
        typeof call.durationMs === 'number' &&
        Number.isFinite(call.durationMs) &&
        isOptionalFiniteNumber(call.inputTokens) &&
        isOptionalFiniteNumber(call.outputTokens) &&
        isOptionalFiniteNumber(call.reasoningTokens) &&
        isOptionalFiniteNumber(call.totalTokens),
    )
  );
}

function isContextBuilderItem(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sourceIndex === 'number' &&
    Number.isInteger(value.sourceIndex) &&
    value.sourceIndex >= 0 &&
    value.sourceIndex < contextBuilderInputCount &&
    typeof value.sourceLabel === 'string' &&
    typeof value.fieldPath === 'string' &&
    typeof value.fieldLabel === 'string' &&
    typeof value.value === 'string' &&
    typeof value.enabled === 'boolean'
  );
}

function isAutoTurnInstructionSettings(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  return ['character-rp', 'character-phone', 'narrator-rp', 'narrator-phone'].every((key) => {
    const entry = value[key];
    return (
      entry === undefined ||
      (
        isRecord(entry) &&
        (entry.mode === 'default' || entry.mode === 'custom') &&
        isOptionalString(entry.customText)
      )
    );
  });
}

function isEventManagerPromptSettings(value: unknown) {
  return (
    isRecord(value) &&
    (value.mode === 'default' || value.mode === 'custom') &&
    isOptionalString(value.customText)
  );
}

function isHistoryRpTimePromptSettings(value: unknown) {
  return (
    isRecord(value) &&
    (value.mode === 'default' || value.mode === 'custom') &&
    isOptionalString(value.customText)
  );
}

function isOutputSpeakerPromptSettings(value: unknown) {
  return (
    isRecord(value) &&
    (value.mode === 'default' || value.mode === 'custom') &&
    isOptionalString(value.customText)
  );
}

function isPortSnapshot(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.direction === 'input' || value.direction === 'output') &&
    typeof value.valueType === 'string' &&
    typeof value.label === 'string' &&
    isOptionalBoolean(value.multiple)
  );
}

function isWorkflowNodeData(value: unknown): value is WorkflowNodeData {
  if (
    !isRecord(value) ||
    typeof value.label !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.preview !== 'string' ||
    typeof value.nodeType !== 'string' ||
    !isNodeVersion(value.nodeDataVersion)
  ) {
    return false;
  }

  if (!workflowNodeTypes.has(value.nodeType as WorkflowNodeType)) {
    return (
      isMissingPluginTypeId(value.nodeType) &&
      Array.isArray(value.portsSnapshot) &&
      value.portsSnapshot.every(isPortSnapshot)
    );
  }

  if (
    !areNodeVersionsCompatible(
      value.nodeDataVersion,
      currentCoreNodeVersions[value.nodeType as WorkflowNodeType],
    )
  ) {
    // Incompatible core nodes only need enough shape to be preserved and rendered as incompatible.
    return true;
  }

  if (
    !isOptionalString(value.llmPromptBefore) ||
    !isOptionalString(value.llmPromptAfter) ||
    !isOptionalBoolean(value.llmPromptAutoFormatJson) ||
    (value.llmPromptActions !== undefined && !isPromptActionConfigArray(value.llmPromptActions)) ||
    (value.llmPromptCommands !== undefined && !isPromptCommandConfigArray(value.llmPromptCommands)) ||
    (value.llmPromptSwitchOutputTitles !== undefined && !isStringArray(value.llmPromptSwitchOutputTitles)) ||
    (value.llmPromptSwitchPromptTitlesByOutput !== undefined && !isStringMatrix(value.llmPromptSwitchPromptTitlesByOutput)) ||
    (value.llmPromptSwitchPromptBeforesByOutput !== undefined && !isStringMatrix(value.llmPromptSwitchPromptBeforesByOutput)) ||
    (value.llmPromptSwitchPromptAftersByOutput !== undefined && !isStringMatrix(value.llmPromptSwitchPromptAftersByOutput)) ||
    !isOptionalFiniteNumber(value.llmPromptSwitchSelectedOutputChannel) ||
    !isOptionalFiniteNumber(value.llmPromptSwitchSelectedPromptSlot) ||
    !isOptionalBoolean(value.llmPromptSwitchAutoShowPrompt) ||
    !isOptionalBoolean(value.llmPromptSwitchAutoFormatJson) ||
    !isOptionalString(value.connectionId) ||
    (value.autoTurnInstructions !== undefined &&
      !isAutoTurnInstructionSettings(value.autoTurnInstructions)) ||
    !isOptionalBoolean(value.runCompleted) ||
    !isOptionalBoolean(value.runPrepared) ||
    !isOptionalString(value.runError) ||
    !isOptionalBoolean(value.streamOutputEnabled) ||
    !isOptionalBoolean(value.speakerAnalysisEnabled) ||
    !isOptionalBoolean(value.dialogueHighlightEnabled) ||
    (value.outputSpeakerResponseFormat !== undefined &&
      value.outputSpeakerResponseFormat !== 'toon' &&
      value.outputSpeakerResponseFormat !== 'json') ||
    (value.outputSpeakerPrompt !== undefined &&
      !isOutputSpeakerPromptSettings(value.outputSpeakerPrompt)) ||
    !isOptionalString(value.inputAPreview) ||
    !isOptionalString(value.inputBPreview) ||
    !isOptionalString(value.writeTextValue) ||
    !isOptionalBoolean(value.fixedBoolValue) ||
    (value.textRouterMode !== undefined && !isTextRouterMode(value.textRouterMode)) ||
    !isOptionalFiniteNumber(value.textRouterNumberOutputCount) ||
    (value.textSelectorMode !== undefined && !isTextRouterMode(value.textSelectorMode)) ||
    !isOptionalFiniteNumber(value.textSelectorInputCount) ||
    !isOptionalFiniteNumber(value.combinerInputCount) ||
    (value.combinerPrefixes !== undefined && !isStringArray(value.combinerPrefixes)) ||
    (value.combinerInputPreviews !== undefined && !isStringArray(value.combinerInputPreviews)) ||
    (value.textReplaceEntries !== undefined &&
      (!Array.isArray(value.textReplaceEntries) ||
        !value.textReplaceEntries.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.id === 'string' &&
            typeof entry.source === 'string' &&
            typeof entry.replacement === 'string',
        ))) ||
    (value.llmDecisionQuestions !== undefined && !isStringArray(value.llmDecisionQuestions)) ||
    (value.llmDecisionOutputToggles !== undefined &&
      !isLlmDecisionOutputTogglesArray(value.llmDecisionOutputToggles)) ||
    (value.llmDecisionBoolResults !== undefined && !isBooleanArray(value.llmDecisionBoolResults)) ||
    (value.llmDecisionTextResults !== undefined && !isStringArray(value.llmDecisionTextResults)) ||
    (value.llmDecisionNumberResults !== undefined && !isNumberArray(value.llmDecisionNumberResults)) ||
    !isOptionalString(value.outputHighlightingInputToon) ||
    !isOptionalString(value.outputHighlightingResponseToon) ||
    !isOptionalString(value.outputHighlightingResultToon) ||
    !isOptionalString(value.fullText) ||
    !isOptionalString(value.memorySlotName) ||
    !isOptionalString(value.memorySlotText) ||
    (value.memorySlotMode !== undefined && !isWireLinkMode(value.memorySlotMode)) ||
    (value.nodeType === 'memory-slot' &&
      (
        typeof value.memorySlotName !== 'string' ||
        typeof value.memorySlotText !== 'string' ||
        !isWireLinkMode(value.memorySlotMode)
      )) ||
    !isOptionalString(value.generatedText) ||
    !isOptionalString(value.rawHistory) ||
    !isOptionalString(value.originalHistory) ||
    !isOptionalString(value.translatedHistory) ||
    !isOptionalString(value.lastTurnsHistory) ||
    !isOptionalBoolean(value.historyTimeTrackingEnabled) ||
    !isOptionalString(value.historyCurrentRpDateTime) ||
    (value.historyProcessedTurnIds !== undefined && !isStringArray(value.historyProcessedTurnIds)) ||
    !isOptionalFiniteNumber(value.historyLastTurnsCount) ||
    !isOptionalString(value.historyTimeStatus) ||
    !isOptionalString(value.historyLastPrompt) ||
    !isOptionalString(value.historyLastResponse) ||
    (value.historyRpTimePrompt !== undefined &&
      !isHistoryRpTimePromptSettings(value.historyRpTimePrompt)) ||
    (value.eventAppointments !== undefined &&
      (!Array.isArray(value.eventAppointments) ||
        !value.eventAppointments.every(isRpAppointment))) ||
    (value.eventProcessedTurnIds !== undefined && !isStringArray(value.eventProcessedTurnIds)) ||
    !isOptionalString(value.eventStatus) ||
    !isOptionalString(value.eventLastPrompt) ||
    !isOptionalString(value.eventLastResponse) ||
    (value.eventManagerPrompt !== undefined &&
      !isEventManagerPromptSettings(value.eventManagerPrompt)) ||
    !isOptionalFiniteNumberOrString(value.contextCompressionMaxTokens) ||
    !isOptionalFiniteNumber(value.contextCompressionRatio) ||
    !isOptionalFiniteNumberOrString(value.contextCompressionLengthWords) ||
    !isOptionalBoolean(value.compressAfterOutput) ||
    !isOptionalBoolean(value.runAfterRpOutput) ||
    !isOptionalFiniteNumber(value.displayTokenBytesPerToken) ||
    !isOptionalString(value.compressedText) ||
    !isOptionalString(value.compressionSourceText) ||
    !isOptionalString(value.compressionRemainingText) ||
    !isOptionalFiniteNumber(value.contextTokenLimit) ||
    !isOptionalFiniteNumber(value.resolvedContextTokenLimit) ||
    !isOptionalBoolean(value.hasContextLimitConnection) ||
    !isOptionalFiniteNumberOrString(value.fixedNumberValue) ||
    (value.settingsValueEntries !== undefined &&
      (!Array.isArray(value.settingsValueEntries) ||
        !value.settingsValueEntries.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.id === 'string' &&
            typeof entry.optionKey === 'string' &&
            typeof entry.label === 'string',
        ))) ||
    !isOptionalString(value.loadedText) ||
    !isOptionalString(value.loadedFileName) ||
    !isOptionalBoolean(value.loadTextWrapPreview) ||
    !isOptionalString(value.contextBuilderStatus) ||
    (value.contextBuilderItems !== undefined &&
      (!Array.isArray(value.contextBuilderItems) ||
        !value.contextBuilderItems.every(isContextBuilderItem))) ||
    !isOptionalString(value.storybookJson) ||
    !isOptionalString(value.storybookStatus) ||
    !isOptionalString(value.storybookFileName) ||
    !isOptionalString(value.storybookFilePath) ||
    (value.storybookFormattedTextSettings !== undefined &&
      !isRpStorybookFormattedTextSettings(value.storybookFormattedTextSettings)) ||
    (value.customNodeDefinition !== undefined &&
      !isCustomNodeDefinition(value.customNodeDefinition)) ||
    (value.customNodeRuntimeDisplays !== undefined &&
      !isStringRecord(value.customNodeRuntimeDisplays)) ||
    (value.llmCallStats !== undefined && !isLlmCallStatsArray(value.llmCallStats)) ||
    (value.characterStatDefinitions !== undefined &&
      (!Array.isArray(value.characterStatDefinitions) ||
        !value.characterStatDefinitions.every(isCharacterStatDefinition))) ||
    (value.characterStatsState !== undefined && !isCharacterStatsState(value.characterStatsState)) ||
    (value.characterStatsBaselineState !== undefined && !isCharacterStatsState(value.characterStatsBaselineState)) ||
    (value.characterStatsLastChanges !== undefined && !isCharacterStatsChanges(value.characterStatsLastChanges)) ||
    !isOptionalString(value.characterStatsLastRpDateTime) ||
    (value.characterStatsTimeline !== undefined &&
      (!Array.isArray(value.characterStatsTimeline) ||
        !value.characterStatsTimeline.every(isCharacterStatsTimelineEntry))) ||
    !isOptionalString(value.characterStatsPrimaryId) ||
    !isOptionalFiniteNumber(value.characterStatsMaxChange) ||
    !isOptionalString(value.characterStatsStatus) ||
    !isOptionalString(value.characterStatsContextText) ||
    !isOptionalString(value.characterStatsLastResponse) ||
    !isOptionalString(value.characterStatsLastPrompt)
  ) {
    return false;
  }

  return true;
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.type === 'workflow' &&
    isRecord(value.position) &&
    typeof value.position.x === 'number' &&
    Number.isFinite(value.position.x) &&
    typeof value.position.y === 'number' &&
    Number.isFinite(value.position.y) &&
    (value.style === undefined || isRecord(value.style)) &&
    isOptionalFiniteNumber(value.width) &&
    isOptionalFiniteNumber(value.height) &&
    (value.measured === undefined ||
      (isRecord(value.measured) &&
        isOptionalFiniteNumber(value.measured.width) &&
        isOptionalFiniteNumber(value.measured.height))) &&
    isOptionalBoolean(value.selected) &&
    isOptionalBoolean(value.dragging) &&
    isOptionalBoolean(value.resizing) &&
    isWorkflowNodeData(value.data)
  );
}

function isWorkflowEdge(value: unknown, nodeIds: Set<string>) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.source === 'string' &&
    nodeIds.has(value.source) &&
    typeof value.target === 'string' &&
    nodeIds.has(value.target) &&
    (value.style === undefined || isRecord(value.style)) &&
    isOptionalBoolean(value.animated) &&
    isOptionalBoolean(value.selected) &&
    (value.sourceHandle === undefined ||
      value.sourceHandle === null ||
      typeof value.sourceHandle === 'string') &&
    (value.targetHandle === undefined ||
      value.targetHandle === null ||
      typeof value.targetHandle === 'string')
  );
}

function isWorkflowViewport(value: unknown) {
  return (
    value === undefined ||
    (
      isRecord(value) &&
      typeof value.x === 'number' &&
      Number.isFinite(value.x) &&
      typeof value.y === 'number' &&
      Number.isFinite(value.y) &&
      typeof value.zoom === 'number' &&
      Number.isFinite(value.zoom) &&
      value.zoom > 0
    )
  );
}

export function isWorkflowFile(value: unknown): value is WorkflowFile {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return false;
  }

  if (
    value.format !== 'rpgraph-workflow' ||
    !isCurrentWorkflowFormatVersion(value.formatVersion) ||
    typeof value.savedAt !== 'string' ||
    !isWorkflowViewport(value.viewport) ||
    !value.nodes.every(isWorkflowNode)
  ) {
    return false;
  }

  const nodeIds = new Set(value.nodes.map((node) => node.id));
  if (nodeIds.size !== value.nodes.length) {
    return false;
  }

  const edgeIds = new Set<string>();
  return value.edges.every((edge) => {
    if (!isWorkflowEdge(edge, nodeIds) || edgeIds.has(edge.id)) {
      return false;
    }
    edgeIds.add(edge.id);
    return true;
  });
}

function isStatsRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([statId, score]) => typeof statId === 'string' && typeof score === 'number' && Number.isFinite(score),
    )
  );
}

function isCharacterStatsState(value: unknown): value is CharacterStatsState {
  return (
    isRecord(value) &&
    isRecord(value.characters) &&
    Object.entries(value.characters).every(
      ([characterId, stats]) => typeof characterId === 'string' && isStatsRecord(stats),
    )
  );
}

function isCharacterStatsChanges(value: unknown): value is CharacterStatsChanges {
  return isCharacterStatsState(value);
}

function isCharacterStatsTimelineEntry(value: unknown): value is CharacterStatsTimelineEntry {
  return (
    isRecord(value) &&
    typeof value.rpDateTime === 'string' &&
    (value.turnNumber === undefined || (typeof value.turnNumber === 'number' && Number.isFinite(value.turnNumber))) &&
    isCharacterStatsState(value.state) &&
    isCharacterStatsState(value.baselineState)
  );
}

export function isRpSaveFile(value: unknown): value is RpgraphSessionV2 {
  return isRpgraphSessionV2(value);
}
