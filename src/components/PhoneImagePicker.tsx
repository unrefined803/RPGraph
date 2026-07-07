import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatImageAttachment, ConnectionPreset, ProviderConnectionHealth } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { ImageGenerationAssistantDialog } from './ImageGenerationAssistantDialog';
import { useBackdropDismiss } from './useBackdropDismiss';
import type {
  ImageGenerationAssistantMessage,
  ImageGenerationAssistantResult,
  ImageGenerationSettings,
  ImageAssistantModelState,
} from '../chat/imageGenerationAssistant';

const phoneGalleryPageSize = 100;

type PhoneImagePickerProps = {
  galleryTitle: string;
  images: ChatImageAttachment[];
  disabled?: boolean;
  disabledReason?: string;
  uploadDisabled?: boolean;
  uploadDisabledReason?: string;
  onSelectImage: (image: ChatImageAttachment) => void;
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
  galleryTitle,
  images,
  disabled = false,
  disabledReason,
  uploadDisabled = false,
  uploadDisabledReason,
  onSelectImage,
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
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [generationAssistantOpen, setGenerationAssistantOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ChatImageAttachment>();
  const [page, setPage] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const totalPages = Math.max(1, Math.ceil(images.length / phoneGalleryPageSize));
  const visiblePage = Math.min(page, totalPages - 1);
  const visibleImages = images.slice(
    visiblePage * phoneGalleryPageSize,
    (visiblePage + 1) * phoneGalleryPageSize,
  );

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

  useEffect(() => {
    if (!galleryOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (selectedImage) {
          setSelectedImage(undefined);
        } else {
          setGalleryOpen(false);
        }
      } else if (event.key === 'Enter' && selectedImage) {
        onSelectImage(selectedImage);
        closeGallery();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [galleryOpen, onSelectImage, selectedImage]);

  function closeGallery() {
    setSelectedImage(undefined);
    setGalleryOpen(false);
    setPage(0);
  }
  const galleryBackdropDismiss = useBackdropDismiss<HTMLDivElement>(closeGallery);

  return (
    <>
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
                  <path d="M14.5 4l5.5 5.5" />
                  <path d="M3 21l3.5-1 12-12a2.1 2.1 0 0 0-3-3l-12 12L3 21z" />
                  <path d="M12 3h-2" />
                  <path d="M4 9V7" />
                </svg>
              </span>
              <span>
                <strong>Take a Picture</strong>
                <small>Create an image with the assistant</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setGalleryOpen(true);
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
          onClose={() => setGenerationAssistantOpen(false)}
        />
      )}

      {galleryOpen && createPortal(
        <div
          className="phone-gallery-backdrop"
          role="presentation"
          {...galleryBackdropDismiss}
        >
          <section
            className="phone-gallery-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={galleryTitle}
          >
            <header className="phone-gallery-header">
              <div>
                <span>Phone Gallery</span>
                <strong>{galleryTitle}</strong>
              </div>
              <button type="button" onClick={closeGallery} aria-label="Close phone gallery">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            {selectedImage ? (
              <div className="phone-gallery-detail">
                <div className="phone-gallery-detail-stage">
                  <img src={selectedImage.dataUrl} alt={selectedImage.name} />
                  {selectedImage.description?.trim() && (
                    <div className="phone-gallery-detail-caption">
                      {selectedImage.description}
                    </div>
                  )}
                  <div className="phone-gallery-detail-overlay-actions">
                    <button
                      type="button"
                      className="phone-gallery-action-btn cancel"
                      onClick={() => setSelectedImage(undefined)}
                      title="Cancel"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="phone-gallery-action-btn select"
                      onClick={() => {
                        onSelectImage(selectedImage);
                        closeGallery();
                      }}
                      title="Select Image"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ) : images.length ? (
              <>
                {images.length > phoneGalleryPageSize && (
                  <div className="phone-gallery-pagination image-gallery-pagination">
                    <button
                      type="button"
                      disabled={visiblePage === 0}
                      onClick={() => setPage(Math.max(0, visiblePage - 1))}
                    >
                      Previous
                    </button>
                    <span>
                      Page {visiblePage + 1} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={visiblePage >= totalPages - 1}
                      onClick={() => setPage(Math.min(totalPages - 1, visiblePage + 1))}
                    >
                      Next
                    </button>
                  </div>
                )}
                <div className="phone-gallery-grid">
                  {visibleImages.map((image) => {
                    const receivedLabel = image.receivedFrom?.trim()
                      ? `Received from ${image.receivedFrom.trim()}`
                      : (image.imageAccess ? 'Image Access' : '');
                    const description = image.description || '';
                    return (
                      <button
                        type="button"
                        key={image.id}
                        className="phone-gallery-tile"
                        onClick={() => setSelectedImage(image)}
                        aria-label={`Preview ${image.name}`}
                        title={[receivedLabel, description.trim() || image.name].filter(Boolean).join('\n')}
                      >
                        <div className="phone-gallery-image-preview">
                          <img src={image.dataUrl} alt={image.name} loading="lazy" decoding="async" />
                          {receivedLabel && (
                            <span className="phone-gallery-received-badge" title={receivedLabel}>
                              {receivedLabel}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="phone-gallery-empty">
                <span aria-hidden="true">▦</span>
                <strong>No images in this Phone Gallery</strong>
                <small>Add images to this character in RP Storybook first.</small>
              </div>
            )}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
