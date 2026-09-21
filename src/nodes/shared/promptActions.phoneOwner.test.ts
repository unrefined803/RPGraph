import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '../../types';
import type { ExecuteContext } from '../types';
import type { StorybookCharacter } from '../../storybook/runtime';
import { defaultPromptActionConfig, executePromptAction, getImagesLlmInstruction, normalizePromptActionConfig, parsePromptActionCall, previousPromptActionDefaultsForValidation } from './promptActions';

const image = (id: string, description: string) => ({
  id, name: id, description, mimeType: 'image/jpeg' as const, size: 1, dataUrl: `data:image/jpeg;base64,${id}`,
});
const character = (name: string, images: ReturnType<typeof image>[]) => ({
  id: name, sourceId: name, name, label: name, kind: 'character', storybookNodeId: '', libraryNpc: true, images,
}) as StorybookCharacter;
const config = defaultPromptActionConfig('Get character phone image list', 'getImageId');
const characters = [
  character('Eli Ward', [image('npc-player', 'Player poses outside in a blue outfit.'), image('npc-selfie', 'Eli Ward takes a mirror selfie.')]),
  character('Player', [image('player-selfie', 'Player takes a mirror selfie in a blue outfit.')]),
];
async function search(phoneOwner: string, subjects = 'Player', appCharacters = characters, historyMessages: MessageRecord[] = [], searchConfig = config) {
  return executePromptAction({ nodes: [], historyMessages, appCharacters } as unknown as ExecuteContext,
    searchConfig, { action: 'getImageId', phoneOwner, characters: subjects, tags: 'outfit, mirror, selfie' }, { visionEnabled: true });
}

describe('phone image search ownership', () => {
  it('upgrades stored default search instructions', () => {
    const legacy = getImagesLlmInstruction
      .replace('choose the phone owner, photographed characters, and visual search tags', 'choose the Storybook characters and visual search tags')
      .split('\n').filter((line) => !line.includes('phoneOwner') && !line.startsWith('characters is')).join('\n');
    expect(normalizePromptActionConfig({ ...config, instructionTemplate: legacy })?.instructionTemplate).toBe(getImagesLlmInstruction);
  });
  it('requires an explicit owner and tags in parsed calls', () => {
    expect(parsePromptActionCall('{"action":"get_image_id","characters":"Player","tags":"selfie"}')).toBeUndefined();
    expect(parsePromptActionCall('{"action":"get_image_id","phoneOwner":"Eli Ward"}')).toBeUndefined();
    expect(parsePromptActionCall('{"action":"get_image_id","phoneOwner":" Eli Ward ","characters":"Player","tags":"selfie"}'))
      .toMatchObject({ phoneOwner: 'Eli Ward', characters: 'Player' });
  });
  it('finds pictures of the player in the NPC container gallery only', async () => {
    const result = await search('Eli Ward');
    expect(result.images.map((entry) => entry.id)).toEqual(['npc-player', 'npc-selfie']);
    expect(result.text).toContain('Phone Gallery searched: Eli Ward.');
    expect(result.text).not.toContain('player-selfie');
  });
  it('allows the NPC to find its own selfie', async () => {
    expect((await search('Eli Ward', 'Eli Ward')).images[0].id).toBe('npc-selfie');
  });
  it('never falls back to other phones for absent, partial, or ambiguous owners', async () => {
    for (const owner of ['', 'Unknown', 'Eli']) expect((await search(owner)).images).toEqual([]);
    expect((await search('Eli Ward', '', [...characters, character('Eli Ward', [])])).images).toEqual([]);
    expect((await search('Empty', '', [...characters, character('Empty', [])])).images).toEqual([]);
  });
});


describe('phone image publication history', () => {
  const post = (app: 'fotogram' | 'onlyfriends', imageId = 'npc-selfie'): MessageRecord => ({
    id: 1, role: 'output', originalText: '', socialPost: {
      app, imageId, postId: `${app}-post`, author: 'Eli Ward', authorHandle: 'eli', caption: 'A selfie.',
    },
  });

  it.each([false, true])('shows direct recipients and deduplicated social apps with hidden captions: %s', async (hideImageTextWhenSendingToLlm) => {
    const result = await search('Eli Ward', 'Eli Ward', characters, [
      { id: 2, role: 'output', originalText: '', channel: 'phone', phoneTo: 'Player', phoneImageIds: ['npc-selfie'] },
      post('fotogram'), post('fotogram'), post('onlyfriends'),
    ], { ...config, hideImageTextWhenSendingToLlm });
    const line = result.text.split('\n').find((line) => line.includes(': npc-selfie :'))!;
    expect(line).toContain('Image shown to: Player; Social media posts: Fotogram (public), OnlyFriends (restricted access)');
    expect(line.match(/Fotogram/g)).toHaveLength(1);
    expect(result.text).toContain('assume everyone has likely seen them');
    expect(result.text).toContain('judge whether the intended recipient likely had access');
    expect(result.text.split('\n').find((line) => line.includes(': npc-player :'))).not.toContain('Social media posts');
  });

  it('does not describe a published image as unseen when no private receipt is recorded', async () => {
    const result = await search('Eli Ward', '', characters, [post('onlyfriends')]);
    expect(result.text).toContain('Image shown to: No direct recipients recorded; Social media posts: OnlyFriends (restricted access)');
    expect(result.text).not.toContain('Social media posts: Fotogram');
  });

  it('includes initial container posts without timeline messages', async () => {
    const owners = structuredClone(characters);
    owners[0].apps = { fotogram: {
      accountId: 'eli-fotogram', enabled: true, profileName: 'eli', bio: '',
      initialPosts: [{ id: 'seed-selfie', text: 'A selfie.', imageId: 'npc-selfie' }],
    } };
    const result = await search('Eli Ward', '', owners);
    expect(result.text).toContain('Social media posts: Fotogram (public)');
  });

  it('ignores text posts and posts of other images', async () => {
    const textPost = post('fotogram');
    textPost.socialPost!.textOnly = true;
    const result = await search('Eli Ward', '', characters, [textPost, post('onlyfriends', 'unrelated')]);
    expect(result.text.split('\n').filter((line) => line.startsWith('* ')).join('\n')).not.toContain('Social media posts');
  });

  it('upgrades prior default result templates while preserving custom text', () => {
    const previous = previousPromptActionDefaultsForValidation().filter((entry) => entry.id.startsWith('get-images-result-'));
    for (const entry of previous) {
      expect(normalizePromptActionConfig({ ...config, resultTemplate: entry.text })?.resultTemplate).toBe(config.resultTemplate);
    }
    const custom = 'My gallery: {{imageShownTo}}';
    expect(normalizePromptActionConfig({ ...config, resultTemplate: custom })?.resultTemplate).toBe(custom);
  });
});


describe('phone image MatchMe profile visibility', () => {
  function matchMeCharacters(enabled = true) {
    const owners = structuredClone(characters);
    owners[0].images!.push(image('unused', 'Another mirror selfie.'));
    owners[0].apps = { matchme: {
      accountId: 'eli-matchme', enabled, profileName: 'Eli', bio: 'Hello.', avatarImageId: 'unused',
      profile: { name: 'Eli', age: 25, bio: 'Hello.', interests: 'Art', decisions: {},
        photoIds: ['npc-selfie', 'npc-player'] },
    } };
    return owners;
  }

  it.each([false, true])('marks all assigned profile photos with hidden captions: %s', async (hideImageTextWhenSendingToLlm) => {
    const result = await search('Eli Ward', '', matchMeCharacters(), [], { ...config, hideImageTextWhenSendingToLlm });
    const lines = result.text.split('\n');
    for (const id of ['npc-selfie', 'npc-player']) {
      expect(lines.find((line) => line.includes(`: ${id} :`))).toContain(
        'Image shown to: No direct recipients recorded; MatchMe profile photo: Eli Ward',
      );
    }
    expect(lines.find((line) => line.includes(': unused :'))).not.toContain('MatchMe profile photo');
    expect(result.text).toContain('Use the chat history, established matches, and story context');
    expect(result.text).toContain('do not treat profile photos as new pictures');
  });

  it('retains profile attribution when the same image is found in a recipient gallery', async () => {
    const owners = matchMeCharacters();
    owners[1].images!.push({ ...owners[0].images![0], receivedFrom: 'Eli Ward' });
    const result = await search('Player', '', owners);
    expect(result.text.split('\n').find((line) => line.includes(': npc-player :'))).toContain(
      'Image shown to: Player; MatchMe profile photo: Eli Ward',
    );
  });

  it('combines MatchMe profile use with social publications', async () => {
    const result = await search('Eli Ward', '', matchMeCharacters(), [{
      id: 1, role: 'output', originalText: '', socialPost: { app: 'fotogram', postId: 'selfie',
        author: 'Eli Ward', authorHandle: 'eli', caption: 'Selfie', imageId: 'npc-selfie' },
    }]);
    expect(result.text).toContain('Social media posts: Fotogram (public); MatchMe profile photo: Eli Ward');
  });

  it('does not mark photos in a disabled MatchMe profile', async () => {
    const result = await search('Eli Ward', '', matchMeCharacters(false));
    expect(result.text.split('\n').filter((line) => line.startsWith('* ')).join('\n')).not.toContain('MatchMe profile photo');
  });
});
