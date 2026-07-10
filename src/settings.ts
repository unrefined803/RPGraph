import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  AppSettings,
  ComfyLoraSlot,
  ComfyNarratorVoice,
  ConnectionReasoningEffort,
  ConnectionPreset,
  DialogueVoiceMode,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  PhoneDesktopIconSize,
  PhoneDesktopLayout,
} from './types';
import { bundledComfyNarratorVoice } from './comfy/defaultNarratorVoice';
import {
  promptActionConfigs,
  promptActionRuntimeSettings,
  promptActionSaveConfigs,
  type PromptActionConfig,
  type PromptActionRuntimeSettings,
} from './nodes/shared/promptActions';
import { inferredProviderKind, validLlmProviderKind } from './llm/providerKind';

const defaultDisplayLanguage = 'German';
const defaultTokenEstimateBytesPerToken = 3;
const minTokenEstimateBytesPerToken = 1;
const maxTokenEstimateBytesPerToken = 8;
export const defaultChatTextSize = 14;
export const defaultPhoneChatTextSize = 14;
export const phoneDesktopGridColumns = 8;
export const phoneDesktopGridRows = 12;
const defaultPhoneDesktopLayout: PhoneDesktopLayout = {
  clock: { column: 2, row: 4, width: 5, height: 2 },
  apps: {
    whatsup: { column: 1, row: 1 },
    gallery: { column: 2, row: 1 },
    camera: { column: 3, row: 1 },
    banking: { column: 4, row: 1 },
    fotogram: { column: 1, row: 2 },
    onlyfriends: { column: 2, row: 2 },
  },
};
const defaultPhoneDesktopIconSize: PhoneDesktopIconSize = 'large';

function validPhoneDesktopIconSize(value: unknown): PhoneDesktopIconSize {
  return value === 'medium' || value === 'large' ? value : defaultPhoneDesktopIconSize;
}
const defaultSmoothChatAutoScrollEnabled = true;
const defaultSmoothChatAutoScrollMinSpeed = 42;
export const minSmoothChatAutoScrollMinSpeed = 32;
export const maxSmoothChatAutoScrollMinSpeed = 60;
export const defaultThoughtTextStyle = 'italic';
const defaultRpDateTimeFormat: RpDateTimeFormat = 'eu';
const defaultRpWeekdayLanguage: RpWeekdayLanguage = 'system';
const defaultShowReferenceImagesInContext = true;
const defaultReferenceImageTurnLookback = 20;
const defaultMaxReferenceImages = 3;
const rpWeekdayLanguages = [
  'disabled',
  'system',
  'de-DE',
  'en-US',
  'ru-RU',
  'fr-FR',
  'es-ES',
  'it-IT',
  'pt-BR',
  'pl-PL',
  'tr-TR',
  'uk-UA',
  'ar-SA',
  'zh-CN',
  'ja-JP',
  'ko-KR',
  'hi-IN',
  'id-ID',
  'nl-NL',
  'sv-SE',
  'vi-VN',
] as const satisfies readonly RpWeekdayLanguage[];
const defaultGlassDesignEnabled = true;
const defaultRetryFormatErrorsEnabled = true;
const defaultGlassDesignOpacity = 0.6;
const defaultDialogueVoiceMode: DialogueVoiceMode = 'click';
const dialogueVoiceModes = ['click', 'preload', 'read-aloud', 'narrator-only'] as const satisfies readonly DialogueVoiceMode[];

function validDialogueVoiceMode(value: unknown): DialogueVoiceMode {
  return dialogueVoiceModes.includes(value as DialogueVoiceMode)
    ? (value as DialogueVoiceMode)
    : defaultDialogueVoiceMode;
}

function validComfyNarratorVoice(value: unknown): ComfyNarratorVoice | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const voice = value as Partial<ComfyNarratorVoice>;
  return typeof voice.name === 'string' &&
    typeof voice.dataUrl === 'string' &&
    voice.dataUrl.startsWith('data:audio/')
    ? { name: voice.name, dataUrl: voice.dataUrl }
    : undefined;
}
const defaultUiScale = 1;
export const minUiScale = 0.5;
export const maxUiScale = 2;
const defaultNodeTextSize = 'normal';
type NodeTextSize = 'small' | 'normal' | 'big';

export function validUiScale(value?: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maxUiScale, Math.max(minUiScale, value))
    : defaultUiScale;
}

function validGlassDesignOpacity(value?: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1.0, Math.max(0.01, value))
    : defaultGlassDesignOpacity;
}

function validNodeTextSize(value?: string): NodeTextSize {
  return value === 'small' || value === 'normal' || value === 'big'
    ? value
    : defaultNodeTextSize;
}

function validTokenEstimateBytesPerToken(value?: number) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minTokenEstimateBytesPerToken
  ) {
    return defaultTokenEstimateBytesPerToken;
  }
  return Math.min(maxTokenEstimateBytesPerToken, value);
}

function validCalibratedTokenBytesPerToken(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? validTokenEstimateBytesPerToken(value)
    : undefined;
}

function validChatTextSize(value?: number) {
  return Number.isFinite(value) && value !== undefined
    ? Math.min(22, Math.max(11, value))
    : defaultChatTextSize;
}

function validPhoneChatTextSize(value?: number) {
  return Number.isFinite(value) && value !== undefined
    ? Math.min(22, Math.max(11, value))
    : defaultPhoneChatTextSize;
}

function validPhoneDesktopLayout(value: unknown): PhoneDesktopLayout {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<PhoneDesktopLayout>
    : {};
  const clock = input.clock && typeof input.clock === 'object'
    ? input.clock as Partial<PhoneDesktopLayout['clock']>
    : {} as Partial<PhoneDesktopLayout['clock']>;
  const apps = input.apps && typeof input.apps === 'object'
    ? input.apps as Partial<PhoneDesktopLayout['apps']>
    : {} as Partial<PhoneDesktopLayout['apps']>;
  const gridNumber = (candidate: unknown, fallback: number, minimum: number, maximum: number) =>
    typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.min(maximum, Math.max(minimum, Math.round(candidate)))
      : fallback;
  const appPosition = (app: keyof PhoneDesktopLayout['apps']) => {
    const position = apps[app] && typeof apps[app] === 'object'
      ? apps[app]
      : {} as Partial<PhoneDesktopLayout['apps'][typeof app]>;
    return {
      column: gridNumber(position.column, defaultPhoneDesktopLayout.apps[app].column, 1, phoneDesktopGridColumns),
      row: gridNumber(position.row, defaultPhoneDesktopLayout.apps[app].row, 1, phoneDesktopGridRows),
    };
  };
  return {
    clock: {
      column: gridNumber(clock.column, defaultPhoneDesktopLayout.clock.column, 1, phoneDesktopGridColumns - 1),
      row: gridNumber(clock.row, defaultPhoneDesktopLayout.clock.row, 1, phoneDesktopGridRows),
      width: gridNumber(clock.width, defaultPhoneDesktopLayout.clock.width, 2, phoneDesktopGridColumns),
      height: gridNumber(clock.height, defaultPhoneDesktopLayout.clock.height, 1, 4),
    },
    apps: {
      whatsup: appPosition('whatsup'),
      gallery: appPosition('gallery'),
      camera: appPosition('camera'),
      banking: appPosition('banking'),
      fotogram: appPosition('fotogram'),
      onlyfriends: appPosition('onlyfriends'),
    },
  };
}

export function validSmoothChatAutoScrollMinSpeed(value?: number) {
  return Number.isFinite(value) && value !== undefined
    ? Math.min(maxSmoothChatAutoScrollMinSpeed, Math.max(minSmoothChatAutoScrollMinSpeed, value))
    : defaultSmoothChatAutoScrollMinSpeed;
}

function validThoughtTextStyle(value?: string): 'bold' | 'italic' | 'light' {
  return value === 'bold' || value === 'italic' || value === 'light'
    ? value
    : defaultThoughtTextStyle;
}

function validRpDateTimeFormat(value?: string): RpDateTimeFormat {
  return value === 'eu' || value === 'us' || value === 'iso'
    ? value
    : defaultRpDateTimeFormat;
}

function validRpWeekdayLanguage(value?: string): RpWeekdayLanguage {
  if (value === 'de') {
    return 'de-DE';
  }
  if (value === 'en') {
    return 'en-US';
  }
  return rpWeekdayLanguages.includes(value as RpWeekdayLanguage)
    ? value as RpWeekdayLanguage
    : defaultRpWeekdayLanguage;
}

function validReferenceImageTurnLookback(value?: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(99, Math.max(5, Math.round(value)))
    : defaultReferenceImageTurnLookback;
}

function validMaxReferenceImages(value?: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(9, Math.max(2, Math.round(value)))
    : defaultMaxReferenceImages;
}

const connectionStorageKey = 'rpgraph.connections';
export const defaultChatPanelWidth = 779;
const defaultConnectionReasoningEffort: ConnectionReasoningEffort = 'none';
export const defaultComfyBaseUrl = 'http://127.0.0.1:8188';
export type BundledComfyWorkflow = {
  id: string;
  label: string;
  role: 'image' | 'voice';
  apiWorkflowPath: string;
  setupWorkflowPath: string;
  description: string;
};

const discoveredImageWorkflowPaths = Object.keys(
  import.meta.glob('/comfy-workflows/api-workflows-with-variables/image/*.json'),
).map((path) => path.replace(/^\//, ''));
const discoveredVoiceWorkflowPaths = Object.keys(
  import.meta.glob('/comfy-workflows/api-workflows-with-variables/voice/*.json'),
).map((path) => path.replace(/^\//, ''));

function sortComfyWorkflowPaths(paths: string[]) {
  return [...paths].sort((left, right) => {
    const leftDefault = left.includes('/higgs_audio_v3-tts.json') || left.includes('/Krea2.json');
    const rightDefault = right.includes('/higgs_audio_v3-tts.json') || right.includes('/Krea2.json');
    if (leftDefault !== rightDefault) {
      return leftDefault ? -1 : 1;
    }
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function workflowFileLabel(path: string) {
  const fileName = path.split('/').pop()?.replace(/\.json$/i, '') ?? path;
  return fileName
    .replace(/[_-]+/g, ' ')
    .replace(/\btts\b/gi, 'TTS')
    .replace(/\bv3\b/gi, 'V3')
    .replace(/\bpt\b/gi, 'PT')
    .replace(/\b(\d+(?:\.\d+)?b)\b/gi, (match) => match.toUpperCase())
    .replace(/\b[a-z]/g, (match) => match.toUpperCase())
    .trim();
}

function comfyWorkflowFromPath(path: string, role: 'image' | 'voice'): BundledComfyWorkflow {
  const label = workflowFileLabel(path);
  return {
    id: `${role}-${path.split('/').pop()?.replace(/\.json$/i, '').toLocaleLowerCase() ?? label.toLocaleLowerCase()}`,
    label: role === 'image' && label === 'Krea2' ? 'Krea2 Image Workflow' : label,
    role,
    apiWorkflowPath: path,
    setupWorkflowPath: `comfy-workflows/normal-comfyui-workflows/${role}`,
    description: role === 'voice'
      ? 'Voice workflow with text and voice-sample variables.'
      : 'Image generation workflow with RPGraph variables.',
  };
}

export const bundledComfyWorkflows: BundledComfyWorkflow[] = [
  ...sortComfyWorkflowPaths(discoveredImageWorkflowPaths).map((path) => comfyWorkflowFromPath(path, 'image')),
  ...sortComfyWorkflowPaths(discoveredVoiceWorkflowPaths).map((path) => comfyWorkflowFromPath(path, 'voice')),
];
export const defaultComfyWorkflowPath = bundledComfyWorkflows.find((workflow) => workflow.role === 'image')?.apiWorkflowPath ??
  'comfy-workflows/api-workflows-with-variables/image/Krea2.json';
export const defaultComfyVoiceWorkflowPath = bundledComfyWorkflows.find((workflow) => workflow.role === 'voice')?.apiWorkflowPath ??
  'comfy-workflows/api-workflows-with-variables/voice/higgs_audio_v3-tts.json';

function defaultComfyWorkflowPathForRole(role: 'image' | 'voice' | null) {
  return role === 'voice' ? defaultComfyVoiceWorkflowPath : defaultComfyWorkflowPath;
}

export function bundledComfyWorkflowPathForRole(path: string | undefined, role: 'image' | 'voice' | null) {
  const trimmedPath = path?.trim() ?? '';
  return bundledComfyWorkflows.some((workflow) =>
    workflow.role === role && workflow.apiWorkflowPath === trimmedPath
  )
    ? trimmedPath
    : defaultComfyWorkflowPathForRole(role);
}
export const defaultComfyWidth = 832;
export const defaultComfyHeight = 1216;
export const defaultComfyPrompt = '';
export const defaultComfyCheckpointName = '';
export const defaultComfyDiffusionModelName = '';
export const defaultComfyVaeName = '';
export const defaultComfyTextEncoderName = '';
export const comfyCharacterLoraName = 'Character LoRA';
export const defaultComfyLoraSlots: ComfyLoraSlot[] = [
  { name: comfyCharacterLoraName, strength: 1 },
  { name: 'None', strength: 1 },
  { name: 'None', strength: 1 },
  { name: 'None', strength: 1 },
];
export const connectionReasoningEfforts = [
  'auto',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ConnectionReasoningEffort[];

export function missingComfySetupFields(connection: Pick<
  ConnectionPreset,
  'comfyCheckpointName' | 'comfyDiffusionModelName' | 'comfyVaeName' | 'comfyTextEncoderName'
>) {
  const missing: string[] = [];
  if (
    !connection.comfyCheckpointName?.trim() &&
    !connection.comfyDiffusionModelName?.trim()
  ) {
    missing.push('Checkpoint or diffusion model');
  }
  if (!connection.comfyVaeName?.trim()) {
    missing.push('VAE');
  }
  if (!connection.comfyTextEncoderName?.trim()) {
    missing.push('Text Encoder');
  }
  return missing;
}

export function comfySetupRequiredMessage(missingFields: string[]) {
  return missingFields.length > 0
    ? `Choose ${missingFields.join(', ')} before generating an image.`
    : '';
}

export const defaultConnectionSampling = {
  temperature: 0.8,
  topP: 1,
  presencePenalty: 0,
  frequencyPenalty: 0,
} as const;

export const defaultConnection: ConnectionPreset = {
  id: 'lm-studio-default',
  kind: 'llm',
  providerKind: 'lm-studio',
  label: 'LM Studio Local',
  baseUrl: 'http://localhost:1234/v1',
  apiKey: '',
  model: '',
  reasoningEffort: defaultConnectionReasoningEffort,
  vision: false,
  ...defaultConnectionSampling,
};

export function validConnectionReasoningEffort(value?: string): ConnectionReasoningEffort {
  return connectionReasoningEfforts.includes(value as ConnectionReasoningEffort)
    ? value as ConnectionReasoningEffort
    : defaultConnectionReasoningEffort;
}

function validSamplingValue(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(max, Math.max(min, value));
}

export function validComfyDimension(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(4096, Math.max(64, Math.round(value)));
}

function validComfyStrength(value: unknown, fallback = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function validComfyModelName(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function validComfyLoraName(value: unknown, fallback: string) {
  const name = validComfyModelName(value, fallback).trim();
  return name.length > 0 ? name : fallback;
}

export function validComfyLoraSlots(value: unknown): ComfyLoraSlot[] {
  const source = Array.isArray(value) ? value : [];
  return defaultComfyLoraSlots.map((fallback, index) => {
    const slot = source[index];
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
      return { ...fallback };
    }
    return {
      name: validComfyLoraName((slot as Partial<ComfyLoraSlot>).name, fallback.name),
      strength: validComfyStrength((slot as Partial<ComfyLoraSlot>).strength, fallback.strength),
    };
  });
}

function validCurrentComfyPrompt(value: unknown) {
  return typeof value === 'string' ? value : defaultComfyPrompt;
}

export function runtimeComfyLoraSlots(value: unknown): ComfyLoraSlot[] {
  return validComfyLoraSlots(value).map((slot) =>
    slot.name.trim() === comfyCharacterLoraName
      ? { ...slot, name: 'None' }
      : slot,
  );
}

export function characterComfyLoraSlots(value: unknown, loraName: string): ComfyLoraSlot[] {
  const requestedLora = loraName.trim();
  const slots = validComfyLoraSlots(value);
  let replacedCharacterSlot = false;
  const replacedSlots = slots.map((slot) => {
    if (slot.name.trim() !== comfyCharacterLoraName) {
      return slot;
    }
    replacedCharacterSlot = true;
    return { ...slot, name: requestedLora || 'None' };
  });

  if (!requestedLora || replacedCharacterSlot) {
    return runtimeComfyLoraSlots(replacedSlots);
  }

  const fallbackSlotIndex = replacedSlots.findIndex((slot) => {
    const slotName = slot.name.trim().toLowerCase();
    return slotName === 'none' || slotName.length === 0;
  });
  const targetIndex = fallbackSlotIndex >= 0 ? fallbackSlotIndex : 0;
  return runtimeComfyLoraSlots(replacedSlots.map((slot, index) =>
    index === targetIndex
      ? { ...slot, name: requestedLora }
      : slot,
  ));
}

function normalizedConnectionPreset(connection: ConnectionPreset): ConnectionPreset {
  const kind = connection.kind === 'comfyui' ? 'comfyui' : 'llm';
  // Stored ComfyUI presets without a role predate voice support and were image presets.
  const comfyRole = kind === 'comfyui'
    ? (connection.comfyRole === 'voice' ? 'voice' as const : 'image' as const)
    : undefined;
  const isComfyImage = comfyRole === 'image';
  return {
    ...connection,
    kind,
    comfyRole,
    providerKind: kind === 'comfyui'
      ? undefined
      : validLlmProviderKind(connection.providerKind) ?? inferredProviderKind(connection),
    apiKey: kind === 'comfyui' ? '' : connection.apiKey,
    model: kind === 'comfyui' ? '' : connection.model,
    ttsVoice: kind === 'comfyui' || typeof connection.ttsVoice !== 'string'
      ? undefined
      : connection.ttsVoice.trim() || undefined,
    ttsTemperature: kind === 'comfyui'
      ? undefined
      : validSamplingValue(connection.ttsTemperature, 0, 2),
    ttsStreamAudio: kind === 'comfyui' ? undefined : connection.ttsStreamAudio === true,
    ttsAudioProfile: kind === 'comfyui' ? undefined : connection.ttsAudioProfile?.trim() || undefined,
    ttsStyle: kind === 'comfyui' ? undefined : connection.ttsStyle?.trim() || undefined,
    ttsAccent: kind === 'comfyui' ? undefined : connection.ttsAccent?.trim() || undefined,
    ttsPace: kind === 'comfyui' ? undefined : connection.ttsPace?.trim() || undefined,
    comfyWorkflowPath: kind === 'comfyui'
      ? bundledComfyWorkflowPathForRole(connection.comfyWorkflowPath, comfyRole ?? null)
      : undefined,
    comfyWorkflowSetupConfirmed: kind === 'comfyui'
      ? connection.comfyWorkflowSetupConfirmed === true
      : undefined,
    comfyNarratorVoice: comfyRole === 'voice'
      ? validComfyNarratorVoice(connection.comfyNarratorVoice) ?? bundledComfyNarratorVoice()
      : undefined,
    comfyDeleteVoiceOutputs: comfyRole === 'voice'
      ? connection.comfyDeleteVoiceOutputs !== false
      : undefined,
    comfyDeleteImageOutputs: isComfyImage
      ? connection.comfyDeleteImageOutputs !== false
      : undefined,
    comfyWidth: isComfyImage
      ? validComfyDimension(connection.comfyWidth, defaultComfyWidth)
      : undefined,
    comfyHeight: isComfyImage
      ? validComfyDimension(connection.comfyHeight, defaultComfyHeight)
      : undefined,
    comfyPrompt: isComfyImage
      ? validCurrentComfyPrompt(connection.comfyPrompt)
      : undefined,
    comfyCheckpointName: isComfyImage
      ? validComfyModelName(connection.comfyCheckpointName, defaultComfyCheckpointName)
      : undefined,
    comfyDiffusionModelName: isComfyImage
      ? validComfyModelName(connection.comfyDiffusionModelName, defaultComfyDiffusionModelName)
      : undefined,
    comfyVaeName: isComfyImage
      ? validComfyModelName(connection.comfyVaeName, defaultComfyVaeName)
      : undefined,
    comfyTextEncoderName: isComfyImage
      ? validComfyModelName(connection.comfyTextEncoderName, defaultComfyTextEncoderName)
      : undefined,
    comfyLoraSlots: isComfyImage
      ? validComfyLoraSlots(connection.comfyLoraSlots)
      : undefined,
    reasoningEffort: kind === 'comfyui'
      ? defaultConnectionReasoningEffort
      : validConnectionReasoningEffort(connection.reasoningEffort),
    vision: kind === 'comfyui' ? false : connection.vision ?? false,
    temperature: kind === 'comfyui'
      ? undefined
      : validSamplingValue(connection.temperature, 0, 2) ?? defaultConnectionSampling.temperature,
    topP: kind === 'comfyui'
      ? undefined
      : validSamplingValue(connection.topP, 0, 1) ?? defaultConnectionSampling.topP,
    presencePenalty: kind === 'comfyui'
      ? undefined
      : validSamplingValue(connection.presencePenalty, -2, 2) ?? defaultConnectionSampling.presencePenalty,
    frequencyPenalty: kind === 'comfyui'
      ? undefined
      : validSamplingValue(connection.frequencyPenalty, -2, 2) ?? defaultConnectionSampling.frequencyPenalty,
  };
}

function loadLegacyConnections(): ConnectionPreset[] {
  try {
    const stored = localStorage.getItem(connectionStorageKey);
    if (!stored) {
      return [defaultConnection];
    }

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [defaultConnection];
    }

    const connections = parsed.filter(isConnectionPreset).map(normalizedConnectionPreset);
    return connections.length > 0 ? connections : [defaultConnection];
  } catch {
    return [defaultConnection];
  }
}

function isConnectionPreset(value: unknown): value is ConnectionPreset {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const connection = value as Partial<ConnectionPreset>;
  return (
    typeof connection.id === 'string' &&
    (connection.kind === undefined || connection.kind === 'llm' || connection.kind === 'comfyui') &&
    (connection.providerKind === undefined || validLlmProviderKind(connection.providerKind) !== undefined) &&
    typeof connection.label === 'string' &&
    typeof connection.baseUrl === 'string' &&
    typeof connection.apiKey === 'string' &&
    typeof connection.model === 'string' &&
    (connection.ttsVoice === undefined || typeof connection.ttsVoice === 'string') &&
    (connection.ttsTemperature === undefined ||
      (typeof connection.ttsTemperature === 'number' && Number.isFinite(connection.ttsTemperature))) &&
    (connection.ttsStreamAudio === undefined || typeof connection.ttsStreamAudio === 'boolean') &&
    (connection.ttsAudioProfile === undefined || typeof connection.ttsAudioProfile === 'string') &&
    (connection.ttsStyle === undefined || typeof connection.ttsStyle === 'string') &&
    (connection.ttsAccent === undefined || typeof connection.ttsAccent === 'string') &&
    (connection.ttsPace === undefined || typeof connection.ttsPace === 'string') &&
    (connection.comfyWorkflowPath === undefined || typeof connection.comfyWorkflowPath === 'string') &&
    (connection.comfyNarratorVoice === undefined ||
      validComfyNarratorVoice(connection.comfyNarratorVoice) !== undefined) &&
    (connection.comfyDeleteVoiceOutputs === undefined || typeof connection.comfyDeleteVoiceOutputs === 'boolean') &&
    (connection.comfyDeleteImageOutputs === undefined || typeof connection.comfyDeleteImageOutputs === 'boolean') &&
    (connection.comfyWidth === undefined || (typeof connection.comfyWidth === 'number' && Number.isFinite(connection.comfyWidth))) &&
    (connection.comfyHeight === undefined || (typeof connection.comfyHeight === 'number' && Number.isFinite(connection.comfyHeight))) &&
    (connection.comfyPrompt === undefined || typeof connection.comfyPrompt === 'string') &&
    (connection.comfyCheckpointName === undefined || typeof connection.comfyCheckpointName === 'string') &&
    (connection.comfyDiffusionModelName === undefined || typeof connection.comfyDiffusionModelName === 'string') &&
    (connection.comfyVaeName === undefined || typeof connection.comfyVaeName === 'string') &&
    (connection.comfyTextEncoderName === undefined || typeof connection.comfyTextEncoderName === 'string') &&
    (connection.comfyLoraSlots === undefined ||
      (Array.isArray(connection.comfyLoraSlots) &&
        connection.comfyLoraSlots.every((slot) =>
          !!slot &&
          typeof slot === 'object' &&
          !Array.isArray(slot) &&
          typeof slot.name === 'string' &&
          typeof slot.strength === 'number' &&
          Number.isFinite(slot.strength),
        ))) &&
    (connection.reasoningEffort === undefined ||
      connectionReasoningEfforts.includes(connection.reasoningEffort as ConnectionReasoningEffort)) &&
    (connection.vision === undefined || typeof connection.vision === 'boolean')
  );
}

function validChatPanelWidth(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 300 ? value : undefined;
}

function isWorkflowVariableRecord(value: unknown) {
  return (
    value === undefined ||
    (!!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every(
        (entry) =>
          typeof entry === 'string' ||
          (typeof entry === 'number' && Number.isFinite(entry)),
      ))
  );
}

function isStringRecord(value: unknown) {
  return (
    value === undefined ||
    (!!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every((entry) => typeof entry === 'string'))
  );
}

function workflowVariableRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry)))
      .map(([key, entry]) => [key, String(entry)]),
  );
}

function isPromptActionCustomPresets(value: unknown) {
  return value === undefined || (Array.isArray(value) && promptActionConfigs(value).length === value.length);
}

function isPromptActionRuntimeSettings(value: unknown) {
  return value === undefined || (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const settings = value as Partial<AppSettings>;
  return (
    settings.format === 'rpgraph-settings' &&
    settings.version === 1 &&
    Array.isArray(settings.connections) &&
    settings.connections.length > 0 &&
    settings.connections.every(isConnectionPreset) &&
    typeof settings.defaultConnectionId === 'string' &&
    !!settings.options &&
    typeof settings.options.englishProcessingEnabled === 'boolean' &&
    (settings.options.inputTranslationOnlyEnabled === undefined ||
      typeof settings.options.inputTranslationOnlyEnabled === 'boolean') &&
    typeof settings.options.displayLanguage === 'string' &&
    (settings.options.convertImagesToJpeg === undefined ||
      typeof settings.options.convertImagesToJpeg === 'boolean') &&
    (settings.options.convertImagesToPng === undefined ||
      typeof settings.options.convertImagesToPng === 'boolean') &&
    (settings.options.downscaleImages === undefined ||
      typeof settings.options.downscaleImages === 'boolean') &&
    (settings.options.imageMaxMegapixels === undefined ||
      (typeof settings.options.imageMaxMegapixels === 'number' &&
        Number.isFinite(settings.options.imageMaxMegapixels) &&
        settings.options.imageMaxMegapixels > 0)) &&
    (settings.options.tokenEstimateBytesPerToken === undefined ||
      (typeof settings.options.tokenEstimateBytesPerToken === 'number' &&
        Number.isFinite(settings.options.tokenEstimateBytesPerToken) &&
        settings.options.tokenEstimateBytesPerToken > 0)) &&
    (settings.options.autoCalibrateTokenEstimate === undefined ||
      typeof settings.options.autoCalibrateTokenEstimate === 'boolean') &&
    (settings.options.calibratedTokenBytesPerToken === undefined ||
      (typeof settings.options.calibratedTokenBytesPerToken === 'number' &&
        Number.isFinite(settings.options.calibratedTokenBytesPerToken) &&
        settings.options.calibratedTokenBytesPerToken > 0)) &&
    isWorkflowVariableRecord(settings.options.workflowSettingsValues) &&
    isPromptActionCustomPresets(settings.options.promptActionCustomPresets) &&
    isPromptActionRuntimeSettings(settings.options.promptActionSettings) &&
    isStringRecord(settings.options.promptTextCustomPresets) &&
    (settings.options.chatTextSize === undefined ||
      (typeof settings.options.chatTextSize === 'number' &&
        Number.isFinite(settings.options.chatTextSize) &&
        settings.options.chatTextSize > 0)) &&
    (settings.options.phoneChatTextSize === undefined ||
      (typeof settings.options.phoneChatTextSize === 'number' &&
        Number.isFinite(settings.options.phoneChatTextSize) &&
        settings.options.phoneChatTextSize > 0)) &&
    (settings.options.phoneDesktopIconSize === undefined ||
      ['medium', 'large'].includes(settings.options.phoneDesktopIconSize)) &&
    (settings.options.smoothChatAutoScrollEnabled === undefined ||
      typeof settings.options.smoothChatAutoScrollEnabled === 'boolean') &&
    (settings.options.smoothChatAutoScrollMinSpeed === undefined ||
      (typeof settings.options.smoothChatAutoScrollMinSpeed === 'number' &&
        Number.isFinite(settings.options.smoothChatAutoScrollMinSpeed) &&
        settings.options.smoothChatAutoScrollMinSpeed > 0)) &&
    (settings.options.thoughtTextStyle === undefined ||
      ['bold', 'italic', 'light'].includes(settings.options.thoughtTextStyle)) &&
    (settings.options.rpDateTimeFormat === undefined ||
      ['eu', 'us', 'iso'].includes(settings.options.rpDateTimeFormat)) &&
    (settings.options.rpWeekdayLanguage === undefined ||
      [...rpWeekdayLanguages, 'de', 'en'].includes(settings.options.rpWeekdayLanguage)) &&
    (settings.options.showReferenceImagesInContext === undefined ||
      typeof settings.options.showReferenceImagesInContext === 'boolean') &&
    (settings.options.referenceImageTurnLookback === undefined ||
      (typeof settings.options.referenceImageTurnLookback === 'number' &&
        Number.isFinite(settings.options.referenceImageTurnLookback) &&
        settings.options.referenceImageTurnLookback >= 0)) &&
    (settings.options.maxReferenceImages === undefined ||
      (typeof settings.options.maxReferenceImages === 'number' &&
        Number.isFinite(settings.options.maxReferenceImages) &&
        settings.options.maxReferenceImages >= 0)) &&
    (settings.options.glassDesignEnabled === undefined ||
      typeof settings.options.glassDesignEnabled === 'boolean') &&
    (settings.options.glassDesignOpacity === undefined ||
      (typeof settings.options.glassDesignOpacity === 'number' &&
        Number.isFinite(settings.options.glassDesignOpacity) &&
        settings.options.glassDesignOpacity >= 0 &&
        settings.options.glassDesignOpacity <= 1)) &&
    (settings.options.nodeTextSize === undefined ||
      ['small', 'normal', 'big'].includes(settings.options.nodeTextSize)) &&
    (settings.options.uiScale === undefined ||
      (typeof settings.options.uiScale === 'number' &&
        Number.isFinite(settings.options.uiScale) &&
        settings.options.uiScale >= minUiScale &&
        settings.options.uiScale <= maxUiScale)) &&
    (settings.options.retryFormatErrorsEnabled === undefined ||
      typeof settings.options.retryFormatErrorsEnabled === 'boolean') &&
    (settings.options.dialogueVoiceMode === undefined ||
      dialogueVoiceModes.includes(settings.options.dialogueVoiceMode)) &&
    (settings.options.dialogueNarratorProviderId === undefined ||
      typeof settings.options.dialogueNarratorProviderId === 'string') &&
    (settings.options.dialogueCloneVoiceProviderId === undefined ||
      typeof settings.options.dialogueCloneVoiceProviderId === 'string') &&
    (!settings.layout || validChatPanelWidth(settings.layout.chatPanelWidth) !== undefined)
  );
}

type AppSettingsState = {
  connections: ConnectionPreset[];
  setConnections: Dispatch<SetStateAction<ConnectionPreset[]>>;
  defaultConnectionId: string;
  setDefaultConnectionId: Dispatch<SetStateAction<string>>;
  englishProcessingEnabled: boolean;
  setEnglishProcessingEnabled: Dispatch<SetStateAction<boolean>>;
  inputTranslationOnlyEnabled: boolean;
  setInputTranslationOnlyEnabled: Dispatch<SetStateAction<boolean>>;
  displayLanguage: string;
  setDisplayLanguage: Dispatch<SetStateAction<string>>;
  tokenEstimateBytesPerToken: number;
  setTokenEstimateBytesPerToken: Dispatch<SetStateAction<number>>;
  autoCalibrateTokenEstimate: boolean;
  setAutoCalibrateTokenEstimate: Dispatch<SetStateAction<boolean>>;
  calibratedTokenBytesPerToken: number | undefined;
  setCalibratedTokenBytesPerToken: Dispatch<SetStateAction<number | undefined>>;
  workflowSettingsValues: Record<string, string>;
  setWorkflowSettingsValues: Dispatch<SetStateAction<Record<string, string>>>;
  promptActionCustomPresets: PromptActionConfig[];
  setPromptActionCustomPresets: Dispatch<SetStateAction<PromptActionConfig[]>>;
  promptActionSettings: PromptActionRuntimeSettings;
  setPromptActionSettings: Dispatch<SetStateAction<PromptActionRuntimeSettings>>;
  promptTextCustomPresets: Record<string, string>;
  setPromptTextCustomPresets: Dispatch<SetStateAction<Record<string, string>>>;
  chatTextSize: number;
  setChatTextSize: Dispatch<SetStateAction<number>>;
  phoneChatTextSize: number;
  setPhoneChatTextSize: Dispatch<SetStateAction<number>>;
  phoneDesktopLayout: PhoneDesktopLayout;
  setPhoneDesktopLayout: Dispatch<SetStateAction<PhoneDesktopLayout>>;
  phoneDesktopIconSize: PhoneDesktopIconSize;
  setPhoneDesktopIconSize: Dispatch<SetStateAction<PhoneDesktopIconSize>>;
  smoothChatAutoScrollEnabled: boolean;
  setSmoothChatAutoScrollEnabled: Dispatch<SetStateAction<boolean>>;
  smoothChatAutoScrollMinSpeed: number;
  setSmoothChatAutoScrollMinSpeed: Dispatch<SetStateAction<number>>;
  thoughtTextStyle: 'bold' | 'italic' | 'light';
  setThoughtTextStyle: Dispatch<SetStateAction<'bold' | 'italic' | 'light'>>;
  rpDateTimeFormat: RpDateTimeFormat;
  setRpDateTimeFormat: Dispatch<SetStateAction<RpDateTimeFormat>>;
  rpWeekdayLanguage: RpWeekdayLanguage;
  setRpWeekdayLanguage: Dispatch<SetStateAction<RpWeekdayLanguage>>;
  showReferenceImagesInContext: boolean;
  setShowReferenceImagesInContext: Dispatch<SetStateAction<boolean>>;
  referenceImageTurnLookback: number;
  setReferenceImageTurnLookback: Dispatch<SetStateAction<number>>;
  maxReferenceImages: number;
  setMaxReferenceImages: Dispatch<SetStateAction<number>>;
  chatPanelWidth: number;
  setChatPanelWidth: Dispatch<SetStateAction<number>>;
  settingsLoadComplete: boolean;
  settingsStatus: string;
  glassDesignEnabled: boolean;
  setGlassDesignEnabled: Dispatch<SetStateAction<boolean>>;
  glassDesignOpacity: number;
  setGlassDesignOpacity: Dispatch<SetStateAction<number>>;
  nodeTextSize: NodeTextSize;
  setNodeTextSize: Dispatch<SetStateAction<NodeTextSize>>;
  uiScale: number;
  setUiScale: Dispatch<SetStateAction<number>>;
  retryFormatErrorsEnabled: boolean;
  setRetryFormatErrorsEnabled: Dispatch<SetStateAction<boolean>>;
  dialogueVoiceMode: DialogueVoiceMode;
  setDialogueVoiceMode: Dispatch<SetStateAction<DialogueVoiceMode>>;
  dialogueNarratorProviderId: string;
  setDialogueNarratorProviderId: Dispatch<SetStateAction<string>>;
  dialogueCloneVoiceProviderId: string;
  setDialogueCloneVoiceProviderId: Dispatch<SetStateAction<string>>;
};

export function useAppSettings(): AppSettingsState {
  const [connections, setConnections] = useState<ConnectionPreset[]>(loadLegacyConnections);
  const [defaultConnectionId, setDefaultConnectionId] = useState(defaultConnection.id);
  const [englishProcessingEnabled, setEnglishProcessingEnabled] = useState(false);
  const [inputTranslationOnlyEnabled, setInputTranslationOnlyEnabled] = useState(false);
  const [displayLanguage, setDisplayLanguage] = useState(defaultDisplayLanguage);
  const [tokenEstimateBytesPerToken, setTokenEstimateBytesPerToken] = useState(
    defaultTokenEstimateBytesPerToken,
  );
  const [autoCalibrateTokenEstimate, setAutoCalibrateTokenEstimate] = useState(true);
  const [calibratedTokenBytesPerToken, setCalibratedTokenBytesPerToken] = useState<
    number | undefined
  >();
  const [workflowSettingsValues, setWorkflowSettingsValues] = useState<Record<string, string>>({});
  const [promptActionCustomPresets, setPromptActionCustomPresets] = useState<PromptActionConfig[]>([]);
  const [promptActionSettings, setPromptActionSettings] = useState<PromptActionRuntimeSettings>({});
  const [promptTextCustomPresets, setPromptTextCustomPresets] = useState<Record<string, string>>({});
  const [chatTextSize, setChatTextSize] = useState(defaultChatTextSize);
  const [phoneChatTextSize, setPhoneChatTextSize] = useState(defaultPhoneChatTextSize);
  const [phoneDesktopLayout, setPhoneDesktopLayout] = useState(defaultPhoneDesktopLayout);
  const [phoneDesktopIconSize, setPhoneDesktopIconSize] = useState<PhoneDesktopIconSize>(
    defaultPhoneDesktopIconSize,
  );
  const [smoothChatAutoScrollEnabled, setSmoothChatAutoScrollEnabled] = useState(
    defaultSmoothChatAutoScrollEnabled,
  );
  const [smoothChatAutoScrollMinSpeed, setSmoothChatAutoScrollMinSpeed] = useState(
    defaultSmoothChatAutoScrollMinSpeed,
  );
  const [thoughtTextStyle, setThoughtTextStyle] = useState<'bold' | 'italic' | 'light'>(
    defaultThoughtTextStyle,
  );
  const [rpDateTimeFormat, setRpDateTimeFormat] = useState<RpDateTimeFormat>(
    defaultRpDateTimeFormat,
  );
  const [rpWeekdayLanguage, setRpWeekdayLanguage] = useState<RpWeekdayLanguage>(
    defaultRpWeekdayLanguage,
  );
  const [showReferenceImagesInContext, setShowReferenceImagesInContext] = useState(
    defaultShowReferenceImagesInContext,
  );
  const [referenceImageTurnLookback, setReferenceImageTurnLookback] = useState(
    defaultReferenceImageTurnLookback,
  );
  const [maxReferenceImages, setMaxReferenceImages] = useState(defaultMaxReferenceImages);
  const [chatPanelWidth, setChatPanelWidth] = useState(defaultChatPanelWidth);
  const [glassDesignEnabled, setGlassDesignEnabled] = useState(defaultGlassDesignEnabled);
  const [glassDesignOpacity, setGlassDesignOpacity] = useState(defaultGlassDesignOpacity);
  const [nodeTextSize, setNodeTextSize] = useState<NodeTextSize>(defaultNodeTextSize);
  const [uiScale, setUiScale] = useState(defaultUiScale);
  const [retryFormatErrorsEnabled, setRetryFormatErrorsEnabled] = useState(
    defaultRetryFormatErrorsEnabled,
  );
  const [dialogueVoiceMode, setDialogueVoiceMode] = useState<DialogueVoiceMode>(
    defaultDialogueVoiceMode,
  );
  const [dialogueNarratorProviderId, setDialogueNarratorProviderId] = useState('');
  const [dialogueCloneVoiceProviderId, setDialogueCloneVoiceProviderId] = useState('');
  const [settingsLoadComplete, setSettingsLoadComplete] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [settingsRecoveryNotice, setSettingsRecoveryNotice] = useState('');
  const [apiKeyEncryptionAvailable, setApiKeyEncryptionAvailable] = useState(true);
  const [apiKeyDecryptionUnavailable, setApiKeyDecryptionUnavailable] = useState(false);
  const apiKeysConfigured = connections.some((connection) => connection.apiKey.trim().length > 0);
  const apiKeyStorageNotice =
    apiKeyDecryptionUnavailable
      ? 'Encrypted API keys are saved, but this system cannot decrypt them right now.'
      : apiKeysConfigured && !apiKeyEncryptionAvailable
      ? 'API key encryption is unavailable on this system. Provider keys are saved as local settings.'
      : '';

  useEffect(() => {
    async function loadSettings() {
      try {
        const result = await window.rpgraph.loadSettings();
        setApiKeyEncryptionAvailable(result.apiKeyEncryptionAvailable);
        setApiKeyDecryptionUnavailable(result.apiKeyDecryptionUnavailable);
        if (result.settings === null) {
          setSettingsStatus('');
          setSettingsLoaded(true);
          setSettingsLoadComplete(true);
          return;
        }
        if (!isAppSettings(result.settings)) {
          throw new Error('The local settings.json file does not contain valid RPGraph settings.');
        }
        const storedDefaultId = result.settings.defaultConnectionId;
        const storedConnections = result.settings.connections.map(normalizedConnectionPreset);
        setConnections(storedConnections);
        setDefaultConnectionId(
          storedConnections.some((connection) => connection.id === storedDefaultId)
            ? storedDefaultId
            : storedConnections[0].id,
        );
        setEnglishProcessingEnabled(result.settings.options.englishProcessingEnabled);
        setInputTranslationOnlyEnabled(result.settings.options.inputTranslationOnlyEnabled ?? false);
        setDisplayLanguage(result.settings.options.displayLanguage);
        setTokenEstimateBytesPerToken(
          validTokenEstimateBytesPerToken(result.settings.options.tokenEstimateBytesPerToken),
        );
        setAutoCalibrateTokenEstimate(result.settings.options.autoCalibrateTokenEstimate ?? true);
        setCalibratedTokenBytesPerToken(
          validCalibratedTokenBytesPerToken(
            result.settings.options.calibratedTokenBytesPerToken,
          ),
        );
        setWorkflowSettingsValues(workflowVariableRecord(result.settings.options.workflowSettingsValues));
        setPromptActionCustomPresets(promptActionConfigs(result.settings.options.promptActionCustomPresets));
        setPromptActionSettings(promptActionRuntimeSettings(result.settings.options.promptActionSettings));
        setPromptTextCustomPresets(workflowVariableRecord(result.settings.options.promptTextCustomPresets));
        setChatTextSize(validChatTextSize(result.settings.options.chatTextSize));
        setPhoneChatTextSize(validPhoneChatTextSize(result.settings.options.phoneChatTextSize));
        setPhoneDesktopLayout(validPhoneDesktopLayout(result.settings.options.phoneDesktopLayout));
        setPhoneDesktopIconSize(validPhoneDesktopIconSize(result.settings.options.phoneDesktopIconSize));
        setSmoothChatAutoScrollEnabled(
          result.settings.options.smoothChatAutoScrollEnabled ??
            defaultSmoothChatAutoScrollEnabled,
        );
        setSmoothChatAutoScrollMinSpeed(
          validSmoothChatAutoScrollMinSpeed(result.settings.options.smoothChatAutoScrollMinSpeed),
        );
        setThoughtTextStyle(validThoughtTextStyle(result.settings.options.thoughtTextStyle));
        setRpDateTimeFormat(validRpDateTimeFormat(result.settings.options.rpDateTimeFormat));
        setRpWeekdayLanguage(validRpWeekdayLanguage(result.settings.options.rpWeekdayLanguage));
        setShowReferenceImagesInContext(
          result.settings.options.showReferenceImagesInContext ?? defaultShowReferenceImagesInContext,
        );
        setReferenceImageTurnLookback(
          validReferenceImageTurnLookback(result.settings.options.referenceImageTurnLookback),
        );
        setMaxReferenceImages(
          validMaxReferenceImages(result.settings.options.maxReferenceImages),
        );
        setGlassDesignEnabled(
          result.settings.options.glassDesignEnabled ?? defaultGlassDesignEnabled,
        );
        setGlassDesignOpacity(
          validGlassDesignOpacity(result.settings.options.glassDesignOpacity),
        );
        setNodeTextSize(validNodeTextSize(result.settings.options.nodeTextSize));
        setUiScale(validUiScale(result.settings.options.uiScale));
        setRetryFormatErrorsEnabled(
          result.settings.options.retryFormatErrorsEnabled ?? defaultRetryFormatErrorsEnabled,
        );
        setDialogueVoiceMode(validDialogueVoiceMode(result.settings.options.dialogueVoiceMode));
        setDialogueNarratorProviderId(result.settings.options.dialogueNarratorProviderId ?? '');
        setDialogueCloneVoiceProviderId(result.settings.options.dialogueCloneVoiceProviderId ?? '');
        setChatPanelWidth(
          validChatPanelWidth(result.settings.layout?.chatPanelWidth) ?? defaultChatPanelWidth,
        );
        setSettingsStatus('');
        setSettingsLoaded(true);
        setSettingsLoadComplete(true);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const recoveryNotice = `Settings load failed: ${detail} Valid local settings were restored.`;
        setSettingsRecoveryNotice(recoveryNotice);
        setSettingsStatus(recoveryNotice);
        setSettingsLoaded(true);
        setSettingsLoadComplete(true);
      }
    }

    void loadSettings();
  }, []);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }
    const settings: AppSettings = {
      format: 'rpgraph-settings',
      version: 1,
      connections,
      defaultConnectionId:
        connections.find((connection) => connection.id === defaultConnectionId)?.id ??
        connections[0]?.id ??
        defaultConnection.id,
      options: {
        englishProcessingEnabled,
        inputTranslationOnlyEnabled,
        displayLanguage,
        tokenEstimateBytesPerToken: validTokenEstimateBytesPerToken(tokenEstimateBytesPerToken),
        autoCalibrateTokenEstimate,
        calibratedTokenBytesPerToken:
          validCalibratedTokenBytesPerToken(calibratedTokenBytesPerToken),
        workflowSettingsValues,
        promptActionCustomPresets: promptActionSaveConfigs(promptActionCustomPresets),
        promptActionSettings: promptActionRuntimeSettings(promptActionSettings),
        promptTextCustomPresets,
        chatTextSize: validChatTextSize(chatTextSize),
        phoneChatTextSize: validPhoneChatTextSize(phoneChatTextSize),
        phoneDesktopLayout: validPhoneDesktopLayout(phoneDesktopLayout),
        phoneDesktopIconSize: validPhoneDesktopIconSize(phoneDesktopIconSize),
        smoothChatAutoScrollEnabled,
        smoothChatAutoScrollMinSpeed: validSmoothChatAutoScrollMinSpeed(
          smoothChatAutoScrollMinSpeed,
        ),
        thoughtTextStyle: validThoughtTextStyle(thoughtTextStyle),
        rpDateTimeFormat: validRpDateTimeFormat(rpDateTimeFormat),
        rpWeekdayLanguage: validRpWeekdayLanguage(rpWeekdayLanguage),
        showReferenceImagesInContext,
        referenceImageTurnLookback: validReferenceImageTurnLookback(referenceImageTurnLookback),
        maxReferenceImages: validMaxReferenceImages(maxReferenceImages),
        glassDesignEnabled,
        glassDesignOpacity: validGlassDesignOpacity(glassDesignOpacity),
        nodeTextSize: validNodeTextSize(nodeTextSize),
        uiScale: validUiScale(uiScale),
        retryFormatErrorsEnabled,
        dialogueVoiceMode,
        dialogueNarratorProviderId,
        dialogueCloneVoiceProviderId,
      },
      layout: {
        chatPanelWidth,
      },
    };
    void window.rpgraph
      .saveSettings(settings)
      .then((result) => {
        setApiKeyEncryptionAvailable(result.apiKeyEncryptionAvailable);
        if (result.apiKeyEncryptionAvailable) {
          setApiKeyDecryptionUnavailable(false);
        }
        setSettingsStatus(settingsRecoveryNotice || apiKeyStorageNotice);
        localStorage.removeItem(connectionStorageKey);
      })
      .catch((error) => {
        setSettingsStatus(
          `Settings save failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, [
    connections,
    chatPanelWidth,
    defaultConnectionId,
    displayLanguage,
    englishProcessingEnabled,
    inputTranslationOnlyEnabled,
    tokenEstimateBytesPerToken,
    autoCalibrateTokenEstimate,
    calibratedTokenBytesPerToken,
    workflowSettingsValues,
    promptActionCustomPresets,
    promptActionSettings,
    promptTextCustomPresets,
    chatTextSize,
    phoneChatTextSize,
    phoneDesktopLayout,
    phoneDesktopIconSize,
    smoothChatAutoScrollEnabled,
    smoothChatAutoScrollMinSpeed,
    thoughtTextStyle,
    rpDateTimeFormat,
    rpWeekdayLanguage,
    showReferenceImagesInContext,
    referenceImageTurnLookback,
    maxReferenceImages,
    glassDesignEnabled,
    glassDesignOpacity,
    nodeTextSize,
    uiScale,
    retryFormatErrorsEnabled,
    dialogueVoiceMode,
    dialogueNarratorProviderId,
    dialogueCloneVoiceProviderId,
    settingsLoaded,
    settingsRecoveryNotice,
    apiKeyStorageNotice,
  ]);

  return {
    connections,
    setConnections,
    defaultConnectionId,
    setDefaultConnectionId,
    englishProcessingEnabled,
    setEnglishProcessingEnabled,
    inputTranslationOnlyEnabled,
    setInputTranslationOnlyEnabled,
    displayLanguage,
    setDisplayLanguage,
    tokenEstimateBytesPerToken,
    setTokenEstimateBytesPerToken,
    autoCalibrateTokenEstimate,
    setAutoCalibrateTokenEstimate,
    calibratedTokenBytesPerToken,
    setCalibratedTokenBytesPerToken,
    workflowSettingsValues,
    setWorkflowSettingsValues,
    promptActionCustomPresets,
    setPromptActionCustomPresets,
    promptActionSettings,
    setPromptActionSettings,
    promptTextCustomPresets,
    setPromptTextCustomPresets,
    chatTextSize,
    setChatTextSize,
    phoneChatTextSize,
    setPhoneChatTextSize,
    phoneDesktopLayout,
    setPhoneDesktopLayout,
    phoneDesktopIconSize,
    setPhoneDesktopIconSize,
    smoothChatAutoScrollEnabled,
    setSmoothChatAutoScrollEnabled,
    smoothChatAutoScrollMinSpeed,
    setSmoothChatAutoScrollMinSpeed,
    thoughtTextStyle,
    setThoughtTextStyle,
    rpDateTimeFormat,
    setRpDateTimeFormat,
    rpWeekdayLanguage,
    setRpWeekdayLanguage,
    showReferenceImagesInContext,
    setShowReferenceImagesInContext,
    referenceImageTurnLookback,
    setReferenceImageTurnLookback,
    maxReferenceImages,
    setMaxReferenceImages,
    chatPanelWidth,
    setChatPanelWidth,
    settingsLoadComplete,
    settingsStatus,
    glassDesignEnabled,
    setGlassDesignEnabled,
    glassDesignOpacity,
    setGlassDesignOpacity,
    nodeTextSize,
    setNodeTextSize,
    uiScale,
    setUiScale,
    retryFormatErrorsEnabled,
    setRetryFormatErrorsEnabled,
    dialogueVoiceMode,
    setDialogueVoiceMode,
    dialogueNarratorProviderId,
    setDialogueNarratorProviderId,
    dialogueCloneVoiceProviderId,
    setDialogueCloneVoiceProviderId,
  };
}
