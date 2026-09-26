import type { ReasoningCapabilities, ReasoningEffort } from './reasoning.cjs';
export type CompatibleModelInfo = {
  id: string;
  capabilities: Partial<Record<'text' | 'vision' | 'tools' | 'reasoning' | 'image' | 'voice', boolean>>;
  reasoning?: ReasoningCapabilities;
  reasoningFormat?: 'reasoning' | 'reasoning_effort';
};
export function compatibleModel(value: unknown): CompatibleModelInfo | null;
export function mergeCompatibleNativeModels(models: CompatibleModelInfo[], native: unknown): CompatibleModelInfo[];
export function compatibleReasoningOptions(connection: {
  reasoningEffort?: ReasoningEffort;
  reasoningCapabilities?: ReasoningCapabilities;
  compatibleReasoningFormat?: 'reasoning' | 'reasoning_effort';
}): { reasoning?: { effort: string }; reasoning_effort?: string };
