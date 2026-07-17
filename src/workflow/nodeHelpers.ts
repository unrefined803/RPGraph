import type {
  CharacterStatDefinition,
  CharacterStatsState,
  ContextBuilderItem,
  LlmDecisionOutputToggles,
  SettingsValueEntry,
  TextReplaceEntry,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';

export type { TextReplaceEntry } from '../types';
import {
  contextLengthMaxOptionKey,
  defaultCharacterStatDefinitions,
  defaultCharacterStatsMaxChange,
  defaultLlmPromptAfter,
  defaultLlmPromptBefore,
  defaultTextRouterNumberOutputs,
  maximumCombinerInputs,
  maximumLlmDecisionQuestions,
  maximumTextRouterNumberOutputs,
  minimumCombinerInputs,
  minimumLlmDecisionQuestions,
  minimumTextRouterNumberOutputs,
} from './defaults';
import {
  storybookContextBuilderSections,
  storyCharacterRefsFromNodes,
} from '../storybook/runtime';

export function settingsValueEntries(data: WorkflowNodeData): SettingsValueEntry[] {
  return data.settingsValueEntries ??
    [{ id: 'context-length-max', optionKey: contextLengthMaxOptionKey, label: 'Context Length Max' }];
}

export function settingsValueHandle(entryId: string) {
  return `settings-value-${entryId.replace(/^value-/, '')}`;
}

export function combinerInputLabel(index: number) {
  return String.fromCharCode(65 + index);
}

export function combinerInputHandle(index: number) {
  return `input-${combinerInputLabel(index).toLowerCase()}`;
}

export function combinerInputCount(data: WorkflowNodeData) {
  return Math.min(
    maximumCombinerInputs,
    Math.max(minimumCombinerInputs, data.combinerInputCount ?? minimumCombinerInputs),
  );
}

export function combinerPrefixes(data: WorkflowNodeData) {
  const count = combinerInputCount(data);
  return Array.from({ length: count }, (_, index) => data.combinerPrefixes?.[index] ?? '');
}

export function combinerPreviews(data: WorkflowNodeData) {
  const legacyPreviews = [data.inputAPreview ?? '', data.inputBPreview ?? ''];
  const count = combinerInputCount(data);
  return Array.from(
    { length: count },
    (_, index) => data.combinerInputPreviews?.[index] ?? legacyPreviews[index] ?? '',
  );
}

export function combineTextInputs(prefixes: string[], inputs: string[]) {
  return prefixes
    .flatMap((prefix, index) => [prefix, inputs[index] ?? ''])
    .filter(Boolean)
    .join('\n\n');
}

export function textReplaceEntries(data: WorkflowNodeData): TextReplaceEntry[] {
  const entries = data.textReplaceEntries ?? [];
  return entries.map((entry, index) => ({
    id: entry?.id || `text-replace-${index}`,
    source: entry?.source ?? '',
    replacement: entry?.replacement ?? '',
  }));
}

function escapeRegExpLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyTextReplacements(entries: TextReplaceEntry[], input: string): string {
  return entries.reduce((text, entry) => {
    if (!entry.source) {
      return text;
    }
    const pattern = new RegExp(escapeRegExpLiteral(entry.source), 'gi');
    // Function replacer keeps the replacement literal ($&, $1, ... are not interpreted).
    return text.replace(pattern, () => entry.replacement);
  }, input);
}

export function textRouterMode(data: WorkflowNodeData) {
  return data.textRouterMode === 'number' ? 'number' : 'bool';
}

export function textRouterNumberOutputCount(data: WorkflowNodeData) {
  return Math.min(
    maximumTextRouterNumberOutputs,
    Math.max(minimumTextRouterNumberOutputs, data.textRouterNumberOutputCount ?? defaultTextRouterNumberOutputs),
  );
}

export function textRouterNumberOutputHandle(index: number) {
  return `number-${index + 1}`;
}

export function textSelectorMode(data: WorkflowNodeData) {
  return data.textSelectorMode === 'number' ? 'number' : 'bool';
}

export function textSelectorInputCount(data: WorkflowNodeData) {
  return Math.min(
    maximumTextRouterNumberOutputs,
    Math.max(minimumTextRouterNumberOutputs, data.textSelectorInputCount ?? defaultTextRouterNumberOutputs),
  );
}

export function textSelectorTextInputHandle(index: number) {
  return `text-${index + 1}`;
}

const defaultLlmDecisionOutputs: LlmDecisionOutputToggles = {
  bool: true,
  text: true,
  number: true,
};

function llmDecisionQuestionCount(data: WorkflowNodeData) {
  return Math.min(
    maximumLlmDecisionQuestions,
    Math.max(minimumLlmDecisionQuestions, data.llmDecisionQuestions?.length ?? minimumLlmDecisionQuestions),
  );
}

export function llmDecisionOutputHandle(index: number, kind: keyof LlmDecisionOutputToggles) {
  return `decision-${index + 1}-${kind}`;
}

export function llmDecisionEntries(data: WorkflowNodeData) {
  const count = llmDecisionQuestionCount(data);
  return Array.from({ length: count }, (_, index) => ({
    index,
    question: data.llmDecisionQuestions?.[index] ?? '',
    outputs: {
      ...defaultLlmDecisionOutputs,
      ...data.llmDecisionOutputToggles?.[index],
    },
  }));
}

export function llmDecisionQuestions(data: WorkflowNodeData) {
  return llmDecisionEntries(data).map((entry) => entry.question);
}

export function llmDecisionOutputToggles(data: WorkflowNodeData) {
  return llmDecisionEntries(data).map((entry) => entry.outputs);
}

export const maximumLlmPromptSwitchEntries = 10;

export function llmPromptSwitchOutputHandle(index: number) {
  return `output-channel-${index}`;
}

export function defaultLlmPromptSwitchOutputTitles() {
  return ['Output 0'];
}

function defaultLlmPromptSwitchPromptTitles() {
  return ['Default Prompt'];
}

export function defaultLlmPromptSwitchPromptTitlesByOutput() {
  return [defaultLlmPromptSwitchPromptTitles()];
}

function defaultLlmPromptSwitchPromptBefores() {
  return [defaultLlmPromptBefore];
}

export function defaultLlmPromptSwitchPromptBeforesByOutput() {
  return [defaultLlmPromptSwitchPromptBefores()];
}

function defaultLlmPromptSwitchPromptAfters() {
  return [defaultLlmPromptAfter];
}

export function defaultLlmPromptSwitchPromptAftersByOutput() {
  return [defaultLlmPromptSwitchPromptAfters()];
}

function visibleSwitchEntries(values: string[] | undefined, defaults: string[], fallback: string) {
  const source = values?.length ? values : defaults;
  const visible = source.slice(0, maximumLlmPromptSwitchEntries);
  return visible.length ? visible : [fallback];
}

function visibleSwitchRows(
  values: string[][] | undefined,
  defaults: string[][],
  rowCount: number,
  fallback: string,
) {
  return Array.from({ length: rowCount }, (_, index) =>
    visibleSwitchEntries(values?.[index], defaults[index] ?? defaults[0] ?? [fallback], fallback),
  );
}

export function llmPromptSwitchOutputTitles(data: WorkflowNodeData) {
  return visibleSwitchEntries(data.llmPromptSwitchOutputTitles, defaultLlmPromptSwitchOutputTitles(), 'Output 0');
}

export function llmPromptSwitchPromptTitlesByOutput(data: WorkflowNodeData) {
  return visibleSwitchRows(
    data.llmPromptSwitchPromptTitlesByOutput,
    defaultLlmPromptSwitchPromptTitlesByOutput(),
    llmPromptSwitchOutputTitles(data).length,
    'Default Prompt',
  );
}

export function llmPromptSwitchPromptTitles(data: WorkflowNodeData, outputChannel = llmPromptSwitchSelectedOutputChannel(data)) {
  return llmPromptSwitchPromptTitlesByOutput(data)[outputChannel] ?? defaultLlmPromptSwitchPromptTitles();
}

function promptRows(
  values: string[][] | undefined,
  defaults: string[][],
  titleRows: string[][],
) {
  return titleRows.map((titles, outputIndex) =>
    Array.from(
      { length: titles.length },
      (_, promptIndex) => values?.[outputIndex]?.[promptIndex] ?? defaults[outputIndex]?.[promptIndex] ?? defaults[0]?.[promptIndex] ?? '',
    ),
  );
}

export function llmPromptSwitchPromptBeforesByOutput(data: WorkflowNodeData) {
  return promptRows(
    data.llmPromptSwitchPromptBeforesByOutput,
    defaultLlmPromptSwitchPromptBeforesByOutput(),
    llmPromptSwitchPromptTitlesByOutput(data),
  );
}

export function llmPromptSwitchPromptAftersByOutput(data: WorkflowNodeData) {
  return promptRows(
    data.llmPromptSwitchPromptAftersByOutput,
    defaultLlmPromptSwitchPromptAftersByOutput(),
    llmPromptSwitchPromptTitlesByOutput(data),
  );
}

export function llmPromptSwitchPromptBefores(data: WorkflowNodeData, outputChannel = llmPromptSwitchSelectedOutputChannel(data)) {
  return llmPromptSwitchPromptBeforesByOutput(data)[outputChannel] ?? defaultLlmPromptSwitchPromptBefores();
}

export function llmPromptSwitchPromptAfters(data: WorkflowNodeData, outputChannel = llmPromptSwitchSelectedOutputChannel(data)) {
  return llmPromptSwitchPromptAftersByOutput(data)[outputChannel] ?? defaultLlmPromptSwitchPromptAfters();
}

export function llmPromptSwitchSelectedOutputChannel(data: WorkflowNodeData) {
  const selected = data.llmPromptSwitchSelectedOutputChannel ?? 0;
  const outputCount = llmPromptSwitchOutputTitles(data).length;
  return Number.isInteger(selected) && selected >= 0 && selected < outputCount
    ? selected
    : 0;
}

export function llmPromptSwitchSelectedPromptSlot(data: WorkflowNodeData) {
  const selected = data.llmPromptSwitchSelectedPromptSlot ?? 0;
  const promptCount = llmPromptSwitchPromptTitles(data, llmPromptSwitchSelectedOutputChannel(data)).length;
  return Number.isInteger(selected) && selected >= 0 && selected < promptCount
    ? selected
    : 0;
}

function titleCaseField(field: string) {
  return field
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function selectorFieldValue(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function contextBuilderInputHandle(index: number) {
  return `context-input-${index + 1}`;
}

export function buildContextBuilderItems(
  inputs: Array<{ sourceIndex: number; sourceLabel: string; text: string }>,
  previousItems: ContextBuilderItem[] = [],
) {
  const previous = new Map(previousItems.map((item) => [item.id, item]));
  const detected = inputs.flatMap(({ sourceIndex, sourceLabel, text }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const storybookSections = storybookContextBuilderSections(text);
    const record =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : undefined;
    const fields = storybookSections
      ? storybookSections
      : record
      ? Object.entries(record)
      : [['text', text] as [string, unknown]];
    return fields.flatMap(([fieldPath, value]) => {
      const formatted = selectorFieldValue(value);
      if (!formatted.trim()) {
        return [];
      }
      const id = `${sourceIndex}:${fieldPath}`;
      const saved = previous.get(id);
      return [{
        id,
        sourceIndex,
        sourceLabel,
        fieldPath,
        fieldLabel: fieldPath === 'text' ? 'Text' : titleCaseField(fieldPath),
        value: formatted,
        enabled: saved?.enabled ?? true,
      }];
    });
  });
  const existingOrder = new Map(
    previousItems.map((item, index) => [item.id, index]),
  );
  return detected.sort((left, right) => {
    const leftOrder = existingOrder.get(left.id);
    const rightOrder = existingOrder.get(right.id);
    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }
    if (leftOrder !== undefined) {
      return -1;
    }
    if (rightOrder !== undefined) {
      return 1;
    }
    return left.sourceIndex - right.sourceIndex;
  });
}

export function contextBuilderText(items: ContextBuilderItem[] = []) {
  return items
    .filter((item) => item.enabled)
    .map((item) => `${item.fieldLabel}:\n${item.value}`)
    .join('\n\n');
}

function dedupeStatDefinitionsById(definitions: CharacterStatDefinition[]) {
  // First occurrence of an id wins, matching the old defaults-merge behavior and
  // guarding against duplicate React keys from hand-edited or imported workflows.
  const seen = new Set<string>();
  return definitions.filter((definition) => {
    const id = definition.id.trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function resolvedStatDefinitions(
  savedDefinitions: CharacterStatDefinition[] | undefined,
  defaults: CharacterStatDefinition[],
) {
  // A saved list is authoritative: it holds exactly the attributes the user kept,
  // including any defaults they removed. A missing or empty list falls back to
  // defaults.
  const source = savedDefinitions?.length ? savedDefinitions : defaults;
  return dedupeStatDefinitionsById(source);
}

// Definitions used by runtime, prompts, and the chart: blank-named entries (a row
// mid-rename in the editor) are excluded so they never reach the LLM or state.
export function characterStatDefinitions(data: WorkflowNodeData) {
  return resolvedStatDefinitions(data.characterStatDefinitions, defaultCharacterStatDefinitions).filter(
    (definition) => definition.name.trim(),
  );
}

// Definitions shown in the editor: keeps blank-named entries mounted so a stat can
// be renamed (clearing the field first) without the row unmounting mid-edit.
export function characterStatDefinitionsForEditing(data: WorkflowNodeData) {
  return resolvedStatDefinitions(data.characterStatDefinitions, defaultCharacterStatDefinitions);
}

export function characterStatsMaxChange(data: WorkflowNodeData) {
  return Math.min(100, Math.max(0, Math.round(data.characterStatsMaxChange ?? defaultCharacterStatsMaxChange)));
}

export function normalizeCharacterStatsState(nodes: WorkflowNode[], state?: CharacterStatsState) {
  const characters = storyCharacterRefsFromNodes(nodes);
  const characterStats = Object.fromEntries(
    characters.map((character) => [
      character.nodeId,
      Object.fromEntries(
        Object.entries(state?.characters[character.nodeId] ?? {})
          .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
          .map(([statId, value]) => [statId, Math.min(100, Math.max(0, Math.round(value)))]),
      ),
    ]),
  );
  return {
    characters: characterStats,
  };
}

export function characterStatsStateText(
  nodes: WorkflowNode[],
  state: CharacterStatsState | undefined,
  characterStats: CharacterStatDefinition[],
  baselineState?: CharacterStatsState,
) {
  const characters = storyCharacterRefsFromNodes(nodes);
  const normalized = normalizeCharacterStatsState(nodes, state);
  const normalizedBaseline = normalizeCharacterStatsState(nodes, baselineState);
  const enabledCharacterStats = characterStats.filter((stat) => stat.enabled);
  const characterLines = characters.flatMap((character) => {
    const parts = enabledCharacterStats.map((stat) => {
      const value = normalized.characters[character.nodeId]?.[stat.id] ?? 50;
      const baseline = normalizedBaseline.characters[character.nodeId]?.[stat.id];
      return baseline === undefined
        ? `${stat.name} ${value}`
        : `${stat.name} [${baseline}] ${value}`;
    });
    return parts.length ? [`- ${character.label}: ${parts.join(', ')}`] : [];
  });
  return [
    'Character Stats:',
    ...(characterLines.length ? characterLines : ['- No character stats tracked.']),
  ].join('\n');
}
