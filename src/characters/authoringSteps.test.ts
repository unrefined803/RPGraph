import { buildCharacterRegistry } from './registry';
import { describe, expect, it } from 'vitest';
import { newAssistantCharacter, parseCharacterAssistantResult, runCharacterAuthoringSteps } from './assistant';
import { characterProvenanceStages, characterStorageBadge, effectiveLibraryEntry, visibleLibraryEntries } from './librarySummary';
import type { NpcLibraryEntry } from './npcLibrary';

const response = (patch: unknown[], extra = {}) => JSON.stringify({ reply: 'Done.', patch, ...extra });
const entry = (tier: 'user' | 'bundled' | 'saved-storybook', id = 'same', fileName = `${tier}.json`): NpcLibraryEntry => ({
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
  it('uses the bundled fallback when local files share an ID and never picks an arbitrary duplicate', () => {
    const bundled = entry('bundled');
    const local = entry('user');
    const duplicate = entry('user', 'same', 'duplicate.json');
    expect(effectiveLibraryEntry([bundled, local], 'same')).toBe(local);
    expect(effectiveLibraryEntry([bundled, local, duplicate], 'same')).toBe(bundled);
    expect(effectiveLibraryEntry([local, duplicate], 'same')).toBeUndefined();
    expect(effectiveLibraryEntry([bundled], 'missing')).toBeUndefined();
  });
  it('hides retained recovery copies after switching back to Storybook', () => {
    for (const tier of [undefined, 'bundled', 'user'] as const) {
      for (const storybookEdited of [false, true]) {
        const options = { tier, inStorybook: true, storybookEdited };
        expect(characterProvenanceStages({ ...options, retained: true, snapshotEdited: true }))
          .toEqual(characterProvenanceStages(options));
      }
    }
    expect(characterProvenanceStages({ inStorybook: false, storybookEdited: false, retained: true })
      .map((stage) => stage.label)).toEqual(['Story NPC']);
  });
  it('shows resolution layers in priority order with the active layer last', () => {
    expect(characterProvenanceStages({ editedBuiltIn: true, localEdited: true, tier: 'user', inStorybook: true, storybookEdited: true })
      .map((stage) => stage.label)).toEqual(['Built-in', 'Local NPC', 'Storybook']);
    expect(characterProvenanceStages({ editedBuiltIn: true, localEdited: false, tier: 'user', inStorybook: false, storybookEdited: false })
      .map((stage) => stage.label)).toEqual(['Built-in', 'Local NPC']);
    expect(characterProvenanceStages({ tier: 'bundled', inStorybook: true, storybookEdited: false })
      .map((stage) => stage.label)).toEqual(['Built-in', 'Storybook']);
    expect(characterProvenanceStages({ inStorybook: true, storybookEdited: false })
      .map((stage) => stage.label)).toEqual(['Storybook']);
    expect(characterProvenanceStages({ tier: 'user', inStorybook: true, storybookEdited: false })
      .map((stage) => stage.label)).toEqual(['Local NPC', 'Storybook']);
    expect(characterProvenanceStages({ tier: 'user', inStorybook: false, storybookEdited: false })
      .map((stage) => stage.label)).toEqual(['Local NPC']);
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
        expect(JSON.parse(prompt.split('Current draft: ')[1].split('\n\n')[0]).character).not.toHaveProperty('apps');
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


it('resolves saved Storybook sources between bundled characters and local overrides', () => {
  const bundled = entry('bundled');
  const saved = entry('saved-storybook');
  saved.character.playable = true;
  const user = entry('user');
  expect(visibleLibraryEntries([bundled, saved])).toEqual([{ ...saved, editedBuiltIn: false }]);
  expect(effectiveLibraryEntry([bundled, saved], 'same')).toBe(saved);
  expect(buildCharacterRegistry([bundled, saved]).characters[0]).toMatchObject({
    provenance: { tier: 'saved-storybook' }, playerSelectable: false,
  });
  expect(buildCharacterRegistry([bundled, saved, user]).characters[0].provenance.tier).toBe('user');
  expect(buildCharacterRegistry([bundled, saved, user, { ...saved, tier: 'storybook' }]).characters[0])
    .toMatchObject({ provenance: { tier: 'storybook' }, playerSelectable: true });
  expect(characterProvenanceStages({ tier: 'saved-storybook', inStorybook: false, storybookEdited: false })[0].label)
    .toBe('From Storybook');
});


it('does not present a scanned Storybook copy as an import path for active Storybook characters', () => {
  expect(characterProvenanceStages({ tier: 'saved-storybook', inStorybook: true, storybookEdited: true })
    .map((stage) => stage.label)).toEqual(['Storybook']);
  expect(characterProvenanceStages({ tier: 'bundled', inStorybook: false, storybookEdited: false, retained: true, snapshotEdited: true })
    .map((stage) => stage.label)).toEqual(['Built-in', 'Story NPC']);
});

it('distinguishes current Opening History NPC versions from RP-only revisions', () => {
  const character = entry('bundled').character;
  const options = { inStorybook: false, retained: false, character };
  expect(characterStorageBadge(options)).toBeUndefined();
  expect(characterStorageBadge({ ...options, inStorybook: true })?.label).toBe('SB');
  expect(characterStorageBadge({ ...options, retained: true })?.label).toBe('RP');
  expect(characterStorageBadge({ ...options, retained: true, openingCharacter: structuredClone(character) })?.label).toBe('SB');
  expect(characterStorageBadge({ ...options, retained: true, openingCharacter: { ...character, description: 'Older revision' } })?.label).toBe('RP');
  expect(characterStorageBadge({ ...options, inStorybook: true, retained: true, openingCharacter: { ...character, description: 'Older revision' } })?.label).toBe('SB');
});
