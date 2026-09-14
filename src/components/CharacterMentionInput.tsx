import { useId, useRef, useState } from 'react';
import type { Character } from '../characters/character';
import { searchRelationshipCharacters } from '../characters/relationships';
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
};

/** Mentions attach explicit canonical identities; typing a name alone never creates a relationship. */
export function CharacterMentionInput({ value, onChange, characters, selectedIds, onSelectedIdsChange, onSubmit, disabled, placeholder }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const prefix = value.slice(0, caret);
  const match = /(?:^|\s)@([^@\n]{1,80})$/.exec(prefix);
  const results = !dismissed && match ? searchRelationshipCharacters(characters, match[1]) : [];
  function select(character: Character) {
    const start = prefix.lastIndexOf('@');
    const text = `@${character.name} `;
    const next = value.slice(0, start) + text + value.slice(caret);
    onChange(next);
    onSelectedIdsChange([...new Set([...selectedIds, character.id])]);
    setDismissed(true);
    const position = start + text.length;
    setCaret(position);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(position, position); });
  }
  return <div className="character-mention-input">
    <textarea ref={input} className="nodrag nowheel" rows={4} value={value} disabled={disabled}
      placeholder={placeholder ?? 'Ask for changes. Type @ and a name to attach a character.'}
      aria-label="Assistant message" aria-controls={results.length ? listId : undefined}
      aria-activedescendant={results.length ? `${listId}-${Math.min(active, results.length - 1)}` : undefined}
      onChange={(event) => { onChange(event.target.value); setCaret(event.target.selectionStart); setActive(0); setDismissed(false); }}
      onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (results.length) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length); return;
          }
          if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
            event.preventDefault(); select(results[Math.min(active, results.length - 1)]); return;
          }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(); }
      }} />
    {results.length > 0 && <div className="character-mention-results" id={listId} role="listbox" aria-label="Character references">
      {results.map((character, index) => <button type="button" role="option" aria-selected={index === active}
        id={`${listId}-${index}`} key={character.id} onMouseDown={(event) => event.preventDefault()} onClick={() => select(character)}>
        <strong>{character.name}</strong><small>{character.role || 'Character'} · {character.id}</small>
      </button>)}
    </div>}
    {selectedIds.length > 0 && <div className="character-reference-chips" aria-label="Attached character context">
      {selectedIds.map((id) => <button type="button" key={id} disabled={disabled}
        onClick={() => onSelectedIdsChange(selectedIds.filter((entry) => entry !== id))}
        aria-label={`Remove reference to ${characters.find((entry) => entry.id === id)?.name ?? id}`}>
        @{characters.find((entry) => entry.id === id)?.name ?? 'Unavailable character'} ×
      </button>)}
    </div>}
  </div>;
}
