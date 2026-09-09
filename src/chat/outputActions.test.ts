import { expect, it } from 'vitest';
import { findOutputActionPlayer } from './outputActions';

const characters = [
  { id: 'npc-id', name: 'NPC', playerSelectable: false },
  { id: 'player-id', name: 'Player', playerSelectable: true },
];

it('resolves Output Action players only from playable characters', () => {
  expect(findOutputActionPlayer(characters, 'npc-id')).toBeUndefined();
  expect(findOutputActionPlayer(characters, 'NPC')).toBeUndefined();
  expect(findOutputActionPlayer(characters, 'player-id')).toBe(characters[1]);
  expect(findOutputActionPlayer(characters, 'player')).toBe(characters[1]);
});
