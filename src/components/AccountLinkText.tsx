import { EmojiText } from './EmojiText';
import { useContext, useMemo } from 'react';
import { AccountLinkContext } from '../chat/accountLinkContext';
import { parseAccountLinks, type AccountLink } from '../chat/accountLinks';
import './account-links.css';

/** `nested` renders links as spans for text that already sits inside a button. */
export function AccountLinkText({ text, bindings, nested = false }: { text: string; bindings?: AccountLink[]; nested?: boolean }) {
  const context = useContext(AccountLinkContext);
  const links = useMemo(
    () => parseAccountLinks(text, context.characters, bindings),
    [text, context.characters, bindings],
  );
  const content = links.flatMap((link, index) => {
    const before = text.slice(index ? links[index - 1].end : 0, link.start);
    const own = context.owner?.sourceId === link.characterId;
    const disabled = own || !context.owner || context.disabled;
    const label = `${link.app}: ${link.name}${own ? ' (your account)' : ''}`;
    const title = own ? 'Your account' : `Add ${link.name} and open ${link.app}`;
    if (nested) {
      const open = (event: { stopPropagation: () => void; preventDefault: () => void }) => {
        event.stopPropagation();
        event.preventDefault();
        if (!disabled) context.open(link);
      };
      return [<EmojiText key={`text-${link.start}`} text={before} />, <span role="link" className="account-link" key={link.start}
        tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={label} title={title}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' || event.key === ' ') open(event); }}
        onClick={open}>
        <EmojiText text={link.token} />
      </span>];
    }
    return [<EmojiText key={`text-${link.start}`} text={before} />, <button type="button" className="account-link" key={link.start}
      disabled={disabled} aria-label={`${link.app}: ${link.name}${own ? ' (your account)' : ''}`}
      title={own ? 'Your account' : `Add ${link.name} and open ${link.app}`}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); context.open(link); }}>
      <EmojiText text={link.token} />
    </button>];
  });
  return <>{content}<EmojiText text={text.slice(links[links.length - 1]?.end ?? 0)} /></>;
}
