import { useId, useState } from 'react';
import type { Character, CharacterRelationship } from '../characters/character';
import { relationshipApps, relationshipAppLabels, searchRelationshipCharacters } from '../characters/relationships';
import './characterRelationships.css';

type Props = { character: Character; characters: Character[]; disabled?: boolean;
  onChange?: (relationships: CharacterRelationship[]) => void };

export function CharacterRelationships({ character, characters, disabled, onChange }: Props) {
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
  return <section className="character-relationships">
    <h4>Contacts &amp; Relationships</h4>
    {onChange && <p>Choose each connection separately. WhatsUp stores a number; follows are one-way; MatchMe is mutual. Following OnlyFriends does not unlock paid posts.</p>}
    <div className="character-relationships-table-wrap"><table>
      <thead><tr><th scope="col">Character</th>{relationshipApps.map((app) => <th scope="col" key={app}>{relationshipAppLabels[app]}</th>)}<th scope="col">Relationship</th>{onChange && <th scope="col">Remove</th>}</tr></thead>
      <tbody>{relationships.map((entry, index) => {
        const matches = characters.filter((target) => target.id === entry.characterId);
        const target = matches.length === 1 ? matches[0] : undefined;
        return <tr key={entry.characterId}>
          <th scope="row"><span title={entry.characterId}>{target ? `@${target.name}` : `Unavailable: ${entry.characterId}`}</span></th>
          {relationshipApps.map((app) => <td key={app}>
            <input type="checkbox" checked={entry.apps[app] === true} disabled={disabled || !onChange || (!entry.apps[app] && (!character.apps?.[app]?.enabled || !target?.apps?.[app]?.enabled))}
              aria-label={`${relationshipAppLabels[app]} with ${target?.name ?? entry.characterId}`}
              title={!character.apps?.[app]?.enabled ? 'Enable this app on the current character first.' : !target?.apps?.[app]?.enabled ? 'The target account is unavailable. A stored link will resume when the account is available.' : relationshipAppLabels[app]}
              onChange={(event) => update(index, { apps: { ...entry.apps, [app]: event.target.checked } })} />
          </td>)}
          <td>{onChange ? <textarea rows={3} aria-label={`Relationship to ${target?.name ?? entry.characterId}`} value={entry.description} disabled={disabled}
            placeholder="Describe the relationship from this character’s perspective…" onChange={(event) => update(index, { description: event.target.value })} /> : entry.description || '—'}</td>
          {onChange && <td><button type="button" disabled={disabled} aria-label={`Remove relationship to ${target?.name ?? entry.characterId}`} onClick={() => onChange(relationships.filter((_, i) => i !== index))}>×</button></td>}
        </tr>;
      })}</tbody>
    </table></div>
    {!relationships.length && <p>No authored contacts or relationships.</p>}
    {onChange && <div className="character-relationship-picker">
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
