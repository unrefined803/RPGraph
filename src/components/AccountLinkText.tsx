import { useContext } from 'react';
import { AccountLinkContext } from '../chat/accountLinkContext';
import { parseAccountLinks, type AccountLink } from '../chat/accountLinks';
import './account-links.css';

export function AccountLinkText({ text, bindings }: { text: string; bindings?: AccountLink[] }) {
  const context = useContext(AccountLinkContext);
  const links = parseAccountLinks(text, context.characters, bindings);
  const content = links.flatMap((link, index) => {
    const before = text.slice(index ? links[index - 1].end : 0, link.start);
    const own = context.owner?.sourceId === link.characterId;
    const disabled = own || !context.owner || context.disabled;
    return [before, <button type="button" className="account-link" key={link.start}
      disabled={disabled} aria-label={`${link.app}: ${link.name}${own ? ' (your account)' : ''}`}
      title={own ? 'Your account' : `Add ${link.name} and open ${link.app}`}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); context.open(link); }}>
      {link.token}
    </button>];
  });
  return <>{content}{text.slice(links[links.length - 1]?.end ?? 0)}</>;
}
