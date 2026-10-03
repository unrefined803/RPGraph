/**
 * One step per released format version, keyed by the version it upgrades from.
 * A step returns a new document with a later `formatVersion` and must not
 * mutate its input: the stored file stays untouched until the user saves.
 */
export type FormatMigrationSteps = Record<
  string,
  (document: Record<string, unknown>) => Record<string, unknown>
>;

/**
 * Upgrades a stored document to `currentVersion` by chaining `steps`. A
 * document without a complete migration path is returned unchanged, so the
 * format validators report its version as incompatible.
 */
export function migrateVersionedDocument(
  value: unknown,
  format: string,
  currentVersion: string,
  steps: FormatMigrationSteps,
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  let document = value as Record<string, unknown>;
  if (document.format !== format) {
    return value;
  }
  const visitedVersions = new Set<unknown>();
  while (document.formatVersion !== currentVersion) {
    const version = document.formatVersion;
    const step = typeof version === 'string' && Object.prototype.hasOwnProperty.call(steps, version) ? steps[version] : undefined;
    if (!step) {
      return value;
    }
    visitedVersions.add(version);
    document = step(document);
    if (visitedVersions.has(document.formatVersion)) {
      throw new Error(`Format migration from ${String(version)} did not advance the format version.`);
    }
  }
  return document;
}
