import { describe, expect, it, vi } from 'vitest';
import { agencyTagCatalog } from '../../../shared/agency-tags.cjs';
import { rankCharacters } from '../../characters/search';
import { appCharactersFromRegistry } from '../../characters/appRuntime';
import { buildCharacterRegistry } from '../../characters/registry';
import type { Character } from '../../characters/character';
import type { StorybookCharacter } from '../../storybook/runtime';
import type { MessageRecord, WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import { defaultPromptActionConfig, executePromptAction, normalizePromptActionConfig, parsePromptActionCall,
  parsePromptActionRequest, promptActionInstructionText, promptActionRuntimeSettings, promptActionSaveConfigs,
  withPromptActionRuntimeSettings, configForPromptActionToken } from './promptActions';
import { runActionAwarePrompt } from './promptRun';

const config = defaultPromptActionConfig('', 'getCharacterList');
const character = (name: string, changes: Partial<StorybookCharacter> = {}): StorybookCharacter => ({
  id: name, sourceId: name, name, label: name, kind: 'character', storybookNodeId: '', libraryNpc: true,
  profile: { name, description: 'Character details', personality: 'Curious', speechStyle: 'Dry humor', role: 'Neighbor' },
  hiddenAgency: 'Seeks attention', gender: 'man', agencyTags: [],
  phoneSettings: { wallpaperId: '' }, banking: { balance: 0 }, social: {},
  apps: { fotogram: { enabled: true, accountId: `account-${name}`, profileName: `profile-${name}`, bio: 'Photography', privacyMode: true } },
  ...changes,
} as StorybookCharacter);
const cast = [character('Partial'), character('Best', { agencyTags: ['drama_magnet'] }), character('Absent', { apps: {} })];
const query = { app: 'fotogram', privacyMode: true, agencyTags: ['drama_magnet'] } as const;
const searchQuery = { ...query, agencyTags: [...query.agencyTags] };

it('ranks partial matches and reports missing criteria without inventing accounts', () => {
  const results = rankCharacters(cast, [], searchQuery);
  expect(results.map((entry) => [entry.name, entry.score])).toEqual([['Best', 3], ['Partial', 2], ['Absent', 0]]);
  expect(results[1].unmatchedCriteria).toEqual(['agencyTag:drama_magnet']);
  expect(results[0]).toMatchObject({ hiddenAgency: 'Seeks attention', speechStyle: 'Dry humor', totalCriteria: 3 });
  expect(results[2].accounts).toEqual([]);
});

it('keeps missing and disabled accounts from matching false privacy or no-post criteria', () => {
  const disabled = character('Disabled');
  disabled.apps!.fotogram!.enabled = false;
  const results = rankCharacters([cast[2], disabled, character('Public', {
    apps: { fotogram: { enabled: true, accountId: 'public', bio: '' } },
  })], [], { app: 'fotogram', privacyMode: false, hasPosts: false });
  expect(results.map((entry) => entry.score)).toEqual([3, 0, 0]);
});

it('uses account-scoped agency tags and does not infer unknown gender', () => {
  const person = character('Person', { gender: undefined, apps: {
    whatsup: { accountId: 'chat', enabled: true, bio: '', agencyTags: ['drama_magnet'] },
    fotogram: { accountId: 'photo', enabled: true, bio: '' },
    onlyfriends: { accountId: 'disabled', enabled: false, bio: '', agencyTags: ['catfish'] },
  } });
  expect(rankCharacters([person], [], { ...searchQuery, gender: 'man' })[0].matchedCriteria).toEqual(['app:fotogram']);
  expect(rankCharacters([person], [], { agencyTags: ['drama_magnet', 'catfish'] })[0].matchedCriteria).toEqual(['agencyTag:drama_magnet']);
});

it('counts seeded and live text posts using account ownership, not another account with the same name', () => {
  const person = character('Author');
  person.apps!.fotogram!.initialPosts = [{ id: 'seed', text: 'Starting post' }];
  const post = (accountId: string, postId: string): MessageRecord => ({ id: 1, role: 'output', originalText: '', socialPost: {
    app: 'fotogram', postId, author: 'Author', authorHandle: 'profile-Author', authorAccountId: accountId, caption: 'Live post', textOnly: true,
  } });
  const results = rankCharacters([person], [post('account-Author', 'live'), post('account-Author', 'live'), post('other', 'unrelated')], { app: 'fotogram', hasPosts: true });
  expect(results[0].score).toBe(2);
  expect(results[0].accounts[0].postCount).toBe(2);
});

it('uses deterministic ties and applies the configured limit (default five)', () => {
  const characters = ['G', 'F', 'E', 'D', 'C', 'B', 'A'].map((name) => character(name));
  expect(rankCharacters(characters, [], {}).map((entry) => entry.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
  expect(rankCharacters(characters, [], {}, 2).map((entry) => entry.name)).toEqual(['A', 'B']);
});

describe('character list action integration', () => {
  it('restores action templates and runtime limits independently', () => {
    expect(config.maxReturnedCharacters).toBe(5);
    expect(configForPromptActionToken([], 'Get character list').actionId).toBe('getCharacterList');
    const saved = promptActionSaveConfigs([config]);
    const restored = normalizePromptActionConfig(saved[0])!;
    const runtime = promptActionRuntimeSettings(JSON.parse(JSON.stringify({ getCharacterList: { maxReturnedCharacters: 2 } })));
    expect(withPromptActionRuntimeSettings(restored, runtime).maxReturnedCharacters).toBe(2);
    expect(normalizePromptActionConfig({ ...config, maxReturnedCharacters: 100 })?.maxReturnedCharacters).toBe(20);
    expect(normalizePromptActionConfig({ ...config, maxReturnedCharacters: null })?.maxReturnedCharacters).toBe(5);
  });

  it('parses plans and validates explicit query criteria', () => {
    expect(parsePromptActionRequest('{"action":"get_character_list","plan":"Find an anonymous troll"}')?.action).toBe('getCharacterList');
    expect(parsePromptActionCall('{"action":"get_character_list","plan":"Find someone"}')).toBeUndefined();
    expect(parsePromptActionCall('{"action":"get_character_list","query":{}}')).toEqual({ action: 'getCharacterList', query: {} });
    expect(parsePromptActionCall(JSON.stringify({ action: 'get_character_list', query: { agencyTags: ['drama_magnet', 'drama_magnet'] } }))?.query?.agencyTags).toEqual(['drama_magnet']);
    for (const invalid of [{ app: 'invented' }, { gender: 'unknown' }, { privacyMode: true }, { app: 'matchme', hasPosts: false },
      { app: 'fotogram', privacyMode: 'false' }, { agencyTags: ['made_up'] }, { extra: true }]) {
      expect(parsePromptActionCall(JSON.stringify({ action: 'get_character_list', query: invalid }))).toBeUndefined();
    }
    const instruction = promptActionInstructionText(config, {}, 'Find someone');
    expect(instruction).toContain('Find someone');
    for (const tag of agencyTagCatalog) expect(instruction).toContain(`${tag.id}: ${tag.meaning}`);
    expect(instruction).not.toContain('{{agencyTags}}');
  });

  it('returns compact character data and no media even with attachments and no vision', async () => {
    const result = await executePromptAction({ nodes: [], historyMessages: [], appCharacters: cast } as unknown as ExecuteContext,
      { ...config, maxReturnedCharacters: 1, resultTemplate: '{{characterList}}' }, { action: 'getCharacterList', query: searchQuery },
      { hasImageInput: true, visionEnabled: false });
    expect(JSON.parse(result.text)).toHaveLength(1);
    expect(JSON.parse(result.text)[0].name).toBe('Best');
    expect(result.text).not.toContain('dataUrl');
    expect(result.images).toEqual([]);
    const empty = await executePromptAction({ nodes: [], historyMessages: [], appCharacters: [] } as unknown as ExecuteContext,
      config, { action: 'getCharacterList', query: {} });
    expect(empty.text).toContain('No existing characters are available.');
  });

  it('preserves authored demographics through the library runtime projection', () => {
    const payload = { id: 'npc', name: 'NPC', description: '', personality: '', speechStyle: '', role: '',
      images: [], gender: 'woman', age: 30, hiddenAgency: 'Private motivation' } as Character;
    const runtime = appCharactersFromRegistry(buildCharacterRegistry([{ character: payload, tier: 'bundled', source: 'test' }]));
    expect(rankCharacters(runtime, [], { gender: 'woman' })[0]).toMatchObject({ score: 1, age: 30, hiddenAgency: 'Private motivation' });
  });

  it.each([false, true])('executes plan, follow-up, result insertion and replay (planning step=%s)', async (planning) => {
    const prompts: string[] = [];
    const replies = [JSON.stringify({ action: 'get_character_list', plan: 'Find a private Fotogram troll' }),
      JSON.stringify({ action: 'get_character_list', query: searchQuery }), 'Best is the existing candidate.', 'The story continues.'];
    const context = { nodes: [], historyMessages: [], appCharacters: cast,
      reportWarning: vi.fn(), reportFormatResult: vi.fn(), updateRuntimeData: vi.fn(),
      llm: { supportsVision: async () => false, complete: async ({ prompt }: { prompt: string }) => {
        prompts.push(prompt);
        return { text: replies[prompts.length - 1], connection: { label: 'Test' } };
      } },
    } as unknown as ExecuteContext;
    const result = await runActionAwarePrompt({
      node: { id: 'prompt', data: { label: 'Narrator' } } as WorkflowNode, context,
      inputValue: 'Narrator: An anonymous account sends a DM.', images: [], referenceImages: [], promptBefore: '',
      promptAfter: planning ? '@step:planning\nPlan.\n@action:Get character list\n@step:main\n@output:planning\nWrite.\n@action:Get character list' : 'Write.\n@action:Get character list',
      actionConfigs: [config], streamsVisibleOutput: false, contributesToTokenCalibration: false, callLabel: () => 'Narrator',
    });
    expect(prompts).toHaveLength(planning ? 4 : 3);
    expect(prompts[0]).toContain('"action":"get_character_list","plan"');
    expect(prompts[1]).toContain('drama_magnet:');
    expect(prompts[2]).toContain('"accountId": "account-Best"');
    expect(prompts[2]).toContain('"score": 3');
    expect(result.generatedText).toBe(planning ? 'The story continues.' : 'Best is the existing candidate.');
    expect(context.reportWarning).not.toHaveBeenCalled();
  });
});
