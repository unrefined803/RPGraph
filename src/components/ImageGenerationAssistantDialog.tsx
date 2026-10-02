import { AssistantComposer } from './AssistantComposer';
import { isTextGenerationConnection } from '../llm/textProvider';
import { characterLoraStatus } from '../images/loraCompatibility';
import { addImageGenerationReference, maxImageGenerationReferences, type ImageGenerationReference } from '../images/references';
import { isImageGenerationConnection, supportsImageGenerationReferences } from '../images/providers';
import { usePanelNavigationOverlay } from '../navigation/usePanelNavigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useBackdropDismiss } from './useBackdropDismiss';
import type { ConnectionPreset, ProviderConnectionHealth } from '../types';
import { NodeCustomSelect } from '../nodes/shared/NodeCustomSelect';
import { providerOption } from '../nodes/shared/providerHealthLabels';
import { isComfyImageConnection } from '../comfy/connectionRole';
import type {
  ImageGenerationAssistantMessage,
  ImageGenerationAssistantResult,
  ImageGenerationSettings,
  ImageAssistantModelState,
} from '../chat/imageGenerationAssistant';
import { imageAssistantInstructions } from '../chat/imageGenerationAssistant';
import { defaultComfyHeight, defaultComfyWidth, validComfyDimension } from '../settings';
import { isLocalProviderConnection } from '../llm/providerKind';
import { TextMetricsApi } from '../llm/tokenMetrics';

type GeneratedImageDraft = {
  dataUrl: string;
  description: string;
};

type ImageSaveCharacter = {
  id: string;
  name: string;
  images: ImageGenerationReference[];
};

class ImageSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageSettingsError';
  }
}

type ImageGenerationAssistantDialogProps = {
  connections: ConnectionPreset[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  availableCharacterLoras: string[];
  characterContext: string;
  characterCount: number;
  chatHistoryContext: string;
  estimatedTokenBytesPerToken: number;
  saveCharacters: ImageSaveCharacter[];
  preferredSaveCharacterId?: string;
  modelStateById: Record<string, ImageAssistantModelState>;
  onSetLlmModelLoaded: (providerId: string, loaded: boolean) => Promise<void>;
  onUnloadComfyModel: (providerId: string) => Promise<void>;
  onRefreshModelState: (providerId: string) => void;
  onClose: () => void;
  onSubmitAssistantMessage: (request: {
    connectionId: string;
    imageProviderId: string;
    currentPrompt: string;
    currentSettings: ImageGenerationSettings;
    referenceImages?: ImageGenerationReference[];
    currentImage?: GeneratedImageDraft;
    availableCharacterLoras: string[];
    characterContext: string;
    chatHistoryContext: string;
    messages: ImageGenerationAssistantMessage[];
    userMessage: string;
    describeImage?: boolean;
    describeFromPromptOnly?: boolean;
    characterLoraOverride?: boolean;
  }) => Promise<ImageGenerationAssistantResult>;
  onGenerateImages: (request: {
    providerId: string;
    prompt: string;
    settings: ImageGenerationSettings;
    referenceImages?: ImageGenerationReference[];
  }) => Promise<string[]>;
  onSaveImage: (request: {
    characterId: string;
    dataUrl: string;
    description: string;
  }) => Promise<void>;
};

export function ImageGenerationAssistantDialog({
  connections,
  providerHealthById,
  availableCharacterLoras,
  characterContext,
  characterCount,
  chatHistoryContext,
  estimatedTokenBytesPerToken,
  saveCharacters,
  preferredSaveCharacterId,
  modelStateById,
  onSetLlmModelLoaded,
  onUnloadComfyModel,
  onRefreshModelState,
  onClose,
  onSubmitAssistantMessage,
  onGenerateImages,
  onSaveImage,
}: ImageGenerationAssistantDialogProps) {
  const llmConnections = connections.filter((connection) => isTextGenerationConnection(connection, providerHealthById[connection.id]));
  const imageConnections = connections.filter((connection) => isImageGenerationConnection(connection, providerHealthById[connection.id]));

  const [assistantProvider, setAssistantProvider] = useState(() => llmConnections[0]?.id ?? '');
  const [imageProvider, setImageProvider] = useState(() => imageConnections[0]?.id ?? '');
  const initialImageConnection = imageConnections[0];
  const imageSupportsLora = !!connections.find((connection) => connection.id === imageProvider && isComfyImageConnection(connection));
  const referencesSupported = supportsImageGenerationReferences(connections.find((connection) => connection.id === imageProvider), providerHealthById[imageProvider]);
  const [referenceImages, setReferenceImages] = useState<ImageGenerationReference[]>([]);
  const [referenceGalleryOpen, setReferenceGalleryOpen] = useState(false);
  const [referenceCharacterId, setReferenceCharacterId] = useState(preferredSaveCharacterId ?? saveCharacters[0]?.id ?? '');
  const [aspectRatio, setAspectRatio] = useState('3:4');
  const [hoverReference, setHoverReference] = useState<{ image: ImageGenerationReference; x: number; y: number } | null>(null);
  const [referenceError, setReferenceError] = useState('');
  const activeReferences = referencesSupported ? referenceImages : [];
  const [prompt, setPrompt] = useState('');
  const [editorMode, setEditorMode] = useState<'prompt' | 'settings'>('prompt');
  const [settingsText, setSettingsText] = useState(() => JSON.stringify({
    width: initialImageConnection?.comfyWidth ?? defaultComfyWidth,
    height: initialImageConnection?.comfyHeight ?? defaultComfyHeight,
    characterLora: '',
  }, null, 2));
  const [settingsError, setSettingsError] = useState('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ImageGenerationAssistantMessage[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [generatedImages, setGeneratedImages] = useState<GeneratedImageDraft[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(-1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [modelActionError, setModelActionError] = useState('');
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const [saveImageError, setSaveImageError] = useState('');
  const [savedImageDataUrls, setSavedImageDataUrls] = useState<Set<string>>(() => new Set());
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement | null>(null);

  const currentImage = currentImageIndex >= 0 ? generatedImages[currentImageIndex] : undefined;
  const hasUnsavedImages = generatedImages.some((image) => !savedImageDataUrls.has(image.dataUrl));
  const requestClose = useCallback(() => {
    if (referenceGalleryOpen) {
      setReferenceGalleryOpen(false);
      return;
    }
    if (isSubmitting || isGenerating || isSavingImage) {
      return;
    }
    if (hasUnsavedImages) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  }, [hasUnsavedImages, isGenerating, isSavingImage, isSubmitting, onClose, referenceGalleryOpen]);
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(requestClose);
  usePanelNavigationOverlay(() => setDiscardConfirmOpen(false), discardConfirmOpen);
  usePanelNavigationOverlay(() => setReferenceGalleryOpen(false), referenceGalleryOpen);
  const textMetrics = new TextMetricsApi(estimatedTokenBytesPerToken);
  const characterContextTokens = textMetrics.measure(characterContext).tokens;
  const chatHistoryContextTokens = textMetrics.measure(chatHistoryContext).tokens;
  const assistantPromptTokens = textMetrics.measure(imageAssistantInstructions(imageSupportsLora, referencesSupported)).tokens;
  const availableLoraEntries = availableCharacterLoras.map((entry) => {
    const separatorIndex = entry.indexOf(': ');
    return separatorIndex >= 0
      ? { characterName: entry.slice(0, separatorIndex).trim(), loraName: entry.slice(separatorIndex + 2).trim() }
      : { characterName: '', loraName: entry.trim() };
  });
  const settingsCharacterLora = (() => {
    try {
      const value = JSON.parse(settingsText) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return '';
      }
      const loraName = (value as Record<string, unknown>).characterLora;
      return typeof loraName === 'string' ? loraName.trim() : '';
    } catch {
      return '';
    }
  })();
  const loraConnection = connections.find((connection) => connection.id === imageProvider);
  const loraKey = JSON.stringify([loraConnection?.id, loraConnection?.comfyWorkflowPath, loraConnection?.comfyDiffusionModelName, loraConnection?.comfyCheckpointName, loraConnection?.comfyLoraSlots, settingsCharacterLora]);
  const [loraOverride, setLoraOverride] = useState('');
  const loraStatus = characterLoraStatus(loraConnection, settingsCharacterLora, loraOverride === loraKey);
  const loraNotice = imageSupportsLora && settingsCharacterLora && !loraStatus.active
    ? `Character LoRA "${settingsCharacterLora}" disabled. ${loraStatus.reason}` : '';
  const lastLoraNotice = useRef('');
  useEffect(() => {
    if (loraNotice && loraNotice !== lastLoraNotice.current) {
      setMessages((current) => [...current, { role: 'assistant', text: loraNotice }]);
    }
    lastLoraNotice.current = loraNotice;
  }, [loraNotice]);
  const selectedLoraEntry = availableLoraEntries.find((entry) => entry.loraName === settingsCharacterLora);
  const orderedSaveCharacters = [...saveCharacters].sort((left, right) => {
    if (left.id === preferredSaveCharacterId) return -1;
    if (right.id === preferredSaveCharacterId) return 1;
    return left.name.localeCompare(right.name);
  });

  function addReference(image: ImageGenerationReference) {
    if (!referencesSupported || isSubmitting || isGenerating) return;
    try {
      const next = addImageGenerationReference(referenceImages, image);
      setReferenceImages(next);
      setReferenceError('');
      setReferenceGalleryOpen(false);
      setMessages((current) => [...current, { role: 'reference', reference: next[next.length - 1], text: `${next[next.length - 1].name} is now used as Image ${next.length}.` }]);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : String(error));
    }
  }

  function removeReference(index: number) {
    const removed = referenceImages[index];
    const next = referenceImages.filter((_, entryIndex) => entryIndex !== index);
    setReferenceImages(next);
    setReferenceError('');
    setMessages((current) => [...current, { role: 'reference', text:
      `${removed.name} was removed from the references. ${next.length
        ? next.map((image, imageIndex) => `Image ${imageIndex + 1}: ${image.name}`).join('; ')
        : 'No reference images selected.'}` }]);
  }

  async function saveCurrentImage(characterId: string) {
    if (!currentImage?.description.trim() || isSavingImage) {
      return;
    }
    setIsSavingImage(true);
    setSaveImageError('');
    try {
      await onSaveImage({
        characterId,
        dataUrl: currentImage.dataUrl,
        description: currentImage.description.trim(),
      });
      setSavedImageDataUrls((current) => new Set(current).add(currentImage.dataUrl));
      setSaveMenuOpen(false);
    } catch (error) {
      setSaveImageError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingImage(false);
    }
  }

  function readSettings(): ImageGenerationSettings {
    if (!imageSupportsLora) return { width: defaultComfyWidth, height: defaultComfyHeight, characterLora: '', aspectRatio };
    let value: unknown;
    try {
      value = JSON.parse(settingsText);
    } catch {
      throw new ImageSettingsError('Image Settings must be valid JSON.');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ImageSettingsError('Image Settings must be a JSON object.');
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.width !== 'number' || !Number.isInteger(record.width) || record.width < 64 || record.width > 4096 ||
      typeof record.height !== 'number' || !Number.isInteger(record.height) || record.height < 64 || record.height > 4096 ||
      typeof record.characterLora !== 'string'
    ) {
      throw new ImageSettingsError('Image Settings require whole-number width and height plus a Character LoRA string.');
    }
    const characterLora = imageSupportsLora ? record.characterLora.trim() : '';
    if (characterLora && !availableLoraEntries.some((entry) => entry.loraName === characterLora)) {
      throw new ImageSettingsError('Image Settings must use a Character LoRA defined in the Storybook.');
    }
    return {
      width: validComfyDimension(record.width, defaultComfyWidth),
      height: validComfyDimension(record.height, defaultComfyHeight),
      characterLora,
    };
  }

  function applyAssistantResult(result: ImageGenerationAssistantResult) {
    if (result.prompt !== null) {
      setPrompt(result.prompt);
    }
    if (result.imageDescription !== null && currentImageIndex >= 0) {
      setGeneratedImages((current) => current.map((image, index) =>
        index === currentImageIndex ? { ...image, description: result.imageDescription ?? '' } : image
      ));
    }
    if (
      imageSupportsLora && result.settings?.characterLora &&
      !availableLoraEntries.some((entry) => entry.loraName === result.settings?.characterLora)
    ) {
      throw new ImageSettingsError('The assistant selected a Character LoRA that is not defined in the Storybook. Prompt and description were applied; the settings were kept unchanged.');
    }
    if (imageSupportsLora && result.settings !== null) {
      setSettingsText(JSON.stringify({ ...result.settings, characterLora: imageSupportsLora ? result.settings.characterLora : '' }, null, 2));
      setSettingsError('');
    }
  }

  useEffect(() => {
    if (assistantProvider) {
      onRefreshModelState(assistantProvider);
    }
  }, [assistantProvider, onRefreshModelState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting && !isGenerating) {
        requestClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isGenerating, isSubmitting, requestClose]);

  useEffect(() => {
    if (!saveMenuOpen) {
      return;
    }
    const closeSaveMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && !saveMenuRef.current?.contains(event.target)) {
        setSaveMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeSaveMenu);
    return () => document.removeEventListener('pointerdown', closeSaveMenu);
  }, [saveMenuOpen]);

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !assistantProvider || isSubmitting || isGenerating) {
      return;
    }
    const previousMessages = messages;
    setMessages((current) => [...current, { role: 'user', text: message }]);
    setDraft('');
    setIsSubmitting(true);
    try {
      const settings = readSettings();
      const result = await onSubmitAssistantMessage({
        connectionId: assistantProvider,
        imageProviderId: imageProvider,
        referenceImages: activeReferences,
        currentPrompt: prompt,
        currentSettings: settings,
        characterLoraOverride: loraOverride === loraKey,
        currentImage,
        availableCharacterLoras,
        characterContext,
        chatHistoryContext,
        messages: previousMessages,
        userMessage: message,
      });
      applyAssistantResult(result);
      setMessages((current) => [...current, { role: 'assistant', text: result.reply }]);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (error instanceof ImageSettingsError) {
        setSettingsError(text);
        setEditorMode('settings');
      }
      setMessages((current) => [...current, { role: 'error', text }]);
    } finally {
      setIsSubmitting(false);
      onRefreshModelState(assistantProvider);
    }
  }

  async function describeCurrentImage() {
    if (!currentImage || !assistantProvider || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await onSubmitAssistantMessage({
        connectionId: assistantProvider,
        imageProviderId: imageProvider,
        referenceImages: selectedAssistantConnection?.vision ? activeReferences : [],
        currentPrompt: prompt,
        currentSettings: readSettings(),
        characterLoraOverride: loraOverride === loraKey,
        currentImage,
        availableCharacterLoras,
        characterContext,
        chatHistoryContext,
        messages,
        userMessage: 'Describe the currently selected image.',
        describeImage: true,
        describeFromPromptOnly: !selectedAssistantConnection?.vision,
      });
      applyAssistantResult(result);
      setMessages((current) => [...current, { role: 'assistant', text: result.reply }]);
    } catch (error) {
      setMessages((current) => [...current, {
        role: 'error',
        text: error instanceof Error ? error.message : String(error),
      }]);
    } finally {
      setIsSubmitting(false);
      onRefreshModelState(assistantProvider);
    }
  }

  async function handleGenerateImage() {
    if (!prompt.trim() || !imageProvider || isGenerating || isSubmitting) {
      return;
    }
    setIsGenerating(true);
    setGenerationError('');
    try {
      const settings = readSettings();
      if (!loraStatus.active) settings.characterLora = '';
      setSettingsError('');
      const images = await onGenerateImages({ providerId: imageProvider, prompt, settings, referenceImages: activeReferences });
      setGeneratedImages((current) => {
        const next = [...current, ...images.map((dataUrl) => ({ dataUrl, description: '' }))];
        setCurrentImageIndex(next.length - 1);
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ImageSettingsError) {
        setSettingsError(message);
        setEditorMode('settings');
      } else {
        setGenerationError(message);
      }
    } finally {
      setIsGenerating(false);
    }
  }

  const selectedImageConnection = imageConnections.find((connection) => connection.id === imageProvider);
  const selectedAssistantConnection = llmConnections.find((connection) => connection.id === assistantProvider);
  const selectedImageHealth = imageProvider ? providerHealthById[imageProvider] : undefined;
  const assistantModelState = assistantProvider ? modelStateById[assistantProvider] ?? 'unknown' : 'unknown';
  const imageModelState = imageProvider ? modelStateById[imageProvider] ?? 'unknown' : 'unknown';
  const assistantIsLocal = !!selectedAssistantConnection && isLocalProviderConnection(selectedAssistantConnection);
  const modelStateLabel = (state: ImageAssistantModelState) => {
    if (state === 'loading') return 'Loading...';
    if (state === 'unloading') return 'Unloading...';
    if (state === 'loaded') return 'Model loaded';
    if (state === 'unloaded') return 'Model unloaded';
    return 'Status unknown';
  };
  const generateDisabledReason = !prompt.trim()
    ? 'Enter an image prompt first.'
    : !selectedImageConnection
      ? 'No image provider selected.'
      : selectedImageHealth?.status === 'offline'
        ? `Provider is offline${selectedImageHealth.detail ? `: ${selectedImageHealth.detail}` : '.'}`
        : selectedImageHealth?.status === 'warning'
          ? `Provider is not fully set up${selectedImageHealth.detail ? `: ${selectedImageHealth.detail}` : '.'}`
          : selectedImageHealth?.status === 'checking'
            ? 'Provider connection is being checked.'
            : '';

  return createPortal(
    <div className="dialog-backdrop" role="presentation" {...backdropDismiss}>
      <section
        className="image-generation-assistant-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Image Generation Assistant"
      >
        <header className="dialog-header storybook-creator-header">
          <div className="storybook-title-row">
            <h2>Image Generation Assistant</h2>
            <p>Compose a picture for this phone conversation.</p>
          </div>
          <div className="storybook-header-actions">
            <button type="button" className="close-button danger" onClick={requestClose}>
              Close
            </button>
          </div>
        </header>

        <div className="image-generation-assistant-workspace">
          <section className="image-generation-preview-panel">
            <div className="storybook-panel-header image-preview-header">
              <span className="panel-title">Image Preview</span>
              {generatedImages.length > 0 && (
                <div className="image-preview-controls">
                  <button
                    type="button"
                    className="preview-nav-btn"
                    disabled={currentImageIndex <= 0}
                    onClick={() => setCurrentImageIndex((idx) => idx - 1)}
                    title="Previous Image"
                  >
                    ←
                  </button>
                  <span className="preview-counter">
                    {currentImageIndex + 1} / {generatedImages.length}
                  </span>
                  <button
                    type="button"
                    className="preview-nav-btn"
                    disabled={currentImageIndex >= generatedImages.length - 1}
                    onClick={() => setCurrentImageIndex((idx) => idx + 1)}
                    title="Next Image"
                  >
                    →
                  </button>
                  {referencesSupported && currentImage && (
                    <button type="button" className="preview-describe-btn"
                      disabled={isSubmitting || isGenerating || referenceImages.length >= maxImageGenerationReferences || referenceImages.some((image) => image.dataUrl === currentImage.dataUrl)}
                      onClick={() => addReference({ id: `generated-${currentImageIndex + 1}`, name: `Generated image ${currentImageIndex + 1}`, ...currentImage })}>
                      Use as Reference
                    </button>
                  )}
                  {currentImage?.description.trim() ? (
                    <div className="image-save-menu-container" ref={saveMenuRef}>
                      <button
                        type="button"
                        className="preview-save-btn"
                        disabled={isSavingImage || orderedSaveCharacters.length === 0}
                        onClick={() => setSaveMenuOpen((current) => !current)}
                      >
                        {isSavingImage ? 'Saving...' : 'Save Image in Phone'}
                      </button>
                      {saveMenuOpen && (
                        <div className="image-save-character-menu" role="menu" aria-label="Save image for character">
                          {orderedSaveCharacters.map((character) => (
                            <button
                              type="button"
                              role="menuitem"
                              key={character.id}
                              onClick={() => void saveCurrentImage(character.id)}
                            >
                              <strong>{character.name}</strong>
                              {character.id === preferredSaveCharacterId && <small>Current phone</small>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span
                      className="prompt-generate-tooltip"
                      title={!assistantProvider
                        ? 'Select an assistant provider to describe this image.'
                        : selectedAssistantConnection?.vision
                          ? 'Describe the currently selected image'
                          : 'The selected assistant provider has no vision — the description will be written from the image prompt instead.'}
                    >
                      <button
                        type="button"
                        className="preview-describe-btn"
                        disabled={!assistantProvider || isSubmitting}
                        onClick={() => void describeCurrentImage()}
                      >
                        Describe Image
                      </button>
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="image-generation-preview-stage">
              {currentImageIndex >= 0 ? (
                <img
                  src={currentImage?.dataUrl}
                  alt={`Generated Preview ${currentImageIndex + 1}`}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '12px' }}
                />
              ) : (
                <div className="image-generation-placeholder" aria-hidden="true">
                  <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <strong>No image yet</strong>
                  <span>Describe the picture in the assistant chat, then press Generate Image.</span>
                </div>
              )}
            </div>
            {currentImage?.description && (
              <p className="image-generation-description">{currentImage.description}</p>
            )}
            {saveImageError && <p className="image-generation-save-error" role="alert">{saveImageError}</p>}
          </section>

          <section className="image-generation-control-panel">
            <div className="image-generation-settings">
              <div className="storybook-panel-header">
                <span className="panel-title">Providers</span>
              </div>
              <div className="image-generation-provider-fields">
                <label className="image-generation-provider-label">
                  <span>Assistant Provider</span>
                  <div className="image-generation-provider-row">
                    <NodeCustomSelect
                      value={assistantProvider}
                      onChange={setAssistantProvider}
                      options={llmConnections.length
                        ? llmConnections.map((c) => providerOption(c, providerHealthById[c.id]))
                        : [{ value: '', label: 'No assistant providers available' }]
                      }
                    />
                    <button
                      type="button"
                      className={`image-model-state-button ${assistantModelState}`}
                      disabled={!assistantIsLocal || assistantModelState === 'loading' || assistantModelState === 'unloading'}
                      title={!assistantIsLocal
                        ? 'API providers run remotely and need no local model management.'
                        : assistantModelState === 'loaded' ? 'Unload the model' : 'Load the selected model'}
                      onClick={() => {
                        setModelActionError('');
                        void onSetLlmModelLoaded(assistantProvider, assistantModelState !== 'loaded')
                          .catch((error) => setModelActionError(error instanceof Error ? error.message : String(error)));
                      }}
                    >
                      {assistantIsLocal ? modelStateLabel(assistantModelState) : 'API'}
                    </button>
                  </div>
                </label>
                <label className="image-generation-provider-label">
                  <span>Image Provider</span>
                  <div className="image-generation-provider-row">
                    <NodeCustomSelect
                      value={imageProvider}
                      disabled={isSubmitting || isGenerating}
                      onChange={(providerId) => {
                      setImageProvider(providerId);
                      setEditorMode('prompt');
                      setHoverReference(null);
                      setReferenceGalleryOpen(false);
                      setReferenceError('');
                      if (!supportsImageGenerationReferences(connections.find((connection) => connection.id === providerId), providerHealthById[providerId]) && referenceImages.length) {
                        setReferenceImages([]);
                        setMessages((current) => [...current, { role: 'reference', text: 'Reference images cleared: this provider does not support references.' }]);
                      }
                      const connection = imageConnections.find((entry) => entry.id === providerId);
                      setSettingsText(JSON.stringify({
                        width: connection?.comfyWidth ?? defaultComfyWidth,
                        height: connection?.comfyHeight ?? defaultComfyHeight,
                        characterLora: '',
                      }, null, 2));
                      setSettingsError('');
                      }}
                      options={imageConnections.length
                        ? imageConnections.map((c) => providerOption(c, providerHealthById[c.id]))
                        : [{ value: '', label: 'No image providers available' }]
                      }
                    />
                    <button
                      type="button"
                      className={`image-model-state-button ${imageModelState}`}
                      disabled={!imageSupportsLora || imageModelState !== 'loaded'}
                      title={!imageSupportsLora ? 'API providers generate images remotely.' : imageModelState === 'loaded'
                        ? 'Unload the ComfyUI model'
                        : 'ComfyUI loads image models when Generate Image runs. Its API has no separate load-only action.'}
                      onClick={() => {
                        setModelActionError('');
                        if (imageModelState === 'loaded') {
                          void onUnloadComfyModel(imageProvider)
                            .catch((error) => setModelActionError(error instanceof Error ? error.message : String(error)));
                        }
                      }}
                    >
                      {imageSupportsLora ? modelStateLabel(imageModelState) : 'API'}
                    </button>
                  </div>
                </label>
                {!imageSupportsLora && imageProvider && (
                  <label className="image-generation-provider-label">
                    <span>Image Format</span>
                    <NodeCustomSelect
                      value={aspectRatio}
                      disabled={isSubmitting || isGenerating}
                      onChange={(val) => setAspectRatio(String(val))}
                      options={[
                        { value: '3:4', label: 'Portrait · 3:4' },
                        { value: '4:5', label: 'Portrait · 4:5' },
                        { value: '9:16', label: 'Portrait · 9:16' },
                        { value: '1:1', label: 'Square · 1:1' },
                        { value: '4:3', label: 'Landscape · 4:3' },
                        { value: '16:9', label: 'Landscape · 16:9' },
                      ]}
                    />
                  </label>
                )}
                {modelActionError && <p className="image-generation-provider-error" role="alert">{modelActionError}</p>}
              </div>
            </div>

            <div className="image-generation-prompt-panel">
              <div className="storybook-panel-header image-prompt-header">
                <div className="chat-panel-tabs image-generation-editor-tabs" role="tablist" aria-label="Image generation editor">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={editorMode === 'prompt'}
                    className={editorMode === 'prompt' ? 'active' : ''}
                    onClick={() => setEditorMode('prompt')}
                  >
                    Image Prompt
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={editorMode === 'settings'}
                    className={editorMode === 'settings' ? 'active' : ''}
                    disabled={!imageSupportsLora}
                    onClick={() => setEditorMode('settings')}
                  >
                    Image Settings
                  </button>
                </div>
                <span
                  className="prompt-generate-tooltip"
                  title={generateDisabledReason || (isGenerating ? 'Image generation is running.' : 'Generate image')}
                >
                  <button
                    type="button"
                    className="prompt-generate-btn"
                    onClick={() => void handleGenerateImage()}
                    disabled={!!generateDisabledReason || isGenerating || isSubmitting}
                  >
                    {isGenerating ? 'Generating...' : 'Generate Image'}
                  </button>
                </span>
              </div>
              {imageSupportsLora && editorMode === 'prompt' && settingsCharacterLora && (
                <div className="image-generation-lora-meter" aria-label="Selected Character LoRA">
                  <button type="button"
                    className={`image-generation-lora-pill${!loraStatus.hasSlot ? ' is-blocked' : !loraStatus.active ? ' is-inactive' : ''}`}
                    disabled={!loraStatus.hasSlot || isGenerating || isSubmitting}
                    title={`${loraStatus.reason}${loraStatus.hasSlot && !loraStatus.active ? ' Activate despite model mismatch.' : ''}`}
                    aria-pressed={loraStatus.active}
                    onClick={() => {
                      if (!loraStatus.active && loraStatus.hasSlot) {
                        setLoraOverride(loraKey);
                        setMessages((current) => [...current, { role: 'assistant', text: `Character LoRA "${settingsCharacterLora}" activated manually despite the model warning.` }]);
                      }
                    }}>

                    LoRA · {selectedLoraEntry?.characterName || settingsCharacterLora} · {loraStatus.active ? 'Active' : loraStatus.hasSlot ? 'Inactive' : 'No slot'}
                  </button>
                </div>
              )}
              {editorMode === 'prompt' ? (
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.currentTarget.value)}
                  placeholder="The final image prompt will appear here..."
                  spellCheck={false}
                  disabled={isSubmitting}
                />
              ) : (
                <textarea
                  className="image-generation-settings-json"
                  value={settingsText}
                  onChange={(event) => {
                    setSettingsText(event.currentTarget.value);
                    setSettingsError('');
                  }}
                  aria-label="Image Settings JSON"
                  spellCheck={false}
                  disabled={isSubmitting || isGenerating}
                />
              )}
              {settingsError && <p className="image-generation-error" role="alert">{settingsError}</p>}
              {generationError && <p className="image-generation-error" role="alert">{generationError}</p>}
            </div>
          </section>

          <section className="storybook-chat-panel image-generation-chat-panel">
            <div className="storybook-chat-header image-chat-header">
              <div className="storybook-chat-header-text">
                <span className="panel-title">AI Image Assistant</span>
                <span className="panel-subtitle">Refines your prompt, settings, and description</span>
              </div>
              <div className="storybook-header-actions">
                <button
                  type="button"
                  className="prompt-generate-btn"
                  onClick={() => setMessages(activeReferences.map((reference) => ({ role: 'reference', text: reference.name, reference })))}
                  title="Clear all chat history"
                  disabled={isSubmitting}
                >
                  Clear Chat
                </button>
              </div>
            </div>
            <div className="node-assistant-context-meter image-generation-context-meter">
              <span className="context-meter-total">
                Characters {characterCount} · ~{characterContextTokens.toLocaleString()} tokens
              </span>
              <span className="context-meter-total">Last 4 Turns · ~{chatHistoryContextTokens.toLocaleString()} tokens</span>
              <span className="context-meter-total">Assistant Prompt · ~{assistantPromptTokens.toLocaleString()} tokens</span>
            </div>
            <div className="storybook-chat-log">
              {messages.length === 0 ? (
                <div className="chat-empty-state">
                  <div className="assistant-avatar-large">AI</div>
                  <p className="empty-title">Create a picture</p>
                  <p className="empty-description">
                    Describe the picture you want. If references are selected, use Image 1, Image 2, or Image 3 to explain what should change.
                  </p>
                </div>
              ) : messages.map((message, index) => (
                <div className={`chat-message-row ${message.role}`} key={`${message.role}-${index}`}>
                  <div className="message-sender-avatar">
                    {message.role === 'user' ? 'U' : message.role === 'assistant' ? 'AI' : message.role === 'reference' ? 'IMG' : '!'}
                  </div>
                  <div className={`chat-message-bubble${message.reference ? ' image-reference-notice' : ''}`}>
                    {message.reference ? (() => {
                      const reference = message.reference;
                      const activeIndex = activeReferences.findIndex((image) => image.dataUrl === reference.dataUrl);
                      const preview = (target: HTMLElement) => {
                        const rect = target.getBoundingClientRect();
                        setHoverReference({ image: reference, x: Math.max(8, Math.min(rect.left, window.innerWidth - 272)), y: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 272)) });
                      };
                      return (
                        <div className="image-reference-bubble-inner">
                          <button
                            className="image-reference-thumb-btn"
                            type="button"
                            onMouseEnter={(event) => preview(event.currentTarget)}
                            onMouseLeave={() => setHoverReference(null)}
                            onFocus={(event) => preview(event.currentTarget)}
                            onBlur={() => setHoverReference(null)}
                            onClick={(event) => hoverReference?.image === reference ? setHoverReference(null) : preview(event.currentTarget)}
                            title="Click or hover to preview full image"
                          >
                            <img src={reference.dataUrl} alt={reference.name} />
                          </button>
                          <div className="image-reference-info">
                            <span className="image-reference-badge">
                              {activeIndex >= 0 ? `Image ${activeIndex + 1}` : 'Not used'}
                            </span>
                            <span className="image-reference-title" title={reference.name}>
                              {reference.name}
                            </span>
                          </div>
                          {activeIndex >= 0 && (
                            <button
                              className="image-reference-remove"
                              type="button"
                              aria-label={`Remove Image ${activeIndex + 1}`}
                              title={`Remove Image ${activeIndex + 1}`}
                              disabled={isSubmitting || isGenerating}
                              onClick={() => removeReference(activeIndex)}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })() : <p>{message.text}</p>}
                  </div>
                </div>
              ))}
              {isSubmitting && (
                <div className="chat-message-row assistant thinking">
                  <div className="message-sender-avatar">AI</div>
                  <div className="chat-message-bubble typing-bubble">
                    <div className="typing-indicator"><span /><span /><span /></div>
                  </div>
                </div>
              )}
            </div>
            {referenceError && <p className="image-generation-error" role="alert">{referenceError}</p>}
            <AssistantComposer onSubmit={submitMessage}
              disabled={!draft.trim() || !assistantProvider || isGenerating} busy={isSubmitting}
              actions={referencesSupported && (
                <button
                  type="button"
                  className="image-chat-reference-btn"
                  disabled={isSubmitting || isGenerating || activeReferences.length >= maxImageGenerationReferences}
                  onClick={() => { setReferenceError(''); setReferenceGalleryOpen(true); }}
                  title={activeReferences.length >= maxImageGenerationReferences ? 'Maximum references reached (3/3)' : 'Add reference image'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>Reference</span>
                  <span className="image-chat-reference-count">{activeReferences.length}/3</span>
                </button>
              )}>
              <textarea
                className="image-chat-textarea"
                rows={2}
                value={draft}
                placeholder="Describe the picture or request a change..."
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </AssistantComposer>
          </section>
        </div>
        {hoverReference && createPortal(<div className="image-reference-hover" style={{ left: hoverReference.x, top: hoverReference.y }}><img src={hoverReference.image.dataUrl} alt={hoverReference.image.name} /></div>, document.body)}
        {referenceGalleryOpen && referencesSupported && (
          <div className="storybook-confirm-backdrop" role="presentation" onClick={() => setReferenceGalleryOpen(false)}>
            <section className="storybook-confirm-dialog image-reference-gallery" role="dialog" aria-modal="true" aria-label="Choose a reference from the phone gallery" onClick={(event) => event.stopPropagation()}>
              <div className="image-reference-gallery-header">
                <div className="image-reference-gallery-title-group">
                  <h3>Choose a Reference Image</h3>
                  <p>Select an image from the gallery to use as reference.</p>
                </div>
                <button
                  type="button"
                  className="image-reference-modal-close"
                  onClick={() => setReferenceGalleryOpen(false)}
                  aria-label="Close reference gallery"
                  title="Close"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="image-reference-gallery-character-select">
                <label className="image-generation-provider-label">
                  <span>Character</span>
                  <NodeCustomSelect
                    value={referenceCharacterId}
                    onChange={(val) => setReferenceCharacterId(String(val))}
                    options={saveCharacters.length
                      ? saveCharacters.map((character) => ({
                          value: character.id,
                          label: character.name,
                        }))
                      : [{ value: '', label: 'No characters available' }]
                    }
                  />
                </label>
              </div>

              <div className="image-reference-gallery-grid">
                {(saveCharacters.find((character) => character.id === referenceCharacterId)?.images ?? []).map((image) => {
                  const isSelected = referenceImages.some((entry) => entry.dataUrl === image.dataUrl);
                  return (
                    <button
                      type="button"
                      className={`image-reference-card${isSelected ? ' is-selected' : ''}`}
                      key={image.id}
                      disabled={isSelected}
                      onClick={() => addReference(image)}
                      title={isSelected ? 'Already selected as reference' : `Select ${image.name || image.id}`}
                    >
                      <div className="image-reference-card-preview">
                        <img src={image.dataUrl} alt={image.description || image.name} loading="lazy" />
                        {isSelected && (
                          <span className="image-reference-selected-badge">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Selected
                          </span>
                        )}
                      </div>
                      <div className="image-reference-card-label">
                        <span title={image.name || image.id}>{image.name || image.id}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {!saveCharacters.find((character) => character.id === referenceCharacterId)?.images.length && (
                <div className="image-reference-empty">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <p>This character's gallery is empty.</p>
                </div>
              )}
              {referenceError && <p className="image-generation-error" role="alert">{referenceError}</p>}
              <div className="image-reference-gallery-actions">
                <button type="button" className="inspect-button" onClick={() => setReferenceGalleryOpen(false)}>Cancel</button>
              </div>
            </section>
          </div>
        )}
        {discardConfirmOpen && (
          <div className="storybook-confirm-backdrop" role="presentation" onClick={() => setDiscardConfirmOpen(false)}>
            <section
              className="storybook-confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="image-discard-confirm-title"
              aria-describedby="image-discard-confirm-message"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id="image-discard-confirm-title">Discard unsaved images?</h3>
              <p id="image-discard-confirm-message">
                Unsaved generated images will be lost when you close the assistant.
              </p>
              <div className="storybook-confirm-actions">
                <button className="inspect-button" type="button" onClick={() => setDiscardConfirmOpen(false)}>
                  Keep Editing
                </button>
                <button className="inspect-button danger" type="button" onClick={onClose}>
                  Close Anyway
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
