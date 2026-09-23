import { expect, it, vi } from 'vitest';
import { TextMetricsApi } from '../../llm/tokenMetrics';
import { appCharactersFromRegistry } from '../../characters/appRuntime';
import { buildCharacterRegistry } from '../../characters/registry';
import type { Character } from '../../characters/character';
import type { WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import { defaultPromptActionConfig, phoneImageSearchContext, phoneImageSearchResult } from './promptActions';
import { runActionAwarePrompt } from './promptRun';
const config = { ...defaultPromptActionConfig('', 'getImageId'), disableWhenImageAttached: false };
const cast = appCharactersFromRegistry(buildCharacterRegistry(['Avery', 'Blake', 'Casey', 'Dana', 'Eli', 'Fran'].map((name, index) => ({
  tier: 'bundled' as const, source: name,
  character: {
    id: name, name, description: `${name} description`, personality: `${name} personality`, speechStyle: 'Dry humor',
    hiddenAgency: 'Wants attention', agencyTags: ['drama_magnet'], role: 'Neighbor', gender: 'man', age: 30,
    images: [{ id: `image-${name}`, name: 'image', dataUrl: 'SECRET_IMAGE_DATA', mimeType: 'image/jpeg', size: 1, description: 'Photo' }],
    relationships: index === 0 ? [{ characterId: 'Blake', description: 'Close friend', apps: { fotogram: true } }] : [],
    apps: { fotogram: { accountId: `account-${name}`, profileName: `profile-${name}`, enabled: true, privacyMode: true, bio: 'Photography' },
      onlyfriends: { accountId: `disabled-${name}`, enabled: false, bio: 'DISABLED_BIO' } },
  } as Character,
}))));

it('resolves exact character/account identities without matching substrings or falling back to the speaker', () => {
  const context = { nodes: [], appCharacters: cast, historyMessages: [] } as unknown as ExecuteContext;
  for (const plan of ['Find account-Blake photos.', 'Find Blake photos.']) {
    const found = phoneImageSearchContext(context, plan);
    expect(found.candidates.map((image) => image.imageId)).toEqual(['image-Blake']);
    expect(found.directory).toContain('profile-Blake');
    expect(found.directory).not.toContain('SECRET_IMAGE_DATA');
  }
  for (const plan of ['Find account-Blakely photos', 'Get my picture', 'disabled-Blake'])
    expect(phoneImageSearchContext(context, plan).candidates).toEqual([]);
  const { candidates } = phoneImageSearchContext(context, 'Avery and Blake');
  expect(phoneImageSearchResult(config, candidates, '{"imageIds":["invented"],"answer":"Yes"}', true, 'Find Avery and Blake photos.')).toBeUndefined();
  expect(phoneImageSearchResult(config, candidates, '', true, 'Find Avery and Blake photos.')).toBeUndefined();
  const selected = phoneImageSearchResult(config, candidates, '{"imageIds":["image-Blake","image-Blake","image-Avery"],"answer":"Both fit."}', true, 'Find Avery and Blake photos.')!;
  expect(selected.images.map((image) => image.id)).toEqual(['image-Blake', 'image-Avery']);
  expect(selected.text).toContain('Both fit.');
  expect(selected.text.indexOf('Request:')).toBeLessThan(selected.text.indexOf('Assistant answer:'));
  expect(selected.text.indexOf('Assistant answer:')).toBeLessThan(selected.text.indexOf('Selected existing images:'));
  expect(selected.text).toContain('Find Avery and Blake photos.');
  expect(selected.text).not.toContain('Image selection:');
  expect(selected.text).toContain('Image shown to:');
  expect(phoneImageSearchResult(config, candidates, '{"imageIds":[],"answer":"No suitable images."}', false, 'Find Avery and Blake photos.')?.text).toContain('No suitable images.');
});

it.each(['main', 'planning', 'later-planning'] as const)('keeps image selections and rationale through %s', async (mode) => {
  const planning = mode !== 'main';
  const calls: Array<{ prompt: string; images: unknown[] }> = [];
  const replies = [JSON.stringify({ action: 'get_image_id', plan: 'Avery is the hacker retrieving photos of Blake from account-Blake for the player. Choose one appropriate photo; Avery is only the intermediary.' }),
    '{"imageIds":["image-Blake"],"answer":"Blake is the requested target, Avery only retrieves it."}', 'Selected the target photo.', 'Story continues.', 'Final reply.'];
  const context = { textMetrics: new TextMetricsApi(), nodes: [], appCharacters: cast, historyMessages: [],
    reportWarning: vi.fn(), reportFormatResult: vi.fn(), updateRuntimeData: vi.fn(),
    llm: { supportsVision: async () => true, complete: vi.fn(async (call) => { calls.push(call); return { text: replies.shift() ?? '', connection: { label: 'Test' } }; }) },
  } as unknown as ExecuteContext;
  const result = await runActionAwarePrompt({ node: { id: 'prompt', data: { label: 'Narrator' } } as WorkflowNode, context,
    inputValue: 'SECRET_RAW_HISTORY', images: [], referenceImages: [], promptBefore: 'SECRET_STORY_INSTRUCTIONS',
    promptAfter: mode === 'later-planning' ? '@step:lookup\n@action:Get character phone image list\n@step:planning\n@output:lookup\nPlan.\n@step:main\n@output:planning\nWrite.' : planning ? '@step:planning\nPlan.\n@action:Get character phone image list\n@step:main\n@output:planning\nWrite.\n@action:Get character phone image list' : '@action:Get character phone image list',
    actionConfigs: [config], streamsVisibleOutput: false, contributesToTokenCalibration: false, callLabel: () => 'Narrator' });
  expect(calls).toHaveLength(mode === 'later-planning' ? 5 : planning ? 4 : 3);
  expect(calls[1].prompt).toContain('image-Blake');
  expect(calls[1].prompt).toContain('account-Blake');
  for (const secret of ['SECRET_RAW_HISTORY', 'SECRET_STORY_INSTRUCTIONS', 'SECRET_IMAGE_DATA', 'Fran description']) expect(calls[1].prompt).not.toContain(secret);
  expect(calls[1].images).toEqual([]);
  expect(calls[2].prompt).toContain('Blake is the requested target');
  expect(calls[2].images).toMatchObject([{ id: 'image-Blake' }]);
  expect(calls[2].prompt).not.toContain('Blake personality');
  for (const call of calls.slice(2)) {
    expect(call.prompt.split('Blake is the requested target, Avery only retrieves it.')).toHaveLength(2);
    expect(call.prompt).toContain('image-Blake');
    expect(call.prompt).toContain('Request:\nAvery is the hacker retrieving photos');
    expect(call.prompt.indexOf('Request:\nAvery')).toBeLessThan(call.prompt.indexOf('Assistant answer:'));
    expect(call.prompt.indexOf('Assistant answer:')).toBeLessThan(call.prompt.indexOf('Selected existing images:'));
  }
  if (mode === 'later-planning') {
    expect(JSON.stringify(result.debug.promptPasses?.find((pass) => pass.label === 'Step planning'))).toContain('Blake is the requested target');
  }
  expect(context.reportWarning).not.toHaveBeenCalled();
});
