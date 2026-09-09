import { describe, expect, it } from 'vitest';
import { rollPlanOutcomes } from './promptSteps';

describe('rollPlanOutcomes', () => {
  it('accepts chance and success probabilities from zero through one hundred', () => {
    const result = rollPlanOutcomes([
      '- Impossible attempt (chance: 0%); otherwise: it fails.',
      '- Certain attempt (SUCCESS: 100%); otherwise: it fails.',
    ].join('\n'), () => 0);

    expect(result.rolls.map(({ chance, outcome }) => ({ chance, outcome }))).toEqual([
      { chance: 0, outcome: 'epic fail' },
      { chance: 100, outcome: 'success' },
    ]);
    expect(result.text).toContain('(chance: 0%: BADLY FAILED');
    expect(result.text).toContain('(chance: 100%: SUCCESS');
  });

  it('inverts failure probabilities into success chances', () => {
    const result = rollPlanOutcomes(
      '- Ryan focuses on the photo (Failure: 20%); otherwise: he notices the room.',
      () => 0.99,
    );

    expect(result.rolls).toEqual([{ chance: 80, roll: 100, outcome: 'great success' }]);
    expect(result.text).toContain('(chance: 80%: CLEAR SUCCESS');
  });

  it('accepts fallback percentages without rolling unrelated values', () => {
    const result = rollPlanOutcomes([
      '- Ryan appreciates the photo (95%); otherwise: he jokes about the room.',
      '- Ryan appreciates the photo 75%; otherwise: he jokes about the room.',
      '- Her phone battery is at 20%.',
    ].join('\n'), () => 0.5);

    expect(result.rolls.map((roll) => roll.chance)).toEqual([95, 75]);
    expect(result.text).toContain('- Her phone battery is at 20%.');
  });

  it('leaves out-of-range probabilities unchanged', () => {
    const text = '- An invalid outcome (chance: 101%); otherwise: it fails.';
    expect(rollPlanOutcomes(text, () => 0.5)).toEqual({ text, rolls: [] });
  });
});
