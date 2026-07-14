import { useMemo, useState } from 'react';
import type { WorkflowNode } from '../types';
import {
  emptyRpStorybookV1,
  parseRpStorybookJson,
  rpStorybookFormattedText,
  type RpStorybookFormattedTextSettings,
  type RpStorybookV1,
} from '../nodes/rp-storybook-v1/model';
import {
  applyRpStorybookEditorJson,
  rpStorybookEditorJsonView,
} from '../nodes/rp-storybook-editor/rawJson';
import { parseRpStorybookFormattedText } from '../nodes/rp-storybook-editor/formattedText';
import { JsonSyntaxTextarea } from '../nodes/shared/JsonSyntaxTextarea';
import { useBackdropDismiss } from './useBackdropDismiss';

// The Formatted Text surface edits prose only. Opening History and image
// captions are read-only context (shown in the UI Preview tab), so they are
// excluded from the editable text to keep the round-trip clean.
const editorFormattedTextSettings: RpStorybookFormattedTextSettings = {
  title: true,
  introduction: true,
  scenario: true,
  characters: true,
  openingHistory: false,
  characterImages: false,
};

type ViewMode = 'ui' | 'text' | 'json';

type StorybookEditorDialogProps = {
  node: WorkflowNode;
  onCommit: (storybook: RpStorybookV1, status: string) => void;
  onClose: () => void;
};

function StorybookReadonlyPreview({ storybook }: { storybook: RpStorybookV1 }) {
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
          <h4>Charakter</h4>
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

export function StorybookEditorDialog({ node, onCommit, onClose }: StorybookEditorDialogProps) {
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  const storybook = useMemo(() => {
    try {
      return node.data.storybookJson ? parseRpStorybookJson(node.data.storybookJson) : emptyRpStorybookV1;
    } catch {
      return emptyRpStorybookV1;
    }
  }, [node.data.storybookJson]);

  const [viewMode, setViewMode] = useState<ViewMode>('ui');
  const [jsonDraft, setJsonDraft] = useState(() => rpStorybookEditorJsonView(storybook));
  const [textDraft, setTextDraft] = useState(() =>
    rpStorybookFormattedText(storybook, editorFormattedTextSettings),
  );
  const [status, setStatus] = useState('');
  const [seededFromJson, setSeededFromJson] = useState(node.data.storybookJson);

  // Reseed both drafts when the node's stored storybook changes (e.g. after an
  // Apply commits new content), using React's render-time "reset state on a prop
  // change" pattern. Unapplied edits are intentionally discarded.
  if (node.data.storybookJson !== seededFromJson) {
    setSeededFromJson(node.data.storybookJson);
    setJsonDraft(rpStorybookEditorJsonView(storybook));
    setTextDraft(rpStorybookFormattedText(storybook, editorFormattedTextSettings));
  }

  const jsonValidity = useMemo(() => {
    try {
      JSON.parse(jsonDraft);
      return { valid: true as const };
    } catch (error) {
      return { valid: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  }, [jsonDraft]);

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

  function revertJson() {
    setJsonDraft(rpStorybookEditorJsonView(storybook));
    setStatus('Reverted to the last applied JSON.');
  }

  function revertText() {
    setTextDraft(rpStorybookFormattedText(storybook, editorFormattedTextSettings));
    setStatus('Reverted to the last applied text.');
  }

  function applyJson() {
    const result = applyRpStorybookEditorJson(storybook, jsonDraft);
    if ('error' in result) {
      setStatus(`Not applied: ${result.error}`);
      return;
    }
    const suffix = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
    onCommit(result.storybook, `Applied JSON edits.${suffix}`);
    setStatus(`Applied JSON edits.${suffix}`);
  }

  function applyText() {
    const result = parseRpStorybookFormattedText(storybook, textDraft);
    const suffix = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
    onCommit(result.storybook, `Applied text edits.${suffix}`);
    setStatus(`Applied text edits.${suffix}`);
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
          <div className="storybook-main-workspace">
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
                    className={`tab-button ${viewMode === 'text' ? 'active' : ''}`}
                    onClick={() => setViewMode('text')}
                  >
                    Formatted Text
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

                {viewMode === 'text' && (
                  <div className="storybook-text-panel storybook-editor-panel">
                    <div className="storybook-editor-tools">
                      <span className="storybook-editor-hint">Prose edits merge into the current storybook.</span>
                      <button type="button" className="inspect-button nodrag" onClick={() => copyDraft(textDraft)}>
                        Copy
                      </button>
                      <button type="button" className="inspect-button nodrag" onClick={revertText}>
                        Revert
                      </button>
                      <button type="button" className="inspect-button nodrag" onClick={applyText}>
                        Apply
                      </button>
                    </div>
                    <textarea
                      className="storybook-editor-textarea"
                      spellCheck={false}
                      value={textDraft}
                      onChange={(event) => setTextDraft(event.currentTarget.value)}
                    />
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
                      <button type="button" className="inspect-button nodrag" onClick={revertJson}>
                        Revert
                      </button>
                      <button type="button" className="inspect-button nodrag" onClick={applyJson}>
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
