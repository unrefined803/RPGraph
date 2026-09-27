import { useEffect, useRef, useState } from 'react';
import type { ConnectionPreset, ProviderConnectionHealth } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { ImageGenerationAssistantDialog } from './ImageGenerationAssistantDialog';
import type {
  ImageGenerationAssistantMessage,
  ImageGenerationAssistantResult,
  ImageGenerationSettings,
  ImageAssistantModelState,
} from '../chat/imageGenerationAssistant';

type PhoneImagePickerProps = {
  openCameraOnMount?: boolean;
  hideLauncher?: boolean;
  onCameraClose?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  uploadDisabled?: boolean;
  uploadDisabledReason?: string;
  onOpenGallery?: () => void;
  onUploadFromComputer: () => void;
  connections?: ConnectionPreset[];
  providerHealthById?: Record<string, ProviderConnectionHealth>;
  availableCharacterLoras: string[];
  characterContext: string;
  characterCount: number;
  chatHistoryContext: string;
  estimatedTokenBytesPerToken: number;
  saveCharacters: StorybookCharacter[];
  preferredSaveCharacterId?: string;
  imageAssistantModelStateById: Record<string, ImageAssistantModelState>;
  onSetImageAssistantLlmModelLoaded: (providerId: string, loaded: boolean) => Promise<void>;
  onUnloadImageAssistantComfyModel: (providerId: string) => Promise<void>;
  onRefreshImageAssistantModelState: (providerId: string) => void;
  onSubmitImageAssistantMessage: (request: {
    connectionId: string;
    imageProviderId: string;
    currentPrompt: string;
    currentSettings: ImageGenerationSettings;
    currentImage?: { dataUrl: string; description: string };
    availableCharacterLoras: string[];
    characterContext: string;
    chatHistoryContext: string;
    messages: ImageGenerationAssistantMessage[];
    userMessage: string;
    describeImage?: boolean;
    describeFromPromptOnly?: boolean;
  }) => Promise<ImageGenerationAssistantResult>;
  onGenerateImageAssistantImages: (request: {
    providerId: string;
    prompt: string;
    settings: ImageGenerationSettings;
  }) => Promise<string[]>;
  onSaveImageAssistantImage: (request: {
    characterId: string;
    dataUrl: string;
    description: string;
  }) => Promise<void>;
};

export function PhoneImagePicker({
  openCameraOnMount = false,
  hideLauncher = false,
  onCameraClose,
  disabled = false,
  disabledReason,
  uploadDisabled = false,
  uploadDisabledReason,
  onOpenGallery,
  onUploadFromComputer,
  connections = [],
  providerHealthById = {},
  availableCharacterLoras,
  characterContext,
  characterCount,
  chatHistoryContext,
  estimatedTokenBytesPerToken,
  saveCharacters,
  preferredSaveCharacterId,
  imageAssistantModelStateById,
  onSetImageAssistantLlmModelLoaded,
  onUnloadImageAssistantComfyModel,
  onRefreshImageAssistantModelState,
  onSubmitImageAssistantMessage,
  onGenerateImageAssistantImages,
  onSaveImageAssistantImage,
}: PhoneImagePickerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [generationAssistantOpen, setGenerationAssistantOpen] = useState(openCameraOnMount);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [menuOpen]);

  return (
    <>
      {!hideLauncher && (
      <div className="phone-image-picker" ref={menuRef}>
        <button
          className="phone-image-button"
          type="button"
          onClick={() => {
            if (disabled) {
              return;
            }
            setMenuOpen((current) => !current);
          }}
          aria-label="Attach phone image"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          disabled={disabled}
          title={disabled ? disabledReason ?? 'Image attachment unavailable' : 'Attach image'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>
        {menuOpen && (
          <div className="phone-image-action-menu" role="menu" aria-label="Add phone image">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setGenerationAssistantOpen(true);
              }}
            >
              <span aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h3l1.2-2h7.6L17 7h3a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1Z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </span>
              <span>
                <strong>Camera</strong>
                <small>Create an image with the assistant</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onOpenGallery?.();
              }}
            >
              <span aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </span>
              <span>
                <strong>Choose from Phone Gallery</strong>
                <small>Use a saved Storybook image</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={uploadDisabled}
              title={uploadDisabled ? uploadDisabledReason ?? 'Image upload requires a vision-capable provider.' : undefined}
              onClick={() => {
                if (uploadDisabled) {
                  return;
                }
                setMenuOpen(false);
                onUploadFromComputer();
              }}
            >
              <span aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </span>
              <span>
                <strong>Upload from Computer</strong>
                <small>Choose a local image file</small>
              </span>
            </button>
          </div>
        )}
      </div>
      )}

      {generationAssistantOpen && (
        <ImageGenerationAssistantDialog
          connections={connections}
          providerHealthById={providerHealthById}
          availableCharacterLoras={availableCharacterLoras}
          characterContext={characterContext}
          characterCount={characterCount}
          chatHistoryContext={chatHistoryContext}
          estimatedTokenBytesPerToken={estimatedTokenBytesPerToken}
          saveCharacters={saveCharacters.map((character) => ({ id: character.id, name: character.name }))}
          preferredSaveCharacterId={preferredSaveCharacterId}
          modelStateById={imageAssistantModelStateById}
          onSetLlmModelLoaded={onSetImageAssistantLlmModelLoaded}
          onUnloadComfyModel={onUnloadImageAssistantComfyModel}
          onRefreshModelState={onRefreshImageAssistantModelState}
          onSubmitAssistantMessage={onSubmitImageAssistantMessage}
          onGenerateImages={onGenerateImageAssistantImages}
          onSaveImage={onSaveImageAssistantImage}
          onClose={() => {
            setGenerationAssistantOpen(false);
            onCameraClose?.();
          }}
        />
      )}
    </>
  );
}
