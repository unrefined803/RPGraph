import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';

export function ProviderModelSwitchIndicator() {
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
  return <>
    <span
      className="provider-model-switch"
      tabIndex={0}
      aria-label="Supports automatic model switching"
      aria-describedby={anchor ? id : undefined}
      onMouseEnter={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAnchor(null)}
      onFocus={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
      onBlur={() => setAnchor(null)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); setAnchor(null); }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); }
      }}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 5h12l-3-3M14 11H2l3 3" />
      </svg>
    </span>
    {anchor && createPortal(
      <div id={id} role="tooltip" className="provider-model-switch-tooltip" style={{
        left: Math.max(12, Math.min(anchor.right - 300, window.innerWidth - 312)),
        top: anchor.top > window.innerHeight / 2 ? anchor.top - 8 : anchor.bottom + 8,
        transform: anchor.top > window.innerHeight / 2 ? 'translateY(-100%)' : undefined,
      }}>
        <strong>Automatic model switching</strong>
        <p>This provider supports model switching. RPGraph automatically loads and unloads models when switching between ComfyUI image or voice generation and a supported local LLM provider.</p>
        <p>Supported local providers: LM Studio, Ollama, and llama.cpp in router mode.</p>
      </div>, document.body,
    )}
  </>;
}
