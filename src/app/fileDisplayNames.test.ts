import { expect, it } from 'vitest';
import type { SavedFileSummary } from '../types';
import { fileNameLabel, readableFileName } from './fileDisplayNames';

it.each(['WF', 'RP', 'SB', 'CH'])('displays unlocked %s names for both filename formats', prefix => {
  for (const version of [1, 2]) {
    const fileName = `${prefix}${version}xQAbCd1234.json`;
    expect(readableFileName(fileName, { [fileName]: 'Private title' }, [])).toBe('Private title');
    expect(readableFileName(fileName, {}, [])).toBeUndefined();
    const files = [{ fileName, name: 'Private title' }] as SavedFileSummary[];
    expect(readableFileName(fileName, {}, files)).toBe('Private title');
    files[0].name = 'Encrypted file (open to unlock)';
    expect(readableFileName(fileName, {}, files)).toBeUndefined();
    expect(readableFileName(fileName, { [fileName]: 'Private title' }, files)).toBe('Private title');
  }
});

it('retains readable legacy filenames and unsaved placeholders', () => {
  expect(readableFileName('Old workflow.json', {}, [])).toBe('Old workflow');
  expect(readableFileName('Old storybook.rpgraph-storybook.json', {}, [])).toBe('Old storybook');
  expect(readableFileName(null, {}, [])).toBeUndefined();
  expect(readableFileName('constructor', {}, [])).toBe('constructor');
  expect(readableFileName('__proto__', {}, [])).toBe('__proto__');
});

it('labels protected files by display name and readable files by filename', () => {
  expect(fileNameLabel('RP2xQAbCd1234.json', 'Private title')).toBe('Private title');
  expect(fileNameLabel('Old save.json', 'Old save')).toBe('Old save.json');
});
