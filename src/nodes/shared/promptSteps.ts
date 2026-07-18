// Prompt-step markers split one prompt text into a Step 1 planning prompt and
// the Step 2 main prompt. A marker is a standalone line like
// "--- Step 1: Planning" (case-insensitive, at least three dashes, free title
// after the colon). Text under a "Step 1" marker becomes the planning pass;
// text before the first marker or under "Step 2" (or any higher number) stays
// the main prompt. Prompts without a Step 1 marker keep the classic
// single-pass behavior.

const promptStepMarkerPattern =
  /^[ \t]*-{3,}[ \t]*step[ \t]*([0-9]+)[ \t]*(?::[ \t]*([^\n\r]*?))?[ \t]*-*[ \t]*$/gim;

// Marks where the rolled Step 1 plan is injected into the Step 2 text. Without
// this token the plan block is prepended to the top of the main prompt.
export const planOutputTokenPattern = /@plan:output\b/gi;

type PromptStepSections = {
  plan: string;
  main: string;
  hasPlanStep: boolean;
};

export function splitPromptStepSections(text: string): PromptStepSections {
  const markers: Array<{ step: number; start: number; end: number }> = [];
  text.replace(promptStepMarkerPattern, (raw, step: string, _title: string | undefined, index: number) => {
    markers.push({ step: Number(step), start: index, end: index + raw.length });
    return raw;
  });
  if (!markers.length) {
    return { plan: '', main: text, hasPlanStep: false };
  }
  const planParts: string[] = [];
  const mainParts: string[] = [];
  const leading = text.slice(0, markers[0].start).trim();
  if (leading) {
    mainParts.push(leading);
  }
  markers.forEach((marker, index) => {
    const sectionEnd = markers[index + 1]?.start ?? text.length;
    const section = text.slice(marker.end, sectionEnd).trim();
    if (!section) {
      return;
    }
    (marker.step <= 1 ? planParts : mainParts).push(section);
  });
  return {
    plan: planParts.join('\n\n'),
    main: mainParts.join('\n\n'),
    hasPlanStep: markers.some((marker) => marker.step <= 1),
  };
}

// Fixed output instruction for the Step 1 planning pass. It is appended in
// code so every prompt slot shares the exact same plan format.
export const planPassInstructionText = [
  'This is a planning pass only. The full prompt runs in the next step; do not write the story, dialogue, JSON, or any commands here.',
  'Plan what can plausibly happen next in this turn. Output nothing but a short bullet list:',
  '- Each bullet states one possible event, outcome of an attempted action, or development, in a single line.',
  '- End every bullet with its probability as (NN%), where NN is a number from 1 to 100.',
  '- 100% is practically certain, 50% is an even chance, low numbers are long shots.',
  '- Never list impossible options: anything with a 0% chance is simply left out. The minimum listed chance is 1%.',
  '- Cover the meaningful options, risks, and complications in roughly 3 to 6 bullets.',
].join('\n');

type PlanRollOutcome = 'great success' | 'success' | 'failure' | 'epic fail';

type PlanRoll = {
  chance: number;
  roll: number;
  outcome: PlanRollOutcome;
};

const planPercentPattern = /\(?[ \t]*([0-9]{1,3})[ \t]*%[ \t]*\)?/;

function planRollOutcome(chance: number, roll: number): PlanRollOutcome {
  // High rolls are good: the roll must beat (100 - chance). The distance to
  // that threshold decides how clearly the attempt succeeds or fails.
  const margin = roll - (100 - chance);
  if (margin >= 40) {
    return 'great success';
  }
  if (margin >= 1) {
    return 'success';
  }
  if (margin > -40) {
    return 'failure';
  }
  return 'epic fail';
}

// Replaces the trailing percentage of every plan bullet with an automatically
// diced outcome, e.g. "(80%)" -> "(80% chance, rolled 92: great success)".
export function rollPlanOutcomes(planText: string, random: () => number = Math.random) {
  const rolls: PlanRoll[] = [];
  const text = planText
    .split('\n')
    .map((line) => {
      const match = line.match(planPercentPattern);
      const chance = match ? Number(match[1]) : NaN;
      if (!match || !Number.isFinite(chance) || chance < 1 || chance > 100) {
        return line;
      }
      const roll = Math.min(100, Math.floor(random() * 100) + 1);
      const outcome = planRollOutcome(chance, roll);
      rolls.push({ chance, roll, outcome });
      return line.replace(
        planPercentPattern,
        `(${chance}% chance, rolled ${roll}: ${outcome})`,
      );
    })
    .join('\n');
  return { text, rolls };
}

// Wraps the rolled plan into the block that gets injected into the Step 2
// prompt (at every @plan:output token, or at the very top without one).
export function planContextBlock(rolledPlanText: string) {
  return [
    '[Step 1 planning result]',
    'A planning pass outlined what can happen in this turn and every point was diced automatically. The noted outcome of each point (success, failure, ...) is binding: write the scene so it plays out accordingly. Treat the outline as guidance for events, not as text to quote.',
    '',
    rolledPlanText.trim(),
    '[End of Step 1 planning result]',
  ].join('\n');
}

export function injectPlanOutput(text: string, block: string) {
  let injected = false;
  const result = text.replace(planOutputTokenPattern, () => {
    injected = true;
    return block;
  });
  return { text: result, injected };
}
