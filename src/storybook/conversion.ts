import {
  currentRpStorybookVersion,
  normalizeRpStorybookV1,
  rpStorybookVersionStatus,
  type RpStorybookV1,
} from '../nodes/rp-storybook-v1/model';

type StorybookConversionRowState = 'mapped' | 'defaulted' | 'suggested';
type StorybookConversionReviewState = 'pending' | 'accepted' | 'resolved';

type StorybookConversionRow = {
  id: string;
  label: string;
  state: StorybookConversionRowState;
  reviewState: StorybookConversionReviewState;
  message: string;
  allowedPatchPaths: string[];
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

function characterRows(
  sourceCharacter: Record<string, unknown>,
  characterIndex: number,
  name: string,
  imageCount: number,
): StorybookConversionRow[] {
  const basePath = `/characters/${characterIndex}`;
  const imagesNote = imageCount
    ? `${imageCount} image${imageCount === 1 ? '' : 's'} kept unchanged.`
    : 'No images.';
  const rows: StorybookConversionRow[] = [{
    id: `character:${characterIndex}:identity`,
    label: `Character: ${name}`,
    state: 'mapped',
    reviewState: 'resolved',
    message: `Identity and story fields carried over. ${imagesNote}`,
    allowedPatchPaths: [],
  }];
  const optionalSections: Array<{
    key: 'banking' | 'social' | 'voiceConfig' | 'phoneSettings' | 'comfyConfig';
    label: string;
    aiFillable?: boolean;
  }> = [
    {
      key: 'banking',
      label: 'Banking',
      aiFillable: true,
    },
    {
      key: 'social',
      label: 'Social Accounts',
      aiFillable: true,
    },
    { key: 'voiceConfig', label: 'Voice Sample' },
    { key: 'phoneSettings', label: 'Phone Settings' },
    {
      key: 'comfyConfig',
      label: 'Image Generation Settings',
      aiFillable: true,
    },
  ];
  optionalSections.forEach((section) => {
    const wasPresent = section.key in sourceCharacter;
    rows.push({
      id: `character:${characterIndex}:${section.key}`,
      label: `${name}: ${section.label}`,
      state: wasPresent ? 'mapped' : 'defaulted',
      reviewState: wasPresent ? 'resolved' : 'pending',
      message: wasPresent ? 'Carried over.' : 'Not present in the old format; filled with defaults.',
      allowedPatchPaths: section.aiFillable ? [`${basePath}/${section.key}`] : [],
    });
  });
  return rows;
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
    reviewState: hasText(source.title) || hasText(source.introduction) ? 'resolved' : 'pending',
    message: hasText(source.title) || hasText(source.introduction)
      ? 'Carried over unchanged.'
      : 'Not present in the old file; left empty.',
    allowedPatchPaths: ['/title', '/introduction'],
  });

  const sourceScenario = recordValue(source.scenario);
  const scenarioFields = (['summary', 'openingSituation', 'currentSituation'] as const)
    .filter((field) => hasText(sourceScenario[field]));
  rows.push({
    id: 'scenario',
    label: 'Scenario',
    state: scenarioFields.length ? 'mapped' : 'defaulted',
    reviewState: scenarioFields.length ? 'resolved' : 'pending',
    message: scenarioFields.length
      ? `Carried over: ${scenarioFields.join(', ')}.`
      : 'Not present in the old file; left empty.',
    allowedPatchPaths: ['/scenario'],
  });

  const sourceCharacters = arrayValue(source.characters).map(recordValue);
  storybook.characters.forEach((character, index) => {
    rows.push(...characterRows(
      sourceCharacters[index] ?? {},
      index,
      character.name || character.id,
      character.images.length,
    ));
  });
  if (storybook.characters.length === 0) {
    rows.push({
      id: 'characters',
      label: 'Characters',
      state: 'defaulted',
      reviewState: 'pending',
      message: 'No characters found in the old file.',
      allowedPatchPaths: ['/characters'],
    });
  }

  const sourceBlocked = arrayValue(recordValue(source.phoneContacts).blocked);
  const droppedBlocked = sourceBlocked.length - storybook.phoneContacts.blocked.length;
  rows.push({
    id: 'phone-contacts',
    label: 'Phone + Fotogram Contacts',
    state: droppedBlocked > 0 ? 'defaulted' : 'mapped',
    reviewState: droppedBlocked > 0 ? 'pending' : 'resolved',
    message: droppedBlocked > 0
      ? `${storybook.phoneContacts.blocked.length} hidden pairs kept, ${droppedBlocked} dropped (unknown characters).`
      : storybook.phoneContacts.blocked.length
        ? `${storybook.phoneContacts.blocked.length} hidden contact pairs carried over.`
        : 'No hidden contact pairs.',
    allowedPatchPaths: [],
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
    reviewState: droppedParts.length ? 'pending' : 'resolved',
    message: droppedParts.length
      ? `Carried over ${openingSummaryParts.join(', ') || 'nothing'}; dropped unreadable entries: ${droppedParts.join(', ')}.`
      : openingSummaryParts.length
        ? `Carried over ${openingSummaryParts.join(', ')}.`
        : 'No opening history in the old file.',
    allowedPatchPaths: [],
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
    reviewState: 'resolved',
    message: phoneAppParts.length
      ? `Carried over ${phoneAppParts.join(', ')}.`
      : 'No phone app data in the old file.',
    allowedPatchPaths: [],
  });

  return {
    sourceVersion: typeof source.version === 'string' ? source.version : 'Unknown',
    targetVersion: currentRpStorybookVersion,
    storybook,
    rows,
  };
}
