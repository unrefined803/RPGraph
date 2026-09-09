import { describe, expect, it } from 'vitest';
import type { ExecuteContext } from '../types';
import type { StorybookCharacter } from '../../storybook/runtime';
import { defaultPromptActionConfig, executePromptAction, getImagesLlmInstruction, normalizePromptActionConfig, parsePromptActionCall } from './promptActions';

const image = (id: string, description: string) => ({
  id, name: id, description, mimeType: 'image/png', size: 1, dataUrl: `data:image/png;base64,${id}`,
});
const character = (name: string, images: ReturnType<typeof image>[]) => ({
  id: name, sourceId: name, name, label: name, kind: 'character', storybookNodeId: '', libraryNpc: true, images,
}) as StorybookCharacter;
const config = defaultPromptActionConfig('Get character phone image list', 'getImageId');
const characters = [
  character('Eli Ward', [image('npc-player', 'Player poses outside in a blue outfit.'), image('npc-selfie', 'Eli Ward takes a mirror selfie.')]),
  character('Player', [image('player-selfie', 'Player takes a mirror selfie in a blue outfit.')]),
];
async function search(phoneOwner: string, subjects = 'Player', appCharacters = characters) {
  return executePromptAction({ nodes: [], historyMessages: [], appCharacters } as unknown as ExecuteContext,
    config, { action: 'getImageId', phoneOwner, characters: subjects, tags: 'outfit, mirror, selfie' }, { visionEnabled: true });
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
