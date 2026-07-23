import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  bundledDefaultWorkflowFileNames,
  importedDefaultFileNamesFromState,
  restoreBundledDefaultWorkflows,
} from './workflowDefaults.cjs';

describe('workflow defaults', () => {
  it('orders bundled default workflow file names', () => {
    assert.deepEqual(
      bundledDefaultWorkflowFileNames([
        'README.md',
        'workflow.default_planning_v1.json',
        'workflow.default_v23.json',
        'workflow.default_v9.json',
      ]),
      [
        'workflow.default_v9.json',
        'workflow.default_v23.json',
        'workflow.default_planning_v1.json',
      ],
    );
  });

  it('normalizes imported default file names from state', () => {
    assert.deepEqual(
      importedDefaultFileNamesFromState({
        importedDefaultFileNames: [
          '/old/path/workflow.default_v23.json',
          'workflow.default_planning_v1.json',
        ],
        importedDefaultFileName: '/legacy/path/workflow.default_v23.json',
      }),
      ['workflow.default_v23.json', 'workflow.default_planning_v1.json'],
    );
  });

  it('restores every bundled default and activates the last one', async () => {
    const restoredPaths: string[] = [];
    let activatedFileName = '';
    const primary = await restoreBundledDefaultWorkflows(
      [
        '/app/workflow.default_v23.json',
        '/app/workflow.default_planning_v1.json',
      ],
      async (bundledPath: string) => {
        restoredPaths.push(bundledPath);
        return { fileName: bundledPath.split('/').pop() };
      },
      async (restored: { fileName: string }) => {
        activatedFileName = restored.fileName;
      },
    );
    assert.deepEqual(restoredPaths, [
      '/app/workflow.default_v23.json',
      '/app/workflow.default_planning_v1.json',
    ]);
    assert.equal(primary.fileName, 'workflow.default_planning_v1.json');
    assert.equal(activatedFileName, 'workflow.default_planning_v1.json');
  });
});
