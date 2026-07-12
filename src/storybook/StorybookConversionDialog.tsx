import { useMemo, useState } from 'react';
import { estimatedRpStorybookPromptTokens } from '../nodes/rp-storybook-v1/model';
import { useBackdropDismiss } from '../components/useBackdropDismiss';
import type { StorybookConversionResult } from './conversion';

type StorybookConversionDialogProps = {
  fileName?: string;
  result: StorybookConversionResult;
  /** Returns null when applied, otherwise the blocking error message. */
  onApply: () => string | null;
  onCancel: () => void;
};

export function StorybookConversionDialog({
  fileName,
  result,
  onApply,
  onCancel,
}: StorybookConversionDialogProps) {
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onCancel);
  const [applyError, setApplyError] = useState<string | null>(null);
  const estimatedTokens = useMemo(
    () => estimatedRpStorybookPromptTokens(result.storybook),
    [result.storybook],
  );
  const defaultedCount = result.rows.filter((row) => row.state === 'defaulted').length;

  return (
    <div className="dialog-backdrop" role="presentation" {...backdropDismiss}>
      <section
        className="storybook-conversion-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storybook-conversion-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <h2 id="storybook-conversion-title">Convert Storybook</h2>
            <p>
              {fileName ? `${fileName} uses` : 'This storybook uses'} the old Storybook Format{' '}
              {result.sourceVersion}. Converting upgrades it to Format {result.targetVersion}.
              The original file is not changed.
            </p>
          </div>
          <button className="close-button" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <ul className="storybook-conversion-rows">
          {result.rows.map((row) => (
            <li key={row.id} className={`storybook-conversion-row storybook-conversion-row-${row.state}`}>
              <span className="storybook-conversion-row-state" aria-hidden="true">
                {row.state === 'mapped' ? '✅' : '🟡'}
              </span>
              <span className="storybook-conversion-row-text">
                <strong>{row.label}</strong>
                <span>{row.message}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="storybook-conversion-summary">
          {defaultedCount
            ? `${defaultedCount} section${defaultedCount === 1 ? '' : 's'} filled with defaults (🟡); everything else carried over.`
            : 'All sections carried over.'}{' '}
          Estimated prompt size: ~{estimatedTokens.toLocaleString('en-US')} tokens (images excluded).
        </p>
        {applyError ? <p className="storybook-conversion-error">{applyError}</p> : null}
        <div className="storybook-conversion-actions">
          <button className="load-text-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="load-text-button storybook-conversion-apply"
            type="button"
            onClick={() => {
              const error = onApply();
              setApplyError(error);
            }}
          >
            Apply Conversion
          </button>
        </div>
      </section>
    </div>
  );
}
