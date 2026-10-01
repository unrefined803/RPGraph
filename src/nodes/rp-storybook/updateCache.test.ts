import { afterEach, expect, it, vi } from 'vitest';
import { emptyRpStorybook, isEmptyRpStorybook, starterRpStorybook, storybookNeedsUpdate } from './model';

afterEach(() => vi.restoreAllMocks());

it('does not parse unchanged Storybook media for each upgrade indicator render', () => {
  const current = JSON.stringify({ format: 'rpgraph-storybook', version: '3.0.0', title: 'Cache test', media: 'x'.repeat(100_000) });
  const legacy = current.replace('3.0.0', '2.0.0');
  const parse = vi.spyOn(JSON, 'parse');
  for (let index = 0; index < 20; index += 1) {
    expect(storybookNeedsUpdate(current)).toBe(false);
    expect(storybookNeedsUpdate(legacy)).toBe(true);
  }
  expect(parse).toHaveBeenCalledTimes(2);
});

it('does not serialize an unchanged Storybook for each emptiness check', () => {
  const starter = JSON.stringify(starterRpStorybook);
  const empty = JSON.stringify(emptyRpStorybook);
  expect(isEmptyRpStorybook(starter)).toBe(false);
  const stringify = vi.spyOn(JSON, 'stringify');
  for (let index = 0; index < 20; index += 1) expect(isEmptyRpStorybook(starter)).toBe(false);
  expect(stringify).not.toHaveBeenCalled();
  expect(isEmptyRpStorybook(empty)).toBe(true);
  expect(isEmptyRpStorybook(starter)).toBe(false);
  expect(isEmptyRpStorybook(emptyRpStorybook)).toBe(true);
  expect(isEmptyRpStorybook('not json')).toBe(false);
});
