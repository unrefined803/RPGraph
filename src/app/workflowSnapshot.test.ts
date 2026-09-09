import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { workflowNeedsStorybookSelection } from './workflowSnapshot';

function workflowWithStorybook(storybookJson?: string) {
  return {
    nodes: [{
      id: 'storybook',
      data: { nodeType: 'rp-storybook', storybookJson },
    }],
  };
}

describe('workflow Storybook selection', () => {
  it('requests a Storybook for missing and reset Storybook content', () => {
    expect(workflowNeedsStorybookSelection(workflowWithStorybook())).toBe(true);
    expect(workflowNeedsStorybookSelection(
      workflowWithStorybook(rpStorybookJsonText(emptyRpStorybook)),
    )).toBe(true);
  });

  it('keeps an embedded Storybook without requesting a selection', () => {
    expect(workflowNeedsStorybookSelection(workflowWithStorybook(rpStorybookJsonText({
      ...emptyRpStorybook,
      title: 'Embedded Storybook',
    })))).toBe(false);
  });

  it('does not request a Storybook when the workflow has no Storybook node', () => {
    expect(workflowNeedsStorybookSelection({ nodes: [] })).toBe(false);
  });

  it.each(['default_normal_v28.json', 'default_planning_v28.json'])(
    'recognizes the empty Storybook slot in %s',
    (fileName) => {
      const workflow = JSON.parse(readFileSync(`resources/default-content/${fileName}`, 'utf8'));
      expect(workflowNeedsStorybookSelection(workflow)).toBe(true);
    },
  );
});
