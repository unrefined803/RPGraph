import { decode, encode } from '@toon-format/toon';

import { fastTaskReasoningStart, fastTaskReasoningEnd } from '../../llm/fastTaskPrompt';
import type { NodeLlmApi } from '../../llm/NodeLlmApi';
import type {
  MessageRecord,
  CharacterStatDefinition,
  CharacterStatsChanges,
  CharacterStatsState,
  WorkflowNode,
  WorkflowNodeData,
} from '../../types';
import {
  characterStatDefinitions,
  characterStatsMaxChange,
  characterStatsStateText,
  normalizeCharacterStatsState,
} from '../../workflow';
import { storyCharacterRefsFromNodes } from '../../storybook/runtime';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stripToonFence(text: string) {
  const trimmed = text.trim();
  const embeddedFence = trimmed.match(/```(?:toon)?\s*([\s\S]*?)\s*```/i);
  if (embeddedFence) {
    return embeddedFence[1].trim();
  }
  const fenced = trimmed.match(/^```(?:toon)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseStatsResponse(text: string) {
  let decoded: unknown;
  try {
    decoded = decode(stripToonFence(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`Character Stats Tracker returned invalid TOON: ${message}`);
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
  if (!isRecord(decoded)) {
    throw new Error('Character Stats Tracker did not return TOON.');
  }
  return decoded;
}

function clampScore(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function parseLocalRpDateTime(value?: string) {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function latestHistoryRpDateTime(messages: MessageRecord[]) {
  return [...messages]
    .reverse()
    .find((message) =>
      message.includeInHistory !== false &&
      (message.role === 'user' || message.role === 'output') &&
      !!parseLocalRpDateTime(message.rpDateTime),
    )?.rpDateTime;
}

function latestHistoryTurnNumber(messages: MessageRecord[]) {
  return [...messages]
    .reverse()
    .find((message) =>
      message.includeInHistory !== false &&
      (message.role === 'user' || message.role === 'output') &&
      message.turnNumber !== undefined,
    )?.turnNumber;
}

function elapsedRpHours(previous?: string, current?: string) {
  const previousDate = parseLocalRpDateTime(previous);
  const currentDate = parseLocalRpDateTime(current);
  if (!previousDate || !currentDate) {
    return undefined;
  }
  return Math.max(0, (currentDate.getTime() - previousDate.getTime()) / 3_600_000);
}

function formatElapsedHours(hours: number) {
  return `${Math.round(hours * 10) / 10}h`;
}

function relaxedScore(current: number, baseline: number, elapsedHoursValue: number) {
  const factor = Math.min(1, Math.max(0, elapsedHoursValue / 10));
  return clampScore(current + (baseline - current) * factor);
}

function applyLinearBaselineRelaxation(
  state: CharacterStatsState,
  baselineState: CharacterStatsState,
  changes: CharacterStatsChanges,
  stats: CharacterStatDefinition[],
  elapsedHoursValue: number,
) {
  if (elapsedHoursValue <= 0) {
    return;
  }
  Object.entries(state.characters).forEach(([characterId, characterStats]) => {
    stats.forEach((stat) => {
      const current = characterStats[stat.id] ?? 50;
      const baseline = baselineState.characters[characterId]?.[stat.id] ?? current;
      const relaxed = relaxedScore(current, baseline, elapsedHoursValue);
      const delta = relaxed - current;
      if (delta !== 0) {
        characterStats[stat.id] = relaxed;
        changes.characters[characterId][stat.id] = (changes.characters[characterId][stat.id] ?? 0) + delta;
      }
    });
  });
}

function parseScore(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampScore(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/^\+/, '').trim());
    return Number.isFinite(parsed) ? clampScore(parsed) : undefined;
  }
  return undefined;
}

function parseDelta(value: unknown, maxChange: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(maxChange, Math.max(-maxChange, Math.round(value)));
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/^\+/, '').trim());
    return Number.isFinite(parsed)
      ? Math.min(maxChange, Math.max(-maxChange, Math.round(parsed)))
      : undefined;
  }
  return undefined;
}

function enabledStats(definitions: CharacterStatDefinition[]) {
  return definitions.filter((definition) => definition.enabled);
}

function hasCharacterStatsChanges(changes: CharacterStatsChanges) {
  return Object.values(changes.characters).some((stats) => Object.keys(stats).length > 0);
}

function statMaps(definitions: CharacterStatDefinition[]) {
  const byReference = new Map<string, CharacterStatDefinition>();
  definitions.forEach((definition) => {
    byReference.set(definition.id.toLocaleLowerCase(), definition);
    byReference.set(definition.name.toLocaleLowerCase(), definition);
  });
  return byReference;
}

function statValueShape(stats: CharacterStatDefinition[], label: string) {
  return Object.fromEntries(stats.map((stat) => [stat.name, label]));
}

function allStatsAreDefault50(
  state: CharacterStatsState,
  characterId: string,
  stats: CharacterStatDefinition[],
  initializedKeys: Set<string>,
) {
  return stats.every((stat) =>
    initializedKeys.has(`${characterId}:${stat.id}`) &&
    (state.characters[characterId]?.[stat.id] ?? 50) === 50,
  );
}

function hasNonDefaultCurrent(
  state: CharacterStatsState,
  characterId: string,
  stats: CharacterStatDefinition[],
) {
  return stats.some((stat) => (state.characters[characterId]?.[stat.id] ?? 50) !== 50);
}

export async function executeCharacterStatsNode({
  node,
  initialContext,
  lastMessage,
  nodes,
  historyMessages,
  llm,
  updateRuntimeNode,
}: {
  node: WorkflowNode;
  initialContext: string;
  lastMessage: string;
  nodes: WorkflowNode[];
  historyMessages: MessageRecord[];
  llm: NodeLlmApi;
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
}) {
  const characters = storyCharacterRefsFromNodes(nodes);
  if (characters.length === 0) {
    throw new Error('Character Stats Tracker needs at least one named Storybook character.');
  }
  const labelCounts = new Map<string, number>();
  characters.forEach((character) => {
    const key = character.label.toLocaleLowerCase();
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  });
  const characterReferences = characters.map((character) => ({
    nodeId: character.nodeId,
    name: character.label,
    reference:
      labelCounts.get(character.label.toLocaleLowerCase()) === 1
        ? character.label
        : character.nodeId,
  }));
  const referenceIds = new Map<string, string>();
  characterReferences.forEach((character) => {
    referenceIds.set(character.nodeId, character.nodeId);
    referenceIds.set(character.reference.toLocaleLowerCase(), character.nodeId);
  });
  const resolveReference = (reference: unknown) =>
    typeof reference === 'string'
      ? referenceIds.get(reference) ?? referenceIds.get(reference.toLocaleLowerCase())
      : undefined;
  const hasState = !!node.data.characterStatsState;
  if (!hasState && !initialContext.trim()) {
    throw new Error('Character Stats Tracker needs Initial Context before it can initialize.');
  }
  if (hasState && !lastMessage.trim()) {
    throw new Error('Character Stats Tracker needs Last Message before it can patch stats.');
  }
  const maxChange = characterStatsMaxChange(node.data);
  const characterStats = enabledStats(characterStatDefinitions(node.data));
  const characterStatByReference = statMaps(characterStats);
  const baseState = normalizeCharacterStatsState(nodes, node.data.characterStatsState);
  const baselineState = normalizeCharacterStatsState(nodes, node.data.characterStatsBaselineState);
  const latestRpDateTime = latestHistoryRpDateTime(historyMessages);
  const latestTurnNumber = latestHistoryTurnNumber(historyMessages);
  const elapsedHours = elapsedRpHours(node.data.characterStatsLastRpDateTime, latestRpDateTime);
  const relaxedPromptState: CharacterStatsState = {
    characters: Object.fromEntries(
      characters.map((character) => [
        character.nodeId,
        Object.fromEntries(characterStats.map((stat) => [
          stat.id,
          baseState.characters[character.nodeId]?.[stat.id] ?? 50,
        ])),
      ]),
    ),
  };
  const relaxedPromptChanges: CharacterStatsChanges = {
    characters: Object.fromEntries(characters.map((character) => [character.nodeId, {}])),
  };
  if (hasState && elapsedHours !== undefined) {
    applyLinearBaselineRelaxation(
      relaxedPromptState,
      {
        characters: Object.fromEntries(
          characters.map((character) => [
            character.nodeId,
            Object.fromEntries(characterStats.map((stat) => [
              stat.id,
              baselineState.characters[character.nodeId]?.[stat.id] ??
                baseState.characters[character.nodeId]?.[stat.id] ??
                50,
            ])),
          ]),
        ),
      },
      relaxedPromptChanges,
      characterStats,
      elapsedHours,
    );
  }
  const compactCurrentState = hasState
    ? {
        characters: Object.fromEntries(
          characterReferences.map((character) => [
            character.reference,
            Object.fromEntries(
              characterStats.map((stat) => [
                stat.name,
                relaxedPromptState.characters[character.nodeId]?.[stat.id] ?? 50,
              ]),
            ),
          ]),
        ),
      }
    : undefined;
  const compactBaselineState = hasState
    ? {
        characters: Object.fromEntries(
          characterReferences.map((character) => [
            character.reference,
            Object.fromEntries(
              characterStats.map((stat) => [
                stat.name,
                baselineState.characters[character.nodeId]?.[stat.id] ??
                  baseState.characters[character.nodeId]?.[stat.id] ??
                  50,
              ]),
            ),
          ]),
        ),
      }
    : undefined;
  const initShape = encode({
    action: 'init',
    baselines: Object.fromEntries(
      characterReferences.map((character) => [
        character.reference,
        statValueShape(characterStats, 'normal/resting 0 to 100'),
      ]),
    ),
    characters: Object.fromEntries(
      characterReferences.map((character) => [
        character.reference,
        statValueShape(characterStats, 'current 0 to 100'),
      ]),
    ),
  });
  const patchShape = encode({
    action: 'patch',
    characterChanges: {
      'character-reference': Object.fromEntries(characterStats.map((stat) => [stat.name, `-${maxChange} to +${maxChange}`])),
    },
  });
  const prompt = [
    fastTaskReasoningStart,
    '',
    'You maintain compact roleplay character stats.',
    'Return TOON only.',
    'Character stats belong to one character.',
    'Use only the exact short character references given below.',
    'Use valid TOON syntax.',
    hasState
      ? `There is stored state. Analyze only LAST MESSAGE and return action "patch" with relevant deltas, or action "keep". Each delta must be between -${maxChange} and +${maxChange}.`
      : 'There is no stored state. Initialize all active stats from INITIAL CONTEXT and return action "init". Return both baselines and current characters. Baselines are normal/resting values; current values include the current context situation. Use 50 only when the context gives no useful hint.',
    hasState ? '' : 'Initialize every character reference listed in CHARACTERS. Do not omit later characters.',
    hasState ? '' : 'Do not fill a whole character baseline with 50 unless INITIAL CONTEXT truly gives no usable personality, role, or situation hints for that character.',
    hasState ? 'If nothing meaningfully changes, return exactly:' : 'Return this initialization shape:',
    hasState ? 'action: keep' : initShape,
    ...(hasState ? ['If stats change, return this patch shape:', patchShape] : []),
    'Do not invent unknown characters.',
    'For patches, include only changed stats. Never repeat unchanged stats.',
    'Use the exact stat names as the attributes to track.',
    '',
    'CHARACTER STATS (TOON):',
    encode(characterStats.map(({ name }) => ({ name }))),
    '',
    'CHARACTERS (TOON):',
    encode(characterReferences.map(({ reference, name }) => ({ reference, name }))),
    ...(compactCurrentState ? ['', 'CURRENT STATE (TOON):', encode(compactCurrentState)] : []),
    ...(compactBaselineState ? ['', 'BASELINE STATE (TOON):', encode(compactBaselineState)] : []),
    ...(hasState && elapsedHours !== undefined
      ? ['', `TIME SINCE LAST STATS UPDATE: ${formatElapsedHours(elapsedHours)}. CURRENT STATE already includes automatic linear relaxation toward BASELINE STATE.`]
      : []),
    '',
    hasState ? 'LAST MESSAGE:' : 'INITIAL CONTEXT:',
    hasState ? lastMessage : initialContext,
    '',
    fastTaskReasoningEnd,
  ].join('\n');
  const completion = await llm.complete({
    connectionId: node.data.connectionId,
    nodeId: node.id,
    label: hasState ? 'Patch Stats' : 'Init Stats',
    prompt,
    fastTask: true,
  });
  updateRuntimeNode(node.id, {
    characterStatsLastPrompt: prompt,
    characterStatsLastResponse: completion.text.trim(),
  });
  const result = parseStatsResponse(completion.text);
  const action = typeof result.action === 'string' ? result.action.toLowerCase() : '';
  if ((!hasState && action !== 'init') || (hasState && !['keep', 'patch'].includes(action))) {
    throw new Error(
      hasState
        ? 'Character Stats Tracker must return action "keep" or "patch".'
        : 'Character Stats Tracker must initialize with action "init".',
    );
  }

  const nextState: CharacterStatsState = {
    characters: Object.fromEntries(
      characters.map((character) => [
        character.nodeId,
        Object.fromEntries(characterStats.map((stat) => [
          stat.id,
          relaxedPromptState.characters[character.nodeId]?.[stat.id] ??
            baseState.characters[character.nodeId]?.[stat.id] ??
            50,
        ])),
      ]),
    ),
  };
  const nextBaselineState: CharacterStatsState = {
    characters: Object.fromEntries(
      characters.map((character) => [
        character.nodeId,
        Object.fromEntries(characterStats.map((stat) => [
          stat.id,
          baselineState.characters[character.nodeId]?.[stat.id] ??
            baseState.characters[character.nodeId]?.[stat.id] ??
            50,
        ])),
      ]),
    ),
  };
  const lastChanges: CharacterStatsChanges = {
    characters: Object.fromEntries(
      characters.map((character) => [
        character.nodeId,
        { ...(relaxedPromptChanges.characters[character.nodeId] ?? {}) },
      ]),
    ),
  };
  const initializedBaselineKeys = new Set<string>();
  const initializedCurrentKeys = new Set<string>();

  if (action === 'init') {
    if (isRecord(result.baselines)) {
      Object.entries(result.baselines).forEach(([characterReference, rawStats]) => {
        const characterId = resolveReference(characterReference);
        if (!characterId || !isRecord(rawStats)) {
          return;
        }
        Object.entries(rawStats).forEach(([statReference, value]) => {
          const stat = characterStatByReference.get(statReference.toLocaleLowerCase());
          const score = parseScore(value);
          if (stat && score !== undefined) {
            nextBaselineState.characters[characterId][stat.id] = score;
            initializedBaselineKeys.add(`${characterId}:${stat.id}`);
          }
        });
      });
    }
    if (isRecord(result.characters)) {
      Object.entries(result.characters).forEach(([characterReference, rawStats]) => {
        const characterId = resolveReference(characterReference);
        if (!characterId || !isRecord(rawStats)) {
          return;
        }
        Object.entries(rawStats).forEach(([statReference, value]) => {
          const stat = characterStatByReference.get(statReference.toLocaleLowerCase());
          const score = parseScore(value);
          if (stat && score !== undefined) {
            nextState.characters[characterId][stat.id] = score;
            initializedCurrentKeys.add(`${characterId}:${stat.id}`);
          }
        });
      });
    }

    Object.entries(nextState.characters).forEach(([characterId, characterValues]) => {
      if (
        allStatsAreDefault50(nextBaselineState, characterId, characterStats, initializedBaselineKeys) &&
        hasNonDefaultCurrent(nextState, characterId, characterStats)
      ) {
        Object.keys(characterValues).forEach((statId) => {
          initializedBaselineKeys.delete(`${characterId}:${statId}`);
        });
      }
      Object.entries(characterValues).forEach(([statId, value]) => {
        if (!initializedBaselineKeys.has(`${characterId}:${statId}`)) {
          nextBaselineState.characters[characterId][statId] = value;
        }
        if (!initializedCurrentKeys.has(`${characterId}:${statId}`)) {
          nextState.characters[characterId][statId] = nextBaselineState.characters[characterId][statId];
        }
      });
    });
  } else if (action === 'patch') {
    if (isRecord(result.characterChanges)) {
      Object.entries(result.characterChanges).forEach(([characterReference, rawStats]) => {
        const characterId = resolveReference(characterReference);
        if (!characterId || !isRecord(rawStats)) {
          return;
        }
        Object.entries(rawStats).forEach(([statReference, value]) => {
          const stat = characterStatByReference.get(statReference.toLocaleLowerCase());
          const delta = parseDelta(value, maxChange);
          if (stat && delta !== undefined) {
            nextState.characters[characterId][stat.id] = clampScore(nextState.characters[characterId][stat.id] + delta);
            lastChanges.characters[characterId][stat.id] =
              (lastChanges.characters[characterId][stat.id] ?? 0) + delta;
          }
        });
      });
    }
  }

  const outputText = characterStatsStateText(nodes, nextState, characterStats, nextBaselineState);
  const contextText = `${hasState ? lastMessage : initialContext}\n\n${outputText}`;
  const hasChanges = hasCharacterStatsChanges(lastChanges);
  const previousTimeline = node.data.characterStatsTimeline ?? [];
  const nextTimeline = latestRpDateTime
    ? [
        ...previousTimeline.filter((entry) => entry.rpDateTime !== latestRpDateTime).slice(-119),
        {
          rpDateTime: latestRpDateTime,
          turnNumber: latestTurnNumber,
          state: nextState,
          baselineState: nextBaselineState,
        },
      ]
    : previousTimeline;
  updateRuntimeNode(node.id, {
    preview:
      action === 'init'
        ? 'Character stats initialized'
        : hasChanges
          ? 'Character stats updated'
          : 'Character stats unchanged',
    fullText: outputText,
    characterStatsContextText: contextText,
    characterStatsLastPrompt: prompt,
    characterStatsLastResponse: completion.text.trim(),
    characterStatsState: nextState,
    characterStatsBaselineState: nextBaselineState,
    characterStatsLastChanges: hasChanges ? lastChanges : undefined,
    characterStatsLastRpDateTime: latestRpDateTime ?? node.data.characterStatsLastRpDateTime,
    characterStatsTimeline: nextTimeline,
    characterStatsStatus:
      action === 'init'
        ? 'Initialized from initial context'
        : action === 'patch' && hasChanges
          ? 'Patched from last message'
          : hasChanges
            ? 'Relaxed toward baseline'
          : 'Kept current stats',
  });
  return { stateText: outputText, contextText };
}
