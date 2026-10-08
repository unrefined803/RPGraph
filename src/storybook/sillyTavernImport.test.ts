import { expect, it } from 'vitest';
import { normalizeRpStorybook, parseRpStorybookAssistantResult } from '../nodes/rp-storybook/model';
import { validateSillyTavernImportResult } from './sillyTavernImport';

const current = normalizeRpStorybook({ characters: [{ id: 'alice', name: 'Alice', description: 'Original' }] });
function result(patch: unknown[]) {
  return parseRpStorybookAssistantResult(JSON.stringify({ reply: 'Imported.', patch }), current);
}
const add = { op: 'add', path: '/characters/-', value: { id: 'bob', name: 'Bob' } };

it('accepts an import that leaves existing characters intact', () => {
  expect(validateSillyTavernImportResult(current, result([add]), { name: 'Bob' }).action).toBe('added');
});

it('rejects an import that also changes another character', () => {
  expect(() => validateSillyTavernImportResult(current, result([
    add, { op: 'replace', path: '/characters/0/description', value: 'Overwritten' },
  ]), { name: 'Bob' })).toThrow('outside the character import');
});

it('rejects an update that removes another character', () => {
  const book = normalizeRpStorybook({ characters: [...current.characters, { id: 'bob', name: 'Bob' }] });
  const updated = parseRpStorybookAssistantResult(JSON.stringify({ patch: [
    { op: 'replace', path: '/characters/0/description', value: 'Updated' },
    { op: 'remove', path: '/characters/1' },
  ] }), book);
  expect(() => validateSillyTavernImportResult(book, updated, { name: 'Alice' })).toThrow('outside the character import');
});

it('allows updating the intended character while preserving its identity', () => {
  expect(validateSillyTavernImportResult(current, result([
    { op: 'replace', path: '/characters/0/description', value: 'Updated' },
  ]), { name: 'Alice' }).action).toBe('updated');
});
