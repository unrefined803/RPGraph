import { useEffect, useState, type FormEvent } from 'react';
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
import { imageGenerationAssistantInstructions } from '../chat/imageGenerationAssistant';
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
};

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
    currentImage?: GeneratedImageDraft;
    availableCharacterLoras: string[];
    characterContext: string;
    chatHistoryContext: string;
    messages: ImageGenerationAssistantMessage[];
    userMessage: string;
    describeImage?: boolean;
  }) => Promise<ImageGenerationAssistantResult>;
  onGenerateImages: (request: {
    providerId: string;
    prompt: string;
    settings: ImageGenerationSettings;
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
  const llmConnections = connections.filter((connection) => connection.kind !== 'comfyui');
  const comfyConnections = connections.filter(isComfyImageConnection);

  const [assistantProvider, setAssistantProvider] = useState(() => llmConnections[0]?.id ?? '');
  const [imageProvider, setImageProvider] = useState(() => comfyConnections[0]?.id ?? '');
  const initialImageConnection = comfyConnections[0];
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

  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  const currentImage = currentImageIndex >= 0 ? generatedImages[currentImageIndex] : undefined;
  const textMetrics = new TextMetricsApi(estimatedTokenBytesPerToken);
  const characterContextTokens = textMetrics.measure(characterContext).tokens;
  const chatHistoryContextTokens = textMetrics.measure(chatHistoryContext).tokens;
  const assistantPromptTokens = textMetrics.measure(imageGenerationAssistantInstructions).tokens;
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
  const selectedLoraEntry = availableLoraEntries.find((entry) => entry.loraName === settingsCharacterLora);
  const orderedSaveCharacters = [...saveCharacters].sort((left, right) => {
    if (left.id === preferredSaveCharacterId) return -1;
    if (right.id === preferredSaveCharacterId) return 1;
    return left.name.localeCompare(right.name);
  });

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
      setSaveMenuOpen(false);
    } catch (error) {
      setSaveImageError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingImage(false);
    }
  }

  function readSettings(): ImageGenerationSettings {
    let value: unknown;
    try {
      value = JSON.parse(settingsText);
    } catch {
      throw new Error('Image Settings must be valid JSON.');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Image Settings must be a JSON object.');
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.width !== 'number' || !Number.isInteger(record.width) || record.width < 64 || record.width > 4096 ||
      typeof record.height !== 'number' || !Number.isInteger(record.height) || record.height < 64 || record.height > 4096 ||
      typeof record.characterLora !== 'string'
    ) {
      throw new Error('Image Settings require whole-number width and height plus a Character LoRA string.');
    }
    const characterLora = record.characterLora.trim();
    if (characterLora && !availableLoraEntries.some((entry) => entry.loraName === characterLora)) {
      throw new Error('Image Settings must use a Character LoRA defined in the Storybook.');
    }
    return {
      width: validComfyDimension(record.width, defaultComfyWidth),
      height: validComfyDimension(record.height, defaultComfyHeight),
      characterLora,
    };
  }

  function applyAssistantResult(result: ImageGenerationAssistantResult) {
    if (
      result.settings?.characterLora &&
      !availableLoraEntries.some((entry) => entry.loraName === result.settings?.characterLora)
    ) {
      throw new Error('The assistant selected a Character LoRA that is not defined in the Storybook.');
    }
    if (result.prompt !== null) {
      setPrompt(result.prompt);
    }
    if (result.settings !== null) {
      setSettingsText(JSON.stringify(result.settings, null, 2));
      setSettingsError('');
    }
    if (result.imageDescription !== null && currentImageIndex >= 0) {
      setGeneratedImages((current) => current.map((image, index) =>
        index === currentImageIndex ? { ...image, description: result.imageDescription ?? '' } : image
      ));
    }
  }

  useEffect(() => {
    if (assistantProvider) {
      onRefreshModelState(assistantProvider);
    }
  }, [assistantProvider, onRefreshModelState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !assistantProvider || isSubmitting) {
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
        currentPrompt: prompt,
        currentSettings: settings,
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
      setMessages((current) => [
        ...current,
        { role: 'error', text: error instanceof Error ? error.message : String(error) },
      ]);
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
        currentPrompt: prompt,
        currentSettings: readSettings(),
        currentImage,
        availableCharacterLoras,
        characterContext,
        chatHistoryContext,
        messages,
        userMessage: 'Describe the currently selected image.',
        describeImage: true,
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
    if (!prompt.trim() || !imageProvider || isGenerating) {
      return;
    }
    setIsGenerating(true);
    setGenerationError('');
    try {
      const settings = readSettings();
      setSettingsError('');
      const images = await onGenerateImages({ providerId: imageProvider, prompt, settings });
      setGeneratedImages((current) => {
        const next = [...current, ...images.map((dataUrl) => ({ dataUrl, description: '' }))];
        setCurrentImageIndex(next.length - 1);
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Image Settings')) {
        setSettingsError(message);
        setEditorMode('settings');
      } else {
        setGenerationError(message);
      }
    } finally {
      setIsGenerating(false);
    }
  }

  const selectedImageConnection = comfyConnections.find((connection) => connection.id === imageProvider);
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
      ? 'No ComfyUI image provider selected.'
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
            <button type="button" className="close-button danger" onClick={onClose}>
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
                  {currentImage?.description.trim() ? (
                    <div className="image-save-menu-container">
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
                      title={!selectedAssistantConnection?.vision
                        ? 'Describe Image requires an assistant provider with vision enabled.'
                        : 'Describe the currently selected image'}
                    >
                      <button
                        type="button"
                        className="preview-describe-btn"
                        disabled={!selectedAssistantConnection?.vision || isSubmitting}
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
                  <strong>Your generated image will appear here</strong>
                  <span>Generate an image to preview it here.</span>
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
                  <span>ComfyUI Image Provider</span>
                  <div className="image-generation-provider-row">
                    <NodeCustomSelect
                      value={imageProvider}
                      onChange={(providerId) => {
                      setImageProvider(providerId);
                      const connection = comfyConnections.find((entry) => entry.id === providerId);
                      setSettingsText(JSON.stringify({
                        width: connection?.comfyWidth ?? defaultComfyWidth,
                        height: connection?.comfyHeight ?? defaultComfyHeight,
                        characterLora: '',
                      }, null, 2));
                      setSettingsError('');
                      }}
                      options={comfyConnections.length
                        ? comfyConnections.map((c) => providerOption(c, providerHealthById[c.id]))
                        : [{ value: '', label: 'No image providers available' }]
                      }
                    />
                    <button
                      type="button"
                      className={`image-model-state-button ${imageModelState}`}
                      disabled={!imageProvider || imageModelState !== 'loaded'}
                      title={imageModelState === 'loaded'
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
                      {modelStateLabel(imageModelState)}
                    </button>
                  </div>
                </label>
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
                    disabled={!!generateDisabledReason || isGenerating}
                  >
                    {isGenerating ? 'Generating...' : 'Generate Image'}
                  </button>
                </span>
              </div>
              {editorMode === 'prompt' && settingsCharacterLora && (
                <div className="image-generation-lora-meter" aria-label="Selected Character LoRA">
                  <span className="image-generation-lora-pill">
                    LoRA · {selectedLoraEntry?.characterName || settingsCharacterLora}
                  </span>
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
                <span className="panel-subtitle">By AI Image Assistant</span>
              </div>
              <div className="storybook-header-actions">
                <button
                  type="button"
                  className="prompt-generate-btn"
                  onClick={() => setMessages([])}
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
                    Tell the assistant who and what should be visible. Story context and character appearances will be added later.
                  </p>
                </div>
              ) : messages.map((message, index) => (
                <div className={`chat-message-row ${message.role}`} key={`${message.role}-${index}`}>
                  <div className="message-sender-avatar">
                    {message.role === 'user' ? 'U' : message.role === 'assistant' ? 'AI' : '!'}
                  </div>
                  <div className="chat-message-bubble"><p>{message.text}</p></div>
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
            <form className="storybook-chat-form" onSubmit={submitMessage}>
              <textarea
                rows={4}
                value={draft}
                placeholder="Describe the picture or request a change..."
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                type="submit"
                className="send-message-button"
                disabled={!draft.trim() || !assistantProvider || isSubmitting}
              >
                {isSubmitting ? 'Sending...' : 'Send'}
              </button>
            </form>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}
