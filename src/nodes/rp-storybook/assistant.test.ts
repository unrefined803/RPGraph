import { describe, expect, it } from 'vitest';
import {
  normalizeRpStorybook,
  parseRpStorybookAssistantResult,
  rpStorybookEditPrompt,
  rpStorybookPromptJsonText,
  starterRpStorybook,
} from './model';

function apply(patch: unknown[], fallback = starterRpStorybook, changedFields = ['invented']) {
  return parseRpStorybookAssistantResult(JSON.stringify({ reply: 'Done.', changedFields, patch }), fallback);
}

describe('Storybook assistant patches', () => {
  it('clears image-generation settings without restoring the old values', () => {
    const book = normalizeRpStorybook({ ...starterRpStorybook, characters: [{
      ...starterRpStorybook.characters[0],
      comfyConfig: { loraName: 'portrait.safetensors', loraUrl: 'https://example.com/lora', appearance: 'Red hair' },
    }] });
    const result = apply(['loraName', 'loraUrl', 'appearance'].map((field) => ({
      op: 'replace', path: `/characters/0/comfyConfig/${field}`, value: '',
    })), book);
    expect(result.storybook.characters[0].comfyConfig).toEqual({ loraName: '', loraUrl: '', appearance: '' });
    expect(book.characters[0].comfyConfig?.appearance).toBe('Red hair');
  });

  it('reports actual changes instead of trusting the response metadata', () => {
    expect(apply([{ op: 'replace', path: '/title', value: 'Changed' }]).changedFields).toEqual(['title']);
    expect(apply([]).changedFields).toEqual([]);
    expect(apply([{ op: 'replace', path: '/title', value: starterRpStorybook.title }]).changedFields).toEqual([]);
    expect(apply([{ op: 'replace', path: '/openingHistory/summary', value: 'Ignored' }]).changedFields).toEqual([]);
  });

  it('identifies a failing operation and leaves the original document untouched', () => {
    const before = JSON.stringify(starterRpStorybook);
    expect(() => apply([
      { op: 'replace', path: '/title', value: 'Changed' },
      { op: 'replace', path: '/characters/mira/name', value: 'Mara' },
    ])).toThrow('Patch operation 2 (/characters/mira/name) failed:');
    expect(JSON.stringify(starterRpStorybook)).toBe(before);
  });

  it.each(['', '01', '-1', '1.0', '-', '99'])('rejects invalid array index %j', (index) => {
    expect(() => apply([{ op: 'replace', path: `/characters/${index}/name`, value: 'Wrong' }])).toThrow();
  });

  it.each(['__proto__', 'constructor/prototype'])('rejects inherited property traversal through %s', (path) => {
    expect(() => apply([{ op: 'add', path: `/${path}/storybookPatchProbe`, value: true }])).toThrow('forbidden property');
    expect(Object.prototype).not.toHaveProperty('storybookPatchProbe');
  });

  it.each(['add', 'replace', 'test'])('requires a value for %s', (op) => {
    expect(() => apply([{ op, path: '/title' }])).toThrow('requires a value');
  });

  it('rejects invalid pointer escapes and moves into descendant paths', () => {
    expect(() => apply([{ op: 'add', path: '/bad~2field', value: '' }])).toThrow('must escape');
    expect(() => apply([{ op: 'move', from: '/characters/0', path: '/characters/0/nested' }])).toThrow('own child');
  });

  it('supports appending a character followed by an edit at its numeric index', () => {
    const result = apply([
      { op: 'add', path: '/characters/-', value: { id: 'new-person', name: 'New Person', images: [] } },
      { op: 'replace', path: '/characters/2/name', value: 'Alex' },
    ]);
    expect(result.storybook.characters[2]).toMatchObject({ id: 'new-person', name: 'Alex' });
    expect(result.storybook.characters.slice(0, 2)).toEqual(starterRpStorybook.characters);
  });
});

it('provides a consistent editing contract to the model', () => {
  const prompt = rpStorybookEditPrompt(rpStorybookPromptJsonText(starterRpStorybook), 'Rename Mira.', true);
  expect(prompt).toContain('/characters/{index}/name');
  expect(prompt).toContain('zero-based array indices');
  expect(prompt).toContain('Character identity is locked');
  expect(prompt).toContain('never patch them, even on request');
  expect(prompt).toContain('do not repeat earlier edits');
});
