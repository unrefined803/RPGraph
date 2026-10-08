import { describe, expect, it } from 'vitest';
import { rollPlanOutcomes } from './promptSteps';

describe('rollPlanOutcomes', () => {
  it('rolls every labelled marker on one line', () => {
    const result = rollPlanOutcomes(
      '- Mina picks the lock (chance: 70%) and Sam slips past (failure: 60%).',
      () => 0.99,
    );

    expect(result.rolls.map(({ chance }) => chance)).toEqual([70, 40]);
    expect(result.text).not.toMatch(/\(chance: 70%\)|failure: 60%/);
  });

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

  it('keeps the spacing around unparenthesized markers', () => {
    const result = rollPlanOutcomes(
      '- Ryan asks her out, chance: 60% otherwise: he stays quiet.',
      () => 0.99,
    );

    expect(result.text).toBe(
      '- Ryan asks her out, (chance: 60%: CLEAR SUCCESS, this happens decisively; skip any otherwise-part) otherwise: he stays quiet.',
    );
  });

  it('does not treat a longer word ending in a label as a marker', () => {
    const text = '- Perchance: 50% of the guests leave early.';
    expect(rollPlanOutcomes(text, () => 0.5)).toEqual({ text, rolls: [] });
  });

  it('leaves out-of-range probabilities unchanged', () => {
    const text = '- An invalid outcome (chance: 101%); otherwise: it fails.';
    expect(rollPlanOutcomes(text, () => 0.5)).toEqual({ text, rolls: [] });
  });
});
