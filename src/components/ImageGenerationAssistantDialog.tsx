import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useBackdropDismiss } from './useBackdropDismiss';
import type { ConnectionPreset, ProviderConnectionHealth } from '../types';
import { NodeCustomSelect } from '../nodes/shared/NodeCustomSelect';
import { providerOption } from '../nodes/shared/providerHealthLabels';
import { isComfyImageConnection } from '../comfy/connectionRole';

type ImageGenerationAssistantDialogProps = {
  connections: ConnectionPreset[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  onClose: () => void;
  onSave?: (dataUrl: string) => void;
};

function generateMockImage(prompt: string, index: number) {
  const gradients = [
    ['#4f46e5', '#06b6d4'], // Indigo -> Cyan
    ['#ec4899', '#8b5cf6'], // Pink -> Purple
    ['#f59e0b', '#ef4444'], // Amber -> Red
    ['#10b981', '#3b82f6'], // Emerald -> Blue
    ['#6366f1', '#a855f7'], // Indigo -> Purple
  ];
  const gradient = gradients[index % gradients.length];
  const displayPrompt = prompt.trim()
    ? (prompt.length > 50 ? prompt.slice(0, 47) + '...' : prompt)
    : 'Scenic View';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="100%" height="100%">
      <defs>
        <linearGradient id="grad-${index}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${gradient[0]};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${gradient[1]};stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grad-${index})" />
      <g stroke="rgba(255,255,255,0.06)" stroke-width="1.5">
        <line x1="0" y1="200" x2="800" y2="200" />
        <line x1="0" y1="400" x2="800" y2="400" />
        <line x1="0" y1="600" x2="800" y2="600" />
        <line x1="0" y1="800" x2="800" y2="800" />
        <line x1="200" y1="0" x2="200" y2="1000" />
        <line x1="400" y1="0" x2="400" y2="1000" />
        <line x1="600" y1="0" x2="600" y2="1000" />
      </g>
      <circle cx="400" cy="420" r="160" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2" />
      <circle cx="400" cy="420" r="200" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="12 12" />
      <rect x="100" y="700" width="600" height="220" rx="16" fill="rgba(15, 23, 42, 0.65)" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1" />
      <text x="140" y="750" fill="rgba(255,255,255,0.4)" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" letter-spacing="1.5">AI IMAGE GENERATOR</text>
      <text x="140" y="795" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="800">Generation #${index + 1}</text>
      <text x="140" y="850" fill="rgba(255,255,255,0.8)" font-family="system-ui, -apple-system, sans-serif" font-size="15" font-weight="500">${displayPrompt}</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function ImageGenerationAssistantDialog({
  connections,
  providerHealthById,
  onClose,
  onSave,
}: ImageGenerationAssistantDialogProps) {
  const llmConnections = connections.filter((connection) => connection.kind !== 'comfyui');
  const comfyConnections = connections.filter(isComfyImageConnection);

  const [assistantProvider, setAssistantProvider] = useState(() => llmConnections[0]?.id ?? '');
  const [imageProvider, setImageProvider] = useState(() => comfyConnections[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<string[]>([]);

  // Generated images navigation states
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(-1);

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

  function submitMessage(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) {
      return;
    }
    setMessages((current) => [...current, message]);
    setDraft('');
  }

  function handleGenerateImage() {
    if (!prompt.trim()) {
      return;
    }
    const nextIndex = generatedImages.length;
    const newImage = generateMockImage(prompt, nextIndex);
    setGeneratedImages((prev) => [...prev, newImage]);
    setCurrentImageIndex(nextIndex);
  }

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
                  <button
                    type="button"
                    className="preview-save-btn"
                    onClick={() => {
                      if (currentImageIndex >= 0 && onSave) {
                        onSave(generatedImages[currentImageIndex]);
                      }
                    }}
                    title="Save current image to message attachments"
                  >
                    Save
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
                  <span>Click Generate Image to create mock visual options.</span>
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
                <button
                  type="button"
                  className="prompt-generate-btn"
                  onClick={handleGenerateImage}
                  disabled={!prompt.trim()}
                >
                  Generate Image
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                placeholder="The final image prompt will appear here..."
                spellCheck={false}
              />
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
                <div className="chat-message-row user" key={`${message}-${index}`}>
                  <div className="message-sender-avatar">U</div>
                  <div className="chat-message-bubble"><p>{message}</p></div>
                </div>
              ))}
            </div>
            <form className="storybook-chat-form" onSubmit={submitMessage}>
              <textarea
                rows={4}
                value={draft}
                placeholder="Describe the picture or request a change..."
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
              <button type="submit" className="send-message-button" disabled={!draft.trim()}>Send</button>
            </form>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}
