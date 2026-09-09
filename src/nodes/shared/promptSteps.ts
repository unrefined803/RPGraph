// Prompt-step markers split one prompt text into a chain of named passes. A
// marker is a standalone line reading "@step:<name>" (case-insensitive,
// letters/digits/_/- in the name). Steps run in the order their names first
// appear; the last step is the output step whose reply becomes the visible
// result, every earlier step is an intermediate pass. Text before the first
// marker belongs to the output step, so prompts without markers keep the
// classic single-pass behavior. Everything an intermediate LLM pass sees comes
// from the prompt text itself; the code only splits sections, dices
// "(chance: NN%)" markers in intermediate outputs, and injects each step's
// output into later steps at its "@output:<name>" token.

export const promptStepMarkerPattern = /^[ \t]*@step:[ \t]*([A-Za-z0-9_-]+)[ \t]*$/gim;

// Marks where an earlier step's output is injected into a later step. A step
// output that no later step references is not inserted into another prompt.
export const stepOutputTokenPattern = /@output:([A-Za-z0-9_-]+)\b/gi;

type PromptTextSections = {
  leading: string;
  sections: Array<{ name: string; text: string }>;
};

function splitPromptTextSections(text: string): PromptTextSections {
  const markers: Array<{ name: string; start: number; end: number }> = [];
  text.replace(promptStepMarkerPattern, (raw, name: string, index: number) => {
    markers.push({
      name: name.toLocaleLowerCase(),
      start: index,
      end: index + raw.length,
    });
    return raw;
  });
  if (!markers.length) {
    return { leading: text.trim(), sections: [] };
  }
  const sections: Array<{ name: string; text: string }> = [];
  markers.forEach((marker, index) => {
    const sectionEnd = markers[index + 1]?.start ?? text.length;
    const section = text.slice(marker.end, sectionEnd).trim();
    if (section) {
      sections.push({ name: marker.name, text: section });
    }
  });
  return { leading: text.slice(0, markers[0].start).trim(), sections };
}

export type PromptStep = {
  name: string;
  before: string;
  after: string;
};

// Builds the ordered step chain from the two prompt fields. Same-named
// sections concatenate; leading text of either field stays with the output
// (last) step, matching the classic behavior of text without markers.
export function buildPromptStepChain(beforeText: string, afterText: string): PromptStep[] {
  const before = splitPromptTextSections(beforeText);
  const after = splitPromptTextSections(afterText);
  const names: string[] = [];
  for (const section of [...before.sections, ...after.sections]) {
    if (!names.includes(section.name)) {
      names.push(section.name);
    }
  }
  const sectionText = (sections: PromptTextSections['sections'], name: string) =>
    sections
      .filter((section) => section.name === name)
      .map((section) => section.text)
      .join('\n\n');
  const steps = names.map((name) => ({
    name,
    before: sectionText(before.sections, name),
    after: sectionText(after.sections, name),
  }));
  if (!steps.length) {
    return [{ name: '', before: before.leading, after: after.leading }];
  }
  const outputStep = steps[steps.length - 1];
  outputStep.before = [before.leading, outputStep.before].filter(Boolean).join('\n\n');
  outputStep.after = [after.leading, outputStep.after].filter(Boolean).join('\n\n');
  return steps;
}

type PlanRollOutcome = 'great success' | 'success' | 'failure' | 'epic fail';

type PlanRoll = {
  chance: number;
  roll: number;
  outcome: PlanRollOutcome;
};

type PlanProbabilityMarker = {
  pattern: RegExp;
  successChance: number;
};

const labeledPlanPercentPattern = /\(?\s*(chance|success|failure|fail)\s*:\s*([0-9]{1,3})\s*%\s*\)?/i;
const parenthesizedPlanPercentPattern = /\(\s*([0-9]{1,3})\s*%\s*\)/i;
const barePlanPercentPattern = /([0-9]{1,3})\s*%/i;

function planProbabilityMarker(line: string): PlanProbabilityMarker | undefined {
  const labeled = line.match(labeledPlanPercentPattern);
  if (labeled) {
    const probability = Number(labeled[2]);
    if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
      return undefined;
    }
    const label = labeled[1].toLocaleLowerCase();
    return {
      pattern: labeledPlanPercentPattern,
      successChance: label === 'failure' || label === 'fail' ? 100 - probability : probability,
    };
  }

  const parenthesized = line.match(parenthesizedPlanPercentPattern);
  if (parenthesized) {
    const probability = Number(parenthesized[1]);
    if (Number.isFinite(probability) && probability >= 0 && probability <= 100) {
      return { pattern: parenthesizedPlanPercentPattern, successChance: probability };
    }
  }

  // An unlabelled, unparenthesized percentage is ambiguous (battery level,
  // price discount, progress, ...). Treat it as a probability only when the
  // line explicitly supplies the alternative outcome.
  if (/\botherwise\s*:/i.test(line)) {
    const bare = line.match(barePlanPercentPattern);
    const probability = bare ? Number(bare[1]) : NaN;
    if (Number.isFinite(probability) && probability >= 0 && probability <= 100) {
      return { pattern: barePlanPercentPattern, successChance: probability };
    }
  }
  return undefined;
}

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

// Plan bullets are either/or rolls: they state what happens on success and an
// "otherwise: ..." part for failure. The replacement tells the next pass which
// branch happened; the raw roll number stays internal.
const planRollOutcomeTexts: Record<PlanRollOutcome, string> = {
  'great success': 'CLEAR SUCCESS, this happens decisively; skip any otherwise-part',
  success: 'SUCCESS, this happens; skip any otherwise-part',
  failure: 'FAILED, this does not happen; the otherwise-part happens instead',
  'epic fail': 'BADLY FAILED, this goes thoroughly wrong; the otherwise-part happens emphatically',
};

// Replaces the chance marker of every uncertain plan bullet with an
// automatically diced outcome, e.g. "(chance: 80%)" -> "(chance: 80%: SUCCESS,
// this happens; ...)". "success:" is equivalent to "chance:", while a
// "failure:" probability is inverted. Parenthesized percentages and bare
// percentages paired with an otherwise-branch are accepted as fallbacks;
// unrelated bare percentages (dates, prices, battery levels) stay untouched.
export function rollPlanOutcomes(planText: string, random: () => number = Math.random) {
  const rolls: PlanRoll[] = [];
  const text = planText
    .split('\n')
    .map((line) => {
      const marker = planProbabilityMarker(line);
      if (!marker) {
        return line;
      }
      const chance = marker.successChance;
      const roll = Math.min(100, Math.floor(random() * 100) + 1);
      const outcome = planRollOutcome(chance, roll);
      rolls.push({ chance, roll, outcome });
      return line.replace(
        marker.pattern,
        `(chance: ${chance}%: ${planRollOutcomeTexts[outcome]})`,
      );
    })
    .join('\n');
  return { text, rolls };
}

export function stepOutputTokenNames(text: string) {
  const names: string[] = [];
  text.replace(stepOutputTokenPattern, (raw, name: string) => {
    const normalized = name.toLocaleLowerCase();
    if (!names.includes(normalized)) {
      names.push(normalized);
    }
    return raw;
  });
  return names;
}

export function injectStepOutput(text: string, stepName: string, outputText: string) {
  let injected = false;
  // A word boundary is not enough here: step names may contain "-", so
  // "@output:draft" must not match inside "@output:draft-2".
  const tokenPattern = new RegExp(`@output:${stepName}(?![A-Za-z0-9_-])`, 'gi');
  const result = text.replace(tokenPattern, () => {
    injected = true;
    return outputText;
  });
  return { text: result, injected };
}
