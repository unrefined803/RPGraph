import { expect, it } from 'vitest';
import { findOutputActionPlayer, parseOutputActions } from './outputActions';

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

it('reports a warning instead of throwing when one object of a sequence is invalid', () => {
  const text = '{"type":"infoBox","text":"a"}\n{"type":"infoBox","text":"b",}';
  expect(() => parseOutputActions(text)).not.toThrow();
  expect(parseOutputActions(text).warnings).toEqual(['RP Output Actions could not be parsed as JSON.']);
});
