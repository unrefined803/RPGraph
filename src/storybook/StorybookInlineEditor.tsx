import { useState, type ReactNode } from 'react';

type TextField = { key: string; label: string; value: string; multiline?: boolean };

type Props = {
  label: string;
  fields: TextField[];
  disabled?: boolean;
  heading?: ReactNode;
  onSave: (values: Record<string, string>) => boolean;
  children: ReactNode;
};

/** Keep section drafts local; merge only edited text into the current document. */
export function StorybookInlineEditor({ label, fields, disabled, heading, onSave, children }: Props) {
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [base, setBase] = useState('');
  const [error, setError] = useState('');
  const snapshot = JSON.stringify(fields.map(({ key, value }) => [key, value]));
  const conflict = draft !== null && base !== snapshot;

  function save() {
    if (!draft || disabled || conflict) return;
    if (onSave(draft)) {
      setDraft(null);
      setError('');
    } else {
      setError('Changes could not be saved. Check the Storybook assistant notice.');
    }
  }

  return (
    <div className={`storybook-inline-editor${heading ? ' has-heading' : ''}${draft ? ' is-editing' : ''}`}>
      <div className={`storybook-inline-actions${heading ? ' section-header' : ''}`} aria-label={`Edit ${label}`}>
        {heading}
        {draft ? (
          <>
            <button type="button" className="storybook-inline-action nodrag" onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
            <button type="button" className="storybook-inline-action nodrag" disabled={disabled || conflict} onClick={save}>Save</button>
          </>
        ) : (
          <button type="button" className="storybook-inline-action nodrag" disabled={disabled} onClick={() => {
            setDraft(Object.fromEntries(fields.map(({ key, value }) => [key, value])));
            setBase(snapshot);
            setError('');
          }}>Edit</button>
        )}
      </div>
      {draft ? (
        <div className="storybook-editor-fields">
          {fields.map((field) => (
            <label className="storybook-editor-field" key={field.key}>
              <span className="field-label">{field.label}</span>
              {field.multiline ? (
                <textarea className="nodrag nowheel" value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.currentTarget.value })} />
              ) : (
                <input className="nodrag" type="text" value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.currentTarget.value })} />
              )}
            </label>
          ))}
          {conflict && <p role="alert">This section changed while you were editing. Copy your draft, then cancel and edit again.</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      ) : children}
    </div>
  );
}
