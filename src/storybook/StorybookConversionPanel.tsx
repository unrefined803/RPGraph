import { useMemo, useState } from 'react';
import { estimatedRpStorybookPromptTokens } from '../nodes/rp-storybook-v1/model';
import type { StorybookConversionResult } from './conversion';

type StorybookConversionPanelProps = {
  fileName?: string;
  result: StorybookConversionResult;
  /** Returns null when applied, otherwise the blocking error message. */
  onApply: () => string | null;
  onCancel: () => void;
};

/**
 * Conversion checklist rendered inside the storybook editor's UI Preview tab
 * (not a modal), so the assistant chat and the other document tabs stay
 * usable while reviewing the conversion.
 */
export function StorybookConversionPanel({
  fileName,
  result,
  onApply,
  onCancel,
}: StorybookConversionPanelProps) {
  const [applyError, setApplyError] = useState<string | null>(null);
  const estimatedTokens = useMemo(
    () => estimatedRpStorybookPromptTokens(result.storybook),
    [result.storybook],
  );
  const defaultedCount = result.rows.filter((row) => row.state === 'defaulted').length;

  return (
    <div className="storybook-conversion-panel">
      <div className="storybook-conversion-intro">
        <h4>Convert Storybook</h4>
        <p>
          {fileName ? `${fileName} uses` : 'This storybook uses'} the old Storybook Format{' '}
          {result.sourceVersion}. Converting upgrades it to Format {result.targetVersion}.
          The original file is not changed. You can inspect the old data in the Raw JSON tab
          and ask the assistant chat about anything that looks off.
        </p>
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
          Cancel Conversion
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
    </div>
  );
}
