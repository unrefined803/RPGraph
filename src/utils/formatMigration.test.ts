import { describe, expect, it } from 'vitest';
import sessionFormatVersions from '../session/formatVersions.json';
import { migrateStoredSession } from '../session/migrations';
import workflowFormatVersions from '../workflow/formatVersions.json';
import { migrateStoredWorkflow } from '../workflow/migrations';
import { migrateVersionedDocument, type FormatMigrationSteps } from './formatMigration';

const steps: FormatMigrationSteps = {
  '1.0': (document) => ({ ...document, formatVersion: '1.1', renamed: document.old, old: undefined }),
  '1.1': (document) => ({ ...document, formatVersion: '1.2', added: true }),
};

describe('format migration', () => {
  it('chains steps up to the current version without changing the source', () => {
    const source = { format: 'fixture', formatVersion: '1.0', old: 'value' };
    const before = structuredClone(source);
    expect(migrateVersionedDocument(source, 'fixture', '1.2', steps)).toEqual({
      format: 'fixture', formatVersion: '1.2', renamed: 'value', old: undefined, added: true,
    });
    expect(source).toEqual(before);
  });

  it('returns current, unknown and foreign documents unchanged', () => {
    const current = { format: 'fixture', formatVersion: '1.2' };
    const newer = { format: 'fixture', formatVersion: '1.3' };
    const tooOld = { format: 'fixture', formatVersion: '0.9' };
    const foreign = { format: 'other', formatVersion: '1.0' };
    expect(migrateVersionedDocument(current, 'fixture', '1.2', steps)).toBe(current);
    expect(migrateVersionedDocument(newer, 'fixture', '1.2', steps)).toBe(newer);
    expect(migrateVersionedDocument(tooOld, 'fixture', '1.2', steps)).toBe(tooOld);
    expect(migrateVersionedDocument(foreign, 'fixture', '1.2', steps)).toBe(foreign);
    expect(migrateVersionedDocument('text', 'fixture', '1.2', steps)).toBe('text');
    expect(migrateVersionedDocument({ format: 'fixture', formatVersion: 'toString' }, 'fixture', '1.2', steps))
      .toEqual({ format: 'fixture', formatVersion: 'toString' });
  });

  it('rejects a step that does not advance the version', () => {
    expect(() => migrateVersionedDocument({ format: 'fixture', formatVersion: '1.0' }, 'fixture', '1.2', {
      '1.0': (document) => ({ ...document }),
    })).toThrow('did not advance');
  });

  it('has a complete path from the oldest loadable workflow and RP save versions', () => {
    expect(migrateStoredWorkflow({
      format: 'rpgraph-workflow', formatVersion: workflowFormatVersions.oldestLoadableWorkflow,
    })).toMatchObject({ formatVersion: workflowFormatVersions.workflow });
    expect(migrateStoredSession({
      format: 'rpgraph-session', formatVersion: sessionFormatVersions.oldestLoadableSession,
    })).toMatchObject({ formatVersion: sessionFormatVersions.session });
  });
});
