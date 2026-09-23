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

  it.each(['default_normal_v34.json', 'default_planning_v34.json'])(
    'recognizes the empty Storybook slot in %s',
    (fileName) => {
      const workflow = JSON.parse(readFileSync(`resources/default-content/${fileName}`, 'utf8'));
      expect(workflowNeedsStorybookSelection(workflow)).toBe(true);
    },
  );
  it.each(['default_normal_v34.json', 'default_planning_v34.json'])(
    'uses one RP input prompt and no image generation in %s',
    (fileName) => {
      const workflow = JSON.parse(readFileSync(`resources/default-content/${fileName}`, 'utf8')) as WorkflowFile;
      const data = workflow.nodes.find((node) => node.data.nodeType === 'llm-prompt-switch')!.data;
      const rows = data.llmPromptSwitchPromptAftersByOutput!;
      expect(data.llmPromptSwitchPromptTitlesByOutput![0].slice(0, 2)).toEqual(['Empty', 'RP Prompt Normal']);
      expect(data.llmPromptSwitchPromptBeforesByOutput![0][0]).toBe('');
      expect(rows[0][0]).toBe('');
      expect(rows.flat().join('\n')).not.toContain('@action:Create character phone image');
      expect(rows.flat().join('\n')).not.toContain('request character phone image creation');
      for (const after of [...rows[0].slice(1), ...rows[1]]) {
        expect(after).toContain('its supplied ID (including RP_Picture_ IDs) can be forwarded');
        expect(after).toContain('@action:Get character phone image list');
        expect(after).toContain('Use the gallery action below to find a stored character photo');
        expect(after).not.toContain("Check the results' recipients and publication history");
        expect(after).not.toContain('reuse a suitable known image ID');
        expect(after).not.toContain('from the plan or history');
        expect(after).not.toContain('Do not answer from memory or skip it with an excuse.');
      }
      for (const index of [1, 2, 4, 5]) {
        expect(rows[0][index]).toContain('Character information:');
        expect(rows[0][index]).toContain('@action:Ask character information');
      }
      expect(rows[0][3]).not.toContain('@action:Ask character information');
      for (const after of [...rows[1], ...rows[2]]) {
        for (const step of buildPromptStepChain('', after)) {
          expect(step.after.match(/@action:Ask character information/g)).toHaveLength(1);
          expect(step.after).toContain('Character information:');
          expect(step.after).toContain('#keywords');
          expect(step.after).toContain('private author context, not automatic character knowledge');
          expect(step.after).toContain('do not invent a conversation, observation or access');
        }
      }
      expect(rows[3].join('\n')).not.toContain('@action:Ask character information');
      expect(rows[0][1]).toContain('@action:Describe input image (After Reply Action)');
      expect(rows[1][0]).toContain('attached image');
    },
  );
  it.each(['default_normal_v34.json', 'default_planning_v34.json'])(
    'explains account links once in every independent app and RP pass in %s',
    (fileName) => {
      const workflow = JSON.parse(readFileSync(`resources/default-content/${fileName}`, 'utf8')) as WorkflowFile;
      const promptSwitch = workflow.nodes.find((node) => node.data.nodeType === 'llm-prompt-switch')!;
      const rows = promptSwitch.data.llmPromptSwitchPromptAftersByOutput!;
      expect(rows.flat()).toHaveLength(23);
      for (const after of rows.flat().filter(Boolean)) {
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
