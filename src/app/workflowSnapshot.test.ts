import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { buildPromptStepChain } from '../nodes/shared/promptSteps';
import type { WorkflowFile } from '../types';
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

  it.each(['default_normal_v32.json', 'default_planning_v32.json'])(
    'recognizes the empty Storybook slot in %s',
    (fileName) => {
      const workflow = JSON.parse(readFileSync(`resources/default-content/${fileName}`, 'utf8'));
      expect(workflowNeedsStorybookSelection(workflow)).toBe(true);
    },
  );
  it.each(['default_normal_v32.json', 'default_planning_v32.json'])(
    'explains account links once in every independent app and RP pass in %s',
    (fileName) => {
      const workflow = JSON.parse(readFileSync(`resources/default-content/${fileName}`, 'utf8')) as WorkflowFile;
      const promptSwitch = workflow.nodes.find((node) => node.data.nodeType === 'llm-prompt-switch')!;
      const rows = promptSwitch.data.llmPromptSwitchPromptAftersByOutput!;
      expect(rows.flat()).toHaveLength(23);
      for (const after of rows.flat()) {
        for (const step of buildPromptStepChain('', after)) {
          expect(step.after.match(/Account links:/g)).toHaveLength(1);
          expect(step.after).toContain('whatsup, fotogram, onlyfriends, matchme, bank');
          expect(step.after).toContain('@bank:Full Name opens Banking');
          expect(step.after).toContain('it never transfers money');
          expect(step.after).toContain('Sharing a MatchMe profile never creates a match');
        }
      }
    },
  );

});
