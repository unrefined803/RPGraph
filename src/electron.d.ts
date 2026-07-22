import type {
  AppSettings,
  ChatImageAttachment,
  ConnectionPreset,
  GeminiModelInfo,
  LmStudioModelInfo,
  LlamaCppModelInfo,
  LlmCompletionResult,
  OllamaModelInfo,
  OpenRouterModelInfo,
  SavedFileSummary,
  WorkflowFile,
} from './types';
import type { RpStorybook } from './nodes/rp-storybook/model';
import type { RpCharacterCard } from './storybook/characterCard';
import type { RpgraphSessionV2 } from './data-management/types';

type SelectedImageFile = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

declare global {
  interface Window {
    rpgraph: {
      listModels: (
        connection: ConnectionPreset,
        onAbort?: (cancel: () => void) => void,
      ) => Promise<string[]>;
      listLmStudioModels: (connection: ConnectionPreset) => Promise<LmStudioModelInfo[]>;
      listLlamaCppModels: (connection: ConnectionPreset) => Promise<LlamaCppModelInfo[]>;
      loadLlamaCppModel: (connection: ConnectionPreset) => Promise<{ loadedModel: string }>;
      isLlamaCppModelLoaded: (connection: ConnectionPreset) => Promise<{ loaded: boolean; status: LlamaCppModelInfo['status'] }>;
      unloadLlamaCppModels: (connection: ConnectionPreset) => Promise<{ unloadedCount: number; models: string[] }>;
      listOpenRouterModels: (connection: ConnectionPreset) => Promise<OpenRouterModelInfo[]>;
      generateOpenRouterSpeech: (request: {
        connection: ConnectionPreset;
        input: string;
      }, onChunk?: (base64PcmChunk: string) => void) => Promise<{ dataUrl: string; filename: string }>;
      generateGeminiSpeech: (request: {
        connection: ConnectionPreset;
        input: string;
      }, onChunk?: (base64PcmChunk: string) => void) => Promise<{ dataUrl: string; filename: string }>;
      listGeminiModels: (connection: ConnectionPreset) => Promise<GeminiModelInfo[]>;
      loadLmStudioModel: (connection: ConnectionPreset) => Promise<{
        loadedModel: string;
        method?: 'rest' | 'cli' | 'already-loaded';
      }>;
      isLmStudioModelLoaded: (connection: ConnectionPreset) => Promise<{ loaded: boolean | null }>;
      unloadLmStudioModels: (connection: ConnectionPreset) => Promise<{
        unloadedCount?: number;
        instanceIds: string[];
        method?: 'rest' | 'cli';
      }>;
      listOllamaModels: (connection: ConnectionPreset) => Promise<OllamaModelInfo[]>;
      loadOllamaModel: (connection: ConnectionPreset) => Promise<{
        loadedModel: string;
      }>;
      isOllamaModelLoaded: (connection: ConnectionPreset) => Promise<{ loaded: boolean }>;
      unloadOllamaModels: (connection: ConnectionPreset) => Promise<{
        unloadedCount: number;
        models: string[];
      }>;
      chatCompletion: (
        request: {
          connection: ConnectionPreset;
          prompt: string;
          images?: ChatImageAttachment[];
          maxTokens?: number;
          temperature?: number;
          topP?: number;
          presencePenalty?: number;
          frequencyPenalty?: number;
        },
        onAbort?: (cancel: () => void) => void,
      ) => Promise<LlmCompletionResult>;
      streamChatCompletion: (
        request: {
          connection: ConnectionPreset;
          prompt: string;
          images?: ChatImageAttachment[];
          maxTokens?: number;
          temperature?: number;
          topP?: number;
          presencePenalty?: number;
          frequencyPenalty?: number;
        },
        onChunk: (text: string) => void,
        onAbort?: (cancel: () => void) => void,
      ) => Promise<LlmCompletionResult>;
      listFiles: () => Promise<SavedFileSummary[]>;
      listCharacterFiles: () => Promise<SavedFileSummary[]>;
      saveNamedWorkflow: (
        name: string,
        workflow: WorkflowFile,
        protection: 'plain' | 'encrypted',
        password: string,
        overwrite?: boolean,
      ) => Promise<{
        fileName: string;
        name: string;
        filePath: string;
        conflict?: boolean;
      }>;
      saveRpgraphFileToPath: (request:
        | {
          kind: 'workflow';
          name: string;
          workflow: WorkflowFile;
          protection: 'plain' | 'encrypted';
          password: string;
        }
        | {
          kind: 'storybook';
          name: string;
          storybook: RpStorybook;
          protection: 'plain' | 'encrypted';
          password: string;
        }
        | {
          kind: 'session';
          name: string;
          session: RpgraphSessionV2;
          protection: 'plain' | 'encrypted';
          password: string;
        }
        | {
          kind: 'character';
          name: string;
          characterCard: RpCharacterCard;
          protection: 'plain' | 'encrypted';
          password: string;
        }
      ) => Promise<{
        canceled: boolean;
        filePath?: string;
        fileName?: string;
        name?: string;
      }>;
      loadFile: (fileName: string, password?: string, storage?: 'files' | 'characters') => Promise<{
        fileName: string;
        name: string;
        filePath: string;
        type: SavedFileSummary['type'];
        protection: SavedFileSummary['protection'];
        value: unknown;
      }>;
      loadFilePath: (filePath: string, password?: string) => Promise<{
        fileName: string;
        name: string;
        filePath: string;
        type: SavedFileSummary['type'];
        protection: SavedFileSummary['protection'];
        value: unknown;
      }>;
      selectFile: () => Promise<{
        canceled: boolean;
        filePath?: string;
        fileName?: string;
        name?: string;
        type?: SavedFileSummary['type'];
        protection?: SavedFileSummary['protection'];
        envelopeFormatVersion?: string;
        formatVersion?: string;
        workflowFormatVersion?: string;
        latestTurnNumber?: number;
        compatible?: boolean;
      }>;
      selectCharacterFile: () => Promise<{
        canceled: boolean;
        filePath?: string;
        fileName?: string;
        name?: string;
        type?: SavedFileSummary['type'];
        protection?: SavedFileSummary['protection'];
        envelopeFormatVersion?: string;
        formatVersion?: string;
        compatible?: boolean;
      }>;
      selectImages: (multiple?: boolean) => Promise<{
        canceled: boolean;
        images: SelectedImageFile[];
      }>;
      deleteFile: (fileName: string, storage?: 'files' | 'characters') => Promise<{ fileName: string }>;
      loadTextFile: () => Promise<{
        canceled: boolean;
        fileName?: string;
        contents?: string;
      }>;
      loadJsonFile: (options?: { title?: string }) => Promise<{
        canceled: boolean;
        fileName?: string;
        contents?: string;
      }>;
      loadDefaultWorkflow: () => Promise<{
        filePath: string;
        fileName?: string;
        workflow: unknown;
      }>;
      loadStartupWorkflow: () => Promise<{
        fileName: string;
        name: string;
        filePath: string;
        type: SavedFileSummary['type'];
        protection: SavedFileSummary['protection'];
        envelopeFormatVersion?: string;
        formatVersion?: string;
        workflowFormatVersion?: string;
        compatible?: boolean;
        requiresPassword?: boolean;
        value?: unknown;
        workflow?: unknown;
      }>;
      resolveProjectPath: (relativePath: string) => Promise<{
        path: string;
      }>;
      restoreDefaultWorkflow: () => Promise<{
        filePath: string;
        fileName: string;
        workflow: unknown;
      }>;
      reloadWorkflow: (filePath: string) => Promise<{
        filePath: string;
        workflow: unknown;
      }>;
      saveCurrentWorkflow: (
        filePath: string,
        workflow: WorkflowFile,
      ) => Promise<{ filePath: string }>;
      runComfyWorkflow: (request: {
        baseUrl: string;
        workflow: Record<string, unknown>;
        timeoutMs?: number;
      }) => Promise<{
        promptId: string;
        images: Array<{
          nodeId: string;
          filename: string;
          subfolder: string;
          type: string;
          dataUrl: string;
        }>;
      }>;
      freeComfyMemory: (request: {
        baseUrl: string;
      }) => Promise<{ ok: boolean }>;
      checkComfyConnection: (request: {
        baseUrl: string;
      }) => Promise<{
        ok: boolean;
        error?: string;
        system?: unknown;
        devices?: unknown;
      }>;
      listComfyModels: (request: {
        baseUrl: string;
        category:
          | 'checkpoints'
          | 'loras'
          | 'vae'
          | 'text_encoders'
          | 'diffusion_models'
          | 'controlnet'
          | 'upscale_models';
      }) => Promise<string[]>;
      inspectComfyWorkflow: (request: {
        workflowPath: string;
        role?: 'image' | 'voice';
      }) => Promise<{
        ok: boolean;
        format: 'api' | 'ui' | 'unknown';
        role: 'image' | 'voice';
        modelSource: 'checkpoint' | 'diffusion_model' | 'both' | 'missing';
        placeholders: string[];
        missing: string[];
        workflowPath?: string;
        fileName?: string;
      }>;
      repairComfyWorkflow: (request: {
        workflowPath: string;
        role?: 'image' | 'voice';
        connection: ConnectionPreset;
      }) => Promise<{
        ok: boolean;
        changed: boolean;
        inspection: {
          ok: boolean;
          format: 'api' | 'ui' | 'unknown';
          role: 'image' | 'voice';
          modelSource: 'checkpoint' | 'diffusion_model' | 'both' | 'missing';
          placeholders: string[];
          missing: string[];
          workflowPath?: string;
          fileName?: string;
        };
        workflowJson: string;
      }>;
      applyComfyWorkflowRepair: (request: {
        workflowPath: string;
        role?: 'image' | 'voice';
        workflowJson: string;
      }) => Promise<{
        ok: boolean;
        inspection: {
          ok: boolean;
          format: 'api' | 'ui' | 'unknown';
          role: 'image' | 'voice';
          modelSource: 'checkpoint' | 'diffusion_model' | 'both' | 'missing';
          placeholders: string[];
          missing: string[];
          workflowPath?: string;
          fileName?: string;
        };
        workflowPath: string;
        fileName: string;
      }>;
      selectComfyWorkflow: () => Promise<{
        canceled: boolean;
        filePath?: string;
        fileName?: string;
      }>;
      runComfyWorkflowPath: (request: {
        baseUrl: string;
        workflowPath: string;
        width?: number;
        height?: number;
        prompt?: string;
        checkpointName?: string;
        diffusionModelName?: string;
        vaeName?: string;
        textEncoderName?: string;
        loraSlots?: Array<{
          name: string;
          strength: number;
        }>;
        deleteOutputs?: boolean;
        timeoutMs?: number;
      }) => Promise<{
        promptId: string;
        images: Array<{
          nodeId: string;
          filename: string;
          subfolder: string;
          type: string;
          dataUrl: string;
        }>;
      }>;
      runComfyVoiceWorkflowPath: (request: {
        baseUrl: string;
        workflowPath: string;
        speechText: string;
        sampleDataUrl: string;
        deleteOutputs?: boolean;
        timeoutMs?: number;
      }) => Promise<{
        promptId: string;
        audio: Array<{
          nodeId: string;
          filename: string;
          subfolder: string;
          type: string;
          dataUrl: string;
        }>;
        cleanupFailed: boolean;
      }>;
      selectAudio: () => Promise<{
        canceled: boolean;
        audio?: {
          name: string;
          mimeType: string;
          size: number;
          dataUrl: string;
        };
      }>;
      loadSettings: () => Promise<{
        filePath: string;
        settings: unknown | null;
        apiKeyEncryptionAvailable: boolean;
        apiKeyDecryptionUnavailable: boolean;
      }>;
      saveSettings: (settings: AppSettings) => Promise<{
        filePath: string;
        apiKeyEncryptionAvailable: boolean;
      }>;
      getResourceStats: () => Promise<{
        ram: {
          usedBytes: number;
          totalBytes: number;
          cachedBytes?: number;
        };
        vram: {
          usedBytes: number;
          totalBytes: number;
          source: string;
        } | null;
        updatedAt: string;
      }>;
      saveSession: (
        name: string,
        session: RpgraphSessionV2,
        protection: 'plain' | 'encrypted',
        password: string,
        overwrite?: boolean,
      ) => Promise<{ fileName: string; name: string; filePath: string; conflict?: boolean }>;
      saveStorybook: (
        name: string,
        storybook: RpStorybook,
        protection: 'plain' | 'encrypted',
        password: string,
        overwrite?: boolean,
      ) => Promise<{ fileName: string; name: string; filePath: string; conflict?: boolean }>;
      saveCharacter: (
        name: string,
        characterCard: RpCharacterCard,
        protection: 'plain' | 'encrypted',
        password: string,
        overwrite?: boolean,
      ) => Promise<{ fileName: string; name: string; filePath: string; conflict?: boolean }>;
      saveCurrentSession: (
        filePath: string,
        session: RpgraphSessionV2,
        protection: 'plain' | 'encrypted',
        password: string,
      ) => Promise<{ fileName: string; filePath: string }>;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<{ isMaximized: boolean }>;
      toggleFullScreenWindow: () => Promise<{ isFullScreen: boolean }>;
      closeWindow: () => Promise<void>;
      onWindowCleanupBeforeClose: (callback: () => void | Promise<void>) => () => void;
      finishWindowCloseCleanup: () => Promise<void>;
      setZoomFactor: (zoomFactor: number) => void;
    };
  }
}
