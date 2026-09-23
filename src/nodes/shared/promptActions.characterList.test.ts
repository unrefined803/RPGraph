import { TextMetricsApi } from '../../llm/tokenMetrics';
import { describe, expect, it, vi } from 'vitest';
import { characterSearchDirectory, characterSearchPrompt, characterSearchResult,
  previousCharacterSearchInstruction, previousCharacterSearchResultTemplate, previousCharacterInformationInstruction, previousFullDirectoryCharacterSearchInstruction } from '../../characters/search';
import { appCharactersFromRegistry } from '../../characters/appRuntime';
import { buildCharacterRegistry } from '../../characters/registry';
import type { Character } from '../../characters/character';
import type { StorybookCharacter } from '../../storybook/runtime';
import type { MessageRecord, WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import { defaultPromptActionConfig, normalizePromptActionConfig, parsePromptActionCall,
  parsePromptActionRequest, promptActionSaveConfigs, configForPromptActionToken } from './promptActions';
import { runActionAwarePrompt } from './promptRun';

const config = defaultPromptActionConfig('', 'getCharacterList');
const cast = appCharactersFromRegistry(buildCharacterRegistry(['Avery', 'Blake', 'Casey', 'Dana', 'Eli', 'Fran'].map((name, index) => ({
  tier: 'bundled' as const, source: name,
  character: {
    id: name, name, description: `${name} description`, personality: `${name} personality`, speechStyle: 'Dry humor',
    hiddenAgency: 'Wants attention', agencyTags: ['drama_magnet'], role: 'Neighbor', gender: 'man', age: 30,
    images: [{ id: 'image', name: 'image', dataUrl: 'SECRET_IMAGE_DATA', mimeType: 'image/jpeg', size: 1, description: 'Photo' }],
    relationships: index === 0 ? [{ characterId: 'Blake', description: 'Close friend', apps: { fotogram: true } }] : [],
    apps: { fotogram: { accountId: `account-${name}`, profileName: `profile-${name}`, enabled: true, privacyMode: true, bio: 'Photography' },
      onlyfriends: { accountId: `disabled-${name}`, enabled: false, bio: 'DISABLED_BIO' } },
  } as Character,
}))));

it('provides every character, authored relationships, and enabled accounts as text without containers or history', () => {
  const history = [{ id: 1, role: 'user', originalText: 'SECRET_CHAT_HISTORY' }] as MessageRecord[];
  const directory = characterSearchDirectory(cast, history);
  for (const character of cast) expect(directory).toContain(`Character: ${character.name}`);
  for (const text of ['Avery personality', 'Dry humor', 'Wants attention', 'drama_magnet', 'Blake [Blake]: Close friend',
    'outgoing contacts/follows: fotogram', 'account-Avery', 'profile-Avery', 'Photography', 'anonymous', 'Age: 30']) expect(directory).toContain(text);
  for (const text of ['SECRET_CHAT_HISTORY', 'SECRET_IMAGE_DATA', 'DISABLED_BIO', 'disabled-Avery', 'dataUrl']) expect(directory).not.toContain(text);
  expect(directory.trimStart()).not.toMatch(/^[{[]/);
  expect(characterSearchDirectory([], [])).toContain('No existing characters');
});

it('counts authored and live posts without copying their text or confusing account ownership', () => {
  const characters = structuredClone(cast);
  characters[0].apps!.fotogram!.initialPosts = [{ id: 'seed', text: 'SECRET_POST_TEXT' }];
  const post = (account: string, id: string): MessageRecord => ({ id: 1, role: 'output', originalText: 'SECRET_CHAT', socialPost: {
    app: 'fotogram', postId: id, author: 'Avery', authorHandle: 'profile-Avery', authorAccountId: account, caption: 'SECRET_POST_TEXT',
  } });
  const directory = characterSearchDirectory(characters.slice(0, 1), [post('account-Avery', 'live'), post('account-Avery', 'live'), post('wrong', 'other')]);
  expect(directory).toContain('posts: 2');
  expect(directory).not.toContain('SECRET_');
});

it('migrates old ranking templates and retains custom assistant templates', () => {
  const restored = normalizePromptActionConfig({ ...config, instructionTemplate: previousCharacterSearchInstruction,
    resultTemplate: previousCharacterSearchResultTemplate, maxReturnedCharacters: 15 })!;
  expect(restored.instructionTemplate).toBe(config.instructionTemplate);
  expect(normalizePromptActionConfig({ ...config, instructionTemplate: previousCharacterInformationInstruction,
    afterReplyTemplate: previousCharacterInformationInstruction, previousFullDirectoryCharacterSearchInstruction })).toMatchObject({
    instructionTemplate: config.instructionTemplate, afterReplyTemplate: config.instructionTemplate,
  });
  expect(normalizePromptActionConfig({ ...config, instructionTemplate: previousFullDirectoryCharacterSearchInstruction,
    afterReplyTemplate: previousFullDirectoryCharacterSearchInstruction })).toMatchObject({
    instructionTemplate: config.instructionTemplate, afterReplyTemplate: config.instructionTemplate,
  });
  expect(restored.resultTemplate).toBe(config.resultTemplate);
  expect(restored).not.toHaveProperty('maxReturnedCharacters');
  expect(normalizePromptActionConfig(promptActionSaveConfigs([config])[0])).toEqual(config);
  expect(normalizePromptActionConfig({ ...config, instructionTemplate: 'Custom {{plan}}', resultTemplate: 'Answer: {{answer}}' }))
    .toMatchObject({ instructionTemplate: 'Custom {{plan}}', resultTemplate: 'Answer: {{answer}}' });
  expect(configForPromptActionToken([], 'Get character list').actionId).toBe('getCharacterList');
  expect(configForPromptActionToken([], 'Ask character information').title).toBe('Ask character information');
  expect(parsePromptActionRequest('{"action":"get_character_list","plan":"Find two friends of Avery"}'))
    .toEqual({ action: 'getCharacterList', plan: 'Find two friends of Avery' });
  expect(parsePromptActionCall('{"action":"get_character_list","query":{"app":"fotogram"}}')).toBeUndefined();
});

it('renders custom templates without recursively interpreting character data', () => {
  expect(characterSearchPrompt('{{plan}}\n{{characterDirectory}}', 'Find {{characterDirectory}}', 'Name {{plan}}'))
    .toBe('Find {{characterDirectory}}\nName {{plan}}');
  expect(characterSearchPrompt('Custom instructions', 'Request', 'Directory')).toContain('Character directory:\nDirectory');
  expect(characterSearchResult('Result: {{answer}}', 'Literal {{answer}}')).toBe('Result: Literal {{answer}}');
  expect(characterSearchResult('Custom header', 'No match.')).toContain('No match.');
});

async function run(planning: boolean, answer: string, characters: StorybookCharacter[] = cast,
  request = 'Find existing #drama_magnet Fotogram accounts with anonymous profiles; return the exact account ID and a reason.') {
  const calls: Array<{ prompt: string; images?: unknown[] }> = [];
  const replies = [JSON.stringify({ action: 'ask_character_information', plan: request }), answer, 'Avery is the candidate.', 'The story continues.'];
  const context = { textMetrics: new TextMetricsApi(), nodes: [], historyMessages: [{ id: 1, role: 'user', originalText: 'SECRET_CHAT_HISTORY' }], appCharacters: characters,
    reportWarning: vi.fn(), reportFormatResult: vi.fn(), updateRuntimeData: vi.fn(),
    llm: { supportsVision: async () => true, complete: async (call: { prompt: string; images?: unknown[] }) => {
      calls.push(call);
      return { text: replies[calls.length - 1], connection: { label: 'Test' } };
    } },
  } as unknown as ExecuteContext;
  const result = await runActionAwarePrompt({
    node: { id: 'prompt', data: { label: 'Narrator' } } as WorkflowNode, context,
    inputValue: 'SECRET_INPUT_AND_HISTORY',
    images: [{ id: 'input', name: 'input', mimeType: 'image/png', size: 1, dataUrl: 'SECRET_INPUT_IMAGE' }], referenceImages: [],
    promptBefore: 'SECRET_STORY_PROMPT',
    promptAfter: planning ? '@step:planning\nPlan.\n@action:Ask character information\n@step:main\n@output:planning\nWrite.\n@action:Ask character information' : 'Write.\n@action:Ask character information',
    actionConfigs: [config], streamsVisibleOutput: false, contributesToTokenCalibration: false, callLabel: () => 'Narrator',
  });
  return { result, calls, context, request };
}

describe('isolated character search assistant', () => {
  it.each([false, true])('replays with prose only and keeps the directory isolated (planning=%s)', async (planning) => {
    const answer = 'Avery fits: his attention-seeking motives suit the request. Fotogram account ID: account-Avery; profile: profile-Avery. His profile hides his real identity.';
    const { result, calls, context, request } = await run(planning, answer);
    expect(calls).toHaveLength(planning ? 4 : 3);
    const assistant = calls[1];
    expect(assistant.prompt).toContain(request);
    expect(assistant.prompt).toContain('Character: Fran');
    expect(assistant.prompt).not.toContain('at most three characters');
    expect(assistant.prompt).not.toContain('50–100 words total');
    expect(assistant.prompt).not.toContain('SECRET_');
    expect(assistant.images).toEqual([]);
    expect(calls[2].prompt).toContain(answer);
    expect(calls[2].prompt).not.toContain('Fran description');
    expect(calls[2].prompt).not.toContain('"score"');
    expect(result.generatedText).toBe(planning ? 'The story continues.' : 'Avery is the candidate.');
    const debug = result.debug.promptPasses.find((pass) => pass.sections?.some((section) => section.label === 'Character information assistant'))!;
    expect(debug.images).toEqual([]);
    expect(debug.sections).toHaveLength(1);
    expect(debug.sections![0].text).toContain(request);
    expect(debug.sections![0].text).toContain('6 characters searched');
    const tokens = new TextMetricsApi().measure(characterSearchDirectory(cast, [])).tokens;
    expect(debug.sections![0].text).toContain(`approximately ${tokens.toLocaleString('en-US')} tokens`);
    expect(debug.sections![0].text).not.toContain('Fran description');
    expect(JSON.stringify(result.debug)).not.toContain('Fran description');
    expect(context.reportWarning).not.toHaveBeenCalled();
  });

  it('passes a no-match answer back without manufacturing candidates', async () => {
    const { calls, context } = await run(false, 'No existing character fits the request.', []);
    expect(calls[1].prompt).toContain('No characters matched the name/profile or #keyword selectors.');
    expect(calls[2].prompt).toContain('No existing character fits the request.');
    expect(context.reportWarning).not.toHaveBeenCalled();
  });

  it('reports an empty assistant response instead of exposing the action request', async () => {
    const { result, calls, context } = await run(false, '');
    expect(calls).toHaveLength(2);
    expect(result.generatedText).toBe('');
    expect(context.reportWarning).toHaveBeenCalledWith(expect.stringContaining('empty answer'));
  });
});


it.each([false, true])('sends only named profiles and direct relationships to the assistant (planning=%s)', async (planning) => {
  const { calls, result } = await run(planning, 'Avery lists Blake as a close friend; reciprocal friendship is not confirmed.',
    cast, 'Who is Avery friends with?');
  expect(calls[1].prompt).toContain('Character: Avery');
  expect(calls[1].prompt).toContain('Character: Blake');
  for (const name of ['Casey', 'Dana', 'Eli', 'Fran']) expect(calls[1].prompt).not.toContain(`Character: ${name}`);
  expect(calls[2].prompt).toContain('reciprocal friendship is not confirmed');
  expect(JSON.stringify(result.debug)).toContain('2 characters searched; selected from 6 available');
});

it('keeps an unmatched selector empty instead of loading the registry', async () => {
  const { calls } = await run(false, 'No match in this selection.', cast, 'Find #astronaut candidates.');
  expect(calls[1].prompt).toContain('empty selection');
  expect(calls[1].prompt).not.toContain('Character: Avery');
  expect(calls[2].prompt).toContain('No match in this selection.');
});


it('limits the dispatched character directory to twenty ranked profiles', async () => {
  const characters = Array.from({ length: 35 }, (_, index) => ({
    ...cast[0], id: `capped-${index}`, sourceId: `capped-${index}`, name: `Candidate${index} Person${index}`,
    apps: {}, relationships: [], gender: 'woman' as const,
    profile: { ...cast[0].profile, personality: index === 34 ? 'Enjoys trolling.' : 'Quiet.' },
  }));
  const { calls, result } = await run(false, 'Candidate34 Person34 fits.', characters, 'Find #woman #troll candidates.');
  expect(calls[1].prompt.match(/^Character:/gm)).toHaveLength(20);
  expect(calls[1].prompt.indexOf('Character: Candidate34')).toBeLessThan(calls[1].prompt.indexOf('Character: Candidate0'));
  expect(calls[1].prompt).not.toContain('Character: Candidate19');
  expect(calls[1].prompt).toContain('at most 20 ranked characters');
  expect(JSON.stringify(result.debug)).toContain('20 characters searched; selected from 35 available');
});
