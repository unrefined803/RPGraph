import { useMemo, useState } from 'react';
import { estimatedRpStorybookPromptTokens } from '../nodes/rp-storybook-v1/model';
import type { StorybookConversionResult } from './conversion';

type StorybookConversionPanelProps = {
  fileName?: string;
  result: StorybookConversionResult;
  phase: 'convert' | 'review';
  isSubmitting: boolean;
  onBeginReview: () => void;
  onAcceptRow: (rowId: string) => void;
  onFixRow: (rowId: string) => Promise<void>;
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
  phase,
  isSubmitting,
  onBeginReview,
  onAcceptRow,
  onFixRow,
  onApply,
  onCancel,
}: StorybookConversionPanelProps) {
  const [applyError, setApplyError] = useState<string | null>(null);
  const estimatedTokens = useMemo(
    () => estimatedRpStorybookPromptTokens(result.storybook),
    [result.storybook],
  );
  const pendingRows = result.rows.filter((row) => row.reviewState === 'pending');
  const unresolvedBlueRows = pendingRows.filter((row) => row.state === 'suggested');
  const reviewedCount = result.rows.length - pendingRows.length;

  return (
    <div className="storybook-conversion-panel">
      <div className="storybook-conversion-intro">
        <h4>Convert Storybook</h4>
        <p>
          {fileName ? `${fileName} uses` : 'This storybook uses'} the old Storybook Format{' '}
          {result.sourceVersion}. Converting upgrades it to Format {result.targetVersion}.
          The original file is not changed. You can inspect the old data in the Raw JSON tab.
          {phase === 'review' ? ' The assistant now sees and edits only the conversion draft.' : ''}
        </p>
      </div>
      <ul className="storybook-conversion-rows">
        {result.rows.map((row) => (
          <li key={row.id} className={`storybook-conversion-row storybook-conversion-row-${row.state}`}>
            <span className="storybook-conversion-row-state" aria-hidden="true">
              {row.reviewState === 'resolved' || row.reviewState === 'accepted'
                ? '✅'
                : row.state === 'suggested' ? '🔵' : row.state === 'defaulted' ? '🟡' : '✅'}
            </span>
            <span className="storybook-conversion-row-text">
              <strong>{row.label}</strong>
              <span>{row.message}</span>
              {phase === 'review' && row.reviewState === 'pending' ? (
                <span className="storybook-conversion-row-actions">
                  <button
                    className="load-text-button"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => onAcceptRow(row.id)}
                  >
                    {row.state === 'suggested' ? 'Keep as Is' : 'Accept Default'}
                  </button>
                  {row.aiInstruction ? (
                    <button
                      className="load-text-button"
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void onFixRow(row.id)}
                    >
                      {isSubmitting ? 'AI is working ...' : row.state === 'suggested' ? 'Fix with AI' : 'Fill with AI'}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="storybook-conversion-summary">
        {phase === 'convert'
          ? `${pendingRows.length} section${pendingRows.length === 1 ? '' : 's'} will need review.`
          : `${reviewedCount} of ${result.rows.length} sections reviewed; ${pendingRows.length} remaining.`}{' '}
        Estimated prompt size: ~{estimatedTokens.toLocaleString('en-US')} tokens (images excluded).
      </p>
      {applyError ? <p className="storybook-conversion-error">{applyError}</p> : null}
      <div className="storybook-conversion-actions">
        <button className="load-text-button" type="button" onClick={onCancel}>
          Cancel Conversion
        </button>
        {phase === 'convert' ? (
          <button className="load-text-button storybook-conversion-apply" type="button" onClick={onBeginReview}>
            Convert and Review
          </button>
        ) : (
          <button
            className="load-text-button storybook-conversion-apply"
            type="button"
            disabled={isSubmitting || unresolvedBlueRows.length > 0}
            title={unresolvedBlueRows.length ? 'Resolve all blue items before applying.' : undefined}
            onClick={() => {
              const error = onApply();
              setApplyError(error);
            }}
          >
            Apply Converted Storybook
          </button>
        )}
      </div>
    </div>
  );
}
