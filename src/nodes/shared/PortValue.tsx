import type { WorkflowNodeData } from '../../types';
import { TextMetricsApi } from '../../llm/tokenMetrics';
import { useNodeView } from '../NodeViewContext';
import { runtimePortValueKey, type RuntimePortDirection } from './portRuntime';

function booleanText(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' ? 'true' : 'false';
}

function imageText(value: string) {
  const imageEntries = value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return imageEntries.length === 1
    ? '1 image'
    : imageEntries.length > 1
      ? `${imageEntries.length} images`
      : 'false';
}

function isNumericText(value: string) {
  return value.trim() !== '' && Number.isFinite(Number(value));
}

function formatNumericText(value: string) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) ? String(numberValue) : String(numberValue);
}

function formatRuntimePortValue(value: string, valueType: string, bytesPerToken: number) {
  if (valueType === 'image') {
    return imageText(value);
  }
  if (valueType === 'boolean') {
    return booleanText(value);
  }
  if (valueType === 'number') {
    return isNumericText(value) ? formatNumericText(value) : '0';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'false') {
    return normalized;
  }
  if (isNumericText(value)) {
    return formatNumericText(value);
  }

  const { tokens } = new TextMetricsApi(bytesPerToken).measure(value);
  return `~${tokens} tokens`;
}

export function PortLabel({
  data,
  direction,
  handle = 'default',
  label,
  valueSuffix,
  valueType,
}: {
  data: Pick<WorkflowNodeData, 'runtimePortValues'>;
  direction: RuntimePortDirection;
  handle?: string;
  label: string;
  valueSuffix?: string;
  valueType: string;
}) {
  const { estimatedTokenBytesPerToken } = useNodeView();
  const value = data.runtimePortValues?.[runtimePortValueKey(direction, handle)];

  return (
    <span className="port-label">
      <span className="port-label-name">{label}</span>
      {value !== undefined && (
        <small className="port-runtime-value">
          {formatRuntimePortValue(value, valueType, estimatedTokenBytesPerToken)}
          {valueSuffix ? ` - ${valueSuffix}` : ''}
        </small>
      )}
    </span>
  );
}
