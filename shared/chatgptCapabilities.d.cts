import type { ReasoningCapabilities } from './reasoning.cjs';
export const chatgptReasoningCapabilities: ReasoningCapabilities;
export const chatgptCapabilities: { text: true; vision: true; reasoning: true; image: false; voice: false };
export function chatgptReasoningEffort(value: unknown): 'low' | 'medium' | 'high';
