import { migrateVersionedDocument, type FormatMigrationSteps } from '../utils/formatMigration';
import { currentSessionFormatVersion } from './version';

// Add one step per format bump; a step also upgrades the embedded workflow when
// the session workflow format changes. `oldestLoadableSession` in
// formatVersions.json must name the oldest version that still has a complete
// path to the current one.
const sessionMigrationSteps: FormatMigrationSteps = {};

export function migrateStoredSession(value: unknown): unknown {
  return migrateVersionedDocument(
    value,
    'rpgraph-session',
    currentSessionFormatVersion,
    sessionMigrationSteps,
  );
}
