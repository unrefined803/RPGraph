import { expect, it } from 'vitest';
import { safeWorkflowBaseName, safeStorybookBaseName, safeCharacterCardBaseName } from './fileNames.cjs';
import { bundledJsonFilesByFormat } from './bundledJsonFiles.cjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('uses short names with the separator for each content type', () => {
  expect(safeWorkflowBaseName(' My Workflow.json ')).toBe('My_Workflow');
  expect(safeWorkflowBaseName('workflow.default_planning_v28.json')).toBe('default_planning_v28');
  expect(safeStorybookBaseName('Saturday Night at Maple Street.rpgraph-storybook.json')).toBe('Saturday_Night_at_Maple_Street');
  expect(safeCharacterCardBaseName('Espen Harper.rpgraph-character.json')).toBe('Espen-Harper');
  expect(safeCharacterCardBaseName('A/B')).toBe('A-B');
});

it('discovers bundled content by format regardless of its JSON file name', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rpgraph-filenames-'));
  try {
    writeFileSync(join(directory, 'Any name.JSON'), JSON.stringify({ format: 'rpgraph-storybook' }));
    writeFileSync(join(directory, 'another-name.json'), JSON.stringify({ format: 'rpgraph-workflow' }));
    writeFileSync(join(directory, 'fake.rpgraph-storybook.json'), '{}');
    writeFileSync(join(directory, 'broken.json'), '{');
    expect(bundledJsonFilesByFormat(directory, 'rpgraph-storybook')).toEqual(['Any name.JSON']);
    expect(bundledJsonFilesByFormat(directory, 'rpgraph-workflow')).toEqual(['another-name.json']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
