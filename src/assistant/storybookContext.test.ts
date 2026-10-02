import { expect, it } from 'vitest';
import type { WorkflowNodeData } from '../types';
import { rpStorybookJsonText, starterRpStorybook } from '../nodes/rp-storybook/model';
import { storybookAssistantContent } from './storybookContext';

it('loads narrative independently of export settings and excludes media and runtime collections', () => {
  const book = structuredClone(starterRpStorybook);
  book.title = 'Harbor mystery';
  book.scenario.summary = 'A missing ship brings strangers together.';
  book.characters[0].images = [{ id: 'portrait', name: 'Portrait', mimeType: 'image/jpeg', size: 3, description: '', dataUrl: 'data:image/jpeg;base64,YWJj' }];
  const data = {
    nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText(book),
    storybookFormattedTextSettings: { title: false, scenario: false, characters: false },
  } as WorkflowNodeData;
  const content = storybookAssistantContent(data);
  expect(content).toMatchObject({ title: book.title, scenario: { summary: book.scenario.summary } });
  expect('characters' in content && content.characters?.[0].name).toBe(book.characters[0].name);
  const json = JSON.stringify(content);
  expect(json).not.toContain('data:image');
  expect(json).not.toContain('"images"');
  expect(json).not.toContain('"checkpoints"');
  expect(json).not.toContain('"turns"');
});

it('distinguishes missing and invalid Storybook content', () => {
  expect(storybookAssistantContent({} as WorkflowNodeData)).toEqual({ status: 'No Storybook content is currently loaded.' });
  expect(storybookAssistantContent({ storybookJson: 'invalid' } as WorkflowNodeData)).toHaveProperty('error');
});
