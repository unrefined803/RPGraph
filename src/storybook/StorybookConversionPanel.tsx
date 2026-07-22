import { useMemo, useState } from 'react';
import { estimatedRpStorybookPromptTokens } from '../nodes/rp-storybook/model';
import type { StorybookConversionResult } from './conversion';

type StorybookConversionPanelProps = {
  fileName?: string;
  result: StorybookConversionResult;
  phase: 'convert' | 'review';
  isSubmitting: boolean;
  onBeginReview: () => void;
  onImprove: () => Promise<void>;
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
  onImprove,
  onApply,
  onCancel,
}: StorybookConversionPanelProps) {
  const [applyError, setApplyError] = useState<string | null>(null);
  const estimatedTokens = useMemo(
    () => estimatedRpStorybookPromptTokens(result.storybook),
    [result.storybook],
  );
  const pendingRows = result.rows.filter((row) => row.reviewState === 'pending');
  const improvableRows = pendingRows.filter((row) => row.allowedPatchPaths.length > 0);
  const unresolvedBlueRows = pendingRows.filter((row) => row.state === 'suggested');

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
            </span>
          </li>
        ))}
      </ul>
      <p className="storybook-conversion-summary">
        {phase === 'convert'
          ? `${pendingRows.length} section${pendingRows.length === 1 ? '' : 's'} will need review.`
          : improvableRows.length
            ? `${improvableRows.length} default${improvableRows.length === 1 ? '' : 's'} can be improved by the assistant; other defaults are safe to keep.`
            : 'All remaining defaults are safe to keep.'}{' '}
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
          <>
            {improvableRows.length ? (
              <button
                className="load-text-button"
                type="button"
                disabled={isSubmitting}
                onClick={() => void onImprove()}
              >
                {isSubmitting ? 'AI is reviewing ...' : 'Improve with AI'}
              </button>
            ) : null}
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
          </>
        )}
      </div>
    </div>
  );
}

type StorybookConversionAssistantReportProps = {
  result: StorybookConversionResult;
  isSubmitting: boolean;
  onImprove: () => Promise<void>;
};

export function StorybookConversionAssistantReport({
  result,
  isSubmitting,
  onImprove,
}: StorybookConversionAssistantReportProps) {
  const attentionRows = result.rows.filter((row) => row.reviewState === 'pending');
  const improvableRows = attentionRows.filter((row) => row.allowedPatchPaths.length > 0);
  const technicalRows = attentionRows.filter((row) => row.allowedPatchPaths.length === 0);
  const improvedRows = result.rows.filter((row) => row.reviewState === 'resolved' && row.state !== 'mapped');
  const groupedRows = (rows: typeof attentionRows) => Array.from(rows.reduce((groups, row) => {
    const separatorIndex = row.label.indexOf(': ');
    const group = separatorIndex >= 0 ? row.label.slice(0, separatorIndex) : 'Storybook';
    const item = separatorIndex >= 0 ? row.label.slice(separatorIndex + 2) : row.label;
    groups.set(group, [...(groups.get(group) ?? []), item]);
    return groups;
  }, new Map<string, string[]>()));
  const improvableGroups = groupedRows(improvableRows);
  const technicalGroups = groupedRows(technicalRows);

  return (
    <aside className="storybook-conversion-assistant-report">
      <div className="storybook-conversion-report-header">
        <span>
          <strong>Conversion Report</strong>
          <small>{result.sourceVersion} → {result.targetVersion}</small>
        </span>
        {improvableRows.length ? (
          <button type="button" disabled={isSubmitting} onClick={() => void onImprove()}>
            {isSubmitting ? 'AI is reviewing ...' : 'Improve with AI'}
          </button>
        ) : null}
      </div>
      <div className="storybook-conversion-report-scroll">
        {improvableGroups.length ? (
          <section>
            <strong>AI can improve</strong>
            <ul>
              {improvableGroups.map(([group, items]) => (
                <li key={group}>
                  <span>{group}</span>
                  <small>{items.join(' · ')}</small>
                </li>
              ))}
            </ul>
          </section>
        ) : technicalGroups.length === 0 ? (
          <p>All conversion items are ready.</p>
        ) : null}
        {technicalGroups.length ? (
          <section>
            <strong>Safe technical defaults</strong>
            <ul>
              {technicalGroups.map(([group, items]) => (
                <li key={group}>
                  <span>{group}</span>
                  <small>{items.join(' · ')}</small>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {improvedRows.length ? (
          <section>
            <strong>Improved by AI</strong>
            <ul>
              {improvedRows.map((row) => <li key={row.id}><span>{row.label}</span></li>)}
            </ul>
          </section>
        ) : null}
      </div>
      <p className="storybook-conversion-report-hint">
        The assistant can improve story-based details in one pass. Technical defaults such as voice samples and phone wallpaper settings can remain unchanged.
      </p>
    </aside>
  );
}
