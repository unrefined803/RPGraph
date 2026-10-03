export type FormatVersionStatus = 'current' | 'legacy' | 'newer' | 'unsupported' | 'invalid';
export function formatVersionStatus(
  value: unknown,
  currentVersion: string,
  oldestLoadableVersion?: string,
): FormatVersionStatus;
