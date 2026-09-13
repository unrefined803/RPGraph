import { useId, useState } from 'react';

type Props = {
  value?: string;
  disabled?: boolean;
  onSave?: (value: string) => boolean;
  onChange?: (value: string) => void;
};

/** Reveal author-only motivations only after an explicit interaction. */
export function HiddenAgencyField({ value = '', disabled, onSave, onChange }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [base, setBase] = useState('');
  const [error, setError] = useState('');
  const contentId = useId();
  const conflict = draft !== null && base !== value;
  const editable = !!(onSave || onChange);

  function save() {
    if (draft === null || disabled || conflict) return;
    const saved = onSave ? onSave(draft) : true;
    if (saved) {
      if (!onSave) onChange?.(draft);
      setDraft(null);
      setError('');
    } else {
      setError('Changes could not be saved. Check the assistant notice.');
    }
  }

  return (
    <div className="character-field">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="field-label" style={{ marginRight: 'auto' }}>Hidden Agency · {value.trim() ? 'Defined' : 'Empty'}</span>
        <button type="button" className="storybook-inline-action nodrag" aria-expanded={revealed} aria-controls={contentId}
          onClick={() => { setRevealed(!revealed); setDraft(null); setError(''); }}>
          {revealed ? 'Hide' : 'View'}
        </button>
        {revealed && editable && (draft === null ? (
          <button type="button" className="storybook-inline-action nodrag" disabled={disabled}
            onClick={() => { setDraft(value); setBase(value); setError(''); }}>Edit</button>
        ) : <>
          <button type="button" className="storybook-inline-action nodrag"
            onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
          <button type="button" className="storybook-inline-action nodrag" disabled={disabled || conflict} onClick={save}>Save</button>
        </>)}
      </div>
      <div id={contentId} hidden={!revealed}>
        {revealed && (draft === null ? <p>{value || 'Not defined yet.'}</p> : <>
          <label className="storybook-editor-field">
            <span className="field-label">Hidden Agency</span>
            <textarea className="nodrag nowheel" value={draft} disabled={disabled} spellCheck={false}
              onChange={(event) => setDraft(event.currentTarget.value)} />
          </label>
          {conflict && <p role="alert">This section changed while you were editing. Copy your draft, then cancel and edit again.</p>}
          {error && <p role="alert">{error}</p>}
        </>)}
      </div>
    </div>
  );
}
