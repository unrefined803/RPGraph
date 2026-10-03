import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const main = readFileSync(new URL('./main.cjs', import.meta.url), 'utf8');
const source = main.slice(main.indexOf('let workflowStateWriteQueue ='), main.indexOf('async function saveLastWorkflowFileName('));

function harness() {
  let disk: Record<string, unknown> = { importedDefaultFileNames: ['default_normal_v40.json'] };
  const write = vi.fn(async (_path: string, contents: string) => { disk = JSON.parse(contents); });
  const save = runInNewContext(`${source}; saveWorkflowState`, {
    loadWorkflowState: async () => structuredClone(disk),
    workflowStateFilePath: () => '/workspace/workflow-state.json',
    writeTextFileAtomically: write,
  }) as (partial: Record<string, unknown>) => Promise<void>;
  return { save, write, read: () => disk };
}

it('preserves workflow, start target and imported defaults during concurrent updates', async () => {
  const state = harness();
  await Promise.all([
    state.save({ lastWorkflowFileName: 'workflow.json' }),
    state.save({ lastStartTargetFileName: 'first-session.json' }),
    state.save({ lastStartTargetFileName: 'latest-session.json' }),
  ]);
  expect(state.read()).toEqual({
    importedDefaultFileNames: ['default_normal_v40.json'],
    lastWorkflowFileName: 'workflow.json',
    lastStartTargetFileName: 'latest-session.json',
  });
});

it('reports a failed write and still processes later updates', async () => {
  const state = harness();
  state.write.mockRejectedValueOnce(new Error('Disk unavailable'));
  const failed = state.save({ lastWorkflowFileName: 'failed.json' });
  const next = state.save({ lastStartTargetFileName: 'session.json' });
  await expect(failed).rejects.toThrow('Disk unavailable');
  await next;
  expect(state.read()).toEqual({
    importedDefaultFileNames: ['default_normal_v40.json'],
    lastStartTargetFileName: 'session.json',
  });
});
