import { useId, useState } from 'react';
import type { Character, CharacterRelationship } from '../characters/character';
import { relationshipApps, relationshipAppLabels, searchRelationshipCharacters } from '../characters/relationships';
import './characterRelationships.css';

type Props = { character: Character; characters: Character[]; disabled?: boolean;
  onChange?: (relationships: CharacterRelationship[]) => void };

const compactAppLabels = {
  whatsup: 'WhatsUp',
  fotogram: 'Fotogram',
  onlyfriends: 'OnlyFriends',
  matchme: 'MatchMe',
} satisfies Record<(typeof relationshipApps)[number], string>;

function displayName(target: Character | undefined, characterId: string) {
  if (!target) return `Unavailable: ${characterId}`;
  return target.name.trim() || target.name;
}

export function CharacterRelationships({ character, characters, disabled, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const relationships = character.relationships ?? [];
  const candidates = searchRelationshipCharacters(characters, query, [character.id, ...relationships.map((entry) => entry.characterId)]);
  const update = (index: number, patch: Partial<CharacterRelationship>) => onChange?.(relationships.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  function add(target: Character) {
    onChange?.([...relationships, { characterId: target.id, description: '', apps: {} }]);
    setQuery(''); setActive(0);
  }
  return <section className={`character-relationships${editing ? ' is-editing' : ''}`}>
    <div className="character-relationships-header">
      <h4>Contacts &amp; Relationships</h4>
      {onChange && <button className="storybook-inline-action nodrag" type="button" disabled={disabled}
        aria-expanded={editing} onClick={() => setEditing((value) => !value)}>{editing ? 'Done' : 'Edit'}</button>}
    </div>
    {editing && <p className="character-relationships-help">Choose the connected apps and describe the relationship from this character’s perspective.</p>}
    <div className="character-relationship-list">
      {relationships.map((entry, index) => {
        const matches = characters.filter((target) => target.id === entry.characterId);
        const target = matches.length === 1 ? matches[0] : undefined;
        const name = displayName(target, entry.characterId);
        return <article className="character-relationship-card" key={entry.characterId}>
          <div className="character-relationship-summary">
            <strong className="character-relationship-name" title={target ? `${target.name} · ${entry.characterId}` : entry.characterId}>{name}</strong>
            {!editing && <span className="character-relationship-connections" aria-label="Connected apps">
              {relationshipApps.filter((app) => entry.apps[app] === true).map((app) =>
                <span key={app}>{compactAppLabels[app]} <span aria-hidden="true">✓</span></span>)}
            </span>}
            {editing && <button className="character-relationship-remove" type="button" disabled={disabled}
              aria-label={`Remove relationship to ${target?.name ?? entry.characterId}`}
              onClick={() => onChange?.(relationships.filter((_, i) => i !== index))}>Remove</button>}
          </div>
          {editing && <fieldset className="character-relationship-apps">
            <legend>Connected apps</legend>
            {relationshipApps.map((app) => {
              const unavailable = !entry.apps[app] && (!character.apps?.[app]?.enabled || !target?.apps?.[app]?.enabled);
              const connected = entry.apps[app] === true;
              return <label className={`${connected ? 'is-connected' : 'is-disconnected'}${unavailable ? ' is-unavailable' : ''}`} key={app}
                title={!character.apps?.[app]?.enabled ? 'Enable this app on the current character first.' : !target?.apps?.[app]?.enabled ? 'The target account is unavailable. A stored link will resume when the account is available.' : relationshipAppLabels[app]}>
                <input type="checkbox" checked={connected} disabled={disabled || unavailable}
                  aria-label={`${relationshipAppLabels[app]} with ${target?.name ?? entry.characterId}`}
                  onChange={(event) => update(index, { apps: { ...entry.apps, [app]: event.target.checked } })} />
                <span>{compactAppLabels[app]}</span>
              </label>;
            })}
          </fieldset>}
          {editing ? <textarea rows={3} aria-label={`Relationship to ${target?.name ?? entry.characterId}`} value={entry.description} disabled={disabled}
            placeholder="Describe the relationship from this character’s perspective…"
            onChange={(event) => update(index, { description: event.target.value })} />
            : <p className={entry.description ? undefined : 'character-relationship-empty'}>{entry.description || 'No relationship description.'}</p>}
        </article>;
      })}
    </div>
    {!relationships.length && <p className="character-relationships-empty">No authored contacts or relationships.</p>}
    {editing && <div className="character-relationship-picker">
      <input role="combobox" aria-label="Add character relationship" aria-autocomplete="list" aria-expanded={candidates.length > 0}
        aria-controls={listId} aria-activedescendant={candidates.length ? `${listId}-${Math.min(active, candidates.length - 1)}` : undefined}
        value={query} disabled={disabled} placeholder="@ Type a name to add a contact…"
        onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.stopPropagation(); setQuery(''); }
          if (!candidates.length) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length); }
          if (event.key === 'Enter') { event.preventDefault(); add(candidates[Math.min(active, candidates.length - 1)]); }
        }} />
      <div id={listId} role="listbox" aria-label="Available characters" className="character-mention-results">
        {candidates.map((target, index) => <button type="button" role="option" aria-selected={index === active} id={`${listId}-${index}`} key={target.id} onClick={() => add(target)}><strong>{target.name}</strong><small>{target.role || 'Character'} · {target.id}</small></button>)}
      </div>
      {query.replace(/^@/, '').trim() && !candidates.length && <p>No matching characters available.</p>}
    </div>}
  </section>;
}
