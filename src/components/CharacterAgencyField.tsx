import { useState } from 'react';
import { agencyTagCatalog, agencyTagSupports, type AgencyAccountRole, type AgencyTagId } from '../../shared/agency-tags.cjs';
import { characterAgencyDraft, withCharacterAgency, type CharacterAgencyDraft } from '../characters/agency';
import type { Character, CharacterApps } from '../characters/character';

/** Transactional authoring controls shared by NPC and Storybook editors. */
export function CharacterAgencyField({ character, disabled, onSave }: {
  character: Character; disabled?: boolean; onSave?: (character: Character) => boolean;
}) {
  const [draft, setDraft] = useState<CharacterAgencyDraft | null>(null);
  const [base, setBase] = useState('');
  const [error, setError] = useState('');
  const fingerprint = JSON.stringify([character.id, characterAgencyDraft(character),
    Object.entries(character.apps ?? {}).map(([app, account]) => [app, account.accountId, account.enabled])]);
  const conflict = draft !== null && base !== fingerprint;
  const appNames = { whatsup: 'WhatsUp', fotogram: 'Fotogram', onlyfriends: 'OnlyFriends', matchme: 'MatchMe' };

  function selectTag(index: number, value: string) {
    if (!draft) return;
    const tags = [...draft.agencyTags];
    if (value) tags[index] = value as AgencyTagId;
    else tags.splice(index, 1);
    // Remove dangling selections, but leave deliberate app assignment to the author.
    setDraft({ agencyTags: tags, apps: Object.fromEntries(Object.entries(draft.apps).map(([app, account]) =>
      [app, { ...account, agencyTags: account.agencyTags.filter((tag) => tags.includes(tag)) }])) });
  }

  function save() {
    if (!draft || disabled || conflict) return;
    try {
      if (!onSave?.(withCharacterAgency(character, draft))) {
        setError('Agency tags could not be saved. Check the editor notice.'); return;
      }
      setDraft(null); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  return <details className="character-field">
    <summary>Agency Tags · {character.agencyTags?.length ? character.agencyTags.join(', ') : 'Unclassified'}</summary>
    {!draft ? <>
      {Object.entries(character.apps ?? {}).map(([app, account]) => <p key={app}>
        {appNames[app as keyof CharacterApps]}{account.enabled ? '' : ' (disabled)'}
        {app === 'fotogram' || app === 'onlyfriends' ? ` · ${account.accountRole ?? 'user'}` : ''}
        {` · ${account.agencyTags?.join(', ') || 'Unclassified'}`}
      </p>)}
      {onSave && <button type="button" className="storybook-inline-action nodrag" disabled={disabled}
        onClick={() => { setBase(fingerprint); setDraft(characterAgencyDraft(character)); setError(''); }}>Edit agency tags</button>}
    </> : <fieldset disabled={disabled}>
      <p>Choose up to two behavior tags, then assign compatible tags to each enabled app.</p>
      {[0, 1].map((index) => <label className="storybook-editor-field" key={index}>
        <span className="field-label">{index === 0 ? 'Agency tag' : 'Second tag (optional)'}</span>
        <select value={draft.agencyTags[index] ?? ''} disabled={index === 1 && !draft.agencyTags[0]}
          onChange={(event) => selectTag(index, event.target.value)}>
          <option value="">None</option>
          {agencyTagCatalog.map((tag) => <option key={tag.id} value={tag.id}
            disabled={draft.agencyTags.includes(tag.id) && draft.agencyTags[index] !== tag.id}>{tag.id}</option>)}
        </select>
        <small>{agencyTagCatalog.find((tag) => tag.id === draft.agencyTags[index])?.meaning}</small>
      </label>)}
      {Object.entries(draft.apps).map(([app, assignment]) => {
        const key = app as keyof CharacterApps;
        return <fieldset key={app}>
          <legend>{appNames[key]}{character.apps?.[key]?.enabled ? '' : ' (disabled)'}</legend>
          {(app === 'fotogram' || app === 'onlyfriends') && <label>Account role <select value={assignment.accountRole ?? 'user'}
            onChange={(event) => setDraft({ ...draft, apps: { ...draft.apps, [app]: { ...assignment, accountRole: event.target.value as AgencyAccountRole } } })}>
            <option value="user">User</option><option value="creator">Creator</option>
          </select></label>}
          {draft.agencyTags.map((tag) => {
            const compatible = agencyTagSupports(tag, key, assignment.accountRole ?? 'user');
            return <label key={tag} style={{ display: 'block' }}>
              <input type="checkbox" checked={assignment.agencyTags.includes(tag)} disabled={!compatible && !assignment.agencyTags.includes(tag)}
                onChange={(event) => setDraft({ ...draft, apps: { ...draft.apps, [app]: { ...assignment,
                  agencyTags: event.target.checked ? [...assignment.agencyTags, tag] : assignment.agencyTags.filter((entry) => entry !== tag),
                } } })} /> {tag}{compatible ? '' : ' (not compatible)'}
            </label>;
          })}
        </fieldset>;
      })}
      {conflict && <p role="alert">Accounts or agency tags changed while editing. Cancel and reopen this section.</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" className="storybook-inline-action nodrag" onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
      <button type="button" className="storybook-inline-action nodrag" disabled={conflict} onClick={save}>Save agency tags</button>
    </fieldset>}
  </details>;
}
