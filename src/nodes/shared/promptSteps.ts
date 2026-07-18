// Prompt-step markers split one prompt text into a planning prompt and the
// main prompt. A marker is a standalone line reading "@step:planning" or
// "@step:main" (case-insensitive). Text under "@step:planning" becomes the
// planning pass; text before the first marker or under "@step:main" stays the
// main prompt. Prompts without a "@step:planning" marker keep the classic
// single-pass behavior. Everything the planning LLM sees comes from the prompt
// text itself; the code only splits sections, dices the plan's percentages,
// and injects the rolled plan at the "@output:planning" token.

const promptStepMarkerPattern = /^[ \t]*@step:[ \t]*(planning|main)[ \t]*$/gim;

// Marks where the rolled plan is injected into the main prompt. Without this
// token the plan is prepended to the top of the main prompt.
export const planOutputTokenPattern = /@output:planning\b/gi;

type PromptStepSections = {
  plan: string;
  main: string;
  hasPlanStep: boolean;
};

export function splitPromptStepSections(text: string): PromptStepSections {
  const markers: Array<{ section: 'planning' | 'main'; start: number; end: number }> = [];
  text.replace(promptStepMarkerPattern, (raw, section: string, index: number) => {
    markers.push({
      section: section.toLocaleLowerCase() as 'planning' | 'main',
      start: index,
      end: index + raw.length,
    });
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
    (marker.section === 'planning' ? planParts : mainParts).push(section);
  });
  return {
    plan: planParts.join('\n\n'),
    main: mainParts.join('\n\n'),
    hasPlanStep: markers.some((marker) => marker.section === 'planning'),
  };
}

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

export function injectPlanOutput(text: string, planText: string) {
  let injected = false;
  const result = text.replace(planOutputTokenPattern, () => {
    injected = true;
    return planText;
  });
  return { text: result, injected };
}
