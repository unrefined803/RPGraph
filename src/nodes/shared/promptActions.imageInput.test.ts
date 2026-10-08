import { describe, expect, it, vi } from 'vitest';
import type { ChatImageAttachment, WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import {
  defaultPromptActionConfig,
  executePromptAction,
  normalizePromptActionConfig,
  promptActionAvailable,
  promptActionRuntimeSettings,
  withPromptActionRuntimeSettings,
} from './promptActions';
import { runActionAwarePrompt } from './promptRun';

const image: ChatImageAttachment = {
  id: 'upload-1', name: 'RP_Picture_01', mimeType: 'image/png', size: 1,
  dataUrl: 'data:image/png;base64,AA==',
};
const gallery = defaultPromptActionConfig();

describe('gallery search with attached input images', () => {
  it('defaults to disabled for attachments, including older saved settings', () => {
    expect(gallery.disableWhenImageAttached).toBe(true);
    const legacy = normalizePromptActionConfig({ title: gallery.title, actionId: 'getImageId' })!;
    expect(promptActionAvailable(legacy, { hasImageInput: true })).toBe(false);
    expect(promptActionAvailable(legacy, { hasImageInput: false })).toBe(true);
    const restored = promptActionRuntimeSettings({ getImageId: { maxReturnedImages: 4 } });
    expect(restored.getImageId?.disableWhenImageAttached).toBe(true);
  });

  it('preserves an explicit opt-out through saved runtime settings', () => {
    const restored = promptActionRuntimeSettings(JSON.parse(JSON.stringify({
      getImageId: { disableWhenImageAttached: false },
    })));
    const config = withPromptActionRuntimeSettings(gallery, restored);
    expect(promptActionAvailable(config, { hasImageInput: true })).toBe(true);
  });

  it('blocks execution as well as hiding the hint', async () => {
    const result = await executePromptAction({} as ExecuteContext, gallery, {
      action: 'getImageId', phoneOwner: 'Avery', tags: 'portrait',
    }, { hasImageInput: true });
    expect(result).toEqual({ text: '', images: [] });
  });

  it('keeps caption actions available for attached images', () => {
    expect(promptActionAvailable(defaultPromptActionConfig('', 'describeInputImage'), {
      hasImageInput: true, visionEnabled: true,
    })).toBe(true);
  });

  it.each([
    { attached: true, vision: true, disabled: true, reference: false, expected: false },
    { attached: true, vision: false, disabled: true, reference: false, expected: false },
    { attached: true, vision: true, disabled: false, reference: false, expected: true },
    { attached: false, vision: true, disabled: true, reference: true, expected: true },
    { attached: false, vision: true, disabled: true, reference: false, expected: true },
  ])('applies availability in planning and main: %j', async ({ attached, vision, disabled, reference, expected }) => {
    const prompts: string[] = [];
    const context = {
      nodes: [], historyMessages: [],
      reportWarning: vi.fn(), reportFormatResult: vi.fn(), updateRuntimeData: vi.fn(),
      llm: {
        supportsVision: async () => vision,
        complete: async ({ prompt }: { prompt: string }) => {
          prompts.push(prompt);
          return { text: 'Avery looks at the picture.', connection: { label: 'Test' } };
        },
      },
    } as unknown as ExecuteContext;
    await runActionAwarePrompt({
      node: { id: 'prompt', data: { label: 'Narrator' } } as WorkflowNode,
      context, inputValue: 'Narrator: Avery looks at the attached picture.',
      images: attached ? [image] : [],
      referenceImages: reference ? [{ index: 1, imageId: image.id, attachment: image, messageId: 1 }] : [],
      promptBefore: '',
      promptAfter: '@step:planning\nPlan.\n@action:Get character phone image list\n'
        + '@step:main\n@output:planning\nWrite the scene.\n@action:Get character phone image list',
      actionConfigs: [{ ...gallery, disableWhenImageAttached: disabled }],
      streamsVisibleOutput: false, contributesToTokenCalibration: false,
      callLabel: 'Narrator',
    });
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt.includes('"action":"get_image_id"')).toBe(expected);
      expect(prompt).not.toContain('@action:');
    }
  });
});
