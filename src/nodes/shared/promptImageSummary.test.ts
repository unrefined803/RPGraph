import { expect, it } from 'vitest';
import { promptImageSummary } from './promptImageSummary';
import type { PromptPreviewPass } from './promptRun';

function image(id: string, source: 'input' | 'reference' | 'action') {
  return { id, source, name: id, index: 1 };
}

it('has no previous-run summary when debug passes are cleared', () => {
  expect(promptImageSummary()).toBeUndefined();
  expect(promptImageSummary([])).toBeUndefined();
});

it('counts history and action images across planning replays without multiplying them', () => {
  const passes: PromptPreviewPass[] = [
    { label: 'Planning', images: [image('old', 'reference')] },
    { label: 'Planning replay', images: [image('old', 'reference'), image('found', 'action')] },
    { label: 'Output', images: [image('old', 'reference'), image('found', 'action'), image('new', 'input')] },
  ];
  const summary = promptImageSummary(passes)!;
  expect(summary.label).toBe('2 injected');
  expect(summary.tooltip).toContain('3 unique images');
  expect(summary.tooltip).toContain('Input: 1; history: 1; actions: 1.');
  expect(summary.tooltip).toContain('Planning replay: 2 images (0 input, 1 history, 1 action)');
});

it('retains images from earlier steps and image search when the final pass has none', () => {
  const summary = promptImageSummary([
    { label: 'Image search', images: [image('candidate', 'action')] },
    { label: 'Output', images: [] },
  ])!;
  expect(summary.label).toBe('1 injected');
  expect(summary.tooltip).toContain('Output: 0 images');
});

it('distinguishes direct input from injected images and text-only prompts', () => {
  expect(promptImageSummary([{ label: 'Output', images: [image('new', 'input')] }])?.label)
    .toBe('1 image in prompts');
  expect(promptImageSummary([{ label: 'Output', images: [] }])?.label)
    .toBe('0 images in prompts');
});

it('counts one image only once even if its source changes between passes', () => {
  const summary = promptImageSummary([
    { label: 'Planning', images: [image('same', 'reference')] },
    { label: 'Output', images: [image('same', 'action')] },
  ])!;
  expect(summary.label).toBe('1 injected');
  expect(summary.tooltip).toContain('1 unique image.');
});
