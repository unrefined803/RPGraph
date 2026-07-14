import {
  defaultRpStorybookCharacterComfyConfig,
  type RpStorybookV1,
  type RpStorybookV1Character,
} from '../rp-storybook-v1/model';

// Placeholders the renderer emits for empty fields (rp-storybook-v1/model.ts
// rpStorybookFormattedText). They must map back to "" so an unedited draft is a
// no-op rather than writing the placeholder text into the storybook.
const TITLE_PLACEHOLDER = 'Untitled RP Storybook';
const INTRODUCTION_PLACEHOLDER = 'No introduction defined.';
const SCENARIO_SUMMARY_PLACEHOLDER = 'No scenario summary defined.';
const NO_CHARACTERS_PLACEHOLDER = 'No characters defined.';

export type FormattedTextParseResult = {
  storybook: RpStorybookV1;
  warnings: string[];
};

type Section = { heading: string; lines: string[] };

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function joinTrim(lines: string[]): string {
  return lines.join('\n').trim();
}

function stripPlaceholder(value: string, placeholder: string): string {
  return value.trim() === placeholder ? '' : value;
}

/** A labeled line like "Role: Knight" → { label: 'Role', value: 'Knight' }. */
function labeledLine(line: string): { label: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z ]*?):\s?(.*)$/.exec(line);
  return match ? { label: match[1].trim(), value: match[2] } : null;
}

/**
 * Groups the document into a title line plus `## `-delimited sections. Lines
 * before the first `## ` heading (other than the `# ` title) are ignored.
 */
function groupDocument(lines: string[]): { title: string | undefined; sections: Section[] } {
  let title: string | undefined;
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const headingTwo = /^##\s+(.*)$/.exec(line);
    if (headingTwo) {
      current = { heading: headingTwo[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    const headingOne = /^#\s+(.*)$/.exec(line);
    if (headingOne) {
      // The first `# ` line is the title; later ones just close the current
      // section without starting a recognized one.
      if (title === undefined) {
        title = headingOne[1].trim();
      }
      current = null;
      continue;
    }
    current?.lines.push(line);
  }
  return { title, sections };
}

function findSection(sections: Section[], heading: string): Section | undefined {
  return sections.find((section) => section.heading.toLowerCase() === heading.toLowerCase());
}

type ScenarioFields = {
  summary: string | undefined;
  openingSituation: string | undefined;
  currentSituation: string | undefined;
};

function parseScenarioSection(lines: string[]): ScenarioFields {
  const summaryLines: string[] = [];
  let opening: string[] | undefined;
  let current: string[] | undefined;
  let target: 'summary' | 'opening' | 'current' = 'summary';
  for (const line of lines) {
    const labeled = labeledLine(line);
    if (labeled?.label === 'Opening Situation') {
      opening = [labeled.value];
      target = 'opening';
      continue;
    }
    if (labeled?.label === 'Current Situation') {
      current = [labeled.value];
      target = 'current';
      continue;
    }
    if (target === 'summary') {
      summaryLines.push(line);
    } else if (target === 'opening') {
      opening?.push(line);
    } else {
      current?.push(line);
    }
  }
  return {
    summary: stripPlaceholder(joinTrim(summaryLines), SCENARIO_SUMMARY_PLACEHOLDER),
    // Absent label preserves the current value (undefined = "not present").
    openingSituation: opening ? joinTrim(opening) : undefined,
    currentSituation: current ? joinTrim(current) : undefined,
  };
}

type CharacterBlock = {
  name: string;
  role?: string;
  description?: string;
  personality?: string;
  speechStyle?: string;
  appearance?: string;
};

// Character prose labels the editor round-trips. "Character Images:" ends a
// block's editable fields (image captions are read-only context).
const characterFieldByLabel: Record<string, keyof Omit<CharacterBlock, 'name'>> = {
  Role: 'role',
  Description: 'description',
  Personality: 'personality',
  'Speech Style': 'speechStyle',
  Appearance: 'appearance',
};

function parseCharacterSection(lines: string[]): CharacterBlock[] {
  if (joinTrim(lines) === NO_CHARACTERS_PLACEHOLDER) {
    return [];
  }
  const blocks: CharacterBlock[] = [];
  let currentBlock: CharacterBlock | null = null;
  let currentField: keyof Omit<CharacterBlock, 'name'> | null = null;
  let ignoringRest = false;
  for (const line of lines) {
    const labeled = labeledLine(line);
    if (labeled?.label === 'Charakter') {
      currentBlock = { name: labeled.value.trim() };
      blocks.push(currentBlock);
      currentField = null;
      ignoringRest = false;
      continue;
    }
    if (!currentBlock || ignoringRest) {
      continue;
    }
    if (labeled?.label === 'Character Images') {
      // Read-only context: ignore this and the remaining image lines.
      currentField = null;
      ignoringRest = true;
      continue;
    }
    if (labeled && labeled.label in characterFieldByLabel) {
      currentField = characterFieldByLabel[labeled.label];
      currentBlock[currentField] = labeled.value;
      continue;
    }
    if (currentField) {
      currentBlock[currentField] = `${currentBlock[currentField] ?? ''}\n${line}`;
    }
  }
  // Trim the accumulated multi-line field values.
  return blocks.map((block) => {
    const trimmed: CharacterBlock = { name: block.name };
    for (const key of ['role', 'description', 'personality', 'speechStyle', 'appearance'] as const) {
      if (block[key] !== undefined) {
        trimmed[key] = block[key]!.trim();
      }
    }
    return trimmed;
  });
}

function mergeCharacter(character: RpStorybookV1Character, block: CharacterBlock): RpStorybookV1Character {
  const next: RpStorybookV1Character = { ...character };
  if (block.role !== undefined) {
    next.role = block.role;
  }
  if (block.description !== undefined) {
    next.description = block.description;
  }
  if (block.personality !== undefined) {
    next.personality = block.personality;
  }
  if (block.speechStyle !== undefined) {
    next.speechStyle = block.speechStyle;
  }
  if (block.appearance !== undefined) {
    next.comfyConfig = {
      ...(character.comfyConfig ?? defaultRpStorybookCharacterComfyConfig()),
      appearance: block.appearance,
    };
  }
  return next;
}

/**
 * Parses the editor's Formatted Text draft and merges the recognized authoring
 * prose into a clone of `current`. Non-destructive: it never adds, removes,
 * reorders, renames, or re-identifies characters, and every field the formatted
 * view does not represent is preserved. Character blocks match existing
 * characters by name (case-insensitive), then by order; unmatched blocks are
 * reported as warnings. Opening History and Character Images are ignored.
 */
export function parseRpStorybookFormattedText(
  current: RpStorybookV1,
  text: string,
): FormattedTextParseResult {
  const warnings: string[] = [];
  const next = structuredClone(current);
  const { title, sections } = groupDocument(splitLines(text));

  if (title !== undefined) {
    next.title = stripPlaceholder(title, TITLE_PLACEHOLDER);
  }

  const introductionSection = findSection(sections, 'Introduction');
  if (introductionSection) {
    next.introduction = stripPlaceholder(joinTrim(introductionSection.lines), INTRODUCTION_PLACEHOLDER);
  }

  const scenarioSection = findSection(sections, 'Scenario');
  if (scenarioSection) {
    const scenario = parseScenarioSection(scenarioSection.lines);
    if (scenario.summary !== undefined) {
      next.scenario.summary = scenario.summary;
    }
    if (scenario.openingSituation !== undefined) {
      next.scenario.openingSituation = scenario.openingSituation;
    }
    if (scenario.currentSituation !== undefined) {
      next.scenario.currentSituation = scenario.currentSituation;
    }
  }

  const characterSection = findSection(sections, 'Charakter');
  if (characterSection) {
    const blocks = parseCharacterSection(characterSection.lines);
    const usedIndices = new Set<number>();
    blocks.forEach((block, blockIndex) => {
      let matchIndex = next.characters.findIndex(
        (character, index) =>
          !usedIndices.has(index) &&
          !!block.name &&
          (character.name || character.id).toLowerCase() === block.name.toLowerCase(),
      );
      if (matchIndex < 0) {
        matchIndex = !usedIndices.has(blockIndex) && blockIndex < next.characters.length ? blockIndex : -1;
      }
      if (matchIndex < 0) {
        warnings.push(`Character block "${block.name || `#${blockIndex + 1}`}" did not match an existing character and was skipped.`);
        return;
      }
      usedIndices.add(matchIndex);
      next.characters[matchIndex] = mergeCharacter(next.characters[matchIndex], block);
    });
  }

  return { storybook: next, warnings };
}
