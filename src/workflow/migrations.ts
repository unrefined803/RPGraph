import { migrateVersionedDocument, type FormatMigrationSteps } from '../utils/formatMigration';
import { currentWorkflowFormatVersion } from './version';

// Add one step per format bump. `oldestLoadableWorkflow` in formatVersions.json
// must name the oldest version that still has a complete path to the current one.
const workflowMigrationSteps: FormatMigrationSteps = {};

export function migrateStoredWorkflow(value: unknown): unknown {
  return migrateVersionedDocument(
    value,
    'rpgraph-workflow',
    currentWorkflowFormatVersion,
    workflowMigrationSteps,
  );
}
