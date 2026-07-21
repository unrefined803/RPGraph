import type { WorkflowCapabilityIndicator } from '../app/useWorkflowCapabilities';

function WorkflowCapabilityIcon({
  kind,
}: {
  kind: WorkflowCapabilityIndicator['kind'];
}) {
  if (kind === 'text') {
    return (
      <span className="workflow-capability-text-mark" aria-hidden="true">
        TXT
      </span>
    );
  }
  if (kind === 'vision') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (kind === 'audio') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="4 9 8 9 13 4 13 20 8 15 4 15" />
        <path d="M17 9.5a4 4 0 0 1 0 5" />
        <path d="M19.5 7a7.5 7.5 0 0 1 0 10" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export function WorkflowCapabilityStrip({
  indicators,
}: {
  indicators: WorkflowCapabilityIndicator[];
}) {
  if (indicators.length === 0) {
    return null;
  }
  return (
    <div
      className="workflow-capability-strip"
      aria-label="Workflow capability requirements"
    >
      {indicators.map((indicator) => (
        <span
          key={indicator.kind}
          className={`workflow-capability-icon ${indicator.tone}${indicator.active ? ' active' : ''}`}
          title={indicator.label}
          aria-label={indicator.label}
        >
          <WorkflowCapabilityIcon kind={indicator.kind} />
        </span>
      ))}
    </div>
  );
}
