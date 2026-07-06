import { MarkerType, type Edge } from '@xyflow/react';
import { defaultConnection } from '../settings';
import { defaultAutoTurnInstructionSettings } from '../chat/instructions';
import {
  defaultOutputSpeakerPromptSettings,
  defaultOutputSpeakerResponseFormat,
} from '../nodes/output/speakerPrompt';
import type { CharacterStatDefinition, WorkflowNode } from '../types';

export const defaultContextCompressionTokenLimit = 10000;
export const contextLengthMaxOptionKey = 'context-length-max';
export const responseLengthOptionKey = 'response-length';
export const contextCompressionMaxTokensHandle = 'max-tokens';
export const defaultContextCompressionRatio = 50;
export const defaultContextCompressionLengthWords = 300;
export const defaultEstimatedTokenBytesPerToken = 3;
export const fixedTokenEstimateReservePercent = 5;
export const workflowPendingColor = '#64d1ff';
export const workflowCompleteColor = '#55cf8d';
export const workflowPreparedColor = '#f2bd68';
export const defaultLlmPromptBefore =
  'You are a creative roleplay character. Respond within the scene and stay in character.';
export const defaultLlmPromptAfter =
  'Respond directly to the input in the same language as the input. Write vividly, without meta commentary. Do not prefix paragraphs with speaker names or Markdown speaker headings such as **Name:**; write narration and dialogue naturally.';
export const minimumCombinerInputs = 2;
export const maximumCombinerInputs = 9;
export const minimumLlmDecisionQuestions = 1;
export const maximumLlmDecisionQuestions = 4;
export const defaultTextRouterNumberOutputs = 5;
export const minimumTextRouterNumberOutputs = 1;
export const maximumTextRouterNumberOutputs = 10;
export const contextBuilderInputCount = 5;
export const defaultCharacterStatsMaxChange = 10;
export const defaultCharacterStatDefinitions: CharacterStatDefinition[] = [
  {
    id: 'stress',
    name: 'Stress',
    description: 'Inner pressure, overload, tension, or emotional strain.',
    enabled: true,
  },
  {
    id: 'fear',
    name: 'Fear',
    description: 'Fear, insecurity, threat perception, or nervous caution.',
    enabled: true,
  },
  {
    id: 'anger',
    name: 'Anger',
    description: 'Irritation, frustration, resentment, or open anger.',
    enabled: true,
  },
  {
    id: 'confidence',
    name: 'Confidence',
    description: 'Self-assurance, decisiveness, courage, or social stability.',
    enabled: true,
  },
  {
    id: 'curiosity',
    name: 'Curiosity',
    description: 'Interest, openness, attention, or desire to know more.',
    enabled: true,
  },
  {
    id: 'control',
    name: 'Control',
    description: 'How much the character feels in control of self, scene, or conversation.',
    enabled: true,
  },
];

export function createInitialNodes(): WorkflowNode[] {
  return [
    {
      id: 'user-input',
      type: 'workflow',
      position: { x: 40, y: 300 },
      data: {
        label: 'User Input',
        description: 'Chat message',
        preview: 'Waiting for input ...',
        nodeType: 'input',
        connectionId: defaultConnection.id,
        autoTurnInstructions: defaultAutoTurnInstructionSettings(),
      },
    },
    {
      id: 'llm-prompt-1',
      type: 'workflow',
      position: { x: 325, y: 170 },
      style: { width: 548, height: 1140 },
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
        connectionId: defaultConnection.id,
      },
    },
    {
      id: 'rp-output',
      type: 'workflow',
      position: { x: 725, y: 300 },
      data: {
        label: 'RP Output',
        description: 'Roleplay response',
        preview: 'No output yet',
        nodeType: 'output',
        connectionId: defaultConnection.id,
        streamOutputEnabled: false,
        speakerAnalysisEnabled: false,
        dialogueHighlightEnabled: false,
        outputSpeakerResponseFormat: defaultOutputSpeakerResponseFormat,
        outputSpeakerPrompt: defaultOutputSpeakerPromptSettings(),
      },
    },
  ];
}

export function createInitialEdges(): Edge[] {
  return [
    makeEdge('input-to-prompt', 'user-input', 'llm-prompt-1'),
    makeEdge('prompt-to-output', 'llm-prompt-1', 'rp-output'),
  ];
}

function makeEdge(id: string, source: string, target: string, color = workflowPendingColor): Edge {
  return {
    id,
    source,
    target,
    markerEnd: { type: MarkerType.ArrowClosed, color },
    style: { stroke: color, strokeWidth: 2 },
  };
}
