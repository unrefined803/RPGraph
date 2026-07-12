import {
  currentRpStorybookVersion,
  normalizeRpStorybookV1,
  rpStorybookVersionStatus,
  type RpStorybookV1,
} from '../nodes/rp-storybook-v1/model';

type StorybookConversionRowState = 'mapped' | 'defaulted';

type StorybookConversionRow = {
  id: string;
  label: string;
  state: StorybookConversionRowState;
  message: string;
};

export type StorybookConversionResult = {
  sourceVersion: string;
  targetVersion: string;
  storybook: RpStorybookV1;
  rows: StorybookConversionRow[];
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isLegacyRpStorybookValue(value: unknown) {
  const storybook = recordValue(value);
  return (
    storybook.format === 'rpgraph-storybook' &&
    rpStorybookVersionStatus(storybook.version) === 'legacy'
  );
}

function characterRow(
  sourceCharacter: Record<string, unknown>,
  name: string,
  imageCount: number,
): StorybookConversionRow {
  const newSections: string[] = [];
  if (!('banking' in sourceCharacter)) newSections.push('banking');
  if (!('social' in sourceCharacter)) newSections.push('social usernames');
  if (!('voiceConfig' in sourceCharacter)) newSections.push('voice sample');
  if (!('phoneSettings' in sourceCharacter)) newSections.push('phone settings');
  if (!('comfyConfig' in sourceCharacter)) newSections.push('image generation config');
  const imagesNote = imageCount
    ? `${imageCount} image${imageCount === 1 ? '' : 's'} kept unchanged.`
    : 'No images.';
  if (newSections.length === 0) {
    return {
      id: `character:${name}`,
      label: `Character: ${name}`,
      state: 'mapped',
      message: `All fields carried over. ${imagesNote}`,
    };
  }
  return {
    id: `character:${name}`,
    label: `Character: ${name}`,
    state: 'defaulted',
    message: `New in this format, filled with defaults: ${newSections.join(', ')}. ${imagesNote}`,
  };
}

/**
 * Deterministic legacy conversion: the tolerant normalizer performs the actual
 * mapping; this wraps it with a per-section report for the conversion dialog.
 * Images and voice samples pass through byte-identical and never touch an LLM.
 */
export function convertLegacyRpStorybook(value: unknown): StorybookConversionResult {
  const source = recordValue(value);
  const storybook = normalizeRpStorybookV1(source);
  const rows: StorybookConversionRow[] = [];

  rows.push({
    id: 'title',
    label: 'Title & Introduction',
    state: hasText(source.title) || hasText(source.introduction) ? 'mapped' : 'defaulted',
    message: hasText(source.title) || hasText(source.introduction)
      ? 'Carried over unchanged.'
      : 'Not present in the old file; left empty.',
  });

  const sourceScenario = recordValue(source.scenario);
  const scenarioFields = (['summary', 'openingSituation', 'currentSituation'] as const)
    .filter((field) => hasText(sourceScenario[field]));
  rows.push({
    id: 'scenario',
    label: 'Scenario',
    state: scenarioFields.length ? 'mapped' : 'defaulted',
    message: scenarioFields.length
      ? `Carried over: ${scenarioFields.join(', ')}.`
      : 'Not present in the old file; left empty.',
  });

  const sourceCharacters = arrayValue(source.characters).map(recordValue);
  storybook.characters.forEach((character, index) => {
    rows.push(characterRow(
      sourceCharacters[index] ?? {},
      character.name || character.id,
      character.images.length,
    ));
  });
  if (storybook.characters.length === 0) {
    rows.push({
      id: 'characters',
      label: 'Characters',
      state: 'defaulted',
      message: 'No characters found in the old file.',
    });
  }

  const sourceBlocked = arrayValue(recordValue(source.phoneContacts).blocked);
  const droppedBlocked = sourceBlocked.length - storybook.phoneContacts.blocked.length;
  rows.push({
    id: 'phone-contacts',
    label: 'Phone Contacts',
    state: droppedBlocked > 0 ? 'defaulted' : 'mapped',
    message: droppedBlocked > 0
      ? `${storybook.phoneContacts.blocked.length} blocked pairs kept, ${droppedBlocked} dropped (unknown characters).`
      : storybook.phoneContacts.blocked.length
        ? `${storybook.phoneContacts.blocked.length} blocked contact pairs carried over.`
        : 'No blocked contact pairs.',
  });

  const sourceOpening = recordValue(source.openingHistory);
  const sourceTurns = arrayValue(sourceOpening.turns).length;
  const sourceCheckpoints = arrayValue(sourceOpening.checkpoints).length;
  const sourceEvents = arrayValue(sourceOpening.events).length;
  const { turns, checkpoints, events } = storybook.openingHistory;
  const droppedParts = [
    sourceTurns - turns.length > 0 ? `${sourceTurns - turns.length} turns` : '',
    sourceCheckpoints - checkpoints.length > 0
      ? `${sourceCheckpoints - checkpoints.length} checkpoints`
      : '',
    sourceEvents - events.length > 0 ? `${sourceEvents - events.length} events` : '',
  ].filter(Boolean);
  const openingSummaryParts = [
    turns.length ? `${turns.length} turns` : '',
    events.length ? `${events.length} events` : '',
    checkpoints.length ? `${checkpoints.length} checkpoints` : '',
  ].filter(Boolean);
  rows.push({
    id: 'opening-history',
    label: 'Opening History',
    state: droppedParts.length ? 'defaulted' : 'mapped',
    message: droppedParts.length
      ? `Carried over ${openingSummaryParts.join(', ') || 'nothing'}; dropped unreadable entries: ${droppedParts.join(', ')}.`
      : openingSummaryParts.length
        ? `Carried over ${openingSummaryParts.join(', ')}.`
        : 'No opening history in the old file.',
  });

  const countRecords = (records: Record<string, unknown[]>) =>
    Object.values(records).reduce((count, entries) => count + entries.length, 0);
  const phoneAppParts = [
    countRecords(storybook.openingHistory.notes) ? `${countRecords(storybook.openingHistory.notes)} phone notes` : '',
    countRecords(storybook.openingHistory.chatGpdChats)
      ? `${countRecords(storybook.openingHistory.chatGpdChats)} ChatGPD chats`
      : '',
    countRecords(storybook.openingHistory.socialLikes)
      ? `${countRecords(storybook.openingHistory.socialLikes)} social likes`
      : '',
  ].filter(Boolean);
  rows.push({
    id: 'phone-app-data',
    label: 'Phone App Data',
    state: 'mapped',
    message: phoneAppParts.length
      ? `Carried over ${phoneAppParts.join(', ')}.`
      : 'No phone app data in the old file.',
  });

  return {
    sourceVersion: typeof source.version === 'string' ? source.version : 'Unknown',
    targetVersion: currentRpStorybookVersion,
    storybook,
    rows,
  };
}
