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
} from '../chat/imageGenerationAssistant';

type ImageGenerationAssistantDialogProps = {
  connections: ConnectionPreset[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  onClose: () => void;
  onSubmitAssistantMessage: (request: {
    connectionId: string;
    currentPrompt: string;
    messages: ImageGenerationAssistantMessage[];
    userMessage: string;
  }) => Promise<ImageGenerationAssistantResult>;
  onGenerateImages: (request: { providerId: string; prompt: string }) => Promise<string[]>;
};

export function ImageGenerationAssistantDialog({
  connections,
  providerHealthById,
  onClose,
  onSubmitAssistantMessage,
  onGenerateImages,
}: ImageGenerationAssistantDialogProps) {
  const llmConnections = connections.filter((connection) => connection.kind !== 'comfyui');
  const comfyConnections = connections.filter(isComfyImageConnection);

  const [assistantProvider, setAssistantProvider] = useState(() => llmConnections[0]?.id ?? '');
  const [imageProvider, setImageProvider] = useState(() => comfyConnections[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ImageGenerationAssistantMessage[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(-1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');

  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);

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
      const result = await onSubmitAssistantMessage({
        connectionId: assistantProvider,
        currentPrompt: prompt,
        messages: previousMessages,
        userMessage: message,
      });
      if (result.prompt !== null) {
        setPrompt(result.prompt);
      }
      setMessages((current) => [...current, { role: 'assistant', text: result.reply }]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: 'error', text: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGenerateImage() {
    if (!prompt.trim() || !imageProvider || isGenerating) {
      return;
    }
    setIsGenerating(true);
    setGenerationError('');
    try {
      const images = await onGenerateImages({ providerId: imageProvider, prompt });
      setGeneratedImages((current) => {
        const next = [...current, ...images];
        setCurrentImageIndex(next.length - 1);
        return next;
      });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGenerating(false);
    }
  }

  const selectedImageConnection = comfyConnections.find((connection) => connection.id === imageProvider);
  const selectedImageHealth = imageProvider ? providerHealthById[imageProvider] : undefined;
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
          <button type="button" className="close-button danger" onClick={onClose}>
            Close
          </button>
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
                </div>
              )}
            </div>
            <div className="image-generation-preview-stage">
              {currentImageIndex >= 0 ? (
                <img
                  src={generatedImages[currentImageIndex]}
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
          </section>

          <section className="image-generation-control-panel">
            <div className="image-generation-settings">
              <div className="storybook-panel-header">
                <span className="panel-title">Providers</span>
              </div>
              <div className="image-generation-provider-fields">
                <label className="image-generation-provider-label">
                  <span>Assistant Provider</span>
                  <NodeCustomSelect
                    value={assistantProvider}
                    onChange={setAssistantProvider}
                    options={llmConnections.length
                      ? llmConnections.map((c) => providerOption(c, providerHealthById[c.id]))
                      : [{ value: '', label: 'No assistant providers available' }]
                    }
                  />
                </label>
                <label className="image-generation-provider-label">
                  <span>ComfyUI Image Provider</span>
                  <NodeCustomSelect
                    value={imageProvider}
                    onChange={setImageProvider}
                    options={comfyConnections.length
                      ? comfyConnections.map((c) => providerOption(c, providerHealthById[c.id]))
                      : [{ value: '', label: 'No image providers available' }]
                    }
                  />
                </label>
              </div>
            </div>

            <div className="image-generation-prompt-panel">
              <div className="storybook-panel-header image-prompt-header">
                <span className="panel-title">Image Prompt</span>
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
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                placeholder="The final image prompt will appear here..."
                spellCheck={false}
                disabled={isSubmitting}
              />
              {generationError && <p className="image-generation-error" role="alert">{generationError}</p>}
            </div>
          </section>

          <section className="storybook-chat-panel image-generation-chat-panel">
            <div className="storybook-chat-header image-chat-header">
              <div className="storybook-chat-header-text">
                <span className="panel-title">AI Image Assistant</span>
                <span className="panel-subtitle">By AI Image Assistant</span>
              </div>
              <button
                type="button"
                className="chat-clear-btn"
                onClick={() => setMessages([])}
                title="Clear all chat history"
                disabled={isSubmitting}
              >
                Clear Chat
              </button>
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
