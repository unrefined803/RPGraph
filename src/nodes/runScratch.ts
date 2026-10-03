import type { ExecuteContext } from './types';

export type CharacterStatsRunResult = {
  stateText: string;
  contextText: string;
};

export type HistoryRunResult = {
  rawHistory: string;
  originalHistory: string;
  translatedHistory: string;
  lastTurnsHistory: string;
};

export type LlmDecisionRunResult = Array<{ bool: boolean; text: string; number: number }>;

export type LlmPromptSwitchRunResult = {
  outputChannel: number;
  text: string;
};

export const runScratchKeys = {
  customNodeMemo: 'customNodeMemo',
  characterStatsMemo: 'characterStatsMemo',
  historyMemo: 'historyMemo',
  llmDecisionMemo: 'llmDecisionMemo',
  llmPromptSwitchMemo: 'llmPromptSwitchMemo',
  memorySlotValues: 'memorySlotValues',
} as const;

function scratchMap<T>(context: ExecuteContext, key: string) {
  const value = context.runScratch.get(key);
  if (value instanceof Map) {
    return value as Map<string, T>;
  }
  const map = new Map<string, T>();
  context.runScratch.set(key, map);
  return map;
}

export function characterStatsMemo(context: ExecuteContext) {
  return scratchMap<Promise<CharacterStatsRunResult>>(context, runScratchKeys.characterStatsMemo);
}

export function historyMemo(context: ExecuteContext) {
  return scratchMap<Promise<HistoryRunResult>>(context, runScratchKeys.historyMemo);
}

export function llmDecisionMemo(context: ExecuteContext) {
  return scratchMap<Promise<LlmDecisionRunResult>>(context, runScratchKeys.llmDecisionMemo);
}

export function llmPromptSwitchMemo(context: ExecuteContext) {
  return scratchMap<Promise<LlmPromptSwitchRunResult>>(context, runScratchKeys.llmPromptSwitchMemo);
}

export function memorySlotValues(context: ExecuteContext) {
  return scratchMap<string>(context, runScratchKeys.memorySlotValues);
}

export function customNodeMemo(context: ExecuteContext) {
  return scratchMap<Promise<Record<string, string>>>(context, runScratchKeys.customNodeMemo);
}
