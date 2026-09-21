import { expect, it } from 'vitest';
import { parseStorybookAssistantJson } from './assistantJson';
import { parseRpStorybookAssistantResult, starterRpStorybook } from '../nodes/rp-storybook/model';

it('repairs split relationship append paths and Markdown underscore escapes', () => {
  const raw = String.raw`{"reply":"Done","patch":[{"op":"add","path":"/characters/0/relationships","-","value":{"characterId":"max\_weber","description":"Friend","apps":{"whatsup":true}}}]}`;
  expect(parseStorybookAssistantJson(raw)).toMatchObject({ patch: [{
    path: '/characters/0/relationships/-', value: { characterId: 'max_weber' },
  }] });
});

it('preserves valid JSON, literal backslashes and quoted syntax in prose', () => {
  const value = { reply: String.raw`"path":"/characters","-","value" and literal \_`, patch: [] };
  expect(parseStorybookAssistantJson(JSON.stringify(value))).toEqual(value);
});

it('preserves escaped backslashes while repairing a separate invalid escape', () => {
  expect(parseStorybookAssistantJson(String.raw`{"a":"keep\\_","b":"fix\_"}`)).toEqual({ a: 'keep\\_', b: 'fix_' });
});

it.each(['{"patch":[]} {"patch":[]}', '{"patch":[}', String.raw`{"reply":"bad\q","patch":[]}`])(
  'rejects other malformed responses: %s', (raw) => {
    expect(() => parseStorybookAssistantJson(raw)).toThrow();
  });

it('still validates repaired patches and preserves the original story on failure', () => {
  const before = JSON.stringify(starterRpStorybook);
  expect(() => parseRpStorybookAssistantResult(String.raw`{"reply":"Done","patch":[{"op":"add","path":"/characters/999/relationships","-","value":{}}]}`, starterRpStorybook)).toThrow();
  expect(JSON.stringify(starterRpStorybook)).toBe(before);
});

it('applies a recovered relationship append through normal Storybook validation', () => {
  const result = parseRpStorybookAssistantResult(String.raw`{"reply":"Done","patch":[{"op":"add","path":"/characters/0/relationships","value":[]},{"op":"add","path":"/characters/0/relationships","-","value":{"characterId":"max\_weber","description":"Friend","apps":{"whatsup":true}}}]}`, starterRpStorybook);
  expect(result.storybook.characters[0].relationships).toEqual([
    { characterId: 'max_weber', description: 'Friend', apps: { whatsup: true } },
  ]);
});
