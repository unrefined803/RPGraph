import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { migrateV3Document, prepareV3Document } from './migration';
import { characterPayload, validateCharacterPayload } from './character';
import { emptyRpStorybook, normalizeRpStorybook, parseRpStorybookAssistantResult, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { planCharacterCardImport, rpCharacterCardForCharacter } from '../storybook/characterCard';

const image = { id: 'stable-photo', name: 'Portrait', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,YWJj', size: 3, description: 'Portrait' };
const legacy = () => ({ format: 'rpgraph-storybook', version: '2.2.0', characters: [{
  id: 'nova', name: 'Nova', description: 'Artist', personality: 'Patient', speechStyle: 'Calm', role: 'Friend',
  images: [image], profileImage: { imageId: image.id, dataUrl: image.dataUrl, crop: { x: 50, y: 50, size: 100 } },
  social: { fotogramUsername: 'nova.art', onlyfriendsUsername: '', plotTwist: {
    name: 'Nova', age: 25, bio: 'Making art', interests: 'Painting', photoIds: [image.id], decisions: { someone: 'like' }, historyVersion: 1,
  } }, banking: { startBalance: 1400, fixedExpenses: [] }, phoneSettings: { wallpaperId: 'night' },
}] });

describe('Character Container and Storybook V3', () => {
  it('migrates without changing the source and retains references and settings', () => {
    const source = legacy();
    const before = structuredClone(source);
    const result = migrateV3Document(source);
    expect(source).toEqual(before);
    expect(result.migratedDocuments).toBe(1);
    const character = normalizeRpStorybook(result.value).characters[0];
    const payload = characterPayload(character);
    validateCharacterPayload(payload);
    expect(payload.images).toEqual(source.characters[0].images);
    expect(payload.profileImage).not.toHaveProperty('dataUrl');
    expect(payload).not.toHaveProperty('social');
    expect(payload.apps.fotogram?.username).toBe('nova.art');
    expect(payload.apps.matchme?.profile?.photoIds).toEqual([image.id]);
    expect(payload.banking?.startBalance).toBe(1400);
    expect(character.profileImage?.dataUrl).toBe(image.dataUrl);
    expect(migrateV3Document(result.value)).toMatchObject({ value: result.value, migratedDocuments: 0 });
  });

  it('converts nested workflow and checkpoint Storybooks with one confirmation', () => {
    const source = { workflow: { nodes: [{ data: { storybookJson: JSON.stringify(legacy()) } }] }, checkpoints: [{ storybook: legacy() }] };
    let calls = 0;
    const result = prepareV3Document(source, () => { calls++; return true; });
    expect(calls).toBe(1);
    expect(JSON.parse(result.workflow.nodes[0].data.storybookJson).version).toBe('3.0.0');
    expect(result.checkpoints[0].storybook.version).toBe('3.0.0');
    expect(() => prepareV3Document(source, () => false)).toThrow('cancelled');
    expect(source.checkpoints[0].storybook.version).toBe('2.2.0');
  });

  it('rejects newer formats and leaves encrypted containers opaque', () => {
    expect(() => migrateV3Document({ ...legacy(), version: '3.0.1' })).toThrow('newer');
    const encrypted = { format: 'rpgraph-encrypted-character', version: '1.0', ciphertext: 'opaque' };
    expect(prepareV3Document(encrypted, () => { throw new Error('Must not prompt'); })).toEqual(encrypted);
  });

  it('exports the same payload, omits live dating state, and imports as playable', () => {
    const story = normalizeRpStorybook(migrateV3Document(legacy()).value);
    const character = { ...story.characters[0], playable: false };
    const card = rpCharacterCardForCharacter(character);
    expect(card.version).toBe('2.0.0');
    expect(card.character.playable).toBe(false);
    expect(card.character.apps.matchme?.profile?.decisions).toEqual({});
    expect(card.character.apps.matchme?.profile).not.toHaveProperty('historyVersion');
    expect(character.social?.plotTwist?.decisions).toEqual({ someone: 'like' });
    const imported = planCharacterCardImport(card, emptyRpStorybook).character;
    expect(imported.playable).toBe(true);
    expect(imported.images).toEqual(character.images);
    expect(imported.apps?.fotogram?.accountId).toBe(card.character.apps.fotogram?.accountId);
    expect(JSON.parse(rpStorybookJsonText(story)).characters[0]).not.toHaveProperty('social');
  });

  it('uses identity rather than names and rejects dangling references', () => {
    const story = normalizeRpStorybook(migrateV3Document(legacy()).value);
    const card = rpCharacterCardForCharacter(story.characters[0]);
    const other = normalizeRpStorybook({ ...emptyRpStorybook, characters: [{ id: 'other', name: 'Nova', images: [] }] });
    expect(planCharacterCardImport(card, other).storybook.characters).toHaveLength(2);
    card.character.apps.fotogram!.avatarImageId = 'missing';
    expect(() => planCharacterCardImport(card, emptyRpStorybook)).toThrow('Unknown character gallery image');
  });

  it('preserves disabled account handles and applies canonical app patches', () => {
    const story = normalizeRpStorybook(migrateV3Document(legacy()).value);
    const result = parseRpStorybookAssistantResult(JSON.stringify({ patch: [
      { op: 'replace', path: '/characters/0/apps/fotogram/username', value: 'new.handle' },
      { op: 'replace', path: '/characters/0/apps/fotogram/enabled', value: false },
    ] }), story).storybook;
    const payload = JSON.parse(rpStorybookJsonText(result)).characters[0];
    expect(payload.apps.fotogram.username).toBe('new.handle');
    expect(payload.apps.fotogram.enabled).toBe(false);
  });

  it.each(['workflow.default_v27.json', 'workflow.default_planning_v27.json'])('ships %s in V3', (filename) => {
    const source = JSON.parse(readFileSync(filename, 'utf8'));
    expect(migrateV3Document(source).migratedDocuments).toBe(0);
    const node = source.nodes.find((entry: { data: { nodeType: string } }) => entry.data.nodeType === 'rp-storybook');
    expect(node.data.nodeDataVersion).toBe('3.0.0');
    expect(node.data.label).toBe('RP Storybook V3');
    expect(JSON.parse(node.data.storybookJson).version).toBe('3.0.0');
  });
});

it('migrates V1 character cards to V2 independently of Storybook V3', () => {
  const result = migrateV3Document({ format: 'rpgraph-character', version: '1.0.0', character: legacy().characters[0] });
  expect(result.value.version).toBe('2.0.0');
  expect(migrateV3Document(result.value).migratedDocuments).toBe(0);
  expect(() => migrateV3Document({ ...result.value, version: '2.0.1' })).toThrow('newer');
});
