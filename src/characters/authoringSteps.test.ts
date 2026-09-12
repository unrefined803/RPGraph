import { describe, expect, it } from 'vitest';
import { newAssistantCharacter, parseCharacterAssistantResult, runCharacterAuthoringSteps } from './assistant';
import { visibleLibraryEntries } from './librarySummary';
import type { NpcLibraryEntry } from './npcLibrary';

const response = (patch: unknown[], extra = {}) => JSON.stringify({ reply: 'Done.', patch, ...extra });
const entry = (tier: 'user' | 'bundled', id = 'same', fileName = `${tier}.json`): NpcLibraryEntry => ({
  tier, fileName, source: `${tier}:${fileName}`, character: { ...newAssistantCharacter(), id, name: 'Alex' },
});

describe('edited built-in library entries', () => {
  it('shows only the user revision, identifies its built-in origin by ID, and restores the original when removed', () => {
    const bundled = entry('bundled');
    const user = entry('user', 'same', 'renamed.json');
    user.character.name = 'Edited Alex';
    expect(visibleLibraryEntries([bundled, user])).toEqual([{ ...user, editedBuiltIn: true }]);
    expect(visibleLibraryEntries([bundled])).toEqual([{ ...bundled, editedBuiltIn: false }]);
  });
  it('does not confuse equal names with matching identity', () => {
    const visible = visibleLibraryEntries([entry('bundled'), entry('user', 'different')]);
    expect(visible).toHaveLength(2);
    expect(visible.every((item) => !item.editedBuiltIn)).toBe(true);
  });
  it('keeps ambiguous user files visible for diagnostics instead of silently picking one', () => {
    expect(visibleLibraryEntries([entry('bundled'), entry('user'), entry('user', 'same', 'duplicate.json')])).toHaveLength(3);
  });
});

describe('sequential character specialists', () => {
  it('passes the completed profile to the accounts step without mutating the source', async () => {
    const character = newAssistantCharacter();
    const initial = parseCharacterAssistantResult(response([], { steps: ['profile', 'accounts'] }), character);
    const calls: string[] = [];
    const result = await runCharacterAuthoringSteps(initial, 'Create a character', [], async (step, prompt) => {
      calls.push(step);
      if (step === 'profile') {
        expect(prompt).not.toContain('"apps":');
        return response([{ op: 'replace', path: '/character/name', value: 'Alex' }]);
      }
      expect(prompt).toContain('"name":"Alex"');
      return response([{ op: 'replace', path: '/character/apps/fotogram/displayName', value: 'Alex' }]);
    });
    expect(calls).toEqual(['profile', 'accounts']);
    expect(result.character.name).toBe('Alex');
    expect(character.name).toBe('New Character');
  });
  it('rejects specialist edits outside their scope and preserves the original on a later failure', async () => {
    const character = newAssistantCharacter();
    const initial = parseCharacterAssistantResult(response([], { steps: ['profile', 'accounts'] }), character);
    await expect(runCharacterAuthoringSteps(initial, 'Create', [], async (step) => response([
      { op: 'replace', path: '/character/name', value: step === 'profile' ? 'Alex' : 'Forbidden' },
    ]))).rejects.toThrow('outside its step');
    expect(character.name).toBe('New Character');
  });
  it('pauses when the profile specialist needs clarification', async () => {
    const initial = parseCharacterAssistantResult(response([], { steps: ['profile', 'accounts'] }), newAssistantCharacter());
    const calls: string[] = [];
    await runCharacterAuthoringSteps(initial, 'Create', [], async (step) => { calls.push(step); return response([]); });
    expect(calls).toEqual(['profile']);
  });
  it('does not invoke specialists for normal chat and rejects recursive or reordered plans', async () => {
    const character = newAssistantCharacter();
    await runCharacterAuthoringSteps(parseCharacterAssistantResult(response([]), character), 'Hello', [], async () => { throw new Error('Unexpected call'); });
    expect(() => parseCharacterAssistantResult(response([], { steps: ['accounts', 'profile'] }), character)).toThrow('steps');
    const initial = parseCharacterAssistantResult(response([], { steps: ['profile'] }), character);
    await expect(runCharacterAuthoringSteps(initial, 'Create', [], async () => response([], { steps: ['accounts'] }))).rejects.toThrow('delegate');
  });
});
