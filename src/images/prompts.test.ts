import { expect, it } from 'vitest';
import { imageGenerationAssistantPrompt } from '../chat/imageGenerationAssistant';

it('uses full character descriptions instead of LoRAs for API image prompts', () => {
  const prompt = imageGenerationAssistantPrompt('', { width: 1024, height: 1024, characterLora: '' }, '',
    ['Alice: alice.safetensors'], 'Alice has red hair.', '', [], 'Create a portrait.', false, false, false);
  expect(prompt).not.toMatch(/LoRA|characterLora|safetensors|whole pixels/);
  expect(prompt).toContain('always return settings as null');
  expect(prompt).toContain('JSON prompt field itself MUST');
  expect(prompt).toContain('portrait 3:4');
  expect(prompt).toContain('describe visible subjects fully');
});

it('keeps local settings and reference capability independent', () => {
  const local = imageGenerationAssistantPrompt('', { width: 832, height: 1216, characterLora: '' }, '', [], '', '', [], 'Portrait');
  expect(local).toContain('whole pixels');
  expect(local).toContain('Character LoRA');
  expect(local).not.toContain('REFERENCE EDITING');
  const futureLocal = imageGenerationAssistantPrompt('', { width: 832, height: 1216, characterLora: '' }, '', [], '', '', [], 'Edit', false, false, true, [], true);
  expect(futureLocal).toContain('REFERENCE EDITING');
  expect(futureLocal).toContain('Only when references are selected');
  expect(futureLocal).toContain('Without selected references, write a standalone scene prompt');
});
