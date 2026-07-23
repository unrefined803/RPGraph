import { useMemo, useState } from 'react';
import type { WorkflowNode } from '../types';
import {
  defaultRpStorybookCharacterComfyConfig,
  emptyRpStorybook,
  parseRpStorybookJson,
  type RpStorybook,
} from '../nodes/rp-storybook/model';
import {
  applyRpStorybookEditorJson,
  rpStorybookEditorJsonView,
} from '../nodes/rp-storybook-editor/rawJson';
import { JsonSyntaxTextarea } from '../nodes/shared/JsonSyntaxTextarea';
import { useBackdropDismiss } from './useBackdropDismiss';

type ViewMode = 'ui' | 'fields' | 'json';

type StorybookEditorDialogProps = {
  node: WorkflowNode;
  // Returns a blocking error message (e.g. a running-story guard violation), or
  // null when the commit succeeded.
  onCommit: (storybook: RpStorybook, status: string) => string | null;
  onClose: () => void;
};

function StorybookReadonlyPreview({ storybook }: { storybook: RpStorybook }) {
  return (
    <div className="storybook-ui-view">
      <div className="storybook-ui-header">
        <div className="storybook-ui-cover-art">
          <div className="book-spine" />
          <div className="book-details">
            <h3>{storybook.title || 'Untitled RP Storybook'}</h3>
            <p className="storybook-intro">{storybook.introduction || 'No introduction defined.'}</p>
          </div>
        </div>
      </div>

      <section className="storybook-section scenario-section">
        <div className="section-header">
          <h4>Scenario</h4>
        </div>
        <div className="section-content">
          <div className="scenario-field">
            <span className="field-label">Summary</span>
            <p>{storybook.scenario.summary || 'No scenario summary defined.'}</p>
          </div>
          <div className="scenario-grid">
            <div className="scenario-field">
              <span className="field-label">Opening Situation</span>
              <p>{storybook.scenario.openingSituation || 'No opening situation defined.'}</p>
            </div>
            <div className="scenario-field">
              <span className="field-label">Current Situation</span>
              <p>{storybook.scenario.currentSituation || 'No current situation defined.'}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="storybook-section actors-section">
        <div className="section-header">
          <h4>Characters</h4>
        </div>
        {storybook.characters.length ? (
          <div className="storybook-actor-grid">
            {storybook.characters.map((character) => (
              <article className="storybook-actor-card" key={character.id}>
                <div className="character-card-header">
                  {character.profileImage?.dataUrl ? (
                    <img
                      className="storybook-editor-avatar"
                      src={character.profileImage.dataUrl}
                      alt={character.name || character.id}
                    />
                  ) : null}
                  <div className="storybook-editor-actor-heading">
                    <strong>{character.name || character.id}</strong>
                    {character.role ? <span className="field-label">{character.role}</span> : null}
                  </div>
                </div>
                {character.description ? <p>{character.description}</p> : null}
                {character.personality ? (
                  <p><span className="field-label">Personality</span> {character.personality}</p>
                ) : null}
                {character.speechStyle ? (
                  <p><span className="field-label">Speech Style</span> {character.speechStyle}</p>
                ) : null}
                {character.comfyConfig?.appearance ? (
                  <p><span className="field-label">Appearance</span> {character.comfyConfig.appearance}</p>
                ) : null}
                {character.images.length ? (
                  <div className="storybook-editor-thumbnails">
                    {character.images.slice(0, 8).map((image) => (
                      <img
                        key={image.id}
                        src={image.dataUrl}
                        alt={image.description || image.id}
                        title={image.description || image.id}
                      />
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="storybook-empty-note">No characters defined.</p>
        )}
      </section>
    </div>
  );
}

type FieldsEditorProps = {
  draft: RpStorybook;
  onChange: (next: RpStorybook) => void;
};

/**
 * Per-field editing surface. Each editor writes directly to its storybook field
 * (no free-form-text parsing), so a value can never be mis-attributed to another
 * field. Character names/ids/images/structure are read-only here — those are
 * Raw-JSON operations.
 */
function StorybookFieldsEditor({ draft, onChange }: FieldsEditorProps) {
  const setCharacter = (index: number, patch: Partial<RpStorybook['characters'][number]>) => {
    onChange({
      ...draft,
      characters: draft.characters.map((character, i) =>
        i === index ? { ...character, ...patch } : character,
      ),
    });
  };

  return (
    <div className="storybook-editor-fields">
      <label className="storybook-editor-field">
        <span className="field-label">Title</span>
        <input
          type="text"
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.currentTarget.value })}
        />
      </label>
      <label className="storybook-editor-field">
        <span className="field-label">Introduction</span>
        <textarea
          value={draft.introduction}
          spellCheck={false}
          onChange={(event) => onChange({ ...draft, introduction: event.currentTarget.value })}
        />
      </label>

      <fieldset className="storybook-editor-fieldset">
        <legend>Scenario</legend>
        <label className="storybook-editor-field">
          <span className="field-label">Summary</span>
          <textarea
            value={draft.scenario.summary}
            spellCheck={false}
            onChange={(event) =>
              onChange({ ...draft, scenario: { ...draft.scenario, summary: event.currentTarget.value } })
            }
          />
        </label>
        <label className="storybook-editor-field">
          <span className="field-label">Opening Situation</span>
          <textarea
            value={draft.scenario.openingSituation}
            spellCheck={false}
            onChange={(event) =>
              onChange({ ...draft, scenario: { ...draft.scenario, openingSituation: event.currentTarget.value } })
            }
          />
        </label>
        <label className="storybook-editor-field">
          <span className="field-label">Current Situation</span>
          <textarea
            value={draft.scenario.currentSituation}
            spellCheck={false}
            onChange={(event) =>
              onChange({ ...draft, scenario: { ...draft.scenario, currentSituation: event.currentTarget.value } })
            }
          />
        </label>
      </fieldset>

      {draft.characters.map((character, index) => (
        <fieldset className="storybook-editor-fieldset" key={character.id}>
          <legend>{character.name || character.id}</legend>
          <label className="storybook-editor-field">
            <span className="field-label">Role</span>
            <input
              type="text"
              value={character.role}
              onChange={(event) => setCharacter(index, { role: event.currentTarget.value })}
            />
          </label>
          <label className="storybook-editor-field">
            <span className="field-label">Description</span>
            <textarea
              value={character.description}
              spellCheck={false}
              onChange={(event) => setCharacter(index, { description: event.currentTarget.value })}
            />
          </label>
          <label className="storybook-editor-field">
            <span className="field-label">Personality</span>
            <textarea
              value={character.personality}
              spellCheck={false}
              onChange={(event) => setCharacter(index, { personality: event.currentTarget.value })}
            />
          </label>
          <label className="storybook-editor-field">
            <span className="field-label">Speech Style</span>
            <textarea
              value={character.speechStyle}
              spellCheck={false}
              onChange={(event) => setCharacter(index, { speechStyle: event.currentTarget.value })}
            />
          </label>
          <label className="storybook-editor-field">
            <span className="field-label">Appearance</span>
            <textarea
              value={character.comfyConfig?.appearance ?? ''}
              spellCheck={false}
              onChange={(event) =>
                setCharacter(index, {
                  comfyConfig: {
                    ...(character.comfyConfig ?? defaultRpStorybookCharacterComfyConfig()),
                    appearance: event.currentTarget.value,
                  },
                })
              }
            />
          </label>
        </fieldset>
      ))}
      {draft.characters.length === 0 && (
        <p className="storybook-empty-note">No characters. Add them in Raw JSON.</p>
      )}
    </div>
  );
}

export function StorybookEditorDialog({ node, onCommit, onClose }: StorybookEditorDialogProps) {
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  // Track parse validity so an Apply can't overwrite unparseable stored JSON
  // with empty/edited content (the fallback would otherwise be silent).
  const parsed = useMemo(() => {
    if (!node.data.storybookJson) {
      return { storybook: emptyRpStorybook, ok: true };
    }
    try {
      return { storybook: parseRpStorybookJson(node.data.storybookJson), ok: true };
    } catch {
      return { storybook: emptyRpStorybook, ok: false };
    }
  }, [node.data.storybookJson]);
  const storybook = parsed.storybook;

  const [viewMode, setViewMode] = useState<ViewMode>('ui');
  const [jsonDraft, setJsonDraft] = useState(() => rpStorybookEditorJsonView(storybook));
  const [fieldsDraft, setFieldsDraft] = useState<RpStorybook>(() => structuredClone(storybook));
  const [status, setStatus] = useState('');
  const [seededFromJson, setSeededFromJson] = useState(node.data.storybookJson);

  // Reseed drafts when the node's stored storybook changes (render-time reset).
  if (node.data.storybookJson !== seededFromJson) {
    setSeededFromJson(node.data.storybookJson);
    setJsonDraft(rpStorybookEditorJsonView(storybook));
    setFieldsDraft(structuredClone(storybook));
  }

  const jsonValidity = useMemo(() => {
    try {
      JSON.parse(jsonDraft);
      return { valid: true as const };
    } catch (error) {
      return { valid: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  }, [jsonDraft]);

  function commit(next: RpStorybook, successStatus: string) {
    const error = onCommit(next, successStatus);
    setStatus(error ? `Not applied: ${error}` : successStatus);
  }

  function beautifyJson() {
    try {
      setJsonDraft(JSON.stringify(JSON.parse(jsonDraft), null, 2));
      setStatus('JSON is valid and formatted.');
    } catch (error) {
      setStatus(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function minifyJson() {
    try {
      setJsonDraft(JSON.stringify(JSON.parse(jsonDraft)));
      setStatus('JSON minified.');
    } catch (error) {
      setStatus(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function copyDraft(value: string) {
    void navigator.clipboard?.writeText(value);
    setStatus('Copied to clipboard.');
  }

  function applyJson() {
    const result = applyRpStorybookEditorJson(storybook, jsonDraft);
    if ('error' in result) {
      setStatus(`Not applied: ${result.error}`);
      return;
    }
    const suffix = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
    commit(result.storybook, `Applied JSON edits.${suffix}`);
  }

  return (
    <div className="dialog-backdrop" role="presentation" {...backdropDismiss}>
      <section
        className="storybook-creator-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="RP Storybook Editor"
      >
        <div className="dialog-header storybook-creator-header">
          <div className="storybook-title-row">
            <h2>{node.data.label}</h2>
            <p>{status || node.data.storybookStatus || 'Ready'}</p>
          </div>
          <div className="storybook-header-actions">
            <button type="button" className="close-button danger" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="storybook-creator-body">
          {!parsed.ok && (
            <span className="run-note storybook-file-status">
              This node&rsquo;s stored JSON is invalid; editing is disabled to avoid overwriting it.
            </span>
          )}
          <div className="storybook-main-workspace storybook-editor-workspace">
            <div className="storybook-document-panel">
              <div className="storybook-panel-header">
                <span className="panel-title">Storybook Document</span>
                <div className="storybook-tabs">
                  <button
                    type="button"
                    className={`tab-button ${viewMode === 'ui' ? 'active' : ''}`}
                    onClick={() => setViewMode('ui')}
                  >
                    UI Preview
                  </button>
                  <button
                    type="button"
                    className={`tab-button ${viewMode === 'fields' ? 'active' : ''}`}
                    onClick={() => setViewMode('fields')}
                  >
                    Fields
                  </button>
                  <button
                    type="button"
                    className={`tab-button ${viewMode === 'json' ? 'active' : ''}`}
                    onClick={() => setViewMode('json')}
                  >
                    Raw JSON
                  </button>
                </div>
              </div>

              <div className="storybook-panel-content">
                {viewMode === 'ui' && <StorybookReadonlyPreview storybook={storybook} />}

                {viewMode === 'fields' && (
                  <div className="storybook-editor-panel">
                    <div className="storybook-editor-tools">
                      <span className="storybook-editor-hint">Each field is edited directly — no parsing.</span>
                      <button
                        type="button"
                        className="inspect-button nodrag"
                        onClick={() => setFieldsDraft(structuredClone(storybook))}
                      >
                        Revert
                      </button>
                      <button
                        type="button"
                        className="inspect-button nodrag"
                        disabled={!parsed.ok}
                        onClick={() => commit(fieldsDraft, 'Applied field edits.')}
                      >
                        Apply
                      </button>
                    </div>
                    <StorybookFieldsEditor draft={fieldsDraft} onChange={setFieldsDraft} />
                  </div>
                )}

                {viewMode === 'json' && (
                  <div className="storybook-json-panel storybook-editor-panel">
                    <div className="storybook-editor-tools">
                      <span className={`storybook-editor-validity ${jsonValidity.valid ? 'valid' : 'invalid'}`}>
                        {jsonValidity.valid ? 'Valid JSON' : `Invalid JSON: ${jsonValidity.message}`}
                      </span>
                      <button type="button" className="inspect-button nodrag" onClick={beautifyJson}>
                        Beautify JSON
                      </button>
                      <button type="button" className="inspect-button nodrag" onClick={minifyJson}>
                        Minify
                      </button>
                      <button type="button" className="inspect-button nodrag" onClick={() => copyDraft(jsonDraft)}>
                        Copy
                      </button>
                      {/* Beautify/Minify/Revert replace the draft, which resets the
                          editor's own undo history; Revert is the escape hatch. */}
                      <button
                        type="button"
                        className="inspect-button nodrag"
                        onClick={() => setJsonDraft(rpStorybookEditorJsonView(storybook))}
                      >
                        Revert
                      </button>
                      <button
                        type="button"
                        className="inspect-button nodrag"
                        disabled={!parsed.ok}
                        onClick={applyJson}
                      >
                        Apply
                      </button>
                    </div>
                    <JsonSyntaxTextarea id="storybook-editor-json" value={jsonDraft} onChange={setJsonDraft} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
