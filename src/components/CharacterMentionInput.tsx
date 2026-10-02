import { useEffect, useId, useRef, useState } from 'react';
import type { Character } from '../characters/character';
import { searchRelationshipCharacters } from '../characters/relationships';
import { characterMentionQuery, updateCharacterMentions, type CharacterMention } from './characterMentions';
import './characterRelationships.css';

type Props = {
  value: string;
  onChange: (value: string) => void;
  characters: Character[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
};

/** Mentions attach explicit canonical identities; typing a name alone never creates a relationship. */
export function CharacterMentionInput({ value, onChange, characters, selectedIds, onSelectedIdsChange, onSubmit, disabled, placeholder, rows = 4 }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [tracked, setTracked] = useState<{ text: string; mentions: CharacterMention[] }>({ text: value, mentions: [] });
  const mentions = updateCharacterMentions(tracked.text, value, tracked.mentions)
    .filter((mention) => selectedIds.includes(mention.id) && characters.some((character) => character.id === mention.id));
  const query = characterMentionQuery(value, caret, mentions);
  const results = !disabled && !composing && !dismissed && query ? searchRelationshipCharacters(characters, query.query) : [];
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const attachedIds = [...new Set(mentions.map((mention) => mention.id))];
  const attachedIdsKey = JSON.stringify(attachedIds);
  // Draft resets and external replacements must not leave invisible attachments behind.
  useEffect(() => {
    const nextIds = JSON.parse(attachedIdsKey) as string[];
    if (selectedIds.length !== nextIds.length || selectedIds.some((id) => !nextIds.includes(id))) onSelectedIdsChange(nextIds);
  }, [attachedIdsKey, selectedIds, onSelectedIdsChange]);
  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, query?.query, results.length]);

  useEffect(() => {
    const textarea = input.current;
    const layer = highlight.current;
    if (!textarea || !layer) return;
    const sync = () => {
      layer.style.width = `${textarea.clientWidth}px`;
      layer.style.height = `${textarea.clientHeight}px`;
      layer.scrollTop = textarea.scrollTop;
      layer.scrollLeft = textarea.scrollLeft;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value]);

  function change(next: string, position: number) {
    const nextMentions = updateCharacterMentions(value, next, mentions);
    setTracked({ text: next, mentions: nextMentions });
    onChange(next);
    onSelectedIdsChange([...new Set(nextMentions.map((mention) => mention.id))]);
    setCaret(position);
    setActive(0);
    setDismissed(false);
  }
  function select(character: Character) {
    if (!query || disabled) return;
    const text = `@${character.name}`;
    const next = value.slice(0, query.start) + text + ' ' + value.slice(caret);
    const nextMentions = [...updateCharacterMentions(value, next, mentions), {
      start: query.start, end: query.start + text.length, id: character.id, text,
    }].sort((a, b) => a.start - b.start);
    setTracked({ text: next, mentions: nextMentions });
    onChange(next);
    onSelectedIdsChange([...new Set(nextMentions.map((mention) => mention.id))]);
    setDismissed(true);
    const position = query.start + text.length + 1;
    setCaret(position);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(position, position); });
  }
  const segments = [];
  let offset = 0;
  for (const mention of mentions) {
    segments.push(value.slice(offset, mention.start));
    segments.push(<mark key={`${mention.start}:${mention.id}`}>{value.slice(mention.start, mention.end)}</mark>);
    offset = mention.end;
  }
  segments.push(value.slice(offset));

  return <div className="character-mention-input">
    <div className="character-mention-editor">
      <div ref={highlight} className="character-mention-highlight" aria-hidden="true">{segments}{'\u200b'}</div>
      <textarea ref={input} className="nodrag nowheel" rows={rows} value={value} disabled={disabled}
        placeholder={placeholder ?? 'Ask for changes. Type @ and a name to attach a character.'}
        aria-label="Assistant message" aria-controls={results.length ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={results.length ? `${listId}-${activeIndex}` : undefined}
        onChange={(event) => change(event.target.value, event.target.selectionStart)}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onBlur={() => setDismissed(true)}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        onScroll={(event) => {
          if (highlight.current) {
            highlight.current.scrollTop = event.currentTarget.scrollTop;
            highlight.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (results.length) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length); return;
            }
            if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
              event.preventDefault(); select(results[activeIndex]); return;
            }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
          }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(); }
        }} />
    </div>
    {results.length > 0 && <div className="character-mention-menu">
      <div className="character-mention-menu-heading"><span>Characters</span><span>↑ ↓ to choose · Enter to add</span></div>
      <div className="character-mention-results" id={listId} role="listbox" aria-label="Character references">
        {results.map((character, index) => <button type="button" role="option" aria-selected={index === activeIndex}
          ref={(element) => { optionRefs.current[index] = element; }}
          id={`${listId}-${index}`} key={character.id} onMouseDown={(event) => event.preventDefault()} onClick={() => select(character)}>
          <span className="character-mention-avatar" aria-hidden="true">{character.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</span>
          <span className="character-mention-option-text"><strong>{character.name}</strong><small>{character.role || 'Character'}{results.some((other) => other.id !== character.id && other.name === character.name) ? ` · ${character.id}` : ''}</small></span>
          <span className="character-mention-option-enter" aria-hidden="true">↵</span>
        </button>)}
      </div>
    </div>}
  </div>;
}
