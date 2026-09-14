import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { type Character } from './character';
import { createCharacterContainer } from './creator';
import { normalizeRpStorybookCharacter } from '../nodes/rp-storybook/model';
import { rpCharacterCardForCharacter } from '../storybook/characterCard';

import { characterContentEqual } from './contentComparison';

for (const file of readdirSync('resources/npc-characters').filter((file) => file.endsWith('.json'))) {
  it(`preserves ${file} through assistant save and Storybook export`, () => {
    const source = JSON.parse(readFileSync(`resources/npc-characters/${file}`, 'utf8')).character as Character;
    const local = createCharacterContainer(source, true).character;
    expect(characterContentEqual(local, source)).toBe(true);
    const storybook = normalizeRpStorybookCharacter(source, 0, new Set());
    const exported = rpCharacterCardForCharacter(storybook, { includePosts: true }).character;
    expect(characterContentEqual(exported, storybook)).toBe(true);
  });
}

const fixture = (): Character => JSON.parse(readFileSync('resources/npc-characters/luca-reed.json', 'utf8')).character;

it('ignores playable status, cached portraits, media access and MatchMe runtime state without mutation', () => {
  const source = fixture();
  const changed = structuredClone(source);
  changed.playable = !source.playable;
  changed.profileImage!.dataUrl = 'cached preview';
  changed.images[0].receivedFrom = 'another-character';
  changed.images[0].imageAccess = true;
  changed.apps!.matchme!.profile!.decisions = { someone: 'like' };
  changed.apps!.matchme!.profile!.messages = [];
  changed.apps!.matchme!.profile!.historyVersion = 1;
  const before = JSON.stringify(changed);
  expect(characterContentEqual(source, changed)).toBe(true);
  expect(JSON.stringify(changed) === before).toBe(true);
});

it('ignores object key order and empty optional content', () => {
  const source = fixture();
  const changed = JSON.parse(JSON.stringify(source, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value)) as Character;
  delete source.hiddenAgency;
  changed.hiddenAgency = '';
  changed.apps!.whatsup!.initialPosts = [];
  expect(characterContentEqual(source, changed)).toBe(true);
});

const edits: Array<[string, (character: Character) => void]> = [
  ['biography', (c) => { c.description += ' Changed.'; }],
  ['account bio', (c) => { c.apps!.fotogram!.bio += ' Changed.'; }],
  ['hidden agency', (c) => { c.hiddenAgency = 'A new motivation.'; }],
  ['new gallery image', (c) => { c.images.push({ ...c.images[0], id: 'extra-image' }); }],
  ['image bytes', (c) => { c.images[0].dataUrl += 'AA'; }],
  ['image description', (c) => { c.images[0].description += ' Changed.'; }],
  ['portrait crop', (c) => { c.profileImage!.crop = { x: 10, y: 10, size: 50 }; }],
  ['new initial post', (c) => { (c.apps!.fotogram!.initialPosts ??= []).push({ id: 'new-post', text: 'New caption' }); }],
  ['removed initial posts', (c) => { c.apps!.fotogram!.initialPosts = []; }],
  ['edited initial post', (c) => { c.apps!.fotogram!.initialPosts![0].text += ' Changed.'; }],
  ['relationship', (c) => { c.relationships = [{ characterId: 'someone', description: 'Friend', apps: { whatsup: true } }]; }],
  ['MatchMe bio', (c) => { c.apps!.matchme!.bio += ' Changed.'; }],
];
for (const [label, edit] of edits) {
  it(`detects ${label} edits and recognizes reverted content`, () => {
    const source = fixture();
    const changed = structuredClone(source);
    edit(changed);
    expect(characterContentEqual(source, changed)).toBe(false);
    expect(characterContentEqual(changed, source)).toBe(false);
    expect(characterContentEqual(source, structuredClone(source))).toBe(true);
  });
}
