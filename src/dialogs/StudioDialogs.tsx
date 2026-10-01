import { chatgptReasoningEffort } from '../../shared/chatgptCapabilities.cjs';
import { isTextGenerationConnection } from '../llm/textProvider';
import { getAccountPassword } from '../accounts/accountSession';
import { AccountControlsContext } from '../accounts/accountControls';
import { UiPerformanceDiagnostics } from '../components/UiPerformanceDiagnostics';
import { ProviderBaseUrlInput } from '../components/ProviderBaseUrlInput';
import { useChatGPTProviderSettings } from '../components/ChatGPTProviderSettings';
import { ProviderModelSwitchIndicator } from '../components/ProviderModelSwitchIndicator';
import { fastTaskReasoningStart, fastTaskReasoningEnd } from '../llm/fastTaskPrompt';
import { usePanelNavigationOverlay } from '../navigation/usePanelNavigation';
import { useSliderPreview } from './useSliderPreview';
import { TextEffectOptions } from '../components/TextEffectOptions';
import type { TextEffectsSettings } from '../chat/textEffects';
import { reasoningActivation, normalizeReasoningEffort, supportsReasoningEffort, type ReasoningCapabilities } from '../../shared/reasoning.cjs';
import type { StorybookCharacter } from '../storybook/runtime';
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { CharacterSaveOptions } from '../components/CharacterSaveOptions';
import { StatLine } from '../components/StatLine';
import { ModelIdPicker } from '../components/ModelIdPicker';
import { DarkAudioPlayer } from '../components/DarkAudioPlayer';
import type {
  MessageRecord,
  ConnectionPreset,
  ChatGPTModelInfo,
  ProviderConnectionCapabilities,
  ProviderConnectionHealth,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  SettingsValueDefinition,
  SavedFileSummary,
  WorkflowNode,
} from '../types';
import {
  characterStatDefinitions,
  fixedTokenEstimateReservePercent,
  formatAppointments,
  formatChatHistorySegments,
} from '../workflow';
import { storyCharacterRefsFromNodes } from '../storybook/runtime';
import { FileFormatsGuide } from '../components/FileFormatsGuide';
import {
  CharacterStatsChart,
  characterStatChartColors,
} from '../nodes/character-stats/Card';
import {
  normalizeEventAppointments,
} from '../data-management/eventStore';
import { NodeCustomSelect } from '../nodes/shared/NodeCustomSelect';
import { PromptPreviewBlock } from '../nodes/shared/PromptTools';
import { HighlightedPreviewText } from '../nodes/shared/HighlightedPreviewText';
import { providerOption } from '../nodes/shared/providerHealthLabels';
import { llmProviderKind } from '../llm/providerKind';
import { sanitizeDataUrls, sanitizeDataUrlsInText } from '../utils/sanitize';
import type { CharacterSaveLocation } from '../app/useRpgraphFiles';
import {
  connectionReasoningEfforts,
  bundledComfyWorkflows,
  bundledComfyWorkflowPathForRole,
  defaultComfyCheckpointName,
  defaultComfyDiffusionModelName,
  defaultComfyHeight,
  defaultComfyLoraSlots,
  defaultComfyPrompt,
  defaultComfyCfg,
  defaultComfySampler,
  defaultComfyScheduler,
  defaultComfySteps,
  defaultComfyTextEncoderName,
  defaultComfyVaeName,
  defaultComfyWidth,
  defaultComfyWorkflowPath,
  defaultConnectionSampling,
  comfySetupRequiredMessage,
  maxSmoothChatAutoScrollMinSpeed,
  missingComfySetupFields,
  minSmoothChatAutoScrollMinSpeed,
  comfyCharacterLoraName,
  validSmoothChatAutoScrollMinSpeed,
  validComfyLoraSlots,
} from '../settings';
import {
  comfyWorkflowCompatibilityMessage,
  type ComfyWorkflowInspection,
} from '../comfy/workflowCompatibility';
import { comfyConnectionRole } from '../comfy/connectionRole';
import { copyTextToClipboard } from '../utils/clipboard';
import { StorybookReadonlyPreview } from '../components/StorybookReadonlyPreview';
import { normalizeRpStorybook, type RpStorybook } from '../nodes/rp-storybook/model';
import type { CharacterImportChoice } from '../storybook/useStorybookActions';
import { storybookDisplayName } from '../storybook/displayName';

type ComfyModelLists = {
  checkpoints: string[];
  loras: string[];
  vae: string[];
  text_encoders: string[];
  diffusion_models: string[];
  samplers: string[];
  schedulers: string[];
};

type ComfyOnboardingMemoryInfo = {
  title: string;
  body: string;
};

function comfyOnboardingMemoryInfo(role: 'image' | 'voice' | null): ComfyOnboardingMemoryInfo | null {
  if (role === 'voice') {
    return {
      title: 'How voice model memory is managed',
      body: 'Higgs Audio needs about 11 GB of VRAM while it is active. A local Gemma 4 LLM can need about 24 GB, so keeping both ready for fast switching needs about 35 GB of system memory/cache. RPGraph keeps the voice model warm for quick clips, then unloads it before the next local LM Studio, Ollama, or llama.cpp LLM request; with enough memory this switch is usually around two seconds. API LLM providers do not need that local LLM switch.',
    };
  }

  if (role === 'image') {
    return {
      title: 'How image model memory is managed',
      body: 'Krea 2 needs about 16 GB of VRAM while it is active. Together with a local Gemma 4 LLM at about 24 GB, fast local switching needs about 40 GB of system memory/cache. RPGraph unloads local LM Studio, Ollama, or llama.cpp models before ComfyUI image generation and can unload ComfyUI again after generation when the workflow asks for memory management. API LLM providers do not use local LLM VRAM, so they avoid this swap.',
    };
  }

  return null;
}

function formatFileDate(value: string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type StudioDialogsProps = {
  appCharacters?: StorybookCharacter[];
  textDialogNode?: WorkflowNode;
  nodes: WorkflowNode[];
  textDialogView:
    | 'text'
    | 'output-highlighting'
    | 'character-stats-context'
    | 'character-stats-response'
    | 'character-stats-prompts'
    | 'character-stats-chart'
    | 'history-time-response'
    | 'event-manager-response'
    | 'event-manager-appointments';
  onCloseText: () => void;
  jsonDialogNode?: WorkflowNode;
  onCloseJson: () => void;
  showOptions: boolean;
  englishProcessingEnabled: boolean;
  inputTranslationOnlyEnabled: boolean;
  displayLanguage: string;
  tokenEstimateBytesPerToken: number;
  autoCalibrateTokenEstimate: boolean;
  activeTokenEstimateBytesPerToken: number;
  settingsValueDefinitions: SettingsValueDefinition[];
  settingsValues: Record<string, string>;
  textEffects: TextEffectsSettings;
  onTextEffectsChange: (value: TextEffectsSettings) => void;
  chatTextBrightness: number;
  chatColorIntensity: number;
  chatMessageAvatarSize: number;
  onChatMessageAvatarSizeChange: (value: number) => void;
  appMessageAvatarsEnabled: boolean;
  onAppMessageAvatarsEnabledChange: (enabled: boolean) => void;
  chatMessageAvatarsEnabled: boolean;
  onChatMessageAvatarsEnabledChange: (enabled: boolean) => void;
  chatTextSize: number;
  phoneChatTextSize: number;
  smoothChatAutoScrollEnabled: boolean;
  smoothChatAutoScrollMinSpeed: number;
  thoughtTextStyle: 'bold' | 'italic' | 'light';
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  showReferenceImagesInContext: boolean;
  referenceImageTurnLookback: number;
  maxReferenceImages: number;
  glassDesignEnabled: boolean;
  glassDesignOpacity: number;
  nodeTextSize: 'small' | 'normal' | 'big';
  uiScale: number;
  minUiScale: number;
  maxUiScale: number;
  retryFormatErrorsEnabled: boolean;
  onCloseOptions: () => void;
  accountActivationDisabled?: boolean;
  defaultCharacterExportDestination: 'npc-characters' | 'account-npc-characters';
  onDefaultCharacterExportDestinationChange: (destination: 'npc-characters' | 'account-npc-characters') => void;
  onEnglishProcessingChange: (enabled: boolean) => void;
  onInputTranslationOnlyChange: (enabled: boolean) => void;
  onDisplayLanguageChange: (language: string) => void;
  onTokenEstimateBytesPerTokenChange: (value: number) => void;
  onAutoCalibrateTokenEstimateChange: (enabled: boolean) => void;
  onSettingsValueAdd: () => void;
  onSettingsValueChange: (optionKey: string, value: string) => void;
  onSettingsValueRename: (optionKey: string, label: string) => void;
  onSettingsValueRemove: (optionKey: string) => void;
  onChatTextBrightnessChange: (value: number) => void;
  onChatColorIntensityChange: (value: number) => void;
  onChatTextSizeChange: (value: number) => void;
  onPhoneChatTextSizeChange: (value: number) => void;
  onSmoothChatAutoScrollEnabledChange: (enabled: boolean) => void;
  onSmoothChatAutoScrollMinSpeedChange: (value: number) => void;
  onThoughtTextStyleChange: (style: 'bold' | 'italic' | 'light') => void;
  onRpDateTimeFormatChange: (format: RpDateTimeFormat) => void;
  onRpWeekdayLanguageChange: (language: RpWeekdayLanguage) => void;
  onShowReferenceImagesInContextChange: (enabled: boolean) => void;
  onReferenceImageTurnLookbackChange: (value: number) => void;
  onMaxReferenceImagesChange: (value: number) => void;
  onGlassDesignEnabledChange: (enabled: boolean) => void;
  onGlassDesignOpacityChange: (opacity: number) => void;
  onNodeTextSizeChange: (size: 'small' | 'normal' | 'big') => void;
  onUiScaleChange: (scale: number) => void;
  onRetryFormatErrorsChange: (enabled: boolean) => void;
  showFiles: boolean;
  showStorybookPicker: boolean;
  savedFiles: SavedFileSummary[];
  selectedFile: string | null;
  workflowName: string;
  storybookName: string;
  characterName: string;
  workflowFormatVersion: string;
  rpSaveFormatVersion: string;
  storybookFormatVersion: string;
  workflowOverwritePending: boolean;
  fileStorageStatus: string;
  onCloseFiles: () => void;
  onCloseStorybookPicker: () => void;
  onRequestOpenStorybookFile: () => void;
  onSelectFile: (file: SavedFileSummary) => void;
  onOpenFile: (file: SavedFileSummary) => void;
  onDeleteFile: (file: SavedFileSummary) => void;
  onRequestOpenFile: () => void;
  onRestoreDefaultFiles: () => void;
  onRequestExportWorkflow: () => void;
  onRequestSaveStorybook: () => void;
  onWorkflowNameChange: (name: string) => void;
  onStorybookNameChange: (name: string) => void;
  onCharacterNameChange: (name: string) => void;
  onRequestSaveSession: () => void;
  sessionPasswordAction: 'save-workflow' | 'save-session' | 'save-storybook' | 'save-character' | 'load' | 'open-file' | 'load-storybook' | 'load-character' | null;
  sessionOverwritePending: boolean;
  sessionName: string;
  sessionPassword: string;
  fileProtection: 'plain' | 'encrypted';
  encryptionRequired: boolean;
  workflowSaveScope: 'workflow' | 'workflow-storybook';
  chooseSaveLocation: boolean;
  characterSaveLocation: CharacterSaveLocation;
  includeCharacterReceivedImages: boolean;
  onIncludeCharacterReceivedImagesChange: (value: boolean) => void;
  includeCharacterOwnPosts: boolean;
  onCloseSessionPassword: () => void;
  onSessionNameChange: (name: string) => void;
  onSessionPasswordChange: (password: string) => void;
  onFileProtectionChange: (protection: 'plain' | 'encrypted') => void;
  onWorkflowSaveScopeChange: (scope: 'workflow' | 'workflow-storybook') => void;
  onChooseSaveLocationChange: (enabled: boolean) => void;
  onCharacterSaveLocationChange: (location: CharacterSaveLocation) => void;
  onIncludeCharacterOwnPostsChange: (enabled: boolean) => void;
  onSubmitSessionPassword: () => void;
  showCharacterFiles: boolean;
  characterImportChoices: CharacterImportChoice[];
  selectedCharacterImportKey: string | null;
  characterFileStatus: string;
  onCloseCharacterFiles: () => void;
  onSelectCharacterImport: (choice: CharacterImportChoice | null) => void;
  onImportCharacterChoice: (choice?: CharacterImportChoice) => void;
  onOpenExternalCharacterFile: () => void;
  showConnections: boolean;
  connections: ConnectionPreset[];
  editingConnection: ConnectionPreset;
  connectionDraftPending: boolean;
  editingConnectionCapabilities?: ProviderConnectionCapabilities;
  editingConnectionArchitecture?: string;
  editingConnectionReasoning?: ReasoningCapabilities;
  editingConnectionSupportedVoices: string[];
  editingConnectionSupportedParameters: string[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  availableConnectionModels: string[];
  chatgptModelsByProfileId: Record<string, ChatGPTModelInfo[]>;
  onSelectChatGPTProfile: (profileId: string, connectionId: string) => void;
  onRefreshChatGPTConnections: () => void;
  availableComfyModels: ComfyModelLists;
  comfyWorkflowInspection: ComfyWorkflowInspection | null;
  comfyWorkflowRepairStatus: string;
  comfyWorkflowRepairReady: boolean;
  comfyWorkflowRepairInspection: ComfyWorkflowInspection | null;
  connectionStatus: string;
  onCloseConnections: () => void;
  onSelectConnection: (connection: ConnectionPreset) => void;
  onNewConnection: () => void;
  onApplyProviderPreset: (
    preset: Pick<ConnectionPreset, 'kind' | 'providerKind' | 'label' | 'baseUrl' | 'apiKey' | 'model' | 'ttsStreamAudio' | 'comfyWorkflowPath' | 'comfyWidth' | 'comfyHeight' | 'comfyPrompt' | 'comfyCheckpointName' | 'comfyDiffusionModelName' | 'comfyVaeName' | 'comfyTextEncoderName' | 'comfySteps' | 'comfyCfg' | 'comfySampler' | 'comfyScheduler' | 'comfyLoraSlots' | 'reasoningEffort'>,
  ) => void;
  onApplyComfyConnectionRole: (role: 'image' | 'voice') => void;
  onEditConnection: (field: keyof ConnectionPreset, value: ConnectionPreset[keyof ConnectionPreset]) => void;
  onRefreshConnectionModels: () => void;
  onDeleteConnection: () => void;
  onCheckConnectionModels: () => void;
  onConnectComfyProvider: () => void;
  onSelectBundledComfyWorkflow: (workflowPath: string) => void;
  onConfirmComfyWorkflowSetup: () => void;
  onRepairComfyWorkflow: (llmConnectionId: string) => void;
  onApplyComfyWorkflowRepair: () => void;
  onGenerateComfyTestImage: () => void;
  onGenerateCharacterVoicePreview: (request: {
    providerId: string;
    speechText: string;
    sampleDataUrl: string;
  }) => Promise<Array<{ dataUrl: string; filename: string }>>;
  onUnloadComfyModels: () => void;
  comfyProviderActionActive: 'models' | 'generate' | 'unload' | 'repair' | 'apply-repair' | null;
  lmStudioToolsAvailable: boolean;
  modelCapabilitiesSourceLabel?: string;
  lmStudioModelActionActive: 'load' | 'unload' | null;
  onLoadLmStudioModel: () => void;
  onUnloadLmStudioModels: () => void;
  ollamaToolsAvailable: boolean;
  llamaCppToolsAvailable: boolean;
  ollamaModelActionActive: 'load' | 'unload' | null;
  onLoadOllamaModel: () => void;
  onUnloadOllamaModels: () => void;
  onLoadLlamaCppModel: () => void;
  onUnloadLlamaCppModels: () => void;
  onApplyConnectionToAllNodes: () => void;
  onSetNarratorOnlyProvider: (providerId: string) => void;
};

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m14 6 4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <path d="M12 9.3a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4Z" />
      {hidden && <path d="M4 4 20 20" />}
    </svg>
  );
}

function ChatUiIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function TranslationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2 3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="M22 22l-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
}

function NodesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function VariablesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 9a3 3 0 1 0-6 0v1a3 3 0 0 1-3 3 3 3 0 0 1 3 3v1a3 3 0 1 0 6 0" />
      <path d="M14 9a3 3 0 1 1 6 0v1a3 3 0 0 0 3 3 3 3 0 0 0-3 3v1a3 3 0 1 1-6 0" />
    </svg>
  );
}

function ImagesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function TokenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6v6H9z" />
      <path d="M9 1v3" />
      <path d="M15 1v3" />
      <path d="M9 20v3" />
      <path d="M15 20v3" />
      <path d="M20 9h3" />
      <path d="M20 15h3" />
      <path d="M1 9h3" />
      <path d="M1 15h3" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

const OPTIONS_TABS = [
  { id: 'accounts', label: 'Accounts', desc: 'Files and privacy' },
  { id: 'chat', label: 'Chat & UI', desc: 'Avatars, scale and scrolling' },
  { id: 'text', label: 'Text', desc: 'Size, color and effects' },
  { id: 'translation', label: 'Translation', desc: 'Processing and display language' },
  { id: 'nodes', label: 'Node Design', desc: 'Appearance and transparency' },
  { id: 'variables', label: 'Workflow Variables', desc: 'Reusable prompt values' },
  { id: 'images', label: 'Reference Images', desc: 'Image history and limits' },
  { id: 'tokens', label: 'Token Estimate', desc: 'Factors and calibration' },
  { id: 'reliability', label: 'Run Reliability', desc: 'Format error retries' },
] as const;

type OptionsTabId = typeof OPTIONS_TABS[number]['id'];


type ProviderCapabilityKind = keyof ProviderConnectionCapabilities;

const providerCapabilityLabels: Record<ProviderCapabilityKind, string> = {
  reasoning: 'Reasoning',
  text: 'Text',
  vision: 'Vision',
  tools: 'Tools',
  image: 'Image generation',
  voice: 'Audio generation',
};

function ProviderCapabilityIcon({ kind }: { kind: ProviderCapabilityKind }) {
  if (kind === 'reasoning') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5a3 3 0 0 0-5.8-1A4 4 0 0 0 3 10a4 4 0 0 0 1 7.5A4 4 0 0 0 12 19V5Z" />
        <path d="M12 5a3 3 0 0 1 5.8-1A4 4 0 0 1 21 10a4 4 0 0 1-1 7.5A4 4 0 0 1 12 19M7 4v3M3 10h4l2 2M4 17.5 8 16M17 4v3M21 10h-4l-2 2M20 17.5 16 16" />
      </svg>
    );
  }
  if (kind === 'text') {
    return <span className="provider-capability-text-mark" aria-hidden="true">TXT</span>;
  }
  if (kind === 'voice') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="4 9 8 9 13 4 13 20 8 15 4 15" />
        <path d="M17 9.5a4 4 0 0 1 0 5" />
        <path d="M19.5 7a7.5 7.5 0 0 1 0 10" />
      </svg>
    );
  }
  if (kind === 'vision') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (kind === 'tools') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function ProviderCapabilityBadges({
  capabilities,
  kinds,
  showInactive = false,
  reasoningEnabled,
}: {
  capabilities?: ProviderConnectionCapabilities;
  kinds: ProviderCapabilityKind[];
  showInactive?: boolean;
  reasoningEnabled?: boolean;
}) {
  const badges = kinds.filter(kind => kind !== 'tools').flatMap((kind) => {
    const active = capabilities?.[kind] === true;
    if (!active && !showInactive) {
      return [];
    }
    const label = providerCapabilityLabels[kind];
    const isReasoning = kind === 'reasoning';
    const state = isReasoning && active
      ? reasoningEnabled === true ? 'active' : 'available'
      : active ? 'active' : 'inactive';
    const description = isReasoning && active
      ? reasoningEnabled === true ? 'enabled' : reasoningEnabled === false
        ? 'supported, disabled' : 'supported, activation unknown'
      : kind === 'image' && active ? 'used as an image generation provider, even when text output is supported'
      : active ? 'available' : capabilities?.[kind] === false ? 'not supported' : 'unknown';
    return (
      <span
        key={kind}
        className={`provider-capability-badge ${state}`}
        data-tooltip={`${label}: ${description}`}
        aria-label={`${label}: ${description}`}
        title={`${label}: ${description}`}
      >
        <ProviderCapabilityIcon kind={kind} />
      </span>
    );
  });
  return badges.length ? <span className="provider-capability-badges">{badges}</span> : null;
}

function ProviderPresetCapabilityBadge({
  kind,
  title,
  description,
  ariaLabel,
  active = true,
}: {
  kind: ProviderCapabilityKind;
  title: string;
  description: string;
  ariaLabel?: string;
  active?: boolean;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor]);

  return (
    <>
      <span
        className={`provider-capability-badge ${active ? 'active' : 'inactive'}`}
        tabIndex={0}
        aria-label={ariaLabel || `${title}: ${description}`}
        aria-describedby={anchor ? id : undefined}
        onMouseEnter={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setAnchor(null)}
        onFocus={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
        onBlur={() => setAnchor(null)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setAnchor(null);
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <ProviderCapabilityIcon kind={kind} />
      </span>
      {anchor &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="provider-model-switch-tooltip"
            style={{
              left: Math.max(12, Math.min(anchor.right - 300, window.innerWidth - 312)),
              top: anchor.top > window.innerHeight / 2 ? anchor.top - 8 : anchor.bottom + 8,
              transform: anchor.top > window.innerHeight / 2 ? 'translateY(-100%)' : undefined,
            }}
          >
            <strong>{title}</strong>
            <p>{description}</p>
          </div>,
          document.body,
        )}
    </>
  );
}

const providerPresets = [
  {
    label: 'Sign in with ChatGPT',
    kind: 'llm',
    providerKind: 'chatgpt',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
    reasoningEffort: 'low',
    models: [],
    description: 'Use your eligible ChatGPT plan',
  },
  {
    label: 'LM Studio',
    kind: 'llm',
    providerKind: 'lm-studio',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: '',
    model: '',
    reasoningEffort: 'none',
    models: [''],
    description: 'Local LM Studio server',
  },
  {
    label: 'Ollama',
    kind: 'llm',
    providerKind: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: '',
    reasoningEffort: 'none',
    models: [''],
    description: 'Local Ollama server',
  },
  {
    label: 'llama.cpp',
    kind: 'llm',
    providerKind: 'llama-cpp',
    baseUrl: 'http://localhost:8080/v1',
    apiKey: '',
    model: '',
    reasoningEffort: 'none',
    models: [''],
    description: 'Local llama-server router',
  },
  {
    label: 'Unsloth',
    kind: 'llm',
    providerKind: 'unsloth',
    baseUrl: 'http://localhost:8888/v1',
    apiKey: '',
    model: '',
    reasoningEffort: 'none',
    models: [''],
    description: 'Local Unsloth server',
  },
  {
    label: 'OpenRouter',
    kind: 'llm',
    providerKind: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'openrouter/auto',
    ttsStreamAudio: true,
    reasoningEffort: 'none',
    models: ['openrouter/auto'],
    description: 'Model router and marketplace',
  },
  {
    label: 'Google Gemini',
    kind: 'llm',
    providerKind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    model: 'gemini-2.5-flash',
    reasoningEffort: 'none',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    description: 'Google Gemini API',
  },
  {
    label: 'Composite',
    kind: 'llm',
    providerKind: 'composite',
    baseUrl: 'https://composite.lucidity.sh/v1',
    apiKey: '',
    model: 'composite/gemini-router',
    reasoningEffort: 'none',
    models: ['composite/gemini-router', 'composite/gpt-router'],
    description: 'Composite OpenAI-compatible roleplay API',
  },
  {
    label: 'Venice AI',
    kind: 'llm',
    providerKind: 'venice',
    baseUrl: 'https://api.venice.ai/api/v1',
    apiKey: '',
    model: 'venice-uncensored',
    ttsStreamAudio: false,
    reasoningEffort: 'none',
    models: ['venice-uncensored'],
    description: 'Venice text, vision, image, and speech API',
  },
  {
    label: 'ComfyUI',
    kind: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    apiKey: '',
    model: '',
    comfyWorkflowPath: defaultComfyWorkflowPath,
    comfyWidth: defaultComfyWidth,
    comfyHeight: defaultComfyHeight,
    comfyPrompt: defaultComfyPrompt,
    comfyCheckpointName: defaultComfyCheckpointName,
    comfyDiffusionModelName: defaultComfyDiffusionModelName,
    comfyVaeName: defaultComfyVaeName,
    comfyTextEncoderName: defaultComfyTextEncoderName,
    comfySteps: defaultComfySteps,
    comfyCfg: defaultComfyCfg,
    comfySampler: defaultComfySampler,
    comfyScheduler: defaultComfyScheduler,
    comfyLoraSlots: defaultComfyLoraSlots,
    reasoningEffort: 'none',
    models: [''],
    description: 'Image and voice generation server',
  },
  {
    label: 'OpenAI Compatible',
    kind: 'llm',
    providerKind: 'openai-compatible',
    baseUrl: 'http://localhost:8080/v1',
    apiKey: '',
    model: '',
    reasoningEffort: 'auto',
    models: [''],
    description: 'Custom API; manual model loading',
  },
] satisfies Array<
  Pick<ConnectionPreset, 'kind' | 'providerKind' | 'label' | 'baseUrl' | 'apiKey' | 'model' | 'ttsStreamAudio' | 'comfyWorkflowPath' | 'comfyWidth' | 'comfyHeight' | 'comfyPrompt' | 'comfyCheckpointName' | 'comfyDiffusionModelName' | 'comfyVaeName' | 'comfyTextEncoderName' | 'comfySteps' | 'comfyCfg' | 'comfySampler' | 'comfyScheduler' | 'comfyLoraSlots' | 'reasoningEffort'> & {
    models: string[];
    description: string;
  }
>;

const PRESET_CAPABILITY_INFO: Record<
  'text' | 'vision' | 'image' | 'voice',
  { title: string; description: string }
> = {
  text: {
    title: 'Provider supports text generation',
    description: 'Provider supports text and chat completions.',
  },
  vision: {
    title: 'Provider supports vision input',
    description: 'Provider supports multimodal image input with compatible models.',
  },
  image: {
    title: 'Provider supports image generation',
    description: 'Provider supports image generation with compatible models or workflows.',
  },
  voice: {
    title: 'Provider supports audio generation',
    description: 'Provider supports audio generation and text-to-speech with compatible models.',
  },
};

function getProviderPresetBadges(
  provider: (typeof providerPresets)[number],
): Array<'text' | 'vision' | 'image' | 'voice'> {
  if (provider.providerKind === 'chatgpt') return ['text', 'vision'];
  if (provider.kind === 'comfyui') {
    return ['image', 'voice'];
  }
  if (
    provider.providerKind === 'openrouter' ||
    provider.providerKind === 'gemini'
  ) {
    return ['text', 'vision', 'image', 'voice'];
  }
  return ['text', 'vision'];
}

const connectionReasoningLabels = {
  auto: 'Auto / provider default',
  none: 'Off',
  on: 'On',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Very high',
  max: 'Max',
} satisfies Record<NonNullable<ConnectionPreset['reasoningEffort']>, string>;

function CharacterStatsChartDialog({ node, nodes }: { node: WorkflowNode; nodes: WorkflowNode[] }) {
  const characters = storyCharacterRefsFromNodes(nodes);
  const definitions = characterStatDefinitions(node.data);
  const characterIds = new Set(characters.map((character) => character.nodeId));
  const initialCharacterId =
    node.data.characterStatsPrimaryId && characterIds.has(node.data.characterStatsPrimaryId)
      ? node.data.characterStatsPrimaryId
      : characters[0]?.nodeId;
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | undefined>(initialCharacterId);
  const [visibleStats, setVisibleStats] = useState(() =>
    new Set(definitions.filter((definition) => definition.enabled).map((definition) => definition.id)),
  );
  const activeCharacterId =
    selectedCharacterId && characterIds.has(selectedCharacterId)
      ? selectedCharacterId
      : initialCharacterId;

  function toggleStat(statId: string, enabled: boolean) {
    setVisibleStats((current) => {
      const next = new Set(current);
      if (enabled) {
        next.add(statId);
      } else {
        next.delete(statId);
      }
      return next;
    });
  }

  return (
    <div className="character-stats-chart-dialog">
      <div className="character-stats-chart-dialog-controls">
        <div>
          <span className="node-field-label">CHARACTER</span>
          <div className="resolver-cast-list">
            {characters.map((character) => (
              <button
                className={`resolver-cast-chip character-select-chip nodrag ${
                  character.nodeId === activeCharacterId ? 'primary' : 'inactive'
                }`}
                key={character.nodeId}
                type="button"
                onClick={() => setSelectedCharacterId(character.nodeId)}
              >
                {character.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="node-field-label">STATS</span>
          <div className="character-stats-chart-toggles">
            {definitions.filter((definition) => definition.enabled).map((definition, index) => (
              <label className="node-toggle nodrag" key={definition.id}>
                <input
                  className="nodrag nowheel"
                  type="checkbox"
                  checked={visibleStats.has(definition.id)}
                  onChange={(event) => toggleStat(definition.id, event.target.checked)}
                />
                <i style={{ background: characterStatChartColors[index % characterStatChartColors.length] }} />
                {definition.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <CharacterStatsChart
        definitions={definitions}
        selectedCharacterId={activeCharacterId}
        selectedStats={visibleStats}
        timeline={node.data.characterStatsTimeline}
      />
    </div>
  );
}

function characterStatsPromptOverview(node: WorkflowNode) {
  const hasState = !!node.data.characterStatsState;
  return [
    'CHARACTER STATS TRACKER PROMPTS',
    '',
    'Variables are shown as <variableName>.',
    `Current node settings: <hasState> = ${hasState ? 'true' : 'false'}, <maxChange> = ${
      node.data.characterStatsMaxChange ?? 10
    }`,
    '',
    'MAIN TRACKER PROMPT TEMPLATE',
    fastTaskReasoningStart,
    '',
    'You maintain compact roleplay character stats.',
    'Return TOON only.',
    'Character stats belong to one character.',
    'Use only the exact short character references given below.',
    'Use valid TOON syntax.',
    '<stateInstruction>',
    '<keepShape or initShape>',
    '<patchShape>',
    'Do not invent unknown characters.',
    'For patches, include only changed stats. Never repeat unchanged stats.',
    'Use the exact stat names as the attributes to track.',
    '',
    'CHARACTER STATS (TOON):',
    '<enabled character stat names>',
    '',
    'CHARACTERS (TOON):',
    '<characterReferences>',
    '<currentStateBlock>',
    '',
    '<INITIAL CONTEXT or LAST MESSAGE>',
    '',
    fastTaskReasoningEnd,
    '',
    'ACTION SHAPES',
    'Initial run:',
    'action: init',
    'characters:',
    '  <character-reference>:',
    '    <Character Stat>: 0 to 100',
    '',
    'Patch run:',
    'action: patch',
    'characterChanges:',
    '  <character-reference>:',
    '    <Character Stat>: -<maxChange> to +<maxChange>',
    '',
    'No change:',
    'action: keep',
  ].join('\n');
}

function formatChatHistoryFromRaw(
  rawHistory: string | undefined,
  fallback: string | undefined,
  rpDateTimeFormat: RpDateTimeFormat,
  rpWeekdayLanguage: RpWeekdayLanguage,
  characters: StorybookCharacter[] = [],
) {
  const segments = formatChatHistorySegmentsFromRaw(rawHistory, rpDateTimeFormat, rpWeekdayLanguage, characters);
  return segments.length ? segments.map((segment) => segment.text).join('\n\n') : fallback ?? '';
}

function formatChatHistorySegmentsFromRaw(
  rawHistory: string | undefined,
  rpDateTimeFormat: RpDateTimeFormat,
  rpWeekdayLanguage: RpWeekdayLanguage,
  characters: StorybookCharacter[] = [],
) {
  if (!rawHistory) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(rawHistory);
    return Array.isArray(parsed)
      ? formatChatHistorySegments(
          parsed as MessageRecord[],
          false,
          rpDateTimeFormat,
          rpWeekdayLanguage,
          undefined, characters,
        )
      : [];
  } catch {
    return [];
  }
}

const rpWeekdayLanguageOptions: Array<{ value: RpWeekdayLanguage; label: string }> = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'system', label: 'System Default' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'en-US', label: 'English' },
  { value: 'ru-RU', label: 'Русский' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'es-ES', label: 'Español' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'pt-BR', label: 'Português' },
  { value: 'pl-PL', label: 'Polski' },
  { value: 'tr-TR', label: 'Türkçe' },
  { value: 'uk-UA', label: 'Українська' },
  { value: 'ar-SA', label: 'العربية' },
  { value: 'zh-CN', label: '中文' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'hi-IN', label: 'हिन्दी' },
  { value: 'id-ID', label: 'Bahasa Indonesia' },
  { value: 'nl-NL', label: 'Nederlands' },
  { value: 'sv-SE', label: 'Svenska' },
  { value: 'vi-VN', label: 'Tiếng Việt' },
];

export function StudioDialogs({
  appCharacters = [],
  textDialogNode,
  nodes,
  textDialogView,
  onCloseText,
  jsonDialogNode,
  onCloseJson,
  showOptions,
  englishProcessingEnabled,
  inputTranslationOnlyEnabled,
  displayLanguage,
  tokenEstimateBytesPerToken,
  autoCalibrateTokenEstimate,
  activeTokenEstimateBytesPerToken,
  settingsValueDefinitions,
  settingsValues,
  textEffects,
  onTextEffectsChange,
  chatTextBrightness,
  chatColorIntensity,
  chatMessageAvatarSize,
  onChatMessageAvatarSizeChange,
  appMessageAvatarsEnabled,
  onAppMessageAvatarsEnabledChange,
  chatMessageAvatarsEnabled,
  onChatMessageAvatarsEnabledChange,
  chatTextSize,
  phoneChatTextSize,
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
  minUiScale,
  maxUiScale,
  retryFormatErrorsEnabled,
  onCloseOptions,
  accountActivationDisabled = false,
  onEnglishProcessingChange,
  onInputTranslationOnlyChange,
  onDisplayLanguageChange,
  onTokenEstimateBytesPerTokenChange,
  onAutoCalibrateTokenEstimateChange,
  onSettingsValueAdd,
  onSettingsValueChange,
  onSettingsValueRename,
  onSettingsValueRemove,
  onChatTextBrightnessChange,
  onChatColorIntensityChange,
  onChatTextSizeChange,
  onPhoneChatTextSizeChange,
  onSmoothChatAutoScrollEnabledChange,
  onSmoothChatAutoScrollMinSpeedChange,
  onThoughtTextStyleChange,
  onRpDateTimeFormatChange,
  onRpWeekdayLanguageChange,
  onShowReferenceImagesInContextChange,
  onReferenceImageTurnLookbackChange,
  onMaxReferenceImagesChange,
  onGlassDesignEnabledChange,
  onGlassDesignOpacityChange,
  onNodeTextSizeChange,
  onUiScaleChange,
  onRetryFormatErrorsChange,
  defaultCharacterExportDestination,
  onDefaultCharacterExportDestinationChange,
  showFiles,
  showStorybookPicker,
  savedFiles,
  selectedFile,
  workflowName,
  storybookName,
  characterName,
  workflowFormatVersion,
  rpSaveFormatVersion,
  storybookFormatVersion,
  workflowOverwritePending,
  fileStorageStatus,
  onCloseFiles,
  onCloseStorybookPicker,
  onRequestOpenStorybookFile,
  onSelectFile,
  onOpenFile,
  onDeleteFile,
  onRequestOpenFile,
  onRestoreDefaultFiles,
  onRequestExportWorkflow,
  onRequestSaveStorybook,
  onWorkflowNameChange,
  onStorybookNameChange,
  onCharacterNameChange,
  onRequestSaveSession,
  sessionPasswordAction,
  sessionOverwritePending,
  sessionName,
  sessionPassword,
  fileProtection,
  encryptionRequired,
  workflowSaveScope,
  chooseSaveLocation,
  characterSaveLocation,
  includeCharacterReceivedImages,
  onIncludeCharacterReceivedImagesChange,
  includeCharacterOwnPosts,
  onCloseSessionPassword,
  onSessionNameChange,
  onSessionPasswordChange,
  onFileProtectionChange,
  onWorkflowSaveScopeChange,
  onChooseSaveLocationChange,
  onCharacterSaveLocationChange,
  onIncludeCharacterOwnPostsChange,
  onSubmitSessionPassword,
  showCharacterFiles,
  characterImportChoices,
  selectedCharacterImportKey,
  characterFileStatus,
  onCloseCharacterFiles,
  onSelectCharacterImport,
  onImportCharacterChoice,
  onOpenExternalCharacterFile,
  showConnections,
  connections,
  editingConnection,
  connectionDraftPending,
  editingConnectionCapabilities,
  editingConnectionArchitecture,
  editingConnectionReasoning,
  editingConnectionSupportedVoices,
  editingConnectionSupportedParameters,
  providerHealthById,
  availableConnectionModels,
  chatgptModelsByProfileId,
  onSelectChatGPTProfile,
  onRefreshChatGPTConnections,
  availableComfyModels,
  comfyWorkflowInspection,
  comfyWorkflowRepairStatus,
  comfyWorkflowRepairReady,
  comfyWorkflowRepairInspection,
  connectionStatus,
  onCloseConnections,
  onSelectConnection,
  onNewConnection,
  onApplyProviderPreset,
  onApplyComfyConnectionRole,
  onEditConnection,
  onRefreshConnectionModels,
  onDeleteConnection,
  onCheckConnectionModels,
  onConnectComfyProvider,
  onSelectBundledComfyWorkflow,
  onConfirmComfyWorkflowSetup,
  onRepairComfyWorkflow,
  onApplyComfyWorkflowRepair,
  onGenerateComfyTestImage,
  onGenerateCharacterVoicePreview,
  onUnloadComfyModels,
  comfyProviderActionActive,
  lmStudioToolsAvailable,
  modelCapabilitiesSourceLabel,
  lmStudioModelActionActive,
  onLoadLmStudioModel,
  onUnloadLmStudioModels,
  ollamaToolsAvailable,
  llamaCppToolsAvailable,
  ollamaModelActionActive,
  onLoadOllamaModel,
  onUnloadOllamaModels,
  onLoadLlamaCppModel,
  onUnloadLlamaCppModels,
  onApplyConnectionToAllNodes,
  onSetNarratorOnlyProvider,
}: StudioDialogsProps) {
  const sessionPasswordInputRef = useRef<HTMLInputElement>(null);
  const saveFileNameInputRef = useRef<HTMLInputElement>(null);
  const activeDialogRef = useRef<HTMLElement>(null);
  const backdropPointerStartedRef = useRef(false);
  const uiScaleInputRef = useRef<HTMLInputElement>(null);
  const uiScaleInputFocusedRef = useRef(false);
  const uiScalePercentRef = useRef(Math.round(uiScale * 100));
  const [showFileVersionInfo, setShowFileVersionInfo] = useState(false);
  const [storybookInfo, setStorybookInfo] = useState<{
    file: SavedFileSummary;
    storybook: RpStorybook;
  } | null>(null);
  const [storybookInfoLoading, setStorybookInfoLoading] = useState<string | null>(null);
  const [storybookInfoStatus, setStorybookInfoStatus] = useState('');
  const textEffectPreview = useSliderPreview(showOptions);
  const [activeOptionsTab, setActiveOptionsTab] = useState<OptionsTabId>('chat');
  const accountControls = useContext(AccountControlsContext);
  const [accountFolderStatus, setAccountFolderStatus] = useState('');
  const [filenamePrivacyBusy, setFilenamePrivacyBusy] = useState(false);
  const [filenamePrivacyStatus, setFilenamePrivacyStatus] = useState('');
  const [deleteAccountVisible, setDeleteAccountVisible] = useState(false);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
  const [deleteAccountStatus, setDeleteAccountStatus] = useState('');
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [developerOptionsVisible, setDeveloperOptionsVisible] = useState(false);
  useEffect(() => {
    if (developerOptionsVisible) return;
    const pressed = new Set<string>();
    const clear = () => pressed.clear();
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing ||
          (target instanceof HTMLElement &&
            (target.isContentEditable || target.closest('input, textarea, select')))) {
        clear();
        return;
      }
      const key = event.key.toLowerCase();
      if (!['d', 'e', 'v'].includes(key)) return;
      pressed.add(key);
      if (pressed.has('d') && pressed.has('e') && pressed.has('v')) {
        setDeveloperOptionsVisible(true);
        clear();
      }
    };
    const keyUp = (event: KeyboardEvent) => pressed.delete(event.key.toLowerCase());
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
    };
  }, [developerOptionsVisible]);

  const [deleteFileCandidate, setDeleteFileCandidate] = useState<SavedFileSummary | null>(null);
  const [fileFilter, setFileFilter] = useState<'all' | 'workflow' | 'storybook' | 'session' | 'character-card'>('all');
  const [characterImportFilters, setCharacterImportFilters] = useState<Record<CharacterImportChoice['source'], boolean>>({
    characters: true,
    'npc-library': true,
    'built-in': true,
  });

  const [editingWorkflowVariableKey, setEditingWorkflowVariableKey] = useState<string | null>(null);
  const [workflowVariableNameDraft, setWorkflowVariableNameDraft] = useState('');
  const [workflowVariableStatus, setWorkflowVariableStatus] = useState('');
  const [comfyWorkflowCopyStatus, setComfyWorkflowCopyStatus] = useState('');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [pendingProviderType, setPendingProviderType] = useState<(typeof providerPresets)[number] | null>(null);
  const [llamaCppRouterNoticePending, setLlamaCppRouterNoticePending] = useState(false);
  const [narratorVoiceTestText, setNarratorVoiceTestText] = useState(
    'The night was quiet as the rain fell softly against the window. Somewhere in the distance, a clock struck midnight.',
  );
  const [narratorVoiceTestStatus, setNarratorVoiceTestStatus] = useState('');
  const [narratorVoiceTesting, setNarratorVoiceTesting] = useState(false);
  const narratorVoiceTestAudioRef = useRef<HTMLAudioElement | null>(null);
  const [uiScalePercentDraft, setUiScalePercentDraft] = useState(() =>
    String(Math.round(uiScale * 100)),
  );
  const isSavingWorkflow = sessionPasswordAction === 'save-workflow';
  const isSavingSession = sessionPasswordAction === 'save-session';
  const isSavingStorybook = sessionPasswordAction === 'save-storybook';
  const isSavingCharacter = sessionPasswordAction === 'save-character';
  const isSavingFile = isSavingWorkflow || isSavingSession || isSavingStorybook || isSavingCharacter;
  const accountEncryption = !!getAccountPassword();

  async function openAccountFolder() {
    setAccountFolderStatus('Opening account folder…');
    try {
      await accountControls.openFolder();
      setAccountFolderStatus('Account folder opened.');
    } catch (error) {
      setAccountFolderStatus(
        `Unable to open account folder: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function changeFilenamePrivacy(enabled: boolean) {
    if (filenamePrivacyBusy) return;
    setFilenamePrivacyBusy(true);
    setFilenamePrivacyStatus('');
    try { await accountControls.setFilenamePrivacy(enabled); }
    catch (error) { setFilenamePrivacyStatus(error instanceof Error ? error.message : String(error)); }
    finally { setFilenamePrivacyBusy(false); }
  }

  async function deleteCurrentAccount() {
    if (deleteAccountBusy || accountActivationDisabled) return;
    if (!deleteAccountPassword) {
      setDeleteAccountStatus('Enter the current account password.');
      return;
    }
    if (!window.confirm('Delete this account and all files in its account folder? This cannot be undone.')) return;
    setDeleteAccountBusy(true);
    setDeleteAccountStatus('Deleting account…');
    try {
      await accountControls.deleteAccount(deleteAccountPassword);
    } catch (error) {
      setDeleteAccountStatus(error instanceof Error ? error.message : String(error));
      setDeleteAccountBusy(false);
    }
  }
  const savingKindLabel = isSavingWorkflow ? 'Workflow' : isSavingStorybook ? 'Storybook' : isSavingCharacter ? 'Character' : 'RP';
  const hasStoredWorkflow = savedFiles.some((file) => file.type === 'workflow');
  const hasStoredStorybook = savedFiles.some((file) => file.type === 'storybook');
  const storybookPickerFiles = savedFiles.filter((file) => file.type === 'storybook');
  const characterImportSections = ([
    { source: 'characters', title: 'Characters Folder' },
    { source: 'npc-library', title: 'NPC Library Folder' },
    { source: 'built-in', title: 'Built-in Characters' },
  ] as const).map((section) => ({
    ...section,
    choices: characterImportChoices
      .filter((choice) => choice.source === section.source)
      .sort((left, right) => left.name.localeCompare(right.name) || left.fileName.localeCompare(right.fileName)),
  })).filter((section) => characterImportFilters[section.source]);
  const connectionModelOptions = Array.from(
    new Set(
      [editingConnection.model, ...availableConnectionModels].filter(
        (model) => model.trim().length > 0,
      ),
    ),
  );
  const providerModelOptions = Array.from(
    new Set(
      [
        ...connectionModelOptions,
        ...(editingConnection.providerKind === 'chatgpt' ? [] : providerPresets.flatMap((provider) => provider.models)),
      ].filter((model) => model.trim().length > 0),
    ),
  );
  const isComfyConnection = editingConnection.kind === 'comfyui';
  const isChatGPTConnection = editingConnection.providerKind === 'chatgpt';
  const chatgptSettings = useChatGPTProviderSettings({
    connection: editingConnection,
    enabled: showConnections && isChatGPTConnection,
    connectionStatus,
    onSelectProfile: profileId => onSelectChatGPTProfile(profileId, editingConnection.id),
    onRefresh: onRefreshChatGPTConnections,
  });
  const chatgptModelOptions = chatgptModelsByProfileId[editingConnection.chatgptProfileId ?? ''] ?? [];
  const isImageModel = editingConnectionCapabilities?.image === true;
  const isVoiceOnlyModel =
    editingConnection.providerKind !== 'openai-compatible' &&
    editingConnectionCapabilities?.voice === true &&
    editingConnectionCapabilities.text !== true &&
    editingConnectionCapabilities.vision !== true &&
    editingConnectionCapabilities.image !== true &&
    editingConnectionCapabilities.tools !== true;
  const supportsTtsTemperature =
    isVoiceOnlyModel && editingConnectionSupportedParameters.includes('temperature');
  const supportsGeminiVoiceDirection =
    isVoiceOnlyModel && (
      editingConnection.model.startsWith('google/gemini-') ||
      editingConnection.model.startsWith('gemini-')
    );
  const editingComfyRole = comfyConnectionRole(editingConnection);
  const isComfyImageEditing = isComfyConnection && editingComfyRole === 'image';
  const isComfyVoiceEditing = isComfyConnection && editingComfyRole === 'voice';
  const comfyRolePending = isComfyConnection && editingComfyRole === null;
  const comfyWorkflowOptions = bundledComfyWorkflows.filter((workflow) => workflow.role === editingComfyRole);
  const comfyWorkflowSetupConfirmed = isComfyConnection && editingConnection.comfyWorkflowSetupConfirmed === true;
  const currentComfyWorkflowPath = bundledComfyWorkflowPathForRole(
    editingConnection.comfyWorkflowPath,
    editingComfyRole,
  );
  const selectedComfyWorkflow =
    comfyWorkflowOptions.find((workflow) => workflow.apiWorkflowPath === currentComfyWorkflowPath) ??
    comfyWorkflowOptions[0];
  const comfyOnboardingMemory = comfyOnboardingMemoryInfo(editingComfyRole);
  const editingProviderKind = llmProviderKind(editingConnection);
  const isMuseGlimmerReasoning =
    editingProviderKind === 'lm-studio' && !editingConnectionReasoning && (
      editingConnectionArchitecture === 'muse_glimmer' ||
      /muse[-_ ]glimmer/i.test(editingConnection.model)
    );
  const museGlimmerReasoningEfforts = ['low', 'medium', 'high', 'xhigh'] as const;
  const reasoningEfforts = isChatGPTConnection
    ? connectionReasoningEfforts.filter((effort) => effort !== 'auto' && effort !== 'on' && supportsReasoningEffort(effort, editingConnectionReasoning))
    : isMuseGlimmerReasoning
    ? museGlimmerReasoningEfforts
    : editingProviderKind === 'gemini' ? ['auto'] as const
    : connectionReasoningEfforts.filter((effort) =>
      (editingProviderKind === 'lm-studio' || editingProviderKind === 'ollama' || editingProviderKind === 'openai-compatible') && editingConnectionReasoning
        ? supportsReasoningEffort(effort, editingConnectionReasoning)
        : effort !== 'on');
  const selectedReasoningEffort = isChatGPTConnection ? chatgptReasoningEffort(editingConnection.reasoningEffort, editingConnectionReasoning)
    : isMuseGlimmerReasoning
    ? editingConnection.reasoningEffort === 'medium' ||
      editingConnection.reasoningEffort === 'high' ||
      editingConnection.reasoningEffort === 'xhigh'
      ? editingConnection.reasoningEffort
      : editingConnection.reasoningEffort === 'max'
        ? 'xhigh'
        : editingConnection.reasoningEffort === 'auto' || editingConnection.reasoningEffort === undefined
          ? 'high'
          : 'low'
    : editingProviderKind === 'gemini' ? 'auto'
    : normalizeReasoningEffort(editingConnection.reasoningEffort, editingConnectionReasoning);
  const comfyLoraSlots = validComfyLoraSlots(editingConnection.comfyLoraSlots ?? defaultComfyLoraSlots);
  const [comfyRepairProviderId, setComfyRepairProviderId] = useState('');
  const llmConnections = connections.filter((connection) => isTextGenerationConnection(connection, providerHealthById[connection.id]));
  const comfyWorkflowModelSource = comfyWorkflowInspection?.modelSource ?? 'missing';
  const comfyCheckpointDisabled =
    isComfyConnection && comfyWorkflowModelSource === 'diffusion_model';
  const comfyDiffusionModelDisabled =
    isComfyConnection && comfyWorkflowModelSource === 'checkpoint';
  const comfyWorkflowCanGenerate =
    !isComfyConnection || !comfyWorkflowInspection || comfyWorkflowInspection.ok;
  const missingComfySetup = isComfyConnection ? missingComfySetupFields(editingConnection) : [];
  const comfySetupMessage = comfySetupRequiredMessage(missingComfySetup);
  const comfySetupComplete = missingComfySetup.length === 0;
  const comfyWorkflowIncompatible =
    isComfyConnection && !!comfyWorkflowInspection && !comfyWorkflowInspection.ok;
  const comfyWorkflowChecklistInspection =
    comfyWorkflowRepairReady && comfyWorkflowRepairInspection
      ? comfyWorkflowRepairInspection
      : comfyWorkflowInspection;
  const selectedComfyRepairProviderId =
    llmConnections.some((connection) => connection.id === comfyRepairProviderId)
      ? comfyRepairProviderId
      : llmConnections[0]?.id ?? '';
  const editingConnectionHealth = providerHealthById[editingConnection.id] ?? { status: 'unknown' as const };
  const providerHealthLabel = (health: ProviderConnectionHealth | undefined) => {
    switch (health?.status) {
      case 'online':
        return 'Connected';
      case 'warning':
        return 'Setup needed';
      case 'offline':
        return 'Offline';
      case 'checking':
        return 'Checking';
      default:
        return 'Not checked';
    }
  };
  const providerHealthClass = (health: ProviderConnectionHealth | undefined) =>
    `provider-health ${health?.status ?? 'unknown'}`;
  const comfyModelOptions = (currentValue: string | undefined, options: string[], extras: string[] = []) =>
    Array.from(
      new Set(
        [
          currentValue ?? '',
          ...extras,
          ...options,
        ].filter((name) => name.trim().length > 0),
      ),
    );
  const comfyWorkflowChecklist = (() => {
    const missing = new Set(comfyWorkflowChecklistInspection?.missing ?? []);
    const originalMissing = new Set(comfyWorkflowInspection?.missing ?? []);
    const originalPlaceholders = new Set(comfyWorkflowInspection?.placeholders ?? []);
    const nextPlaceholders = new Set(comfyWorkflowChecklistInspection?.placeholders ?? []);
    const item = (id: string, label: string, ok: boolean, added: boolean) => ({
      id,
      label,
      ok,
      added,
    });
    if (isComfyVoiceEditing) {
      const placeholderItem = (id: string, label: string) =>
        item(
          id,
          label,
          !missing.has(id) && nextPlaceholders.has(id),
          !originalPlaceholders.has(id) && nextPlaceholders.has(id),
        );
      return [
        item(
          'format',
          'API workflow',
          comfyWorkflowChecklistInspection?.format === 'api',
          originalMissing.has('API workflow export') || originalMissing.has('ComfyUI API workflow JSON'),
        ),
        placeholderItem('speech_text', 'Speech text'),
        placeholderItem('voice_audio', 'Voice sample'),
      ];
    }
    const modelLabel = comfyWorkflowChecklistInspection?.modelSource === 'checkpoint'
      ? 'Checkpoint'
      : comfyWorkflowChecklistInspection?.modelSource === 'diffusion_model'
        ? 'Diffusion model'
        : comfyWorkflowChecklistInspection?.modelSource === 'both'
          ? 'Checkpoint or diffusion model'
          : 'Checkpoint or diffusion model';
    return [
      item(
        'format',
        'API workflow',
        comfyWorkflowChecklistInspection?.format === 'api',
        originalMissing.has('API workflow export') || originalMissing.has('ComfyUI API workflow JSON'),
      ),
      item(
        'resolution',
        'Resolution',
        !missing.has('width') && !missing.has('height') && nextPlaceholders.has('width') && nextPlaceholders.has('height'),
        (!originalPlaceholders.has('width') || !originalPlaceholders.has('height')) &&
          nextPlaceholders.has('width') &&
          nextPlaceholders.has('height'),
      ),
      item('prompt', 'Prompt', !missing.has('prompt') && nextPlaceholders.has('prompt'), !originalPlaceholders.has('prompt') && nextPlaceholders.has('prompt')),
      item('vae', 'VAE', !missing.has('vae') && nextPlaceholders.has('vae'), !originalPlaceholders.has('vae') && nextPlaceholders.has('vae')),
      item('text_encoder', 'Text encoder', !missing.has('text_encoder') && nextPlaceholders.has('text_encoder'), !originalPlaceholders.has('text_encoder') && nextPlaceholders.has('text_encoder')),
      item(
        'model',
        modelLabel,
        !missing.has('checkpoint or diffusion_model') &&
          (nextPlaceholders.has('checkpoint') || nextPlaceholders.has('diffusion_model')),
        !originalPlaceholders.has('checkpoint') &&
          !originalPlaceholders.has('diffusion_model') &&
          (nextPlaceholders.has('checkpoint') || nextPlaceholders.has('diffusion_model')),
      ),
      item(
        'lora',
        'LoRA slot',
        !missing.has('at least one lora placeholder') &&
          (nextPlaceholders.has('lora_01') || nextPlaceholders.has('lora')),
        !originalPlaceholders.has('lora_01') &&
          !originalPlaceholders.has('lora') &&
          (nextPlaceholders.has('lora_01') || nextPlaceholders.has('lora')),
      ),
    ];
  })();

  useEffect(() => {
    return () => {
      narratorVoiceTestAudioRef.current?.pause();
      narratorVoiceTestAudioRef.current = null;
    };
  }, []);
  const isHistoryTimeResponseDialog =
    textDialogNode?.data.nodeType === 'history' && textDialogView === 'history-time-response';
  const isEventManagerResponseDialog =
    textDialogNode?.data.nodeType === 'event-manager' && textDialogView === 'event-manager-response';
  const isEventManagerAppointmentsDialog =
    textDialogNode?.data.nodeType === 'event-manager' && textDialogView === 'event-manager-appointments';
  const isHistoryDialog =
    textDialogNode?.data.nodeType === 'history' &&
    !isHistoryTimeResponseDialog &&
    !isEventManagerResponseDialog &&
    !isEventManagerAppointmentsDialog;
  const isCompressionDialog = textDialogNode?.data.nodeType === 'context-compression';
  const isOutputHighlightingDialog =
    textDialogNode?.data.nodeType === 'output' && textDialogView === 'output-highlighting';
  const isCharacterStatsContextDialog =
    textDialogNode?.data.nodeType === 'character-stats' && textDialogView === 'character-stats-context';
  const isCharacterStatsResponseDialog =
    textDialogNode?.data.nodeType === 'character-stats' && textDialogView === 'character-stats-response';
  const isCharacterStatsPromptsDialog =
    textDialogNode?.data.nodeType === 'character-stats' && textDialogView === 'character-stats-prompts';
  const isCharacterStatsChartDialog =
    textDialogNode?.data.nodeType === 'character-stats' && textDialogView === 'character-stats-chart';

  function beginWorkflowVariableRename(definition: SettingsValueDefinition) {
    if (definition.builtIn) {
      return;
    }
    setWorkflowVariableStatus('');
    setEditingWorkflowVariableKey(definition.key);
    setWorkflowVariableNameDraft(definition.label);
  }

  function commitWorkflowVariableRename(optionKey: string) {
    const nextName = workflowVariableNameDraft.trim();
    if (nextName) {
      onSettingsValueRename(optionKey, nextName);
    }
    setEditingWorkflowVariableKey(null);
    setWorkflowVariableNameDraft('');
  }

  function requestWorkflowVariableRemove(definition: SettingsValueDefinition) {
    if (definition.used) {
      setWorkflowVariableStatus(`Cannot delete "${definition.label}" because it is still used in the workflow.`);
      return;
    }
    setWorkflowVariableStatus('');
    onSettingsValueRemove(definition.key);
  }

  function handleWorkflowVariableNameKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    optionKey: string,
  ) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitWorkflowVariableRename(optionKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setEditingWorkflowVariableKey(null);
      setWorkflowVariableNameDraft('');
    }
  }

  async function copyComfyWorkflowPath(path: string, label: string) {
    try {
      const resolvedPath = await window.rpgraph.resolveProjectPath(path);
      await copyTextToClipboard(resolvedPath.path);
      setComfyWorkflowCopyStatus(`${label} copied.`);
    } catch (error) {
      setComfyWorkflowCopyStatus(
        `Copy failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function chooseNarratorVoiceSample() {
    const result = await window.rpgraph.selectAudio();
    if (result.canceled || !result.audio) {
      return;
    }
    onEditConnection('comfyNarratorVoice', {
      name: result.audio.name,
      dataUrl: result.audio.dataUrl,
    });
  }

  async function testNarratorVoice() {
    const speechText = narratorVoiceTestText.trim();
    const sampleDataUrl = editingConnection.comfyNarratorVoice?.dataUrl;
    if (!sampleDataUrl) {
      setNarratorVoiceTestStatus('Choose a narrator voice sample first.');
      return;
    }
    if (!speechText) {
      setNarratorVoiceTestStatus('Enter test text first.');
      return;
    }
    setNarratorVoiceTesting(true);
    setNarratorVoiceTestStatus('');
    narratorVoiceTestAudioRef.current?.pause();
    narratorVoiceTestAudioRef.current = null;
    try {
      const clips = await onGenerateCharacterVoicePreview({
        providerId: editingConnection.id,
        speechText,
        sampleDataUrl,
      });
      const clip = clips[0];
      if (!clip) {
        setNarratorVoiceTestStatus('No voice clip was returned.');
        return;
      }
      const audio = new Audio(clip.dataUrl);
      narratorVoiceTestAudioRef.current = audio;
      audio.addEventListener('ended', () => {
        if (narratorVoiceTestAudioRef.current === audio) {
          narratorVoiceTestAudioRef.current = null;
          setNarratorVoiceTestStatus('');
        }
      }, { once: true });
      await audio.play();
      setNarratorVoiceTestStatus('Playing narrator voice test.');
    } catch (error) {
      setNarratorVoiceTestStatus(
        `Narrator voice test failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setNarratorVoiceTesting(false);
    }
  }
  const textDialogBytesPerEstimatedToken = textDialogNode?.data.displayTokenBytesPerToken;
  const formattedHistoryText =
    textDialogNode?.data.nodeType === 'history'
      ? formatChatHistoryFromRaw(
          textDialogNode.data.rawHistory,
          textDialogNode.data.originalHistory,
          rpDateTimeFormat,
          rpWeekdayLanguage,
          appCharacters,
        )
      : '';
  const formattedHistorySegments =
    textDialogNode?.data.nodeType === 'history'
      ? formatChatHistorySegmentsFromRaw(
          textDialogNode.data.rawHistory,
          rpDateTimeFormat,
          rpWeekdayLanguage,
          appCharacters,
        )
      : [];
  const rawHistoryDisplayText =
    textDialogNode?.data.nodeType === 'history'
      ? sanitizeDataUrlsInText(textDialogNode.data.rawHistory ?? '')
      : '';
  const formattedAppointmentsText =
    textDialogNode?.data.nodeType === 'event-manager'
      ? formatAppointments(
          normalizeEventAppointments(textDialogNode.data.eventAppointments ?? []),
          rpDateTimeFormat,
          rpWeekdayLanguage,
        )
      : '';
  const textDialogContent =
    isOutputHighlightingDialog
        ? [
            'PROMPT SENT TO MODEL',
            textDialogNode.data.outputHighlightingPrompt ?? '',
            '',
            'MODEL OUTPUT',
            textDialogNode.data.outputHighlightingResponseToon ?? '',
          ].join('\n')
      : isCharacterStatsContextDialog
        ? textDialogNode.data.characterStatsContextText ?? ''
      : isCharacterStatsResponseDialog
        ? textDialogNode.data.characterStatsLastResponse ?? ''
      : isCharacterStatsPromptsDialog
        ? characterStatsPromptOverview(textDialogNode)
      : isHistoryTimeResponseDialog
        ? textDialogNode.data.historyLastResponse ?? ''
      : isEventManagerResponseDialog
        ? textDialogNode.data.eventLastResponse ?? ''
      : isEventManagerAppointmentsDialog
        ? formattedAppointmentsText
      : isHistoryDialog
      ? [rawHistoryDisplayText, formattedHistoryText].join('\n\n')
      : textDialogNode?.data.nodeType === 'combiner' ||
          textDialogNode?.data.nodeType === 'text-replace' ||
          textDialogNode?.data.nodeType === 'last-user-input' ||
          textDialogNode?.data.nodeType === 'last-rp-output' ||
          textDialogNode?.data.nodeType === 'load-text' ||
          textDialogNode?.data.nodeType === 'context-builder' ||
          textDialogNode?.data.nodeType === 'llm-decision' ||
          textDialogNode?.data.nodeType === 'character-stats'
        ? textDialogNode.data.nodeType === 'load-text'
          ? textDialogNode.data.loadedText ?? ''
          : textDialogNode.data.fullText ?? ''
        : textDialogNode?.data.nodeType === 'llm-prompt' ||
            textDialogNode?.data.nodeType === 'llm-prompt-switch'
          ? textDialogNode.data.generatedText ?? ''
          : textDialogNode?.data.preview ?? '';
  const jsonDialogContent = JSON.stringify(sanitizeDataUrls(jsonDialogNode?.data ?? {}), null, 2);
  const roundedUiScalePercent = Math.round(uiScale * 100);
  const canDecreaseUiScale = uiScale > minUiScale + 0.0001;
  const canIncreaseUiScale = uiScale < maxUiScale - 0.0001;
  const clampUiScale = useCallback(
    (scale: number) => Math.min(maxUiScale, Math.max(minUiScale, scale)),
    [maxUiScale, minUiScale],
  );
  const setUiScaleByPercent = useCallback((percent: number) => {
    const nextScale = clampUiScale(percent / 100);
    const nextPercent = Math.round(nextScale * 100);
    uiScalePercentRef.current = nextPercent;
    onUiScaleChange(nextScale);
    setUiScalePercentDraft(String(nextPercent));
  }, [clampUiScale, onUiScaleChange]);
  const commitUiScaleDraft = () => {
    const parsedPercent = Number(uiScalePercentDraft.trim().replace('%', '').replace(',', '.'));
    if (Number.isFinite(parsedPercent)) {
      setUiScaleByPercent(parsedPercent);
      return;
    }
    setUiScalePercentDraft(String(roundedUiScalePercent));
  };
  const activeDialog =
    showConnections
      ? 'connections'
      : sessionPasswordAction
        ? 'session-password'
        : storybookInfo
          ? 'storybook-info'
        : showStorybookPicker
          ? 'storybook-picker'
        : showCharacterFiles
          ? 'characters'
        : showFiles
          ? 'files'
            : showOptions
              ? 'options'
              : jsonDialogNode
                ? 'json'
                : textDialogNode
                  ? 'text'
                  : null;

  useEffect(() => {
    if (!showStorybookPicker) {
      queueMicrotask(() => {
        setStorybookInfo(null);
        setStorybookInfoLoading(null);
        setStorybookInfoStatus('');
      });
    }
  }, [showStorybookPicker]);

  useEffect(() => {
    if (!showFiles) {
      queueMicrotask(() => {
        setShowFileVersionInfo(false);
        setDeleteFileCandidate(null);
      });
    }
  }, [showFiles]);

  useEffect(() => {
    if (!showConnections) {
      queueMicrotask(() => {
        setPendingProviderType(null);
        setApiKeyVisible(false);
        setComfyWorkflowCopyStatus('');
        setLlamaCppRouterNoticePending(false);
      });
    }
  }, [showConnections]);

  useEffect(() => {
    uiScalePercentRef.current = roundedUiScalePercent;
    if (!uiScaleInputFocusedRef.current) {
      setUiScalePercentDraft(String(roundedUiScalePercent));
    }
  }, [roundedUiScalePercent]);

  useEffect(() => {
    function handleUiScaleWheel(event: WheelEvent) {
      if (!uiScaleInputFocusedRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY < 0 ? 1 : -1;
      setUiScaleByPercent(uiScalePercentRef.current + direction);
    }

    window.addEventListener('wheel', handleUiScaleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleUiScaleWheel);
  }, [setUiScaleByPercent]);

  useEffect(() => {
    if (!activeDialog) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (activeDialog === 'session-password') {
      if (isSavingFile && fileProtection === 'plain') {
        saveFileNameInputRef.current?.focus();
        saveFileNameInputRef.current?.select();
      } else {
        sessionPasswordInputRef.current?.focus();
      }
    } else {
      activeDialogRef.current?.querySelector<HTMLElement>('.close-button')?.focus();
    }

    return () => previouslyFocused?.focus();
  }, [activeDialog, fileProtection, isSavingFile]);

  const closeActiveDialog = useCallback(() => {
    if (deleteFileCandidate) { setDeleteFileCandidate(null); return; }
    if (activeDialog === 'storybook-info') { setStorybookInfo(null); return; }
    if (showFileVersionInfo) {
      setShowFileVersionInfo(false);
      return;
    }
    if (activeDialog === 'session-password') { onCloseSessionPassword(); return; }
    if (activeDialog === 'storybook-picker') { onCloseStorybookPicker(); return; }
    if (activeDialog === 'connections') { onCloseConnections(); return; }
    if (activeDialog === 'characters') { onCloseCharacterFiles(); return; }
    if (activeDialog === 'files') { onCloseFiles(); return; }
    if (activeDialog === 'options') { onCloseOptions(); return; }
    if (activeDialog === 'json') { onCloseJson(); return; }
    onCloseText();
  }, [activeDialog, showFileVersionInfo, deleteFileCandidate, onCloseSessionPassword,
    onCloseStorybookPicker, onCloseConnections, onCloseCharacterFiles, onCloseFiles,
    onCloseOptions, onCloseJson, onCloseText]);
  usePanelNavigationOverlay(closeActiveDialog, !!activeDialog);

  useEffect(() => {
    if (!activeDialog) {
      return;
    }

    function handleKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (document.getElementById('provider-type-confirm-title')) setPendingProviderType(null);
        else closeActiveDialog();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const dialog = document.getElementById('provider-type-confirm-title')?.closest('section') ?? activeDialogRef.current;
      const focusable = dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          )).filter((element) => element.offsetParent !== null)
        : [];
      if (!dialog || focusable.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [
    activeDialog,
    showFileVersionInfo, closeActiveDialog,
    onCloseText, onCloseJson, onCloseOptions, onCloseFiles, onCloseStorybookPicker, onCloseCharacterFiles,
    onCloseSessionPassword, onCloseConnections,
  ]);

  function trackBackdropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    backdropPointerStartedRef.current = event.target === event.currentTarget;
  }

  function closeFromBackdropClick(
    event: MouseEvent<HTMLDivElement>,
    dialog: typeof activeDialog,
    close: () => void,
  ) {
    const shouldClose =
      backdropPointerStartedRef.current &&
      activeDialog === dialog &&
      event.target === event.currentTarget;
    backdropPointerStartedRef.current = false;
    if (shouldClose) {
      close();
    }
  }

  async function openStorybookInfo(file: SavedFileSummary) {
    if (file.protection !== 'plain' || !file.compatible) {
      return;
    }
    setStorybookInfoLoading(file.fileName);
    setStorybookInfoStatus('');
    try {
      const result = await window.rpgraph.loadFile(file.fileName, '', file.storage);
      if (result.type !== 'storybook' || result.protection !== 'plain') {
        throw new Error('This file is not a readable plain Storybook.');
      }
      setStorybookInfo({ file, storybook: normalizeRpStorybook(result.value) });
    } catch (error) {
      setStorybookInfoStatus(
        `Preview failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setStorybookInfoLoading(null);
    }
  }

  return (
    <>
      {textDialogNode && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeFromBackdropClick(event, 'text', onCloseText)}
        >
          <section
            ref={activeDialog === 'text' ? activeDialogRef : undefined}
            className={`text-dialog node-text-dialog${isOutputHighlightingDialog ? ' highlighting-text-dialog' : ''}${isCompressionDialog ? ' compression-text-dialog' : ''}${isHistoryDialog ? ' history-text-dialog' : ''}${isCharacterStatsChartDialog ? ' character-stats-chart-text-dialog' : ''}`}
            role="dialog"
            aria-modal={activeDialog === 'text'}
            aria-hidden={activeDialog !== 'text'}
            aria-label="Node Text"
            tabIndex={-1}
          >
            <div className="dialog-header">
              <div>
                <h2>
                  {textDialogNode.data.label}
                  {isOutputHighlightingDialog
                      ? ' Highlighting'
                    : isCharacterStatsContextDialog
                      ? ' Context + Stats'
                    : isCharacterStatsResponseDialog
                      ? ' Update TOON'
                    : isCharacterStatsPromptsDialog
                      ? ' Prompts'
                    : isCharacterStatsChartDialog
                      ? ' Chart'
                    : isHistoryTimeResponseDialog
                      ? ' Time LLM Output'
                    : isEventManagerResponseDialog
                      ? ' Events LLM Output'
                    : isEventManagerAppointmentsDialog
                      ? ' Events'
                    : ' Text'}
                </h2>
                <p>
                  {isOutputHighlightingDialog
                      ? 'Last sent prompt: white template text, yellow inserted content, and green model output'
                    : isCharacterStatsContextDialog
                      ? 'Exact output for the Context + Stats port'
                    : isCharacterStatsResponseDialog
                      ? 'Raw TOON response used to initialize, patch, or keep stats'
                    : isCharacterStatsPromptsDialog
                      ? 'Internal prompt template with runtime variables shown as placeholders'
                    : isCharacterStatsChartDialog
                      ? 'Character stat values over RP time with automatic baseline relaxation'
                    : isHistoryTimeResponseDialog
                      ? 'Raw JSON response from the latest RP time call'
                    : isEventManagerResponseDialog
                      ? 'Raw JSON response from the latest event call'
                    : isEventManagerAppointmentsDialog
                      ? 'Upcoming scheduled roleplay events as plain text'
                    : isHistoryDialog
                      ? 'Raw stored messages and formatted chat history'
                    : 'Full text and analysis'}
                </p>
              </div>
              <button type="button" className="close-button" onClick={onCloseText}>
                Close
              </button>
            </div>
            <div className="text-form">
              {isOutputHighlightingDialog ? (
                <div className="prompt-preview-blocks">
                  {textDialogNode.data.outputHighlightingPrompt
                    ? <PromptPreviewBlock label="Prompt Sent to Model" text={textDialogNode.data.outputHighlightingPrompt}
                        parts={textDialogNode.data.outputHighlightingPromptParts} />
                    : <p>No recorded prompt. Run speaker analysis to capture the exact request.</p>}
                  <PromptPreviewBlock label="Model Output" text={textDialogNode.data.outputHighlightingResponseToon ?? ''} tone="output" />
                </div>
              ) : isCharacterStatsChartDialog ? (
                <CharacterStatsChartDialog node={textDialogNode} nodes={nodes} />
              ) : isHistoryDialog ? (
                <div className="history-inspection">
                  <div className="history-inspection-part">
                    <label>RAW HISTORY</label>
                    <StatLine
                      text={rawHistoryDisplayText}
                      bytesPerEstimatedToken={textDialogBytesPerEstimatedToken}
                    />
                    <textarea
                      rows={20}
                      readOnly
                      value={rawHistoryDisplayText}
                      placeholder="No raw history yet."
                    />
                  </div>
                  <div className="history-inspection-part">
                    <label>CHAT FORMATTED</label>
                    <StatLine
                      text={formattedHistoryText}
                      bytesPerEstimatedToken={textDialogBytesPerEstimatedToken}
                    />
                    {formattedHistoryText ? (
                      <HighlightedPreviewText
                        chatHistory="auto"
                        historySegments={formattedHistorySegments}
                        text={formattedHistoryText}
                      />
                    ) : (
                      <span className="history-preview-empty">No formatted history yet.</span>
                    )}
                  </div>
                </div>
              ) : isEventManagerAppointmentsDialog ? (
                <>
                  <label>EVENTS PORT OUTPUT</label>
                  <StatLine
                    text={formattedAppointmentsText}
                    bytesPerEstimatedToken={textDialogBytesPerEstimatedToken}
                  />
                  <textarea
                    rows={15}
                    readOnly
                    value={formattedAppointmentsText}
                    placeholder="No upcoming events."
                  />
                </>
              ) : isCompressionDialog ? (
                <div className="compression-inspection">
                  <div className="compression-inspection-part compressed-source">
                    <label>COMPRESSED SOURCE TEXT / OLD RAW TEXT</label>
                    <StatLine
                      text={textDialogNode.data.compressionSourceText ?? ''}
                      bytesPerEstimatedToken={textDialogBytesPerEstimatedToken}
                    />
                    <textarea
                      rows={8}
                      readOnly
                      value={textDialogNode.data.compressionSourceText ?? ''}
                      placeholder="Nothing compressed yet."
                    />
                  </div>
                  <div className="compression-inspection-part compressed-summary">
                    <label>SUMMARY OF RED TEXT</label>
                    <StatLine
                      text={textDialogNode.data.compressedText ?? ''}
                      bytesPerEstimatedToken={textDialogBytesPerEstimatedToken}
                    />
                    <textarea
                      rows={8}
                      readOnly
                      value={textDialogNode.data.compressedText ?? ''}
                      placeholder="No summary generated yet."
                    />
                  </div>
                  <div className="compression-inspection-part uncompressed-tail">
                    <label>UNCOMPRESSED REMAINING TEXT</label>
                    <StatLine
                      text={textDialogNode.data.compressionRemainingText ?? ''}
                      bytesPerEstimatedToken={textDialogBytesPerEstimatedToken}
                    />
                    <textarea
                      rows={8}
                      readOnly
                      value={textDialogNode.data.compressionRemainingText ?? ''}
                      placeholder="No remaining text available yet."
                    />
                  </div>
                </div>
              ) : (
                <>
                  <StatLine
                    text={textDialogContent}
                    bytesPerEstimatedToken={textDialogBytesPerEstimatedToken}
                  />
                  <textarea rows={15} readOnly value={textDialogContent} />
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {jsonDialogNode && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeFromBackdropClick(event, 'json', onCloseJson)}
        >
          <section
            ref={activeDialog === 'json' ? activeDialogRef : undefined}
            className="text-dialog json-dialog"
            role="dialog"
            aria-modal={activeDialog === 'json'}
            aria-hidden={activeDialog !== 'json'}
            aria-label="Node JSON"
            tabIndex={-1}
          >
            <div className="dialog-header">
              <div>
                <h2>{jsonDialogNode.data.label} JSON</h2>
                <p>Stored node data</p>
              </div>
              <button type="button" className="close-button" onClick={onCloseJson}>
                Close
              </button>
            </div>
            <div className="text-form">
              <textarea rows={18} readOnly value={jsonDialogContent} />
            </div>
          </section>
        </div>
      )}

      {showOptions && (
        <div
          className={`dialog-backdrop${textEffectPreview ? ' text-effect-preview' : ''}`}
          role="presentation"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeFromBackdropClick(event, 'options', onCloseOptions)}
        >
          <section
            ref={activeDialog === 'options' ? activeDialogRef : undefined}
            className="options-dialog"
            role="dialog"
            aria-modal={activeDialog === 'options'}
            aria-hidden={activeDialog !== 'options'}
            aria-label="Options"
            tabIndex={-1}
          >
            <div className="dialog-header">
              <div>
                <h2>Options</h2>
              </div>
              <button type="button" className="close-button" onClick={onCloseOptions}>
                Close
              </button>
            </div>
            <div className="options-layout">
              <aside className="options-sidebar">
                {OPTIONS_TABS.filter((tab) => tab.id !== 'reliability' || developerOptionsVisible).map((tab) => {
                  const isActive = activeOptionsTab === tab.id;
                  let Icon = ChatUiIcon;
                  if (tab.id === 'accounts') Icon = AccountIcon;
                  if (tab.id === 'translation') Icon = TranslationIcon;
                  if (tab.id === 'nodes') Icon = NodesIcon;
                  if (tab.id === 'variables') Icon = VariablesIcon;
                  if (tab.id === 'images') Icon = ImagesIcon;
                  if (tab.id === 'tokens') Icon = TokenIcon;
                  if (tab.id === 'reliability') Icon = RetryIcon;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`options-tab-btn ${isActive ? 'active' : ''}`}
                      aria-pressed={isActive}
                      onClick={() => setActiveOptionsTab(tab.id)}
                    >
                      <Icon />
                      <div className="options-tab-btn-text">
                        <span className="options-tab-btn-label">{tab.label}</span>
                        <span className="options-tab-btn-desc">{tab.desc}</span>
                      </div>
                    </button>
                  );
                })}
              </aside>

              <main className="options-panel" aria-label={OPTIONS_TABS.find(tab => tab.id === activeOptionsTab)?.label}>
                {activeOptionsTab === 'accounts' && <div className="options-tab-content">
                  <div className="options-tab-body account-options">
                    <section className="account-options-card">
                      <div className="account-options-card-copy">
                        <h4>{accountEncryption ? 'Using a local account' : 'Using RPGraph without an account'}</h4>
                        <p>{accountEncryption
                          ? 'Files are saved in your account folder and encrypted with your account password by default.'
                          : 'A local account keeps your files and settings separate. Its password is used by default to encrypt new workflows, RP saves, Storybooks and characters.'}</p>
                        {!accountEncryption && <p>While signed in, matching files unlock automatically when opened. File names can also be encrypted in folders and shown normally in RPGraph. No online registration is needed; existing files are not converted automatically.</p>}
                      </div>
                      <p className="account-options-note">Save your work before logging in or out. Switching closes the current workspace.</p>
                      <div className="account-options-actions">
                        <button className="account-options-action primary" type="button" disabled={accountActivationDisabled || deleteAccountBusy} onClick={accountControls.openAccountEntry}>
                          {accountEncryption ? 'Log Out' : accountControls.hasAccounts ? 'Log In' : 'Create Account'}
                        </button>
                        {accountEncryption && <button className="account-options-action danger" type="button" disabled={accountActivationDisabled || deleteAccountBusy} onClick={() => {
                          setDeleteAccountVisible(visible => !visible);
                          setDeleteAccountPassword('');
                          setDeleteAccountStatus('');
                        }}>
                          Delete Account
                        </button>}
                      </div>
                      {accountEncryption && deleteAccountVisible && <div className="account-delete-confirm">
                        <strong>Delete the current account</strong>
                        <p>Permanently deletes all account files and settings. Back up first.</p>
                        <label htmlFor="delete-account-password">
                          <span>CURRENT ACCOUNT PASSWORD</span>
                          <input
                            id="delete-account-password"
                            type="password"
                            autoComplete="current-password"
                            value={deleteAccountPassword}
                            disabled={deleteAccountBusy}
                            onChange={(event) => setDeleteAccountPassword(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void deleteCurrentAccount();
                            }}
                          />
                        </label>
                        <button className="account-options-action danger" type="button" disabled={accountActivationDisabled || deleteAccountBusy || !deleteAccountPassword} onClick={() => void deleteCurrentAccount()}>
                          {deleteAccountBusy ? 'Deleting Account…' : 'Delete Account Permanently'}
                        </button>
                        {deleteAccountStatus && <p className="account-options-status" role="status">{deleteAccountStatus}</p>}
                      </div>}
                    </section>

                    {accountEncryption && <section className="account-options-card">
                      <div className="account-options-card-copy">
                        <h4>Encrypt file names</h4>
                        <p>Make new encrypted file names unreadable in folders. RPGraph displays their original names after unlocking them. Plain JSON exports keep readable names.</p>
                      </div>
                      <label className="option-toggle">
                        <input type="checkbox" checked={accountControls.filenamePrivacy}
                          disabled={filenamePrivacyBusy || accountActivationDisabled || deleteAccountBusy}
                          onChange={(event) => void changeFilenamePrivacy(event.target.checked)} />
                        <span>Protect new encrypted filenames</span>
                      </label>
                      {filenamePrivacyStatus && <p className="account-options-status" role="status">{filenamePrivacyStatus}</p>}
                    </section>}

                    {accountEncryption && <section className="account-options-card">
                      <div className="account-options-card-copy">
                        <h4>Back up your account</h4>
                        <p>Close RPGraph before copying the complete account folder to a safe location. It contains your files, characters and account settings.</p>
                      </div>
                      <button className="account-options-action" type="button" onClick={() => void openAccountFolder()}>
                        Open Account Folder
                      </button>
                      {accountFolderStatus && <p className="account-options-status" role="status">{accountFolderStatus}</p>}
                    </section>}

                    {accountEncryption && <section className="account-options-card">
                      <div className="account-options-card-copy">
                        <h4>Default location for character exports</h4>
                        <p>Choose where new character exports and Storybook NPCs are saved. You can change the location for each export; existing NPC files stay in their current folder.</p>
                      </div>
                      <div className="option-field">
                        <span>DEFAULT LOCATION</span>
                        <NodeCustomSelect<'npc-characters' | 'account-npc-characters'>
                          id="default-character-export-location"
                          value={defaultCharacterExportDestination}
                          options={[
                            { value: 'npc-characters', label: 'NPC Library Folder' },
                            { value: 'account-npc-characters', label: 'Account NPC Library' },
                          ]}
                          onChange={onDefaultCharacterExportDestinationChange}
                        />
                      </div>
                    </section>}
                  </div>
                </div>}
                {activeOptionsTab === 'chat' && (
                  <div className="options-tab-content">
                    <div className="options-tab-body">
                      <label className="option-toggle">
                        <input
                          type="checkbox"
                          checked={chatMessageAvatarsEnabled}
                          onChange={(event) => onChatMessageAvatarsEnabledChange(event.target.checked)}
                        />
                        <span>Chat avatars</span>
                      </label>
                      <label className="option-toggle">
                        <input type="checkbox" checked={appMessageAvatarsEnabled}
                          onChange={(event) => onAppMessageAvatarsEnabledChange(event.target.checked)} />
                        <span>App avatars</span>
                      </label>
                      <label className="option-avatar-size" htmlFor="chat-message-avatar-size">
                        <span>Face size</span>
                        <input
                          id="chat-message-avatar-size"
                          type="range"
                          min={70}
                          max={130}
                          step={1}
                          value={chatMessageAvatarSize}
                          disabled={!chatMessageAvatarsEnabled && !appMessageAvatarsEnabled}
                          onChange={(event) => onChatMessageAvatarSizeChange(Number(event.target.value))}
                          aria-valuetext={`${chatMessageAvatarSize}%`}
                        />
                        <output htmlFor="chat-message-avatar-size">{chatMessageAvatarSize}%</output>
                      </label>
                      <label className="option-field chat-text-size-field" htmlFor="ui-scale">
                        <span className="option-label-row">
                          UI SCALE
                          <small>Type or scroll</small>
                        </span>
                        <div className="option-stepper-row">
                          <button
                            type="button"
                            className="option-stepper-button"
                            disabled={!canDecreaseUiScale}
                            aria-label="Decrease UI scale"
                            onClick={() => setUiScaleByPercent(roundedUiScalePercent - 5)}
                          >
                            -
                          </button>
                          <input
                            ref={uiScaleInputRef}
                            id="ui-scale"
                            type="text"
                            inputMode="decimal"
                            value={uiScalePercentDraft}
                            aria-label="UI scale percent"
                            onFocus={(event) => {
                              uiScaleInputFocusedRef.current = true;
                              event.currentTarget.select();
                            }}
                            onBlur={() => {
                              uiScaleInputFocusedRef.current = false;
                              commitUiScaleDraft();
                            }}
                            onChange={(event) => setUiScalePercentDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitUiScaleDraft();
                                event.currentTarget.blur();
                                return;
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                setUiScalePercentDraft(String(roundedUiScalePercent));
                                event.currentTarget.blur();
                              }
                            }}
                          />
                          <span aria-hidden="true">%</span>
                          <button
                            type="button"
                            className="option-stepper-button"
                            disabled={!canIncreaseUiScale}
                            aria-label="Increase UI scale"
                            onClick={() => setUiScaleByPercent(roundedUiScalePercent + 5)}
                          >
                            +
                          </button>
                        </div>
                      </label>
                      <div className="option-scale-status">
                        <span>Internal zoom: {roundedUiScalePercent}%</span>
                        <span>Minimum: {Math.round(minUiScale * 100)}%</span>
                        <span>Maximum: {Math.round(maxUiScale * 100)}%</span>
                      </div>
                      <label className="option-toggle">
                        <input
                          type="checkbox"
                          checked={smoothChatAutoScrollEnabled}
                          onChange={(event) =>
                            onSmoothChatAutoScrollEnabledChange(event.target.checked)
                          }
                        />
                        <span>Smooth Chat Auto-Scroll</span>
                      </label>
                      <label
                        className="option-field chat-text-size-field"
                        htmlFor="smooth-chat-auto-scroll-min-speed"
                      >
                        SMOOTH SCROLL MIN SPEED
                        <div className="option-range-row">
                          <input
                            id="smooth-chat-auto-scroll-min-speed"
                            title="Base scroll speed. Long output increases it gradually, up to 1.75 times this value."
                            min={minSmoothChatAutoScrollMinSpeed}
                            max={maxSmoothChatAutoScrollMinSpeed}
                            step={1}
                            type="range"
                            disabled={!smoothChatAutoScrollEnabled}
                            value={validSmoothChatAutoScrollMinSpeed(smoothChatAutoScrollMinSpeed)}
                            onChange={(event) =>
                              onSmoothChatAutoScrollMinSpeedChange(Number(event.target.value))
                            }
                          />
                          <span>
                            {validSmoothChatAutoScrollMinSpeed(smoothChatAutoScrollMinSpeed)} px/s
                          </span>
                        </div>
                      </label>
                      <div className="option-field">
                        <span>RP TIME / DATE FORMAT</span>
                        <NodeCustomSelect
                          id="rp-date-time-format"
                          value={rpDateTimeFormat}
                          onChange={(value) => onRpDateTimeFormatChange(value as RpDateTimeFormat)}
                          options={[
                            { value: 'eu', label: 'EU - 05.06.26 FR   20:00' },
                            { value: 'us', label: 'US - 06/05/26 FR   8:00 PM' },
                            { value: 'iso', label: 'ISO - 2026-06-05 FR   20:00' },
                          ]}
                        />
                      </div>
                      <div className="option-field">
                        <span>RP WEEKDAY LANGUAGE</span>
                        <NodeCustomSelect
                          id="rp-weekday-language"
                          value={rpWeekdayLanguage}
                          onChange={(value) => onRpWeekdayLanguageChange(value as RpWeekdayLanguage)}
                          options={rpWeekdayLanguageOptions}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeOptionsTab === 'text' && (
                  <div className="options-tab-content">
                    <div className="options-tab-body">
                      <label className="option-field chat-text-size-field" htmlFor="chat-text-size">
                        NORMAL CHAT TEXT SIZE
                        <div className="option-range-row">
                          <input
                            id="chat-text-size"
                            min={11}
                            max={22}
                            step={1}
                            type="range"
                            value={chatTextSize}
                            onChange={(event) => onChatTextSizeChange(Number(event.target.value))}
                          />
                          <span>{chatTextSize}px</span>
                        </div>
                      </label>
                      <label className="option-field chat-text-size-field" htmlFor="chatTextBrightness">
                        RP TEXT BRIGHTNESS
                        <div className="option-range-row">
                          <input
                            id="chatTextBrightness"
                            aria-describedby="chatTextBrightness-hint"
                            min={0}
                            max={100}
                            step={1}
                            type="range"
                            value={chatTextBrightness}
                            onChange={(event) => onChatTextBrightnessChange(Number(event.target.value))}
                          />
                          <span>{chatTextBrightness}%</span>
                        </div>
                        <small id="chatTextBrightness-hint">100% keeps the previous brightness. 50% is gently dimmed; 0% is a little dimmer still.</small>
                      </label>
                      <label className="option-field chat-text-size-field" htmlFor="chatColorIntensity">
                        RP DIALOGUE COLOR INTENSITY
                        <div className="option-range-row">
                          <input
                            id="chatColorIntensity"
                            aria-describedby="chatColorIntensity-hint"
                            min={0}
                            max={100}
                            step={1}
                            type="range"
                            value={chatColorIntensity}
                            onChange={(event) => onChatColorIntensityChange(Number(event.target.value))}
                          />
                          <span>{chatColorIntensity}%</span>
                        </div>
                        <small id="chatColorIntensity-hint">100% keeps the original colors. Lower values gently soften saturation and slightly dim dialogue colors.</small>
                      </label>
                      <label className="option-field chat-text-size-field" htmlFor="phone-chat-text-size">
                        PHONE CHAT TEXT SIZE
                        <div className="option-range-row">
                          <input
                            id="phone-chat-text-size"
                            min={11}
                            max={22}
                            step={1}
                            type="range"
                            value={phoneChatTextSize}
                            onChange={(event) => onPhoneChatTextSizeChange(Number(event.target.value))}
                          />
                          <span>{phoneChatTextSize}px</span>
                        </div>
                      </label>
                      <div className="option-field">
                        <span>FORMATTING FOR *THOUGHTS*</span>
                        <NodeCustomSelect
                          id="thought-text-style"
                          value={thoughtTextStyle}
                          onChange={(value) => onThoughtTextStyleChange(value as 'bold' | 'italic' | 'light')}
                          options={[
                            { value: 'bold', label: 'Bold' },
                            { value: 'italic', label: 'Italic' },
                            { value: 'light', label: 'Light' },
                          ]}
                        />
                      </div>
                      <div className="option-field">
                        <span>NODE TEXT</span>
                        <NodeCustomSelect
                          id="node-text-size"
                          value={nodeTextSize}
                          onChange={(value) => onNodeTextSizeChange(value as 'small' | 'normal' | 'big')}
                          options={[
                            { value: 'small', label: 'Small' },
                            { value: 'normal', label: 'Normal' },
                            { value: 'big', label: 'Big' },
                          ]}
                        />
                      </div>
                      <TextEffectOptions value={textEffects} onChange={onTextEffectsChange} />
                    </div>
                  </div>
                )}

                {activeOptionsTab === 'translation' && (
                  <div className="options-tab-content">
                    <div className="options-tab-body">
                      <div className="option-info">
                        <strong>English processing</strong>
                        <p>English processing can improve roleplay quality with some models. Your input is translated to English, and replies are translated back for display. Chat History keeps the English text. With both translation options off, your original language is used.</p>
                      </div>
                      <label className="option-toggle">
                        <input
                          type="checkbox"
                          checked={englishProcessingEnabled}
                          onChange={(event) => onEnglishProcessingChange(event.target.checked)}
                        />
                        <span>Use English internally</span>
                      </label>
                      <label className="option-toggle">
                        <input
                          type="checkbox"
                          checked={inputTranslationOnlyEnabled}
                          onChange={(event) => onInputTranslationOnlyChange(event.target.checked)}
                        />
                        <span>Translate only input to English</span>
                      </label>
                      <label className="option-field" htmlFor="display-language">
                        DISPLAY LANGUAGE
                        <input
                          id="display-language"
                          value={displayLanguage}
                          onChange={(event) => onDisplayLanguageChange(event.target.value)}
                          placeholder="German"
                          disabled={!englishProcessingEnabled && !inputTranslationOnlyEnabled}
                        />
                      </label>
                      <p className="options-note">
                        Choose the translation LLM connections in the User Input and RP Output nodes.
                      </p>
                    </div>
                  </div>
                )}

                {activeOptionsTab === 'nodes' && (
                  <div className="options-tab-content">
                    <div className="options-tab-body">
                      <div className="option-info">
                        <strong>Node Translucency</strong>
                        <p>
                          Use translucent backgrounds to see connections behind nodes. Adjust opacity to control how much shows through.
                        </p>
                      </div>
                      <label className="option-toggle">
                        <input
                          type="checkbox"
                          checked={glassDesignEnabled}
                          onChange={(event) => onGlassDesignEnabledChange(event.target.checked)}
                        />
                        <span>Translucent nodes</span>
                      </label>
                      <label className="option-field chat-text-size-field" htmlFor="glass-design-opacity">
                        OPACITY
                        <div className="option-range-row">
                          <input
                            id="glass-design-opacity"
                            min={0.01}
                            max={1.0}
                            step={0.01}
                            type="range"
                            value={glassDesignOpacity}
                            disabled={!glassDesignEnabled}
                            onChange={(event) => onGlassDesignOpacityChange(Number(event.target.value))}
                          />
                          <span>{Math.round(glassDesignOpacity * 100)}%</span>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {activeOptionsTab === 'variables' && (
                  <div className="options-tab-content">
                    <div className="options-tab-body">
                      <div className="option-info">
                        <strong>Workflow Variables</strong>
                        <p>
                          Insert &lt;Variable Name&gt; in prompts or use a Workflow Variable node. Green highlights variables used in the current workflow.
                        </p>
                        {workflowVariableStatus && (
                          <small className="workflow-variable-status">{workflowVariableStatus}</small>
                        )}
                        <button
                          type="button"
                          className="connection-button"
                          onClick={() => {
                            setWorkflowVariableStatus('');
                            onSettingsValueAdd();
                          }}
                        >
                          + Variable
                        </button>
                      </div>
                      <div className="workflow-option-fields">
                        {settingsValueDefinitions.map((definition) => (
                          <div
                            className={[
                              'option-field workflow-variable-field',
                              definition.used ? 'used' : 'unused',
                              definition.usedAsNumber && definition.valueKind !== 'number' ? 'invalid' : '',
                            ].filter(Boolean).join(' ')}
                            key={definition.key}
                          >
                            <div className="workflow-variable-header">
                              <div className="workflow-variable-title-group">
                                {editingWorkflowVariableKey === definition.key ? (
                                  <input
                                    className="workflow-variable-name-input"
                                    aria-label="Variable name"
                                    autoFocus
                                    type="text"
                                    value={workflowVariableNameDraft}
                                    onBlur={() => commitWorkflowVariableRename(definition.key)}
                                    onChange={(event) => setWorkflowVariableNameDraft(event.target.value)}
                                    onKeyDown={(event) =>
                                      handleWorkflowVariableNameKeyDown(event, definition.key)
                                    }
                                  />
                                ) : (
                                  <strong className="workflow-variable-name">&lt;{definition.label}&gt;</strong>
                                )}
                              </div>
                              {!definition.builtIn && editingWorkflowVariableKey !== definition.key && (
                                <div className="workflow-variable-actions">
                                  <button
                                    type="button"
                                    className="workflow-variable-action-button"
                                    onClick={() => beginWorkflowVariableRename(definition)}
                                    aria-label={`Rename ${definition.label}`}
                                    title="Rename variable"
                                  >
                                    <PencilIcon />
                                  </button>
                                  <button
                                    type="button"
                                    className="workflow-variable-action-button danger"
                                    onClick={() => requestWorkflowVariableRemove(definition)}
                                    aria-label={`Delete ${definition.label}`}
                                    title="Delete variable"
                                  >
                                    <TrashIcon />
                                  </button>
                                </div>
                              )}
                            </div>
                            <input
                              id={`workflow-option-${definition.key}`}
                              aria-label={`Value for ${definition.label}`}
                              type="text"
                              value={settingsValues[definition.key] ?? ''}
                              onChange={(event) =>
                                onSettingsValueChange(definition.key, event.target.value)
                              }
                            />
                            {definition.usedAsNumber && definition.valueKind !== 'number' && (
                              <small className="field-warning">Used as number, but value is text.</small>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeOptionsTab === 'images' && (
                  <div className="options-tab-content">
                    <div className="options-tab-body">
                      <div className="option-info">
                        <strong>Reference Images</strong>
                        <p>
                          Include past images with message history. Enable vision support in the model connection; models without it receive text captions.
                        </p>
                      </div>
                      <label className="option-toggle">
                        <input
                          type="checkbox"
                          checked={showReferenceImagesInContext}
                          onChange={(event) => onShowReferenceImagesInContextChange(event.target.checked)}
                        />
                        <span>Send reference images to LLM</span>
                      </label>
                      <label className="option-field" htmlFor="reference-image-turn-lookback">
                        REFERENCE IMAGE TURN LOOKBACK
                        <div className="option-range-row">
                          <input
                            id="reference-image-turn-lookback"
                            type="range"
                            min={5}
                            max={99}
                            step={1}
                            value={referenceImageTurnLookback}
                            disabled={!showReferenceImagesInContext}
                            onChange={(event) => onReferenceImageTurnLookbackChange(Number(event.target.value))}
                          />
                          <span>{referenceImageTurnLookback} turns</span>
                        </div>
                      </label>
                      <label className="option-field" htmlFor="max-reference-images">
                        MAX REFERENCE IMAGES
                        <div className="option-range-row">
                          <input
                            id="max-reference-images"
                            type="range"
                            min={2}
                            max={9}
                            step={1}
                            value={maxReferenceImages}
                            disabled={!showReferenceImagesInContext}
                            onChange={(event) => onMaxReferenceImagesChange(Number(event.target.value))}
                          />
                          <span>{maxReferenceImages} images</span>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {activeOptionsTab === 'tokens' && (
                  <div className="options-tab-content">
                    <div className="options-tab-body">
                      <div className="option-info">
                        <strong>Token estimate calibration</strong>
                        <p>
                          Estimate context size using UTF-8 bytes per token. Automatic calibration adjusts the factor from LLM Prompt input usage reported by the API. Estimates include a {fixedTokenEstimateReservePercent}% reserve.
                        </p>
                      </div>
                      <label className="option-field token-factor-field" htmlFor="token-estimate-factor">
                        DEFAULT TOKEN FACTOR (UTF-8 BYTES / TOKEN)
                        <div className="option-range-row">
                          <input
                            id="token-estimate-factor"
                            min={1}
                            max={8}
                            step={0.1}
                            type="range"
                            value={tokenEstimateBytesPerToken}
                            onChange={(event) => onTokenEstimateBytesPerTokenChange(Number(event.target.value))}
                          />
                          <span>{tokenEstimateBytesPerToken.toFixed(1)}</span>
                        </div>
                      </label>
                      <label className="option-toggle">
                        <input
                          type="checkbox"
                          checked={autoCalibrateTokenEstimate}
                          onChange={(event) => onAutoCalibrateTokenEstimateChange(event.target.checked)}
                        />
                        <span>Calibrate from API usage</span>
                      </label>
                      <p className="options-note">
                        Active factor: {activeTokenEstimateBytesPerToken.toFixed(3)} bytes/token;
                        fixed reserve: {fixedTokenEstimateReservePercent}%
                      </p>
                    </div>
                  </div>
                )}

                {developerOptionsVisible && activeOptionsTab === 'reliability' && (
                  <div className="options-tab-content">
                    <div className="options-tab-body">
                      <UiPerformanceDiagnostics />
                      <div className="option-info">
                        <strong>Retry format errors</strong>
                        <p>
                          Some analysis steps require valid JSON or RP times. If a model returns an invalid format, retry the failed step once with a fresh request before reporting an error.
                        </p>
                      </div>
                      <label className="option-toggle">
                        <input
                          type="checkbox"
                          checked={retryFormatErrorsEnabled}
                          onChange={(event) => onRetryFormatErrorsChange(event.target.checked)}
                        />
                        <span>Retry once before reporting errors</span>
                      </label>
                      <p className="options-note">
                        Applies to speaker analysis, RP time and Event Manager.
                      </p>
                    </div>
                  </div>
                )}
              </main>
            </div>
          </section>
        </div>
      )}

      {showCharacterFiles && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeFromBackdropClick(event, 'characters', onCloseCharacterFiles)}
        >
          <section
            ref={activeDialog === 'characters' ? activeDialogRef : undefined}
            className="chat-files-dialog"
            role="dialog"
            aria-modal={activeDialog === 'characters'}
            aria-hidden={activeDialog !== 'characters'}
            aria-label="RPGraph Characters"
            tabIndex={-1}
          >
            <div className="dialog-header">
              <div>
                <h2 className="workflow-dialog-title">Import Character</h2>
                <p>Select a character from a local folder or the built-in library</p>
              </div>
              <button type="button" className="close-button" onClick={onCloseCharacterFiles}>
                Close
              </button>
            </div>
            <div className="chat-files-form">
              <div className="saved-chat-list character-import-list" aria-label="Available RPGraph characters">
                {characterImportSections.length === 0 ? (
                  <p className="empty-chat-list">Select at least one source below.</p>
                ) : characterImportSections.map((section) => (
                  <div className="character-import-section" key={section.source}>
                    <div className="character-import-section-heading" role="separator">
                      <span>{section.title}</span>
                    </div>
                    {section.choices.length === 0 ? (
                      <p className="character-import-empty">Empty</p>
                    ) : section.choices.map((choice) => {
                      const file = choice.file;
                      return (
                        <div
                          className={`saved-chat-row${selectedCharacterImportKey === choice.key ? ' selected' : ''}`}
                          key={choice.key}
                          onDoubleClick={() => onImportCharacterChoice(choice)}
                        >
                          <button
                            className="saved-chat-select"
                            type="button"
                            onClick={() => onSelectCharacterImport(choice)}
                          >
                            <span className="saved-file-summary">
                              <strong className="saved-file-name-container">
                                <span className="saved-file-name-text">{choice.name}</span>
                                {file.protection === 'encrypted' && (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                                    strokeLinejoin="round" aria-label="Encrypted">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                  </svg>
                                )}
                              </strong>
                              <small>
                                {choice.fileName} · {file.updatedAt ? `Modified ${formatFileDate(file.updatedAt)}` : 'Modified date unavailable'} ·{' '}
                                Container v{file.formatVersion ?? 'Unknown'} ·{' '}
                                {file.protection === 'encrypted' ? 'Encrypted' : 'Plain JSON'}
                                {'unlocked' in file && file.unlocked ? ' · Unlocked for this session' : ''}
                                {file.protection === 'encrypted' && ` · Envelope v${file.envelopeFormatVersion ?? 'Unknown'}`}
                              </small>
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {characterFileStatus && (
                <p className="chat-storage-status">{characterFileStatus}</p>
              )}
            </div>
            <div className="dialog-actions chat-files-actions">
              <div className="character-import-filters" role="group" aria-label="Character source filters">
                {([
                  ['characters', 'Characters'],
                  ['npc-library', 'NPC Library'],
                  ['built-in', 'Built-in'],
                ] as const).map(([source, label]) => (
                  <label key={source}>
                    <input type="checkbox" checked={characterImportFilters[source]} onChange={(event) => {
                      setCharacterImportFilters((current) => ({ ...current, [source]: event.target.checked }));
                      if (!event.target.checked && characterImportChoices.some((choice) => (
                        choice.key === selectedCharacterImportKey && choice.source === source
                      ))) {
                        onSelectCharacterImport(null);
                      }
                    }} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <button type="button" className="secondary" onClick={onOpenExternalCharacterFile}>
                Open File
              </button>
              <button type="button" onClick={() => onImportCharacterChoice()}>
                Import Character
              </button>
            </div>
          </section>
        </div>
      )}

      {showStorybookPicker && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeFromBackdropClick(event, 'storybook-picker', onCloseStorybookPicker)}
        >
          <section
            ref={activeDialog === 'storybook-picker' ? activeDialogRef : undefined}
            className="chat-files-dialog storybook-picker-dialog"
            role="dialog"
            aria-modal={activeDialog === 'storybook-picker'}
            aria-hidden={activeDialog !== 'storybook-picker'}
            aria-label="Open a Storybook"
            tabIndex={-1}
          >
            <div className="dialog-header">
              <div>
                <h2 className="workflow-dialog-title">Open a Storybook</h2>
                <p>This workflow has no embedded Storybook. Choose one from RPGraph Studio Files or continue without one.</p>
              </div>
              <button type="button" className="close-button" onClick={onCloseStorybookPicker}>
                Cancel
              </button>
            </div>
            <div className="chat-files-form">
              <div className="saved-chat-list" aria-label="Available Storybooks">
                {storybookPickerFiles.length === 0 ? (
                  <p className="empty-chat-list">No Storybooks are available in RPGraph Studio Files.</p>
                ) : storybookPickerFiles.map((file) => (
                  <div
                    className={`saved-chat-row${selectedFile === file.fileName ? ' selected' : ''}`}
                    key={file.fileName}
                    onDoubleClick={() => file.compatible && onOpenFile(file)}
                  >
                    <button
                      className="saved-chat-select"
                      type="button"
                      onClick={() => onSelectFile(file)}
                      onDoubleClick={() => file.compatible && onOpenFile(file)}
                    >
                      <span className="saved-file-summary">
                        <strong className="saved-file-name-container">
                          <span className="file-type-badge storybook">Storybook</span>
                          <span className="saved-file-name-text">{storybookDisplayName(file.name)}</span>
                          {file.protection === 'encrypted' && (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ marginLeft: '4px', verticalAlign: 'middle', color: 'var(--success)' }}
                              aria-label="Encrypted"
                            >
                              <title>Encrypted</title>
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                          )}
                        </strong>
                        <small>
                          {formatFileDate(file.updatedAt)} · v{file.formatVersion} · {file.protection === 'encrypted' ? 'Encrypted' : 'Plain JSON'}
                        </small>
                      </span>
                    </button>
                    <div className="saved-chat-actions" onDoubleClick={(event) => event.stopPropagation()}>
                      <button
                        className="saved-chat-info"
                        type="button"
                        disabled={file.protection !== 'plain' || !file.compatible || storybookInfoLoading === file.fileName}
                        title={file.protection === 'encrypted'
                          ? 'Preview is unavailable for encrypted Storybooks.'
                          : !file.compatible
                            ? 'Preview is unavailable for incompatible Storybooks.'
                            : `Preview ${file.name}`}
                        onClick={() => void openStorybookInfo(file)}
                      >
                        {storybookInfoLoading === file.fileName ? 'Loading…' : 'Info'}
                      </button>
                      <button
                        className="saved-chat-open"
                        type="button"
                        disabled={!file.compatible}
                        onClick={() => onOpenFile(file)}
                      >
                        Open
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {(storybookInfoStatus || fileStorageStatus) && (
                <p className="chat-storage-status">{storybookInfoStatus || fileStorageStatus}</p>
              )}
            </div>
            <div className="dialog-actions chat-files-actions storybook-picker-actions">
              <button type="button" className="secondary" onClick={onRequestOpenStorybookFile}>Open File</button>
              <button type="button" className="secondary" onClick={onCloseStorybookPicker}>Continue Without Storybook</button>
            </div>
          </section>
        </div>
      )}

      {storybookInfo && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeFromBackdropClick(event, 'storybook-info', () => setStorybookInfo(null))}
        >
          <section
            ref={activeDialog === 'storybook-info' ? activeDialogRef : undefined}
            className="storybook-creator-dialog storybook-info-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Storybook Preview: ${storybookInfo.file.name}`}
            tabIndex={-1}
          >
            <div className="dialog-header storybook-creator-header">
              <div className="storybook-title-row">
                <h2>Storybook Preview</h2>
                <p>{storybookInfo.file.name}</p>
              </div>
              <div className="storybook-header-actions">
                <button type="button" className="close-button danger" onClick={() => setStorybookInfo(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="storybook-creator-body">
              <div className="storybook-main-workspace storybook-info-workspace">
                <div className="storybook-document-panel">
                  <div className="storybook-panel-content">
                    <StorybookReadonlyPreview
                      storybook={storybookInfo.storybook}
                      showDocumentHeader={false}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {showFiles && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeFromBackdropClick(event, 'files', onCloseFiles)}
        >
          <section
            ref={activeDialog === 'files' ? activeDialogRef : undefined}
            className="chat-files-dialog"
            role="dialog"
            aria-modal={activeDialog === 'files'}
            aria-hidden={activeDialog !== 'files'}
            aria-label="RPGraph Files"
            tabIndex={-1}
          >
            <div className="dialog-header">
              <div>
                <h2 className="workflow-dialog-title">
                  Files
                  <small>
                    Workflow File Format {workflowFormatVersion} · RP Save Format v{rpSaveFormatVersion} · Storybook Format {storybookFormatVersion}
                  </small>
                </h2>
                <p>Open workflows, Storybooks, Character Cards, or complete sessions</p>
              </div>
              <div className="files-header-actions">
                <button
                  type="button"
                  className="close-button"
                  onClick={() => setShowFileVersionInfo((visible) => !visible)}
                >
                  Info
                </button>
                <button type="button" className="close-button" onClick={onCloseFiles}>
                  Close
                </button>
              </div>
            </div>
            {showFileVersionInfo && (
              <div
                className="dialog-backdrop welcome-dialog-backdrop"
                role="presentation"
                onPointerDown={trackBackdropPointerDown}
                onClick={(event) => {
                  if (backdropPointerStartedRef.current && event.target === event.currentTarget) {
                    setShowFileVersionInfo(false);
                  }
                  backdropPointerStartedRef.current = false;
                }}
              >
                <section
                  className="welcome-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="RPGraph Files & Storage Formats Info"
                  style={{ height: 'auto', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
                >
                  <button
                    type="button"
                    className="welcome-close-x"
                    onClick={() => setShowFileVersionInfo(false)}
                    aria-label="Close files info guide"
                  >
                    &times;
                  </button>

                  <div className="welcome-dialog-content">
                    <FileFormatsGuide />
                  </div>

                  <footer className="welcome-footer" style={{ borderTop: 'none', paddingTop: 0, marginTop: '20px' }}>
                    <div style={{ marginLeft: 'auto' }}>
                      <button
                        type="button"
                        className="welcome-btn primary-btn"
                        onClick={() => setShowFileVersionInfo(false)}
                      >
                        Got it
                      </button>
                    </div>
                  </footer>
                </section>
              </div>
            )}
            <div className="chat-files-form">
              <div className="saved-chat-list" aria-label="Saved RPGraph files">
                {(() => {
                  const filtered = savedFiles.filter((f) => {
                    if (fileFilter === 'all') return true;
                    return f.type === fileFilter;
                  });
                  if (filtered.length === 0) {
                    return (
                      <p className="empty-chat-list">
                        {savedFiles.length === 0 ? 'No saved files yet.' : 'No matching files found.'}
                      </p>
                    );
                  }
                  return filtered.map((file) => (
                    <div
                      className={`saved-chat-row${
                        selectedFile === file.fileName ? ' selected' : ''
                      }`}
                      key={file.fileName}
                      onDoubleClick={() => onOpenFile(file)}
                    >
                      <button
                        className="saved-chat-select"
                        type="button"
                        onClick={() => onSelectFile(file)}
                        onDoubleClick={() => onOpenFile(file)}
                      >
                        <span className="saved-file-summary">
                          <strong className="saved-file-name-container">
                            <span className={`file-type-badge ${file.type}`}>
                              {file.type === 'workflow'
                                ? 'Workflow'
                                : file.type === 'storybook'
                                  ? 'Storybook'
                                  : file.type === 'character-card'
                                    ? 'Character'
                                    : 'RP Save'}
                            </span>
                            <span className="saved-file-name-text">{file.name}</span>
                            {file.protection === 'encrypted' && (
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ marginLeft: '4px', verticalAlign: 'middle', color: 'var(--success)' }}
                                aria-hidden="true"
                              >
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                            )}
                          </strong>
                          <small style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                            <span>{formatFileDate(file.updatedAt)}</span>
                            <span>·</span>
                            <span>v{file.type === 'workflow' ? file.workflowFormatVersion : file.formatVersion}</span>
                            {file.compatible ? (
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#4ade80"
                                strokeWidth="3.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ display: 'inline-block', verticalAlign: 'middle' }}
                                aria-label="Compatible"
                              >
                                <title>Compatible</title>
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#f87171"
                                strokeWidth="3.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ display: 'inline-block', verticalAlign: 'middle' }}
                                aria-label="Incompatible"
                              >
                                <title>Incompatible</title>
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            )}
                            <span>·</span>
                            <span>{file.protection === 'encrypted' ? 'Encrypted' : 'Plain JSON'}</span>
                            {file.type === 'session' && (
                              <>
                                <span>·</span>
                                <span>Turn {file.latestTurnNumber ?? 'Unknown'}</span>
                              </>
                            )}
                          </small>
                        </span>
                      </button>
                      <div className="saved-chat-actions">
                        <button
                          className="saved-chat-open"
                          type="button"
                          onClick={() => onOpenFile(file)}
                        >
                          Open
                        </button>
                        <button
                          className="saved-chat-delete"
                          type="button"
                          onClick={() => setDeleteFileCandidate(file)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ));
                })()}
              </div>
              {fileStorageStatus && (
                <p className="chat-storage-status">{fileStorageStatus}</p>
              )}
            </div>
            <div className="dialog-actions chat-files-actions">
              <div className="file-filter-select-wrapper">
                <NodeCustomSelect
                  value={fileFilter}
                  onChange={(val) => setFileFilter(val)}
                  options={[
                    { value: 'all', label: 'Show All' },
                    { value: 'workflow', label: 'Workflow' },
                    { value: 'storybook', label: 'Storybook' },
                    { value: 'session', label: 'RP Save' },
                    { value: 'character-card', label: 'Character' },
                  ]}
                />
              </div>
              <button type="button" className="secondary" onClick={onRequestOpenFile}>
                Open File
              </button>
              {(!hasStoredWorkflow || !hasStoredStorybook) && (
                <button type="button" className="secondary" onClick={onRestoreDefaultFiles}>
                  Restore Default Files
                </button>
              )}
              <button type="button" className="secondary" onClick={onRequestExportWorkflow}>
                Save Workflow
              </button>
              <button type="button" className="secondary" onClick={onRequestSaveStorybook}>
                Save Storybook
              </button>
              <button type="button" onClick={onRequestSaveSession}>
                Save RP
              </button>
            </div>
          </section>
          {deleteFileCandidate && (
            <div
              className="storybook-confirm-backdrop file-confirm-backdrop"
              role="presentation"
              onClick={() => setDeleteFileCandidate(null)}
            >
              <section
                className="storybook-confirm-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="file-delete-confirm-title"
                aria-describedby="file-delete-confirm-message"
                onClick={(event) => event.stopPropagation()}
              >
                <h3 id="file-delete-confirm-title">Delete File</h3>
                <p id="file-delete-confirm-message">
                  Delete {deleteFileCandidate.type} "{deleteFileCandidate.name}" permanently?
                </p>
                <div className="storybook-confirm-actions">
                  <button className="inspect-button" type="button" onClick={() => setDeleteFileCandidate(null)}>
                    Cancel
                  </button>
                  <button
                    className="inspect-button danger"
                    type="button"
                    onClick={() => {
                      const file = deleteFileCandidate;
                      setDeleteFileCandidate(null);
                      onDeleteFile(file);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {sessionPasswordAction && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeFromBackdropClick(event, 'session-password', onCloseSessionPassword)}
        >
          <section
            ref={activeDialog === 'session-password' ? activeDialogRef : undefined}
            className="chat-password-dialog"
            role="dialog"
            aria-modal={activeDialog === 'session-password'}
            aria-hidden={activeDialog !== 'session-password'}
            aria-label={isSavingWorkflow ? 'Save Workflow' : isSavingStorybook ? 'Save Storybook' : isSavingCharacter ? 'Export Character' : isSavingSession ? 'Save RP' : 'Unlock File'}
            tabIndex={-1}
          >
            <div className="dialog-header">
              <div>
                <h2>{isSavingWorkflow ? 'Save Workflow' : isSavingStorybook ? 'Save Storybook' : isSavingCharacter ? 'Export Character' : isSavingSession ? 'Save RP' : 'Unlock File'}</h2>
                <p>
                  {isSavingFile
                    ? 'Choose how the complete file should be stored'
                    : 'Enter the password or PIN used when this file was saved'}
                </p>
              </div>
              <button type="button" className="close-button" onClick={onCloseSessionPassword}>
                Close
              </button>
            </div>
            <div className="chat-password-form">
              {isSavingFile && (
                <>
                  <div className="chat-security-info">
                    <strong>Whole-file protection</strong>
                    <p>
                      Plain JSON is readable and easy to share. Password encrypted protects the
                      complete {isSavingWorkflow
                        ? 'saved workflow contents'
                        : isSavingStorybook
                          ? 'standalone Storybook file'
                          : isSavingCharacter
                            ? 'Character Card contents, including images, voice sample, and app setup'
                          : 'RP save, including its workflow, Storybook data, chat history, and runtime state'}.
                    </p>
                  </div>
                  <label className="chat-file-field" htmlFor="save-file-name">
                    {savingKindLabel.toUpperCase()} NAME
                    <input
                      id="save-file-name"
                      ref={saveFileNameInputRef}
                      value={isSavingWorkflow ? workflowName : isSavingStorybook ? storybookName : isSavingCharacter ? characterName : sessionName}
                      onChange={(event) => {
                        if (isSavingWorkflow) {
                          onWorkflowNameChange(event.target.value);
                        } else if (isSavingStorybook) {
                          onStorybookNameChange(event.target.value);
                        } else if (isSavingCharacter) {
                          onCharacterNameChange(event.target.value);
                        } else {
                          onSessionNameChange(event.target.value);
                        }
                      }}
                      placeholder={isSavingWorkflow ? 'workflow' : isSavingStorybook ? 'storybook' : isSavingCharacter ? 'Character name' : 'My roleplay'}
                    />
                  </label>
                  <div className="file-protection-options" role="radiogroup" aria-label="File protection">
                    <label>
                      <input
                        type="radio"
                        name="file-protection"
                        checked={fileProtection === 'plain'}
                        disabled={encryptionRequired}
                        onChange={() => onFileProtectionChange('plain')}
                      />
                      <span><strong>Plain JSON</strong><small>Readable and shareable</small></span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="file-protection"
                        checked={fileProtection === 'encrypted'}
                        disabled={encryptionRequired}
                        onChange={() => onFileProtectionChange('encrypted')}
                      />
                      <span><strong>{accountEncryption ? 'Account encrypted' : 'Password encrypted'}</strong><small>{accountEncryption ? 'Use your account password automatically' : 'Protect the complete file'}</small></span>
                    </label>
                  </div>
                  {isSavingWorkflow && (
                    <div className="file-protection-options" role="radiogroup" aria-label="Workflow contents">
                      <label>
                        <input
                          type="radio"
                          name="workflow-save-scope"
                          checked={workflowSaveScope === 'workflow'}
                          onChange={() => onWorkflowSaveScopeChange('workflow')}
                        />
                        <span><strong>Only Workflow</strong><small>Save graph without Storybook data</small></span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="workflow-save-scope"
                          checked={workflowSaveScope === 'workflow-storybook'}
                          onChange={() => onWorkflowSaveScopeChange('workflow-storybook')}
                        />
                        <span><strong>Workflow plus Storybook</strong><small>Embed Storybook in this workflow</small></span>
                      </label>
                    </div>
                  )}
                  {isSavingCharacter && (
                    <CharacterSaveOptions includeReceivedImages={includeCharacterReceivedImages} onIncludeReceivedImagesChange={onIncludeCharacterReceivedImagesChange} includePosts={includeCharacterOwnPosts} onIncludePostsChange={onIncludeCharacterOwnPostsChange}
                      destination={characterSaveLocation} onDestinationChange={onCharacterSaveLocationChange}
                      destinations={[
                        { value: 'npc-characters', label: 'NPC Library Folder' },
                        ...(accountEncryption ? [{ value: 'account-npc-characters' as const, label: 'Account NPC Library' }] : []),
                        { value: 'characters', label: 'Characters Folder' },
                        { value: 'choose', label: 'Choose Save Location…' },
                      ]} />
                  )}
                </>
              )}
              {(sessionPasswordAction === 'load' || sessionPasswordAction === 'load-storybook') && (
                <div className="chat-security-info">
                  <strong>Password required</strong>
                  <p>
                    {sessionPasswordAction === 'load-storybook'
                      ? 'This storybook is encrypted. Enter the password or PIN used when it was saved.'
                      : 'This file is encrypted. Enter the password or PIN used when it was saved.'}
                  </p>
                </div>
              )}
              {isSavingFile && encryptionRequired && <p className="chat-security-info">Encryption is required. The existing game password is used automatically.</p>}
              {isSavingFile && accountEncryption && fileProtection === 'encrypted' && <p className="chat-security-info">Your account password is used automatically.</p>}
              {(!isSavingFile || (fileProtection === 'encrypted' && !encryptionRequired && !accountEncryption)) && (
                <label className="chat-file-field" htmlFor="chat-password">
                  PASSWORD OR PIN
                  <input
                    id="chat-password"
                    ref={sessionPasswordInputRef}
                    type="password"
                    autoComplete="off"
                    autoFocus
                    value={sessionPassword}
                    onChange={(event) => onSessionPasswordChange(event.target.value)}
                    placeholder="Enter password or PIN"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSubmitSessionPassword();
                      }
                    }}
                  />
                </label>
              )}
              {fileStorageStatus && <p className="chat-storage-status">{fileStorageStatus}</p>}
            </div>
            <div className="dialog-actions">
              {isSavingFile && !isSavingCharacter && (
                <label className="dialog-action-checkbox">
                  <input
                    type="checkbox"
                    checked={chooseSaveLocation}
                    onChange={(event) => onChooseSaveLocationChange(event.target.checked)}
                  />
                  <span>Choose save location</span>
                </label>
              )}
              <button type="button" onClick={onSubmitSessionPassword}>
                {isSavingWorkflow
                  ? workflowOverwritePending
                    ? 'Overwrite Workflow'
                    : 'Save Workflow'
                  : isSavingSession
                    ? sessionOverwritePending
                      ? 'Overwrite RP'
                      : 'Save RP'
                    : isSavingStorybook
                      ? sessionOverwritePending
                        ? 'Overwrite Storybook'
                        : 'Save Storybook'
                    : isSavingCharacter
                      ? sessionOverwritePending
                        ? 'Overwrite Character'
                        : 'Export Character'
                  : 'Unlock and Open'}
              </button>
            </div>
          </section>
        </div>
      )}

      {showConnections && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeFromBackdropClick(event, 'connections', onCloseConnections)}
        >
          <section
            ref={activeDialog === 'connections' ? activeDialogRef : undefined}
            className="connection-dialog"
            role="dialog"
            aria-modal={activeDialog === 'connections'}
            aria-hidden={activeDialog !== 'connections'}
            aria-label="Providers"
            tabIndex={-1}
          >
            <div className="dialog-header">
              <div>
                <h2>Providers</h2>
                <p>LLM providers and local image and voice providers, saved locally</p>
              </div>
              <button type="button" className="close-button" onClick={onCloseConnections}>
                Close
              </button>
            </div>
            <div className="connection-dialog-grid">
              <div className="connection-dialog-left">
                <div className="preset-tabs">
                  {connections.map((connection) => {
                    const active = !connectionDraftPending && editingConnection.id === connection.id;
                    const label = active ? editingConnection.label : connection.label;
                    return (
                      <button
                        className={active ? 'active' : ''}
                        key={connection.id}
                        type="button"
                        onClick={() => {
                          setLlamaCppRouterNoticePending(false);
                          onSelectConnection(active ? editingConnection : connection);
                        }}
                      >
                        <span className="provider-tab-label">{label}</span>
                        <span className={providerHealthClass(providerHealthById[connection.id])}>
                          {providerHealthLabel(providerHealthById[connection.id])}
                        </span>
                      </button>
                    );
                  })}
                  {connectionDraftPending ? (
                    <button type="button" className="new-preset active" disabled>
                      <span className="provider-tab-label">New provider ...</span>
                    </button>
                  ) : (
                    <button type="button" className="new-preset" onClick={onNewConnection}>
                      + New
                    </button>
                  )}
                </div>
                {connectionDraftPending ? (
                <div className="connection-draft-placeholder">
                  <strong>Pick a provider type</strong>
                  <span>
                    Choose a type from the list on the right. It creates the new preset with the
                    matching Base URL and defaults — everything can be adjusted afterwards.
                  </span>
                </div>
                ) : comfyRolePending ? (
                <div className="connection-draft-placeholder comfy-role-chooser">
                  <strong>Choose the ComfyUI setup</strong>
                  <span>
                    A ComfyUI preset either generates images or voice clips. Pick one — the
                    matching workflow and defaults are prepared for you.
                  </span>
                  <div className="comfy-role-options">
                    <button type="button" onClick={() => onApplyComfyConnectionRole('image')}>
                      <strong>Image Generation</strong>
                      <span>Create character and scene images with a ComfyUI image workflow.</span>
                    </button>
                    <button type="button" onClick={() => onApplyComfyConnectionRole('voice')}>
                      <strong>Voice Generation</strong>
                      <span>Clone character voices from short MP3 samples with a ComfyUI voice workflow.</span>
                    </button>
                  </div>
                </div>
                ) : llamaCppRouterNoticePending ? (
                <div className="connection-draft-placeholder llama-router-notice">
                  <strong>llama.cpp must run in router mode</strong>
                  <span>
                    RPGraph loads and unloads llama.cpp models on demand — to free GPU memory
                    for ComfyUI image and voice generation and to detect model capabilities.
                    This needs the llama-server router mode; a server started the classic way
                    with <code>-m model.gguf</code> cannot load or unload models, and requests
                    will fail.
                  </span>
                  <span>
                    Start llama-server without <code>-m</code> and point it at a models
                    directory, where each model has its own subfolder:
                  </span>
                  <pre>llama-server --models-dir /path/to/models --models-max 1 --no-models-autoload --jinja</pre>
                  <button type="button" onClick={() => setLlamaCppRouterNoticePending(false)}>
                    Understood — continue
                  </button>
                </div>
                ) : (
                <>
                <div className={`connection-form${isChatGPTConnection ? ' connection-form-chatgpt' : ''}`}>
                  <div className="connection-field">
                    <label htmlFor="connection-label">PRESET NAME</label>
                    <input
                      id="connection-label"
                      value={editingConnection.label}
                      onChange={(event) => onEditConnection('label', event.target.value)}
                    />
                  </div>
                  {!isChatGPTConnection && <div className="connection-field">
                    <label htmlFor="base-url">BASE URL</label>
                    {isComfyConnection ? (
                      <div className="comfy-workflow-row">
                        <ProviderBaseUrlInput
                          key={editingConnection.id + ':' + editingConnection.kind}
                          value={editingConnection.baseUrl}
                          onChange={(value) => onEditConnection('baseUrl', value)}
                          onCheck={onConnectComfyProvider}
                        />
                        <button
                          type="button"
                          className="connection-inline-button"
                          onClick={onConnectComfyProvider}
                          disabled={comfyProviderActionActive !== null}
                        >
                          {comfyProviderActionActive === 'models' ? 'Loading' : 'Connect'}
                        </button>
                      </div>
                    ) : (
                      <ProviderBaseUrlInput
                        key={editingConnection.id + ':' + editingProviderKind}
                        value={editingConnection.baseUrl}
                        onChange={(value) => onEditConnection('baseUrl', value)}
                        onCheck={onCheckConnectionModels}
                      />
                    )}
                  </div>}
                  {isChatGPTConnection && chatgptSettings.accountField}
                  {isComfyConnection ? (
                    <>
                      <div className="connection-field comfy-workflow-field">
                        <label htmlFor="comfy-workflow-path">WORKFLOW</label>
                        <NodeCustomSelect
                          id="comfy-workflow-path"
                          value={selectedComfyWorkflow?.apiWorkflowPath ?? currentComfyWorkflowPath}
                          options={comfyWorkflowOptions.length
                            ? comfyWorkflowOptions.map((workflow) => ({
                                value: workflow.apiWorkflowPath,
                                label: workflow.label,
                              }))
                            : [{ value: currentComfyWorkflowPath, label: 'No bundled workflow', disabled: true }]}
                          onChange={(workflowPath) => {
                            setComfyWorkflowCopyStatus('');
                            onSelectBundledComfyWorkflow(String(workflowPath));
                          }}
                        />
                        {selectedComfyWorkflow && !comfyWorkflowSetupConfirmed ? (
                          <div className="comfy-workflow-onboarding">
                            <div>
                              <strong>{selectedComfyWorkflow.label}</strong>
                              <span>{selectedComfyWorkflow.description}</span>
                            </div>
                            <ol>
                              <li>Copy the normal workflow path and open that workflow in ComfyUI.</li>
                              <li>Install the required custom nodes and download the required models there.</li>
                              <li>Run the normal ComfyUI workflow once until it works.</li>
                              <li>Return to RPGraph and confirm that ComfyUI is set up and working.</li>
                            </ol>
                            {comfyOnboardingMemory ? (
                              <div className="comfy-workflow-memory-note">
                                <strong>{comfyOnboardingMemory.title}</strong>
                                <span>{comfyOnboardingMemory.body}</span>
                              </div>
                            ) : null}
                            <div className="connection-provider-actions">
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => void copyComfyWorkflowPath(selectedComfyWorkflow.setupWorkflowPath, 'Normal workflow path')}
                              >
                                Copy Normal Workflow Path
                              </button>
                              <button type="button" onClick={onConfirmComfyWorkflowSetup}>
                                ComfyUI Is Set Up and Working
                              </button>
                            </div>
                            {comfyWorkflowCopyStatus ? <em>{comfyWorkflowCopyStatus}</em> : null}
                          </div>
                        ) : null}
                        {comfyWorkflowSetupConfirmed && comfyWorkflowIncompatible ? (
                          <div className={`comfy-workflow-compatibility ${comfyWorkflowRepairReady ? 'ready' : 'error'}`}>
                            <div>
                              <strong>{comfyWorkflowRepairReady ? 'Fix ready' : 'Workflow incompatible'}</strong>
                              <span>
                                {comfyWorkflowRepairReady
                                  ? 'The repaired workflow passed the compatibility check. Apply the fix to overwrite the workflow JSON.'
                                  : comfyWorkflowCompatibilityMessage(comfyWorkflowInspection)}
                              </span>
                              {comfyWorkflowRepairStatus ? <span>{comfyWorkflowRepairStatus}</span> : null}
                              <div className="comfy-workflow-checklist" aria-label="Workflow compatibility checklist">
                                {comfyWorkflowChecklist.map((entry) => (
                                  <div
                                    className={`comfy-workflow-checklist-item ${entry.ok ? 'ok' : 'missing'}`}
                                    key={entry.id}
                                  >
                                    <span className="comfy-workflow-checkmark" aria-hidden="true">
                                      {entry.ok ? '✓' : '!'}
                                    </span>
                                    <span>{entry.label}</span>
                                    {comfyWorkflowRepairReady && entry.added ? <small>added</small> : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="comfy-workflow-repair">
                              <NodeCustomSelect
                                id="comfy-repair-provider"
                                value={selectedComfyRepairProviderId}
                                options={llmConnections.length
                                  ? llmConnections.map((connection) =>
                                      providerOption(connection, providerHealthById[connection.id]),
                                    )
                                  : [{ value: '', label: 'No LLM provider', disabled: true }]}
                                onChange={(providerId) => setComfyRepairProviderId(String(providerId))}
                              />
                              <div className="connection-provider-actions">
                                <button
                                  type="button"
                                  onClick={() => onRepairComfyWorkflow(selectedComfyRepairProviderId)}
                                  disabled={
                                    comfyProviderActionActive !== null ||
                                    !selectedComfyRepairProviderId ||
                                    llmConnections.length === 0
                                  }
                                >
                                  {comfyProviderActionActive === 'repair' ? 'Fixing ...' : 'Fix Prompt'}
                                </button>
                                <button
                                  type="button"
                                  onClick={onApplyComfyWorkflowRepair}
                                  disabled={comfyProviderActionActive !== null || !comfyWorkflowRepairReady}
                                >
                                  {comfyProviderActionActive === 'apply-repair' ? 'Applying ...' : 'Apply Fix'}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      {comfyWorkflowSetupConfirmed && !comfyWorkflowIncompatible && isComfyVoiceEditing ? (
                        <>
                          <div className="connection-provider-tools comfy-connection-tools" aria-label="ComfyUI voice connection tools">
                            <div>
                              <strong>
                                ComfyUI Voice
                                <span className={providerHealthClass(editingConnectionHealth)}>
                                  {providerHealthLabel(editingConnectionHealth)}
                                </span>
                                <ProviderCapabilityBadges
                                  capabilities={editingConnectionHealth.capabilities ?? { voice: true }}
                                  kinds={['voice']}
                                />
                              </strong>
                              <span>
                                {editingConnectionHealth.detail ||
                                  'Voice clips are generated from the character voice samples in the Storybook character setup.'}
                              </span>
                            </div>
                            <div className="connection-provider-actions">
                              <button
                                type="button"
                                className="danger"
                                onClick={onUnloadComfyModels}
                                disabled={comfyProviderActionActive !== null}
                              >
                                {comfyProviderActionActive === 'unload' ? 'Unloading ...' : 'Unload Models'}
                              </button>
                            </div>
                          </div>
                          <div className="connection-field connection-field-checkbox">
                            <label className="node-toggle nodrag">
                              <input
                                className="nodrag nowheel"
                                type="checkbox"
                                checked={editingConnection.comfyDeleteVoiceOutputs !== false}
                                onChange={(event) => onEditConnection('comfyDeleteVoiceOutputs', event.target.checked)}
                              />
                              <span>Store voice files in the ComfyUI temp folder so ComfyUI deletes them</span>
                            </label>
                            <p className="character-voice-hint">
                              The voice clip stays embedded in RPGraph. The generated audio and the uploaded voice
                              sample go to the ComfyUI temp folder instead of the output and input folders; ComfyUI
                              empties the temp folder when it shuts down or starts.
                            </p>
                          </div>
                          <div className="character-voice-card">
                            <div className="character-voice-card-header">
                              <span className="character-voice-card-title">NARRATOR VOICE (MP3)</span>
                              <button
                                id="comfy-narrator-voice"
                                type="button"
                                className="contextual-action-button nodrag"
                                onClick={() => void chooseNarratorVoiceSample()}
                              >
                                {editingConnection.comfyNarratorVoice ? 'Replace MP3 Sample' : 'Choose MP3 Sample'}
                              </button>
                            </div>
                            <p className="character-voice-hint">
                              Optional MP3 sample of 10 to 20 seconds for the narrator. It reads the
                              narration text between the character quotes when the chat uses the
                              read-aloud voice playback.
                            </p>
                            {editingConnection.comfyNarratorVoice ? (
                              <DarkAudioPlayer
                                src={editingConnection.comfyNarratorVoice.dataUrl}
                                title={editingConnection.comfyNarratorVoice.name || 'Narrator voice sample'}
                                onRemove={() => onEditConnection('comfyNarratorVoice', undefined)}
                                className="voice-sample-player"
                              />
                            ) : (
                              <div className="character-voice-empty-sample">
                                <span>No narrator voice sample uploaded yet</span>
                              </div>
                            )}
                          </div>
                          <div className="character-voice-card">
                            <div className="character-voice-card-header">
                              <span className="character-voice-card-title">NARRATOR VOICE GENERATION &amp; TESTING</span>
                              <button
                                type="button"
                                className="contextual-action-button nodrag"
                                disabled={narratorVoiceTesting || !editingConnection.comfyNarratorVoice}
                                onClick={() => void testNarratorVoice()}
                              >
                                {narratorVoiceTesting ? 'Testing ...' : 'Test Narrator Voice'}
                              </button>
                            </div>
                            <label className="character-comfy-field">
                              <span>TEST TEXT</span>
                              <textarea
                                className="node-textarea nodrag nowheel"
                                rows={3}
                                value={narratorVoiceTestText}
                                placeholder="Write a sentence the narrator should read ..."
                                onChange={(event) => setNarratorVoiceTestText(event.currentTarget.value)}
                              />
                            </label>
                            {narratorVoiceTesting ? (
                              <div className="character-voice-generating-box">
                                <span className="character-voice-spinner" aria-hidden="true" />
                                <span>Generating narrator voice test ...</span>
                              </div>
                            ) : null}
                            {narratorVoiceTestStatus && (
                              <p className="character-voice-hint">{narratorVoiceTestStatus}</p>
                            )}
                          </div>
                        </>
                      ) : null}
                      {comfyWorkflowSetupConfirmed && !comfyWorkflowIncompatible && isComfyImageEditing ? (
                        <>
                          <div className="connection-field">
                            <label htmlFor="comfy-width">WIDTH</label>
                            <input
                              id="comfy-width"
                              type="number"
                              min={64}
                              max={4096}
                              step={8}
                              value={editingConnection.comfyWidth ?? defaultComfyWidth}
                              onChange={(event) => onEditConnection('comfyWidth', Number(event.target.value))}
                            />
                          </div>
                          <div className="connection-field">
                            <label htmlFor="comfy-height">HEIGHT</label>
                            <input
                              id="comfy-height"
                              type="number"
                              min={64}
                              max={4096}
                              step={8}
                              value={editingConnection.comfyHeight ?? defaultComfyHeight}
                              onChange={(event) => onEditConnection('comfyHeight', Number(event.target.value))}
                            />
                          </div>
                          <div className="connection-field">
                            <label htmlFor="comfy-checkpoint-name">CHECKPOINT</label>
                            <ModelIdPicker
                              id="comfy-checkpoint-name"
                              value={editingConnection.comfyCheckpointName ?? defaultComfyCheckpointName}
                              onChange={(name) => onEditConnection('comfyCheckpointName', String(name))}
                              options={comfyModelOptions(
                                editingConnection.comfyCheckpointName ?? defaultComfyCheckpointName,
                                availableComfyModels.checkpoints,
                              )}
                              onOpenOptions={() => undefined}
                              placeholder="Type or select a checkpoint"
                              disabled={comfyCheckpointDisabled}
                            />
                          </div>
                          <div className="connection-field">
                            <label htmlFor="comfy-diffusion-model-name">DIFFUSION MODEL</label>
                            <ModelIdPicker
                              id="comfy-diffusion-model-name"
                              value={editingConnection.comfyDiffusionModelName ?? defaultComfyDiffusionModelName}
                              onChange={(name) => onEditConnection('comfyDiffusionModelName', String(name))}
                              options={comfyModelOptions(
                                editingConnection.comfyDiffusionModelName ?? defaultComfyDiffusionModelName,
                                availableComfyModels.diffusion_models,
                              )}
                              onOpenOptions={() => undefined}
                              placeholder="Type or select a diffusion model"
                              disabled={comfyDiffusionModelDisabled}
                            />
                          </div>
                          <div className="connection-field">
                            <label htmlFor="comfy-vae-name">VAE</label>
                            <ModelIdPicker
                              id="comfy-vae-name"
                              value={editingConnection.comfyVaeName ?? defaultComfyVaeName}
                              onChange={(name) => onEditConnection('comfyVaeName', String(name))}
                              options={comfyModelOptions(
                                editingConnection.comfyVaeName ?? defaultComfyVaeName,
                                availableComfyModels.vae,
                              )}
                              onOpenOptions={() => undefined}
                              placeholder="Type or select a VAE"
                            />
                          </div>
                          <div className="connection-field">
                            <label htmlFor="comfy-text-encoder-name">TEXT ENCODER</label>
                            <ModelIdPicker
                              id="comfy-text-encoder-name"
                              value={editingConnection.comfyTextEncoderName ?? defaultComfyTextEncoderName}
                              onChange={(name) => onEditConnection('comfyTextEncoderName', String(name))}
                              options={comfyModelOptions(
                                editingConnection.comfyTextEncoderName ?? defaultComfyTextEncoderName,
                                availableComfyModels.text_encoders,
                              )}
                              onOpenOptions={() => undefined}
                              placeholder="Type or select a text encoder"
                            />
                          </div>
                          <div className="connection-field">
                            <label htmlFor="comfy-steps">
                              STEPS <span>{editingConnection.comfySteps ? editingConnection.comfySteps : 'Workflow default'}</span>
                            </label>
                            <input
                              id="comfy-steps"
                              type="range"
                              min={0}
                              max={150}
                              step={1}
                              value={editingConnection.comfySteps || 0}
                              onChange={(event) => onEditConnection('comfySteps', Number(event.target.value))}
                            />
                          </div>
                          <div className="connection-field">
                            <label htmlFor="comfy-cfg">
                              CFG <span>{editingConnection.comfyCfg ? editingConnection.comfyCfg.toFixed(1) : 'Workflow default'}</span>
                            </label>
                            <input
                              id="comfy-cfg"
                              type="range"
                              min={0}
                              max={30}
                              step={0.1}
                              value={editingConnection.comfyCfg || 0}
                              onChange={(event) => onEditConnection('comfyCfg', Number(event.target.value))}
                            />
                          </div>
                          <div className="connection-field">
                            <label htmlFor="comfy-sampler">SAMPLER</label>
                            <ModelIdPicker
                              id="comfy-sampler"
                              value={editingConnection.comfySampler ?? defaultComfySampler}
                              onChange={(name) => onEditConnection('comfySampler', String(name))}
                              options={comfyModelOptions(
                                editingConnection.comfySampler ?? defaultComfySampler,
                                availableComfyModels.samplers,
                              )}
                              onOpenOptions={() => undefined}
                              placeholder="Workflow default (e.g. euler)"
                            />
                          </div>
                          <div className="connection-field">
                            <label htmlFor="comfy-scheduler">SCHEDULER</label>
                            <ModelIdPicker
                              id="comfy-scheduler"
                              value={editingConnection.comfyScheduler ?? defaultComfyScheduler}
                              onChange={(name) => onEditConnection('comfyScheduler', String(name))}
                              options={comfyModelOptions(
                                editingConnection.comfyScheduler ?? defaultComfyScheduler,
                                availableComfyModels.schedulers,
                              )}
                              onOpenOptions={() => undefined}
                              placeholder="Workflow default (e.g. simple)"
                            />
                          </div>
                          <div className="comfy-lora-grid">
                            {comfyLoraSlots.map((slot, index) => {
                              const slotNumber = index + 1;
                              return (
                                <div className="comfy-lora-slot" key={slotNumber}>
                                  <div className="connection-field comfy-lora-name-field">
                                    <label htmlFor={`comfy-lora-${slotNumber}`}>LORA {slotNumber}</label>
                                    <ModelIdPicker
                                      id={`comfy-lora-${slotNumber}`}
                                      value={slot.name}
                                      onChange={(name) => {
                                        const nextSlots = comfyLoraSlots.map((currentSlot, slotIndex) =>
                                          slotIndex === index
                                            ? { ...currentSlot, name: String(name) }
                                            : currentSlot,
                                        );
                                        onEditConnection('comfyLoraSlots', nextSlots);
                                      }}
                                      onBlur={() => {
                                        if (slot.name.trim().length > 0) {
                                          return;
                                        }
                                        const fallbackName = defaultComfyLoraSlots[index]?.name ?? 'None';
                                        const nextSlots = comfyLoraSlots.map((currentSlot, slotIndex) =>
                                          slotIndex === index
                                            ? { ...currentSlot, name: fallbackName }
                                            : currentSlot,
                                        );
                                        onEditConnection('comfyLoraSlots', nextSlots);
                                      }}
                                      options={comfyModelOptions(slot.name, availableComfyModels.loras, ['None', comfyCharacterLoraName])}
                                      onOpenOptions={() => undefined}
                                      placeholder="Type or select a LoRA"
                                    />
                                  </div>
                                  <div className="connection-field comfy-lora-strength-field">
                                    <label htmlFor={`comfy-lora-strength-${slotNumber}`}>STRENGTH</label>
                                    <input
                                      id={`comfy-lora-strength-${slotNumber}`}
                                      type="number"
                                      min={0}
                                      step={0.05}
                                      value={slot.strength}
                                      onChange={(event) => {
                                        const nextStrength = Number(event.target.value);
                                        const nextSlots = comfyLoraSlots.map((currentSlot, slotIndex) =>
                                          slotIndex === index
                                            ? {
                                                ...currentSlot,
                                                strength: Number.isFinite(nextStrength) ? nextStrength : currentSlot.strength,
                                              }
                                            : currentSlot,
                                        );
                                        onEditConnection('comfyLoraSlots', nextSlots);
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="connection-provider-tools comfy-connection-tools" aria-label="ComfyUI connection tools">
                            <div>
                              <strong>
                                ComfyUI
                                <span className={providerHealthClass(editingConnectionHealth)}>
                                  {providerHealthLabel(editingConnectionHealth)}
                                </span>
                                <ProviderCapabilityBadges
                                  capabilities={editingConnectionHealth.capabilities ?? { image: true }}
                                  kinds={['image']}
                                />
                              </strong>
                              <span>
                                {comfySetupMessage ||
                                  editingConnectionHealth.detail ||
                                  'Model lists load automatically. Generate an image or unload model memory.'}
                              </span>
                            </div>
                            <div className="connection-provider-actions">
                              <button
                                type="button"
                                onClick={onGenerateComfyTestImage}
                                disabled={comfyProviderActionActive !== null || !comfyWorkflowCanGenerate || !comfySetupComplete}
                              >
                                {comfyProviderActionActive === 'generate' ? 'Generating ...' : 'Generate Image'}
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={onUnloadComfyModels}
                                disabled={comfyProviderActionActive !== null}
                              >
                                {comfyProviderActionActive === 'unload' ? 'Unloading ...' : 'Unload Models'}
                              </button>
                            </div>
                          </div>
                          <div className="connection-field connection-field-checkbox">
                            <label
                              className="node-toggle nodrag"
                              title="The generated image stays embedded in RPGraph and goes to the ComfyUI temp folder instead of the output folder; ComfyUI empties the temp folder when it shuts down or starts. Requires the standard Save Image node in the workflow."
                            >
                              <input
                                className="nodrag nowheel"
                                type="checkbox"
                                checked={editingConnection.comfyDeleteImageOutputs !== false}
                                onChange={(event) => onEditConnection('comfyDeleteImageOutputs', event.target.checked)}
                              />
                              <span>Store images in the ComfyUI temp folder so ComfyUI deletes them</span>
                            </label>
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className="connection-field">
                        <label htmlFor="model-name">MODEL ID</label>
                        <ModelIdPicker
                          value={editingConnection.model}
                          options={isChatGPTConnection ? chatgptModelOptions.map(model => model.id) : providerModelOptions}
                          optionLabels={isChatGPTConnection ? Object.fromEntries(chatgptModelOptions.map(model => [model.id, model.name])) : undefined}
                          selectionOnly={isChatGPTConnection}
                          placeholder={isChatGPTConnection ? 'Connect ChatGPT and select a model' : undefined}
                          onChange={(model) => onEditConnection('model', model)}
                          onOpenOptions={onRefreshConnectionModels}
                        />
                      </div>
                      {modelCapabilitiesSourceLabel ? (
                        <div className="connection-field connection-field-capabilities">
                          <label>CAPABILITIES</label>
                          <div className="connection-detected-capabilities">
                            <ProviderCapabilityBadges
                              capabilities={editingConnectionCapabilities}
                              reasoningEnabled={reasoningActivation(selectedReasoningEffort, editingConnectionReasoning)}
                              kinds={
                                isChatGPTConnection ? ['text', 'reasoning', 'vision']
                                : editingProviderKind === 'openai-compatible'
                                  ? (['text', 'reasoning', 'vision', 'image', 'voice'] as const).filter((kind) => editingConnectionCapabilities?.[kind] !== undefined)
                                  : lmStudioToolsAvailable || ollamaToolsAvailable
                                  ? ['text', 'reasoning', 'vision']
                                  : llamaCppToolsAvailable
                                    ? ['text', 'vision']
                                  : editingProviderKind === 'openrouter'
                                    ? ['text', 'reasoning', 'vision', 'image', 'voice']
                                    : ['text', 'vision', 'image', 'voice']
                              }
                              showInactive
                            />
                            <span>
                              {isChatGPTConnection ? 'Text, vision and thinking' : editingConnection.model.trim()
                                ? `Detected from ${modelCapabilitiesSourceLabel}`
                                : 'Select a model to detect'}
                            </span>
                          </div>
                        </div>
                      ) : null}
                      {!isChatGPTConnection && (!modelCapabilitiesSourceLabel || (editingProviderKind === 'openai-compatible' && editingConnectionCapabilities?.vision === undefined)) && (
                        <div className="connection-field connection-field-vision">
                          <label className="node-toggle post-output-toggle connection-vision-label nodrag">
                            <input
                              className="nodrag nowheel"
                              type="checkbox"
                              checked={!!editingConnection.vision}
                              onChange={(event) => onEditConnection('vision', event.target.checked)}
                            />
                            <span>Activate vision features</span>
                          </label>
                          <span
                            className="node-info-button"
                            data-tooltip="Checking this unlocks vision-based options, allowing the program to send reference images and use image captioning capabilities in roleplay chat sessions. (Selected LLM model must support vision, otherwise turn off.)"
                            aria-label="Vision features help"
                          >
                            ?
                          </span>
                        </div>
                      )}
                      {isChatGPTConnection && chatgptSettings.authenticationField}
                      {!isChatGPTConnection && <div className="connection-field connection-field-api-key">
                        <label htmlFor="api-key">API KEY (OPTIONAL)</label>
                        <div className="secret-input-row">
                          <input
                            id="api-key"
                            type={apiKeyVisible ? 'text' : 'password'}
                            placeholder="Local providers can usually stay empty"
                            value={editingConnection.apiKey}
                            onChange={(event) => onEditConnection('apiKey', event.target.value)}
                          />
                          <button
                            type="button"
                            className="secret-input-toggle"
                            aria-label={apiKeyVisible ? 'Hide API key' : 'Show API key'}
                            aria-pressed={apiKeyVisible}
                            onClick={() => setApiKeyVisible((visible) => !visible)}
                          >
                            <EyeIcon hidden={!apiKeyVisible} />
                          </button>
                        </div>
                      </div>}
                      {!isVoiceOnlyModel && !(editingProviderKind === 'openai-compatible' && editingConnectionCapabilities?.reasoning === false) && <div className="connection-field connection-field-reasoning">
                        <div className="connection-field-label-row">
                          <label htmlFor="reasoning-effort">
                            {isMuseGlimmerReasoning ? 'REASONING (MUSE GLIMMER)' : 'REASONING'}
                          </label>
                          {isMuseGlimmerReasoning ? (
                            <button
                              type="button"
                              className="node-info-button connection-reasoning-help"
                              data-tooltip="Muse Glimmer always uses reasoning and does not support Off. RPGraph sends the selected Low, Medium, High, or Very high strength through the model's chat template."
                              aria-label="About Muse Glimmer reasoning"
                            >
                              ?
                            </button>
                          ) : null}
                        </div>
                        <NodeCustomSelect
                          id="reasoning-effort"
                          disabled={editingProviderKind === 'gemini'}
                          value={selectedReasoningEffort}
                          onChange={(effort) => onEditConnection('reasoningEffort', String(effort))}
                          options={reasoningEfforts.map((effort) => ({
                            value: effort,
                            label: connectionReasoningLabels[effort] + (
                              !supportsReasoningEffort(effort, editingConnectionReasoning)
                                ? ' (not supported)'
                                : effort === 'auto' && editingConnectionReasoning?.defaultEnabled === false
                                  ? ' (Off)'
                                  : effort === 'auto' && editingConnectionReasoning?.defaultEffort
                                    ? ` (${connectionReasoningLabels[editingConnectionReasoning.defaultEffort]})`
                                    : ''
                            ),
                            disabled: !supportsReasoningEffort(effort, editingConnectionReasoning),
                          }))}
                        />
                      </div>}
                      {isVoiceOnlyModel && (
                        <div className={`connection-tts-section${supportsTtsTemperature ? ' has-temperature' : ''}`}>
                          <div className="connection-field connection-tts-voice-field">
                            <label htmlFor="tts-voice">VOICE</label>
                            {editingConnectionSupportedVoices.length > 0 ? (
                              <NodeCustomSelect
                                id="tts-voice"
                                value={editingConnection.ttsVoice ?? editingConnectionSupportedVoices[0]}
                                onChange={(voice) => onEditConnection('ttsVoice', String(voice))}
                                options={editingConnectionSupportedVoices.map((voice) => ({
                                  value: voice,
                                  label: voice,
                                }))}
                              />
                            ) : (
                              <span className="connection-field-hint">
                                Open the model list to load the voices provided by this service.
                              </span>
                            )}
                          </div>
                          {supportsTtsTemperature && (
                            <div className="connection-field connection-tts-temperature-field">
                              <label htmlFor="tts-temperature">
                                TEMPERATURE <span>{(editingConnection.ttsTemperature ?? 1).toFixed(2)}</span>
                              </label>
                              <input
                                id="tts-temperature"
                                type="range"
                                min={0}
                                max={2}
                                step={0.05}
                                value={editingConnection.ttsTemperature ?? 1}
                                onChange={(event) => onEditConnection('ttsTemperature', Number(event.target.value))}
                              />
                            </div>
                          )}
                          {supportsGeminiVoiceDirection && (
                            <div className="connection-tts-stream-container">
                              <label className="node-toggle post-output-toggle connection-tts-stream-toggle nodrag">
                                <input
                                  className="nodrag nowheel"
                                  type="checkbox"
                                  checked={editingConnection.ttsStreamAudio === true}
                                  onChange={(event) => onEditConnection('ttsStreamAudio', event.target.checked)}
                                />
                                <span>Stream Audio Live</span>
                              </label>
                            </div>
                          )}
                          {supportsGeminiVoiceDirection && (
                            <div className="connection-tts-direction-grid">
                              <div className="connection-field connection-tts-wide-field">
                                <label htmlFor="tts-audio-profile">AUDIO PROFILE</label>
                                <input
                                  id="tts-audio-profile"
                                  type="text"
                                  placeholder="Persona, role, age, and vocal character"
                                  value={editingConnection.ttsAudioProfile ?? ''}
                                  onChange={(event) => onEditConnection('ttsAudioProfile', event.target.value)}
                                />
                              </div>
                              {([
                                ['ttsStyle', 'tts-style', 'STYLE', 'Conversational and intimate'],
                                ['ttsAccent', 'tts-accent', 'ACCENT', 'Neutral German'],
                                ['ttsPace', 'tts-pace', 'PACE', 'Calm and measured'],
                              ] as const).map(([field, id, label, placeholder]) => (
                                <div className="connection-field" key={field}>
                                  <label htmlFor={id}>{label}</label>
                                  <input
                                    id={id}
                                    type="text"
                                    placeholder={placeholder}
                                    value={editingConnection[field] ?? ''}
                                    onChange={(event) => onEditConnection(field, event.target.value)}
                                  />
                                </div>
                              ))}
                              <span className="connection-field-hint connection-tts-wide-field">
                                Gemini uses these directions as part of its speech prompt. Empty fields are omitted.
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      {!isChatGPTConnection && !isVoiceOnlyModel && <div className="connection-sampling-section">
                        <div className="connection-sampling-header">
                          <strong>Story sampling</strong>
                          <span>
                            Only used for story generation (LLM Prompt and LLM Prompt Switch nodes).
                            Helper calls like translation, speaker detection, and trackers keep fixed
                            internal values. An emptied field returns to its default.
                          </span>
                        </div>
                        <div className="connection-sampling-grid">
                          <div className="connection-field connection-sampling-field">
                            <label htmlFor="connection-temperature">TEMPERATURE</label>
                            <input
                              id="connection-temperature"
                              type="number"
                              min={0}
                              max={2}
                              step={0.05}
                              placeholder={String(defaultConnectionSampling.temperature)}
                              value={editingConnection.temperature ?? ''}
                              onChange={(event) =>
                                onEditConnection(
                                  'temperature',
                                  event.target.value === '' ? undefined : Number(event.target.value),
                                )
                              }
                              onBlur={() => {
                                if (editingConnection.temperature === undefined) {
                                  onEditConnection('temperature', defaultConnectionSampling.temperature);
                                }
                              }}
                            />
                          </div>
                          <div className="connection-field connection-sampling-field">
                            <label htmlFor="connection-top-p">TOP P</label>
                            <input
                              id="connection-top-p"
                              type="number"
                              min={0}
                              max={1}
                              step={0.05}
                              placeholder={String(defaultConnectionSampling.topP)}
                              value={editingConnection.topP ?? ''}
                              onChange={(event) =>
                                onEditConnection(
                                  'topP',
                                  event.target.value === '' ? undefined : Number(event.target.value),
                                )
                              }
                              onBlur={() => {
                                if (editingConnection.topP === undefined) {
                                  onEditConnection('topP', defaultConnectionSampling.topP);
                                }
                              }}
                            />
                          </div>
                          <div className="connection-field connection-sampling-field">
                            <label htmlFor="connection-presence-penalty">PRESENCE PEN.</label>
                            <input
                              id="connection-presence-penalty"
                              type="number"
                              min={-2}
                              max={2}
                              step={0.05}
                              placeholder={String(defaultConnectionSampling.presencePenalty)}
                              value={editingConnection.presencePenalty ?? ''}
                              onChange={(event) =>
                                onEditConnection(
                                  'presencePenalty',
                                  event.target.value === '' ? undefined : Number(event.target.value),
                                )
                              }
                              onBlur={() => {
                                if (editingConnection.presencePenalty === undefined) {
                                  onEditConnection('presencePenalty', defaultConnectionSampling.presencePenalty);
                                }
                              }}
                            />
                          </div>
                          <div className="connection-field connection-sampling-field">
                            <label htmlFor="connection-frequency-penalty">FREQUENCY PEN.</label>
                            <input
                              id="connection-frequency-penalty"
                              type="number"
                              min={-2}
                              max={2}
                              step={0.05}
                              placeholder={String(defaultConnectionSampling.frequencyPenalty)}
                              value={editingConnection.frequencyPenalty ?? ''}
                              onChange={(event) =>
                                onEditConnection(
                                  'frequencyPenalty',
                                  event.target.value === '' ? undefined : Number(event.target.value),
                                )
                              }
                              onBlur={() => {
                                if (editingConnection.frequencyPenalty === undefined) {
                                  onEditConnection('frequencyPenalty', defaultConnectionSampling.frequencyPenalty);
                                }
                              }}
                            />
                          </div>
                        </div>
                      </div>}
                    </>
                  )}
                  {!isComfyConnection && (
                    <>
                      {lmStudioToolsAvailable && (
                        <div className="connection-provider-tools" aria-label="LM Studio model tools">
                          <div>
                            <strong>
                              LM Studio
                              <span className={providerHealthClass(editingConnectionHealth)}>
                                {providerHealthLabel(editingConnectionHealth)}
                              </span>
                            </strong>
                            <span>{editingConnectionHealth.detail ?? 'Load or unload local model memory from here.'}</span>
                          </div>
                          <div className="connection-provider-actions">
                            <button
                              type="button"
                              onClick={onLoadLmStudioModel}
                              disabled={lmStudioModelActionActive !== null}
                            >
                              {lmStudioModelActionActive === 'load' ? 'Loading ...' : 'Load Selected Model'}
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={onUnloadLmStudioModels}
                              disabled={lmStudioModelActionActive !== null}
                            >
                              {lmStudioModelActionActive === 'unload' ? 'Unloading ...' : 'Unload All Models'}
                            </button>
                          </div>
                        </div>
                      )}
                      {ollamaToolsAvailable && (
                        <div className="connection-provider-tools" aria-label="Ollama model tools">
                          <div>
                            <strong>Ollama</strong>
                            <span>Load selected model or unload every running Ollama model.</span>
                          </div>
                          <div className="connection-provider-actions">
                            <button
                              type="button"
                              onClick={onLoadOllamaModel}
                              disabled={ollamaModelActionActive !== null}
                            >
                              {ollamaModelActionActive === 'load' ? 'Loading ...' : 'Load Selected Model'}
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={onUnloadOllamaModels}
                              disabled={ollamaModelActionActive !== null}
                            >
                              {ollamaModelActionActive === 'unload' ? 'Unloading ...' : 'Unload Running Models'}
                            </button>
                          </div>
                        </div>
                      )}
                      {llamaCppToolsAvailable && (
                        <div className="connection-provider-tools" aria-label="llama.cpp model tools">
                          <div>
                            <strong>llama.cpp</strong>
                            <span>{editingConnectionHealth.detail ?? 'Router model state is read from /models.'}</span>
                          </div>
                          <div className="connection-provider-actions">
                            <button type="button" onClick={onLoadLlamaCppModel} disabled={ollamaModelActionActive !== null}>
                              {ollamaModelActionActive === 'load' ? 'Loading ...' : 'Load Selected Model'}
                            </button>
                            <button type="button" className="danger" onClick={onUnloadLlamaCppModels} disabled={ollamaModelActionActive !== null}>
                              {ollamaModelActionActive === 'unload' ? 'Unloading ...' : 'Unload All Models'}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {!isChatGPTConnection && <p className="connection-status">
                  {connectionStatus || (
                    isComfyConnection
                      ? 'Check the local ComfyUI server settings. Changes are saved automatically.'
                      : 'Adjust the settings, paste an API key if needed. Changes are saved automatically.'
                  )}
                </p>}
                <div className="dialog-actions">
                  <div className="dialog-action-group">
                    <button type="button" className="danger" onClick={onDeleteConnection}>
                      Delete
                    </button>
                  </div>
                  <div className="dialog-action-group">
                    {!isComfyConnection && (
                      <button type="button" className="secondary" onClick={onCheckConnectionModels}>
                      Check Models
                      </button>
                    )}
                    {!isComfyConnection && !isVoiceOnlyModel && !isImageModel && (
                      <button type="button" onClick={onApplyConnectionToAllNodes}>
                        Apply to all nodes
                      </button>
                    )}
                    {!isComfyConnection && isVoiceOnlyModel && (
                      <button type="button" onClick={() => onSetNarratorOnlyProvider(editingConnection.id)}>
                        Set as Narrator Model
                      </button>
                    )}
                  </div>
                </div>
                </>
                )}
              </div>
              <div className="connection-dialog-right">
                <span className="presets-sidebar-title">
                  {connectionDraftPending ? 'CHOOSE A PROVIDER TYPE' : 'PROVIDER TYPES'}
                </span>
                <div
                  className={`provider-presets${connectionDraftPending ? ' choose' : ''}`}
                  aria-label="Provider types"
                >
                  {providerPresets.map((provider) => {
                    const activeType = !connectionDraftPending && (
                      provider.kind === 'comfyui'
                        ? isComfyConnection
                        : !isComfyConnection && provider.providerKind === editingProviderKind
                    );
                    const presetBadges = getProviderPresetBadges(provider);
                    const hasModelSwitch =
                      provider.kind === 'comfyui' ||
                      ['lm-studio', 'ollama', 'llama-cpp'].includes(provider.providerKind ?? '');
                    const isHosted = ['chatgpt', 'openrouter', 'gemini', 'composite', 'venice'].includes(provider.providerKind ?? '');
                    const hostingLabel = isHosted
                      ? 'Online provider — models are managed remotely; automatic local model switching is not needed.'
                      : 'Custom or local server — automatic model switching is not supported.';
                    return (
                      <button
                        type="button"
                        key={provider.label}
                        className={activeType ? 'active' : ''}
                        onClick={() => {
                          if (!connectionDraftPending && editingConnection.apiKey.trim() && editingConnection.apiKey !== provider.apiKey) {
                            setPendingProviderType(provider);
                            return;
                          }
                          setLlamaCppRouterNoticePending(provider.providerKind === 'llama-cpp');
                          onApplyProviderPreset(provider);
                        }}
                      >
                        <strong className="provider-preset-heading">
                          <span>{provider.label}</span>
                          <span className="provider-capability-badges">
                            {(['text', 'vision', 'image', 'voice'] as const).map((badgeKind) => {
                              const info = PRESET_CAPABILITY_INFO[badgeKind];
                              return (
                                <ProviderPresetCapabilityBadge
                                  key={badgeKind}
                                  kind={badgeKind}
                                  active={presetBadges.includes(badgeKind)}
                                  title={presetBadges.includes(badgeKind) ? info.title : `${providerCapabilityLabels[badgeKind]} not supported`}
                                  description={presetBadges.includes(badgeKind) ? info.description : 'This provider type does not support this capability.'}
                                />
                              );
                            })}
                            {hasModelSwitch ? <ProviderModelSwitchIndicator /> : (
                              <span className="provider-capability-badge active" title={hostingLabel} aria-label={hostingLabel} tabIndex={0}>
                                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  {isHosted ? <>
                                    <circle cx="8" cy="8" r="6" />
                                    <ellipse cx="8" cy="8" rx="2.5" ry="6" />
                                    <path d="M2 8h12" />
                                  </> : <>
                                    <rect x="2" y="2" width="12" height="5" rx="1" />
                                    <rect x="2" y="9" width="12" height="5" rx="1" />
                                    <path d="M4.5 4.5h.01M4.5 11.5h.01M8 4.5h3M8 11.5h3" />
                                  </>}
                                </svg>
                              </span>
                            )}
                          </span>
                        </strong>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
      {pendingProviderType && showConnections && (
        <div className="storybook-confirm-backdrop file-confirm-backdrop" role="presentation" onClick={() => setPendingProviderType(null)}>
          <section className="storybook-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="provider-type-confirm-title" aria-describedby="provider-type-confirm-message" onClick={(event) => event.stopPropagation()}>
            <h3 id="provider-type-confirm-title">Change provider type?</h3>
            <p id="provider-type-confirm-message">Switching to {pendingProviderType.label} will remove the API key from this preset and reset its Base URL and defaults. Continue?</p>
            <div className="storybook-confirm-actions">
              <button type="button" className="secondary" autoFocus onClick={() => setPendingProviderType(null)}>Cancel</button>
              <button type="button" className="danger" onClick={() => {
                setLlamaCppRouterNoticePending(pendingProviderType.providerKind === 'llama-cpp');
                onApplyProviderPreset(pendingProviderType);
                setPendingProviderType(null);
              }}>Yes, change type</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
