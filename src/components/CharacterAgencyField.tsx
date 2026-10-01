import { useState } from 'react';
import { agencyTagCatalog, type AgencyTagId } from '../../shared/agency-tags.cjs';
import { withCharacterAgencyTags } from '../characters/agency';
import type { Character } from '../characters/character';
import { AgencyTagSelect } from './AgencyTagSelect';
import { useAgencyTagHoverTooltip, AGENCY_TAG_TOOLTIP_DELAY_MS } from './AgencyTagTooltip';
import './characterAgencyField.css';

/** Transactional authoring controls shared by NPC and Storybook editors. */
export function CharacterAgencyField({ character, disabled, onSave }: {
  character: Character; disabled?: boolean; onSave?: (character: Character) => boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState<AgencyTagId[] | null>(null);
  const [base, setBase] = useState('');
  const [error, setError] = useState('');
  const fingerprint = JSON.stringify([character.id, character.agencyTags ?? []]);
  const conflict = draft !== null && base !== fingerprint;

  function selectTag(index: number, value: string) {
    if (!draft) return;
    const tags = [...draft];
    if (value) tags[index] = value as AgencyTagId;
    else tags.splice(index, 1);
    setDraft(tags);
  }

  function save() {
    if (!draft || disabled || conflict) return;
    try {
      if (!onSave?.(withCharacterAgencyTags(character, draft))) {
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

  const {
    handleTagMouseEnter,
    handleTagMouseLeave,
    handleTagClick,
    showTooltipForElement,
    hideTooltip,
    TooltipPortal,
  } = useAgencyTagHoverTooltip(AGENCY_TAG_TOOLTIP_DELAY_MS);

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
                      <span
                        key={tag}
                        className="character-agency-badge character-agency-hoverable"
                        onMouseEnter={handleTagMouseEnter(tag)}
                        onMouseLeave={handleTagMouseLeave}
                        onClick={handleTagClick}
                      >
                        {tag}
                      </span>
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
                        setDraft([...characterTags]);
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

      {revealed && isEditing && (
        <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>
          <p className="character-agency-help">
            Choose up to two behavior tags. They describe the character on every app, whichever accounts exist.
          </p>

          <div className="character-agency-tag-selectors">
            {[0, 1].map((index) => {
              const selectedId = draft[index] ?? '';
              const meaning = agencyTagCatalog.find((tag) => tag.id === selectedId)?.meaning;
              return (
                <label className="character-agency-select-field" key={index}>
                  <span className="field-label">{index === 0 ? 'Primary Agency Tag' : 'Second Tag (Optional)'}</span>
                  <AgencyTagSelect
                    value={selectedId}
                    disabled={disabled || (index === 1 && !draft[0])}
                    placeholder={index === 0 ? 'None' : 'None (Single tag)'}
                    options={agencyTagCatalog.map((tag) => ({
                      id: tag.id,
                      disabled: draft.includes(tag.id) && selectedId !== tag.id,
                    }))}
                    onChange={(value) => selectTag(index, value)}
                    onShowTooltip={showTooltipForElement}
                    onHideTooltip={hideTooltip}
                  />
                  {meaning && <span className="character-agency-tag-meaning">{meaning}</span>}
                </label>
              );
            })}
          </div>

          {conflict && (
            <div className="character-agency-alert danger" role="alert">
              Agency tags changed while editing. Cancel and reopen this section.
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
      )}
      {TooltipPortal}
    </div>
  );
}
