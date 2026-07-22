import type {
  RpStorybookAssistantResult,
  RpStorybook,
  RpStorybookCharacter,
} from '../nodes/rp-storybook/model';

export type SillyTavernImportValidation = {
  characterName: string;
  action: 'added' | 'updated';
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function cardData(value: unknown) {
  const root = recordValue(value);
  const data = recordValue(root.data);
  return textValue(data.name) ? data : root;
}

function matchingCharacter(storybook: RpStorybook, name: string) {
  return storybook.characters.find(
    (character) => character.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
  );
}

function sillyTavernCardName(value: unknown) {
  const name = textValue(cardData(value).name);
  if (!name) {
    throw new Error('The selected SillyTavern card does not contain a character name.');
  }
  return name;
}

function storybookScenarioIsEmpty(storybook: RpStorybook) {
  return !storybook.scenario.summary.trim() &&
    !storybook.scenario.openingSituation.trim() &&
    !storybook.scenario.currentSituation.trim();
}

/** Builds the field-by-field AI conversion request for SillyTavern V1/V2 cards. */
export function sillyTavernImportInstruction(
  storybook: RpStorybook,
  value: unknown,
  fileName: string,
) {
  const name = sillyTavernCardName(value);
  const existing = matchingCharacter(storybook, name);
  const allowScenario = storybookScenarioIsEmpty(storybook);
  const importedJson = JSON.stringify(value, null, 2);
  return [
    `Convert the SillyTavern character card from "${fileName}" into the current RPGraph Storybook.`,
    `The imported character name is "${name}". Keep that proper name unchanged.`,
    existing
      ? `Update the existing character "${existing.name}" in place. Keep its id, images, profileImage, voiceConfig, and app-only settings.`
      : 'Add exactly one complete new character object at /characters/-. Do not replace the characters array or alter existing characters.',
    'Rewrite and organize the card information for RPGraph; do not paste the entire card, creator notes, examples, or scenario into description.',
    'Map factual biography, appearance, background, relationships, occupation, and relevant history into a concise but complete description.',
    'Map stable traits, temperament, preferences, motivations, and behavior into personality.',
    'Infer speechStyle from dialogue examples, wording, tone, accent, vocabulary, and mannerisms. Summarize the style instead of copying example conversations.',
    'Use role for the character\'s concise function in the story.',
    'Populate comfyConfig.appearance with a concise visual description when the card provides physical details. Never invent loraName or loraUrl.',
    'Populate banking.startBalance with a plausible US-dollar amount supported by the character\'s circumstances. Include exactly one realistic mobile plan in banking.fixedExpenses.',
    'Create a fitting lowercase Fotogram handle in social.fotogramUsername. Keep social.onlyfriendsUsername empty unless the card explicitly establishes such an account.',
    'Do not create phoneSettings, voiceConfig, profileImage, images, or image data that the source card does not actually contain. New characters use an empty images array.',
    allowScenario
      ? 'The current Storybook scenario is completely empty. You may also map the card scenario into scenario.summary and its first message or greeting into scenario.openingSituation.'
      : 'The current Storybook already has scenario content. Do not patch title, introduction, scenario, phoneContacts, openingHistory, or any non-character field.',
    'Return a non-empty RFC 6902 patch that actually adds or updates the character. In reply, summarize which RPGraph character fields were filled.',
    '',
    `SillyTavern card JSON:\n${importedJson}`,
  ].join('\n');
}

function characterChanged(
  before: RpStorybookCharacter | undefined,
  after: RpStorybookCharacter,
) {
  return !before || JSON.stringify(before) !== JSON.stringify(after);
}

/** Rejects false-positive model replies and patches outside the import's allowed scope. */
export function validateSillyTavernImportResult(
  currentStorybook: RpStorybook,
  result: RpStorybookAssistantResult,
  sourceValue: unknown,
): SillyTavernImportValidation {
  const characterName = sillyTavernCardName(sourceValue);
  const before = matchingCharacter(currentStorybook, characterName);
  const after = matchingCharacter(result.storybook, characterName);
  const allowScenario = storybookScenarioIsEmpty(currentStorybook);
  const disallowedPath = result.patchPaths.find((path) =>
    !path.startsWith('/characters/') && !(allowScenario && path.startsWith('/scenario/'))
  );
  if (disallowedPath) {
    throw new Error(`The model tried to change a field outside the character import: ${disallowedPath}`);
  }
  if (!after || !characterChanged(before, after)) {
    throw new Error('The model did not add or update the SillyTavern character. No changes were saved.');
  }
  if (!before && result.storybook.characters.length !== currentStorybook.characters.length + 1) {
    throw new Error('The model did not add exactly one SillyTavern character. No changes were saved.');
  }
  return { characterName, action: before ? 'updated' : 'added' };
}
