import { expect, it } from 'vitest';
import {
  isRetiredPromptActionConfig, normalizePromptActionConfig, promptActionConfigs,
  parsePromptActionTokens, replacePromptActionTokensWithInstructions,
} from './promptActions';

it('keeps stored create-image actions loadable and drops them during normalization', () => {
  const retired = { title: 'Create character phone image', actionId: 'createImage', preset: 'default' };
  const search = { title: 'Get character phone image list', actionId: 'getImageId', preset: 'default' };
  expect(isRetiredPromptActionConfig(retired)).toBe(true);
  expect(isRetiredPromptActionConfig({ ...retired, actionId: 'create_image' })).toBe(true);
  expect(isRetiredPromptActionConfig(search)).toBe(false);
  expect(normalizePromptActionConfig(retired)).toBeUndefined();
  expect(promptActionConfigs([search, retired]).map((config) => config.actionId)).toEqual(['getImageId']);
});

it.each(['Create character phone image', 'CREATE CHARACTER PHONE IMAGE (after reply action)'])(
  'ignores retired tokens instead of enabling image search: %s', (title) => {
    const prompt = `Before\n@action:${title}\nAfter`;
    expect(parsePromptActionTokens(prompt)).toEqual([]);
    expect(replacePromptActionTokensWithInstructions(prompt, [])).toBe('Before\n\nAfter');
  },
);

it('preserves active actions and their offsets beside retired tokens', () => {
  const prompt = '@action:Create character phone image\n@action:Get character phone image list';
  const tokens = parsePromptActionTokens(prompt);
  expect(tokens).toHaveLength(1);
  expect(tokens[0].index).toBe(prompt.lastIndexOf('@action:'));
  const resolved = replacePromptActionTokensWithInstructions(prompt, []);
  expect(resolved).not.toContain('Create character phone image');
  expect(resolved).toContain('get_image_id');
});
