import type { ReasoningCapabilities, ReasoningEffort } from './reasoning.cjs';
export const chatgptReasoningCapabilities: ReasoningCapabilities;
export const chatgptCapabilities: { text: true; vision: true; reasoning: true; image: false; voice: false };
export function chatgptModelReasoning(model: unknown): ReasoningCapabilities | undefined;
export function chatgptReasoningEffort(value: unknown, capabilities?: ReasoningCapabilities): Exclude<ReasoningEffort, 'auto' | 'on'>;
