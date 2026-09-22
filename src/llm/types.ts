import type {
  ChatImageAttachment,
  ConnectionPreset,
  LlmCallStats,
  LlmCompletionResult,
  LlmCallStage,
} from '../types';

export type NodeLlmRequest = {
  connectionId?: string;
  prompt: string;
  /** Compact diagnostic representation only; never sent to the provider or used for token calibration. */
  diagnosticPrompt?: string;
  images?: ChatImageAttachment[];
  label: string;
  stage?: LlmCallStage;
  nodeId?: string;
  purpose?: string;
  onChunk?: (text: string) => void;
  contributesToTokenCalibration?: boolean;
  maxTokens?: number;
  temperature?: number;
  fastTask?: boolean;
  useConnectionSampling?: boolean;
  signal?: AbortSignal;
};

export type NodeLlmResult = LlmCompletionResult & {
  connection: ConnectionPreset;
};

export type CalibrationSample = {
  prompt: string;
  stats: LlmCallStats;
};
