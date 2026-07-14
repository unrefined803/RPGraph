import type { ChatImageAttachment } from '../types';
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

export type CreateComfyImageForCharacterRequest = {
  phoneOwnerName: string;
  loraCharacterName?: string;
  prompt: string;
  llmConnectionId?: string;
  comfyProviderId?: string;
  manageModelMemory?: boolean;
};

export type CreateComfyImageForCharacterResult = {
  phoneOwnerName: string;
  loraCharacterName?: string;
  imageIds: string[];
  images: ChatImageAttachment[];
};

export type CreateComfyImageForCharacterRunner = (
  request: CreateComfyImageForCharacterRequest,
  warn: (message: string) => void,
) => Promise<CreateComfyImageForCharacterResult>;

export const runScratchKeys = {
  characterStatsMemo: 'characterStatsMemo',
  historyMemo: 'historyMemo',
  llmDecisionMemo: 'llmDecisionMemo',
  llmPromptSwitchMemo: 'llmPromptSwitchMemo',
  memorySlotValues: 'memorySlotValues',
  createComfyImageForCharacter: 'createComfyImageForCharacter',
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

export function createComfyImageForCharacter(
  context: ExecuteContext,
  request: CreateComfyImageForCharacterRequest,
) {
  const runner = context.runScratch.get(runScratchKeys.createComfyImageForCharacter);
  if (typeof runner !== 'function') {
    throw new Error('Create character phone image action is not available for this graph run.');
  }
  return (runner as CreateComfyImageForCharacterRunner)(request, context.reportWarning);
}
