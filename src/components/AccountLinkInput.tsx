import { useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { AccountLinkContext } from '../chat/accountLinkContext';
import { parseAccountLinks } from '../chat/accountLinks';
import './account-links.css';

/** Paint recognized links over a native field without changing its text or selection. */
export function AccountLinkInput({ value, children }: { value: string; children: ReactNode }) {
  const { characters } = useContext(AccountLinkContext);
  const links = parseAccountLinks(value, characters);
  const wrapper = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const mirror = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const field = wrapper.current?.querySelector('input, textarea');
    const frame = viewport.current;
    const content = mirror.current;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || !frame || !content) return;
    const sync = () => {
      const style = getComputedStyle(field);
      const singleLine = field instanceof HTMLInputElement;
      Object.assign(frame.style, {
        left: `${field.offsetLeft + field.clientLeft}px`, top: `${field.offsetTop + field.clientTop}px`,
        width: `${field.clientWidth}px`, height: `${field.clientHeight}px`,
        borderRadius: style.borderRadius,
      });
      Object.assign(content.style, {
        // Computed font shorthand can be empty when individual font settings differ.
        // Copy the longhands so the mirror never falls back to its parent's font size.
        fontFamily: style.fontFamily, fontSize: style.fontSize,
        fontWeight: style.fontWeight, fontStyle: style.fontStyle,
        fontStretch: style.fontStretch, fontVariant: style.fontVariant,
        fontKerning: style.fontKerning, fontFeatureSettings: style.fontFeatureSettings,
        fontVariationSettings: style.fontVariationSettings, fontOpticalSizing: style.fontOpticalSizing,
        lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
        wordSpacing: style.wordSpacing, textAlign: style.textAlign,
        textIndent: style.textIndent, textTransform: style.textTransform, tabSize: style.tabSize,
        color: style.color, padding: style.padding, width: `${field.clientWidth}px`,
        whiteSpace: singleLine ? 'pre' : 'pre-wrap', overflowWrap: singleLine ? 'normal' : 'break-word',
        height: singleLine ? `${field.clientHeight}px` : 'auto',
        display: singleLine ? 'flex' : 'block', alignItems: singleLine ? 'center' : '',
        transform: `translate(${-field.scrollLeft}px, ${-field.scrollTop}px)`,
      });
      field.style.setProperty('--account-input-caret', style.color);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(field);
    field.addEventListener('scroll', sync);
    field.addEventListener('input', sync);
    return () => {
      observer.disconnect();
      field.removeEventListener('scroll', sync);
      field.removeEventListener('input', sync);
      field.style.removeProperty('--account-input-caret');
    };
  });

  return <div ref={wrapper} className={`account-link-input${links.length ? ' has-links' : ''}`}>
    {children}
    <div ref={viewport} className="account-link-input-viewport" aria-hidden="true">
      <div ref={mirror} className="account-link-input-mirror"><span>{links.flatMap((link, index) => [
        value.slice(index ? links[index - 1].end : 0, link.start),
        <span className="account-link-recognized" key={link.start}>{link.token}</span>,
      ])}{value.slice(links[links.length - 1]?.end ?? 0)}{'\u200b'}</span></div>
    </div>
  </div>;
}
