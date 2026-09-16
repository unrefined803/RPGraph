import { useState } from 'react';
import { agencyTagCatalog, agencyTagSupports, type AgencyAccountRole, type AgencyTagId } from '../../shared/agency-tags.cjs';
import { characterAgencyDraft, withCharacterAgency, type CharacterAgencyDraft } from '../characters/agency';
import type { Character, CharacterApps } from '../characters/character';
import './characterAgencyField.css';

/** Transactional authoring controls shared by NPC and Storybook editors. */
export function CharacterAgencyField({ character, disabled, onSave }: {
  character: Character; disabled?: boolean; onSave?: (character: Character) => boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState<CharacterAgencyDraft | null>(null);
  const [base, setBase] = useState('');
  const [error, setError] = useState('');
  const fingerprint = JSON.stringify([character.id, characterAgencyDraft(character),
    Object.entries(character.apps ?? {}).map(([app, account]) => [app, account.accountId, account.enabled])]);
  const conflict = draft !== null && base !== fingerprint;
  const appNames: Record<keyof CharacterApps, string> = {
    whatsup: 'WhatsUp',
    fotogram: 'Fotogram',
    onlyfriends: 'OnlyFriends',
    matchme: 'MatchMe',
  };

  function selectTag(index: number, value: string) {
    if (!draft) return;
    const tags = [...draft.agencyTags];
    if (value) tags[index] = value as AgencyTagId;
    else tags.splice(index, 1);
    // Remove dangling selections, but leave deliberate app assignment to the author.
    setDraft({
      agencyTags: tags,
      apps: Object.fromEntries(Object.entries(draft.apps).map(([app, account]) =>
        [app, { ...account, agencyTags: account.agencyTags.filter((tag) => tags.includes(tag)) }])),
    });
  }

  function save() {
    if (!draft || disabled || conflict) return;
    try {
      if (!onSave?.(withCharacterAgency(character, draft))) {
        setError('Agency tags could not be saved. Check the editor notice.');
        return;
      }
      setDraft(null);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const isEditing = draft !== null;
  const characterTags = character.agencyTags ?? [];
  const count = characterTags.length;
  const summaryText = count === 0 ? 'Empty' : count === 1 ? '1 Tag' : `${count} Tags`;
  const appEntries = Object.entries(character.apps ?? {}) as [keyof CharacterApps, NonNullable<CharacterApps[keyof CharacterApps]>][];

  return (
    <div className={`character-agency-field character-field${isEditing ? ' is-editing' : ''}${!revealed ? ' is-collapsed' : ''}`}>
      <div className="character-agency-header">
        {!revealed ? (
          <>
            <span className="field-label" style={{ marginRight: 'auto' }}>Agency Tags · {summaryText}</span>
            <button
              type="button"
              className="storybook-inline-action nodrag"
              onClick={() => {
                setRevealed(true);
                setDraft(null);
                setError('');
              }}
            >
              View
            </button>
          </>
        ) : (
          <>
            <div className="character-agency-title-group">
              <span className="field-label">{isEditing ? 'Edit Agency Tags' : 'Agency Tags'}</span>
              {!isEditing && (
                <div className="character-agency-tag-chips">
                  {characterTags.length > 0 ? (
                    characterTags.map((tag) => (
                      <span key={tag} className="character-agency-badge">{tag}</span>
                    ))
                  ) : (
                    <span className="character-agency-empty-label">Empty</span>
                  )}
                </div>
              )}
            </div>
            <div className="character-agency-header-actions">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    className="storybook-inline-action nodrag"
                    onClick={() => { setDraft(null); setError(''); }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="storybook-inline-action nodrag"
                    disabled={disabled || conflict}
                    onClick={save}
                  >
                    Save
                  </button>
                </>
              ) : (
                <>
                  {onSave && (
                    <button
                      type="button"
                      className="storybook-inline-action nodrag"
                      disabled={disabled}
                      onClick={() => {
                        setBase(fingerprint);
                        setDraft(characterAgencyDraft(character));
                        setError('');
                      }}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="storybook-inline-action nodrag"
                    onClick={() => {
                      setRevealed(false);
                      setDraft(null);
                      setError('');
                    }}
                  >
                    Hide
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {revealed && (
        !isEditing ? (
          <div className="character-agency-apps-list">
            {appEntries.map(([app, account]) => {
              const name = appNames[app] ?? app;
              const tags = account.agencyTags ?? [];
              const role = (app === 'fotogram' || app === 'onlyfriends') ? account.accountRole ?? 'user' : null;
              return (
                <div key={app} className={`character-agency-app-row${!account.enabled ? ' is-disabled' : ''}`}>
                  <div className="character-agency-app-meta">
                    <span className="character-agency-app-name">{name}</span>
                    {!account.enabled && <span className="character-agency-disabled-tag">(disabled)</span>}
                    {role && <span className="character-agency-role-badge">{role}</span>}
                  </div>
                  <div className="character-agency-app-tags">
                    {tags.length > 0 ? (
                      tags.map((tag) => (
                        <span key={tag} className="character-agency-app-tag-pill">{tag}</span>
                      ))
                    ) : (
                      <span className="character-agency-tag-none">Unclassified</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>
            <p className="character-agency-help">
              Choose up to two behavior tags, then assign compatible tags to each enabled app.
            </p>

            <div className="character-agency-tag-selectors">
              {[0, 1].map((index) => {
                const selectedId = draft.agencyTags[index] ?? '';
                const meaning = agencyTagCatalog.find((tag) => tag.id === selectedId)?.meaning;
                return (
                  <label className="character-agency-select-field" key={index}>
                    <span className="field-label">{index === 0 ? 'Primary Agency Tag' : 'Second Tag (Optional)'}</span>
                    <div className="character-agency-select-wrap">
                      <select
                        value={selectedId}
                        disabled={disabled || (index === 1 && !draft.agencyTags[0])}
                        onChange={(event) => selectTag(index, event.target.value)}
                        className="character-agency-select nodrag"
                      >
                        <option value="">{index === 0 ? 'None' : 'None (Single tag)'}</option>
                        {agencyTagCatalog.map((tag) => (
                          <option
                            key={tag.id}
                            value={tag.id}
                            disabled={draft.agencyTags.includes(tag.id) && selectedId !== tag.id}
                          >
                            {tag.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    {meaning && <span className="character-agency-tag-meaning">{meaning}</span>}
                  </label>
                );
              })}
            </div>

            <div className="character-agency-apps-editor">
              {Object.entries(draft.apps).map(([app, assignment]) => {
                const key = app as keyof CharacterApps;
                const appName = appNames[key] ?? app;
                const isEnabled = character.apps?.[key]?.enabled;
                const hasRole = app === 'fotogram' || app === 'onlyfriends';

                return (
                  <div key={app} className={`character-agency-app-card${!isEnabled ? ' is-disabled' : ''}`}>
                    <div className="character-agency-app-card-header">
                      <div className="character-agency-app-card-title">
                        <strong>{appName}</strong>
                        {!isEnabled && <span className="character-agency-disabled-badge">Disabled</span>}
                      </div>
                      {hasRole && (
                        <div className="character-agency-role-selector">
                          <span className="character-agency-role-label">Role</span>
                          <select
                            value={assignment.accountRole ?? 'user'}
                            disabled={disabled}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                apps: {
                                  ...draft.apps,
                                  [app]: {
                                    ...assignment,
                                    accountRole: event.target.value as AgencyAccountRole,
                                  },
                                },
                              })
                            }
                            className="character-agency-role-select nodrag"
                          >
                            <option value="user">User</option>
                            <option value="creator">Creator</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="character-agency-pills-list">
                      {draft.agencyTags.length === 0 ? (
                        <span className="character-agency-empty-hint">Select a behavior tag above first.</span>
                      ) : (
                        draft.agencyTags.map((tag) => {
                          const compatible = agencyTagSupports(tag, key, assignment.accountRole ?? 'user');
                          const isChecked = assignment.agencyTags.includes(tag);
                          return (
                            <label
                              key={tag}
                              className={`character-agency-pill-toggle nodrag${isChecked ? ' is-active' : ''}${!compatible ? ' is-incompatible' : ''}`}
                              title={!compatible ? `${tag} is not compatible with ${assignment.accountRole ?? 'user'} role on ${appName}` : undefined}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={disabled || (!compatible && !isChecked)}
                                onChange={(event) => {
                                  const newTags = event.target.checked
                                    ? [...assignment.agencyTags, tag]
                                    : assignment.agencyTags.filter((entry) => entry !== tag);
                                  setDraft({
                                    ...draft,
                                    apps: {
                                      ...draft.apps,
                                      [app]: { ...assignment, agencyTags: newTags },
                                    },
                                  });
                                }}
                                style={{
                                  position: 'absolute',
                                  width: 1,
                                  height: 1,
                                  padding: 0,
                                  margin: -1,
                                  overflow: 'hidden',
                                  clip: 'rect(0, 0, 0, 0)',
                                  border: 0,
                                }}
                              />
                              <span className="character-agency-pill-check" aria-hidden="true">{isChecked ? '✓' : '+'}</span>
                              <span className="character-agency-pill-name">{tag}</span>
                              {!compatible && <span className="character-agency-pill-incompatible-tag">(not compatible)</span>}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {conflict && (
              <div className="character-agency-alert danger" role="alert">
                Accounts or agency tags changed while editing. Cancel and reopen this section.
              </div>
            )}
            {error && (
              <div className="character-agency-alert danger" role="alert">
                {error}
              </div>
            )}

            <div className="character-agency-footer-actions">
              <button
                type="button"
                className="character-agency-cancel-btn nodrag"
                onClick={() => { setDraft(null); setError(''); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="character-agency-save-btn nodrag"
                disabled={disabled || conflict}
                onClick={save}
              >
                Save Agency Tags
              </button>
            </div>
          </fieldset>
        )
      )}
    </div>
  );
}
