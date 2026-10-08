import { expect, it } from 'vitest';
import { normalizeRpStorybook, parseRpStorybookAssistantResult } from '../nodes/rp-storybook/model';
import { sillyTavernImportInstruction, validateSillyTavernImportResult, sillyTavernStoryImportInstruction, validateSillyTavernStoryImportResult } from './sillyTavernImport';

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


it('accepts separate people from a group card without requiring its title as a person', () => {
  const imported = result([
    add,
    { op: 'add', path: '/characters/-', value: { id: 'clara', name: 'Clara' } },
  ]);
  expect(validateSillyTavernImportResult(current, imported, {
    name: 'The siblings', description: 'Bob is {{char}} and his sister Clara is {{user}}.',
  })).toEqual({ action: 'added', characterName: 'Bob, Clara' });
});

it('accepts updating the named person and adding another defined person together', () => {
  expect(validateSillyTavernImportResult(current, result([
    { op: 'replace', path: '/characters/0/description', value: 'Bob’s sister' },
    add,
  ]), { name: 'Alice' })).toEqual({ action: 'added', characterName: 'Alice, Bob' });
});

it('rejects a group import that changes an unrelated existing person', () => {
  expect(() => validateSillyTavernImportResult(current, result([
    add,
    { op: 'replace', path: '/characters/0/description', value: 'Overwritten' },
  ]), { name: 'The siblings' })).toThrow('outside the character import');
});

it('rejects an import with no actual character changes', () => {
  expect(() => validateSillyTavernImportResult(current, result([]), {
    name: 'The siblings',
  })).toThrow('did not add or update');
});

it('preserves existing identity when adding another person during an update', () => {
  expect(() => validateSillyTavernImportResult(current, result([
    { op: 'replace', path: '/characters/0/id', value: 'different-alice' },
    add,
  ]), { name: 'Alice' })).toThrow('existing character identity');
});


it.each([false, true])('explicitly forbids title changes with an occupied scenario: %s', (occupied) => {
  const book = normalizeRpStorybook({
    title: 'Existing title',
    scenario: { summary: occupied ? 'Existing story' : '' },
  });
  const prompt = sillyTavernImportInstruction(book, { name: 'Bob' }, 'bob.json');
  const scope = prompt.slice(prompt.indexOf('MANDATORY IMPORT SCOPE:'));
  expect(scope).toContain('Never patch /title');
  expect(scope).toContain('even when those fields are empty or contain defaults');
  const allowed = scope.split('\n').find((line) => line.startsWith('Allowed patch paths'))!;
  expect(allowed).toContain('/characters/-');
  expect(allowed.includes('/scenario/summary')).toBe(false);
  expect(allowed.includes('/scenario/openingSituation')).toBe(false);
  expect(allowed).not.toContain('/title');
  const imported = parseRpStorybookAssistantResult(JSON.stringify({ patch: [
    add, { op: 'replace', path: '/title', value: 'Bob' },
  ] }), book);
  expect(() => validateSillyTavernImportResult(book, imported, { name: 'Bob' }))
    .toThrow('outside the character import: /title');
});

it('lists only the matching existing character as an allowed update target', () => {
  const prompt = sillyTavernImportInstruction(current, { name: 'Alice' }, 'alice.json');
  expect(prompt).toContain('/characters/0 or its child fields');
  expect(prompt).not.toContain('/characters/1');
});


it.each(['/title', '/scenario/summary', '/scenario/openingSituation', '/openingHistory/summary'])(
  'rejects story changes during the character-only import: %s', (path) => {
    expect(() => validateSillyTavernImportResult(current, result([
      add, { op: 'replace', path, value: 'Imported story' },
    ]), { name: 'Bob' })).toThrow('outside the character import');
  },
);

it('accepts confirmed story text updates without changing characters', () => {
  const imported = result([
    { op: 'replace', path: '/title', value: 'New story' },
    { op: 'replace', path: '/scenario/openingSituation', value: 'A greeting' },
  ]);
  expect(() => validateSillyTavernStoryImportResult(imported)).not.toThrow();
  expect(imported.storybook.characters).toEqual(current.characters);
  const prompt = sillyTavernStoryImportInstruction({ name: 'Bob', first_mes: 'A greeting' }, 'bob.json');
  expect(prompt).toContain('A greeting');
  expect(prompt).toContain('overwriting existing story text');
});

it.each(['/characters/0/description', '/openingHistory/summary'])(
  'rejects protected fields during confirmed story import: %s', (path) => {
    expect(() => validateSillyTavernStoryImportResult(result([
      { op: 'replace', path, value: 'Overwrite' },
    ]))).toThrow('outside the story import');
  },
);
