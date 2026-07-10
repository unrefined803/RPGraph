import type { CoreNodeType } from './types';

export type NodeVersion = `${number}.${number}.${number}`;

export type ParsedNodeVersion = {
  major: number;
  minor: number;
  patch: number;
};

const nodeVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const currentCoreNodeVersions: Record<CoreNodeType, NodeVersion> = {
  input: '1.6.0',
  note: '1.0.0',
  group: '1.0.0',
  custom: '1.0.9',
  'last-user-input': '1.1.0',
  'last-rp-output': '1.1.0',
  'event-manager': '1.3.0',
  history: '1.8.2',
  'memory-slot': '1.0.0',
  'phone-message-router': '1.1.0',
  'text-selector': '1.1.0',
  'llm-prompt-switch': '1.2.2',
  'llm-prompt': '1.1.1',
  combiner: '1.0.0',
  'load-text': '1.0.1',
  'write-text': '1.0.0',
  'text-preview': '1.1.0',
  'context-builder': '1.0.0',
  'llm-decision': '1.0.0',
  'context-compression': '1.0.3',
  'character-stats': '1.1.0',
  'fixed-number': '1.0.1',
  'fixed-bool': '1.0.0',
  'settings-value': '1.0.1',
  'rp-storybook-v1': '1.13.0',
  output: '1.4.2',
};

export function parseNodeVersion(value: unknown): ParsedNodeVersion | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = nodeVersionPattern.exec(value);
  if (!match) {
    return undefined;
  }
  const parsed = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
  return Object.values(parsed).every(Number.isSafeInteger) ? parsed : undefined;
}

export function isNodeVersion(value: unknown): value is NodeVersion {
  return !!parseNodeVersion(value);
}

export function areNodeVersionsCompatible(stored: NodeVersion, current: NodeVersion) {
  const storedVersion = parseNodeVersion(stored);
  const currentVersion = parseNodeVersion(current);
  return (
    !!storedVersion &&
    !!currentVersion &&
    storedVersion.major === currentVersion.major &&
    storedVersion.minor === currentVersion.minor
  );
}
