import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { StorybookCreatorMessage } from '../components/AppDialogs';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import {
  emptyRpStorybookV1,
  parseRpStorybookAssistantResult,
  parseRpStorybookJson,
  rpStorybookEditPrompt,
  rpStorybookIdentityLockViolations,
  rpStorybookJsonText,
  rpStorybookPromptJsonText,
  type RpStorybookV1,
} from '../nodes/rp-storybook-v1/model';
import { resetCharacterStatsRuntimeData } from '../nodes/character-stats/runtime';
import type { TurnRecord, WorkflowNode, WorkflowNodeData } from '../types';
import type { SystemLogLevel } from '../types';
import {
  appointmentEntitiesFromAppointments,
  appointmentsFromEventEntities,
  normalizeEventAppointments,
  removeEventEntities,
} from '../data-management/eventStore';
import { usedStorybookImageIdsRemoved } from './imageUsage';
import { withChangedStorybookImageDescriptionsSynchronized } from './imageLibrary';
import { turnsWithStorybookImageRefs } from './openingHistoryRuntime';
import storybookFormatVersions from './formatVersions.json';
import {
  convertLegacyRpStorybook,
  isLegacyRpStorybookValue,
  type StorybookConversionResult,
} from './conversion';
import { planCharacterCardImport, rpCharacterCardForCharacter } from './characterCard';
import { storybookWithoutCharacter } from './characterManagement';
import type { TurnCheckpoint } from '../data-management/types';
import type {
  ChatGpdChatsByCharacter,
  PhoneNotesByCharacter,
} from '../chat/phoneAppsSessions';

type FileProtection = 'plain' | 'encrypted';

type PendingStorybookLoad = {
  nodeId: string;
  filePath: string;
  fileName: string;
} | null;

type StorybookFileMetadata = {
  protection?: FileProtection | 'unknown';
  envelopeFormatVersion?: string;
  formatVersion?: string;
};

type SessionPasswordAction =
  | 'save-workflow'
  | 'save-session'
  | 'save-storybook'
  | 'load'
  | 'open-file'
  | 'load-storybook'
  | null;

type UseStorybookActionsOptions = {
  nodesRef: MutableRefObject<WorkflowNode[]>;
  turnsRef: MutableRefObject<TurnRecord[]>;
  turnCheckpointsRef: MutableRefObject<TurnCheckpoint[]>;
  currentSocialLikesByAccount: () => Record<string, string[]>;
  currentPhoneNotesByCharacter: () => PhoneNotesByCharacter;
  currentChatGpdChatsByCharacter: () => ChatGpdChatsByCharacter;
  replaceCurrentChatWithOpeningHistoryRef: MutableRefObject<boolean>;
  nodeLlm: NodeLlmApi;
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  errorMessage: (error: unknown) => string;
  refreshFiles: (selectedFileName?: string | null) => Promise<void>;
  setPendingStorybookLoad: Dispatch<SetStateAction<PendingStorybookLoad>>;
  setPendingSessionFilePath: Dispatch<SetStateAction<string | null>>;
  setSessionPassword: Dispatch<SetStateAction<string>>;
  setFileStorageStatus: Dispatch<SetStateAction<string>>;
  setSessionPasswordAction: Dispatch<SetStateAction<SessionPasswordAction>>;
  setActiveStorybookProtection: Dispatch<SetStateAction<FileProtection>>;
  notifySystem: (level: SystemLogLevel, text: string) => number;
  usedStorybookImageIds: ReadonlySet<string>;
  clearCurrentSession: () => void;
};

export function useStorybookActions({
  nodesRef,
  turnsRef,
  turnCheckpointsRef,
  currentSocialLikesByAccount,
  currentPhoneNotesByCharacter,
  currentChatGpdChatsByCharacter,
  replaceCurrentChatWithOpeningHistoryRef,
  nodeLlm,
  updateRuntimeNode,
  errorMessage,
  refreshFiles,
  setPendingStorybookLoad,
  setPendingSessionFilePath,
  setSessionPassword,
  setFileStorageStatus,
  setSessionPasswordAction,
  setActiveStorybookProtection,
  notifySystem,
  usedStorybookImageIds,
  clearCurrentSession,
}: UseStorybookActionsOptions) {
  const [pendingStorybookConversion, setPendingStorybookConversion] = useState<{
    nodeId: string;
    fileName?: string;
    filePath?: string;
    sourceValue: unknown;
    result: StorybookConversionResult;
    phase: 'convert' | 'review';
    protection: FileProtection;
  } | null>(null);
  const [storybookCreatorNodeId, setStorybookCreatorNodeId] = useState<string | null>(null);
  const [storybookCreatorMessages, setStorybookCreatorMessages] = useState<StorybookCreatorMessage[]>([]);
  const [storybookCreatorSubmitting, setStorybookCreatorSubmitting] = useState(false);

  function incompatibleStorybookFileStatus(file: StorybookFileMetadata) {
    if (
      file.protection === 'encrypted' &&
      file.envelopeFormatVersion !== storybookFormatVersions.encryptedStorybookEnvelope
    ) {
      return `Encrypted storybook Envelope Format ${file.envelopeFormatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Envelope Format ${storybookFormatVersions.encryptedStorybookEnvelope}.`;
    }
    return `Storybook Format ${file.formatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Storybook Format ${storybookFormatVersions.storybook}.`;
  }

  function storyHistoryPresent(storybook: RpStorybookV1) {
    return (
      turnsRef.current.length > 0 ||
      storybook.openingHistory.turns.length > 0 ||
      storybook.openingHistory.events.length > 0
    );
  }

  /** Returns null when the storybook was committed, otherwise the blocking error message. */
  function commitStorybookToNode(
    nodeId: string,
    storybook: ReturnType<typeof parseRpStorybookJson>,
    patch: Partial<WorkflowNodeData>,
    options?: { replaceExisting?: boolean },
  ): string | null {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    let committedStorybook = storybook;
    if (options?.replaceExisting) {
      clearCurrentSession();
      updateRuntimeNode(nodeId, {
        ...patch,
        storybookJson: rpStorybookJsonText(storybook),
      });
      return null;
    }
    if (node?.data.nodeType === 'rp-storybook-v1') {
      const currentStorybook = node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybookV1;
      committedStorybook = withChangedStorybookImageDescriptionsSynchronized(
        currentStorybook,
        storybook,
      );
      const removedImageIds = usedStorybookImageIdsRemoved(
        currentStorybook,
        committedStorybook,
        usedStorybookImageIds,
      );
      if (removedImageIds.length > 0) {
        const message = 'Cannot delete: image is used in chat history.';
        updateRuntimeNode(nodeId, { storybookStatus: message });
        notifySystem('info', message);
        return message;
      }
      if (storyHistoryPresent(currentStorybook)) {
        const violations = rpStorybookIdentityLockViolations(currentStorybook, committedStorybook);
        if (violations.length > 0) {
          const message = violations.join(' ');
          updateRuntimeNode(nodeId, { storybookStatus: violations[0] });
          notifySystem('info', message);
          return message;
        }
      }
    }
    updateRuntimeNode(nodeId, {
      ...patch,
      storybookJson: rpStorybookJsonText(committedStorybook),
    });
    return null;
  }

  function updateStorybook(nodeId: string, storybook: ReturnType<typeof parseRpStorybookJson>, status?: string) {
    const commitError = commitStorybookToNode(
      nodeId,
      storybook,
      { storybookStatus: status ?? 'Storybook updated.' },
    );
    if (commitError) {
      setStorybookCreatorMessages((current) => [
        ...current,
        { role: 'storybook', text: commitError },
      ]);
      return false;
    }
    return true;
  }

  function openStorybookCreator(nodeId: string) {
    setStorybookCreatorNodeId(nodeId);
    if (pendingStorybookConversion?.nodeId !== nodeId || pendingStorybookConversion.phase !== 'review') {
      setStorybookCreatorMessages([]);
    }
  }

  async function submitStorybookCreatorMessage(message: string, visibleMessage = message) {
    const nodeId = storybookCreatorNodeId;
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!nodeId || !node || node.data.nodeType !== 'rp-storybook-v1') {
      return;
    }

    setStorybookCreatorMessages((current) => [...current, { role: 'user', text: visibleMessage }]);
    setStorybookCreatorSubmitting(true);
    updateRuntimeNode(nodeId, {
      storybookStatus: 'Thinking ...',
      llmCallStats: [],
    });

    try {
      const conversion = pendingStorybookConversion?.nodeId === nodeId && pendingStorybookConversion.phase === 'review'
        ? pendingStorybookConversion
        : null;
      const currentStorybook = conversion?.result.storybook ?? (node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybookV1);
      const conversionStatus = conversion
        ? [
            `Conversion review: Storybook ${conversion.result.sourceVersion} -> ${conversion.result.targetVersion}.`,
            ...conversion.result.rows.map((row) =>
              `${row.reviewState === 'resolved' || row.reviewState === 'accepted' ? 'GREEN' : row.state === 'suggested' ? 'BLUE' : row.state === 'defaulted' ? 'YELLOW' : 'GREEN'} | ${row.label} | ${row.message}`,
            ),
            'During conversion, patches update the conversion draft only. They do not update the active node.',
          ].join('\n')
        : '';
      const storybookMessageContext = storybookCreatorMessages
        .filter((entry) => entry.role === 'storybook')
        .slice(-6)
        .map((entry) => `STORYBOOK NOTICE: ${entry.text}`)
        .join('\n');
      const instruction = [conversionStatus, storybookMessageContext, message].filter(Boolean).join('\n\n');
      const currentJson = rpStorybookPromptJsonText(currentStorybook);
      const completion = await nodeLlm.complete({
        connectionId: node.data.connectionId,
        nodeId,
        label: 'Storybook Chat',
        prompt: rpStorybookEditPrompt(currentJson, instruction, storyHistoryPresent(currentStorybook)),
      });
      const result = parseRpStorybookAssistantResult(completion.text, currentStorybook);
      const changedFields = result.changedFields.slice(0, 4);
      const storybookChanged = JSON.stringify(result.storybook) !== JSON.stringify(currentStorybook);
      const changedSummary = changedFields.length
        ? `edit ${changedFields.join(' + ')}${result.changedFields.length > changedFields.length ? ' + more' : ''}`
        : 'answer';
      if (storybookChanged && conversion) {
        const rows = conversion.result.rows.map((row) => {
          const rowWasChanged = row.allowedPatchPaths.some((allowed) =>
            result.patchPaths.some((path) => path === allowed || path.startsWith(`${allowed}/`)),
          );
          return rowWasChanged ? { ...row, reviewState: 'resolved' as const, message: 'Reviewed and updated by the AI assistant.' } : row;
        });
        setPendingStorybookConversion({
          ...conversion,
          result: { ...conversion.result, storybook: result.storybook, rows },
        });
        updateRuntimeNode(nodeId, { storybookStatus: `Conversion draft edited via ${completion.connection.label}` });
      } else if (storybookChanged) {
        const commitError = commitStorybookToNode(nodeId, result.storybook, {
          storybookStatus: `Edited via ${completion.connection.label}`,
        });
        if (commitError) {
          setStorybookCreatorMessages((current) => [
            ...current,
            { role: 'error', text: commitError },
          ]);
          return;
        }
      } else {
        updateRuntimeNode(nodeId, {
          storybookStatus: `Answered via ${completion.connection.label}`,
        });
      }
      setStorybookCreatorMessages((current) => [
        ...current,
        { role: 'assistant', text: `${changedSummary}: ${result.reply}` },
      ]);
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { storybookStatus: `Error: ${messageText}` });
      setStorybookCreatorMessages((current) => [...current, { role: 'error', text: messageText }]);
    } finally {
      setStorybookCreatorSubmitting(false);
    }
  }

  function deleteStorybookCharacter(nodeId: string, characterId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook-v1') {
      return;
    }
    const storybook = node.data.storybookJson
      ? parseRpStorybookJson(node.data.storybookJson)
      : emptyRpStorybookV1;
    const character = storybook.characters.find((entry) => entry.id === characterId);
    if (!character) {
      return;
    }
    const commitError = commitStorybookToNode(
      nodeId,
      storybookWithoutCharacter(storybook, characterId),
      { storybookStatus: `Deleted character ${character.name || character.id}.` },
    );
    if (commitError) {
      setStorybookCreatorMessages((current) => [
        ...current,
        { role: 'storybook', text: commitError },
      ]);
    }
  }

  function applyStorybookToNode(
    nodeId: string,
    storybookValue: unknown,
    fileName?: string,
    filePath?: string,
    status = 'Loaded storybook',
    protection: FileProtection = 'plain',
  ) {
    if (isLegacyRpStorybookValue(storybookValue)) {
      const result = convertLegacyRpStorybook(storybookValue);
      setStorybookCreatorMessages([]);
      setPendingStorybookConversion({
        nodeId,
        fileName,
        filePath,
        sourceValue: storybookValue,
        result,
        phase: 'convert',
        protection,
      });
      // The conversion checklist lives in the storybook editor's UI Preview.
      setStorybookCreatorNodeId(nodeId);
      updateRuntimeNode(nodeId, {
        storybookStatus: `Storybook Format ${result.sourceVersion} is older than ${result.targetVersion}. Review the conversion in the storybook editor.`,
      });
      return true;
    }
    const storybook = parseRpStorybookJson(JSON.stringify(storybookValue));
    const commitError = commitStorybookToNode(nodeId, storybook, {
      storybookStatus: fileName ? `${status}: ${fileName}` : status,
      storybookFileName: fileName,
      storybookFilePath: filePath,
    }, { replaceExisting: true });
    if (!commitError) {
      setActiveStorybookProtection(protection);
    }
    return commitError === null;
  }

  function beginPendingStorybookReview() {
    const pending = pendingStorybookConversion;
    if (!pending) {
      return;
    }
    const reviewRows = pending.result.rows.filter((row) => row.reviewState === 'pending');
    setPendingStorybookConversion({ ...pending, phase: 'review' });
    if (reviewRows.length === 0) {
      updateRuntimeNode(pending.nodeId, { storybookStatus: 'Conversion draft is ready to apply.' });
    }
  }

  async function improvePendingStorybookConversion() {
    if (pendingStorybookConversion?.phase !== 'review') {
      return;
    }
    await submitStorybookCreatorMessage(
      [
        'Review the conversion report and improve every missing or defaulted value that can be inferred meaningfully from the existing storybook.',
        'Prioritize character banking, social usernames, scenario text, and useful image-generation appearance descriptions.',
        'Leave technical or binary defaults alone when they cannot be inferred safely, including voice samples, wallpaper ids, LoRA file names, and LoRA URLs.',
        'Make one coherent patch for all useful improvements, then summarize what you changed and what correctly remains at its default.',
      ].join(' '),
      'Improve the useful conversion defaults.',
    );
  }

  /** Returns null when applied, otherwise the blocking error message. */
  function applyPendingStorybookConversion(): string | null {
    const pending = pendingStorybookConversion;
    if (!pending || pending.phase !== 'review') {
      return null;
    }
    const { nodeId, fileName, filePath, result, protection } = pending;
    const commitError = commitStorybookToNode(nodeId, result.storybook, {
      storybookStatus: `Converted from Storybook Format ${result.sourceVersion} to ${result.targetVersion}${fileName ? `: ${fileName}` : ''}. Save the storybook to keep the upgrade.`,
      storybookFileName: fileName,
      storybookFilePath: filePath,
    }, { replaceExisting: true });
    if (commitError) {
      return commitError;
    }
    setPendingStorybookConversion(null);
    setActiveStorybookProtection(protection);
    const message = `Storybook converted to Format ${result.targetVersion}. Save it as a new file to keep the upgrade.`;
    setFileStorageStatus(message);
    notifySystem('info', message);
    return null;
  }

  function cancelPendingStorybookConversion() {
    const pending = pendingStorybookConversion;
    if (!pending) {
      return;
    }
    updateRuntimeNode(pending.nodeId, {
      storybookStatus: 'Conversion canceled. The old storybook was not loaded.',
    });
    setPendingStorybookConversion(null);
  }

  function importCurrentSessionAsOpeningHistory(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook-v1') {
      return;
    }
    const storybook = node.data.storybookJson
      ? parseRpStorybookJson(node.data.storybookJson)
      : emptyRpStorybookV1;
    // Images that live in a Storybook gallery are stored as id-only
    // references instead of embedded copies; loading resolves them again.
    const historyTurns = turnsWithStorybookImageRefs(
      turnsRef.current.map((turn) => {
        const { openingHistory: _openingHistory, ...storedTurn } = structuredClone(turn);
        return storedTurn;
      }),
      nodesRef.current,
    );
    const historyMessageCount = historyTurns.reduce(
      (count, turn) => count + turn.input.messages.length + turn.output.messages.length,
      0,
    );
    const historyTurnIds = new Set(historyTurns.map((turn) => turn.id));
    const storybookNodeIds = new Set(
      nodesRef.current
        .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'rp-storybook-v1')
        .map((entry) => entry.id),
    );
    const historyCheckpoints = turnCheckpointsRef.current
      .filter((checkpoint) => historyTurnIds.has(checkpoint.turnId))
      .map((checkpoint) => {
        const storedCheckpoint = structuredClone(checkpoint);
        storybookNodeIds.forEach((storybookNodeId) => {
          delete storedCheckpoint.nodeSnapshots[storybookNodeId];
        });
        return storedCheckpoint;
      });
    const openingEvents = nodesRef.current
      .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'event-manager')
      .flatMap((entry) => entry.data.eventAppointments ?? [])
      .filter((event) => event.status === 'upcoming');
    const normalizedOpeningEvents = normalizeEventAppointments(openingEvents);
    // Player likes, notes, and ChatGPD chats are session UI state, not
    // message records, so they are snapshotted into the opening history
    // explicitly.
    const openingSocialLikes = structuredClone(currentSocialLikesByAccount());
    const openingNotes = structuredClone(currentPhoneNotesByCharacter());
    const openingChatGpdChats = structuredClone(currentChatGpdChatsByCharacter());
    const countRecords = (records: Record<string, unknown[]>) =>
      Object.values(records).reduce((count, entries) => count + entries.length, 0);
    const openingNoteCount = countRecords(openingNotes);
    const openingChatGpdChatCount = countRecords(openingChatGpdChats);
    const openingSocialLikeCount = countRecords(openingSocialLikes);
    const phoneAppParts = [
      openingNoteCount ? `${openingNoteCount} phone note${openingNoteCount === 1 ? '' : 's'}` : '',
      openingChatGpdChatCount
        ? `${openingChatGpdChatCount} ChatGPD chat${openingChatGpdChatCount === 1 ? '' : 's'}`
        : '',
      openingSocialLikeCount
        ? `${openingSocialLikeCount} social like${openingSocialLikeCount === 1 ? '' : 's'}`
        : '',
    ].filter(Boolean);
    const phoneAppSuffix = phoneAppParts.length ? ` Includes ${phoneAppParts.join(', ')}.` : '';
    const hasOpeningContent =
      historyTurns.length > 0 || normalizedOpeningEvents.length > 0 || phoneAppParts.length > 0;
    const nextStorybook = {
      ...storybook,
      openingHistory: {
        summary: hasOpeningContent
          ? `Imported from current RP session: ${historyMessageCount} messages and ${normalizedOpeningEvents.length} events across ${historyTurns.length} turns.${phoneAppSuffix}`
          : '',
        turns: historyTurns,
        checkpoints: historyCheckpoints,
        events: normalizedOpeningEvents,
        socialLikes: openingSocialLikes,
        notes: openingNotes,
        chatGpdChats: openingChatGpdChats,
      },
    };
    replaceCurrentChatWithOpeningHistoryRef.current = true;
    updateRuntimeNode(nodeId, {
      storybookJson: rpStorybookJsonText(nextStorybook),
      storybookStatus: hasOpeningContent
        ? `Imported ${historyTurns.length} opening history turns and ${normalizedOpeningEvents.length} events.${phoneAppSuffix}`
        : 'No current chat messages, events, or phone app entries to import.',
    });
  }

  function clearStorybookOpeningHistory(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook-v1') {
      return;
    }
    const storybook = node.data.storybookJson
      ? parseRpStorybookJson(node.data.storybookJson)
      : emptyRpStorybookV1;
    const nextStorybook = {
      ...storybook,
      openingHistory: emptyRpStorybookV1.openingHistory,
    };
    const openingEventIds = new Set(storybook.openingHistory.events.map((event) => event.id));
    if (openingEventIds.size > 0) {
      nodesRef.current
        .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'event-manager')
        .forEach((entry) => {
          const nextAppointments = appointmentsFromEventEntities(
            removeEventEntities(
              appointmentEntitiesFromAppointments(entry.data.eventAppointments ?? []),
              openingEventIds,
            ),
          );
          if (nextAppointments.length !== (entry.data.eventAppointments ?? []).length) {
            updateRuntimeNode(entry.id, {
              eventAppointments: normalizeEventAppointments(nextAppointments),
              eventStatus: nextAppointments.length
                ? `Opening History cleared. ${nextAppointments.length} events remain.`
                : 'Opening History cleared. No events remain.',
            });
          }
        });
    }
    updateRuntimeNode(nodeId, {
      storybookJson: rpStorybookJsonText(nextStorybook),
      storybookStatus: 'Opening History cleared.',
    });
  }

  // A full reset wipes the running story with the storybook (chat session,
  // events, character stats), so the image-usage and identity locks that
  // protect a running story intentionally do not apply here.
  function resetStorybook(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook-v1') {
      return;
    }
    clearCurrentSession();
    nodesRef.current
      .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'event-manager')
      .forEach((entry) => {
        updateRuntimeNode(entry.id, {
          eventAppointments: [],
          eventStatus: 'Storybook reset. All events cleared.',
        });
      });
    nodesRef.current
      .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'character-stats')
      .forEach((entry) => {
        updateRuntimeNode(entry.id, {
          ...resetCharacterStatsRuntimeData(),
          characterStatsStatus: 'Storybook reset. State initializes on next run.',
        });
      });
    updateRuntimeNode(nodeId, {
      storybookJson: rpStorybookJsonText(emptyRpStorybookV1),
      storybookStatus: 'Storybook and current session reset.',
      storybookFileName: undefined,
      storybookFilePath: undefined,
    });
  }

  async function exportStorybookCharacter(nodeId: string, characterId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook-v1') {
      return;
    }
    try {
      const storybook = node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybookV1;
      const character = storybook.characters.find((entry) => entry.id === characterId);
      if (!character) {
        updateRuntimeNode(nodeId, { storybookStatus: 'Export failed: character not found.' });
        return;
      }
      const result = await window.rpgraph.saveRpgraphFileToPath({
        kind: 'character',
        name: character.name || character.id,
        characterCard: rpCharacterCardForCharacter(character),
        protection: 'plain',
      });
      if (result.canceled) {
        return;
      }
      const message = `Exported character ${character.name || character.id}: ${result.fileName}`;
      updateRuntimeNode(nodeId, { storybookStatus: message });
      notifySystem('info', message);
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { storybookStatus: `Character export failed: ${messageText}` });
      notifySystem('error', `Character export failed: ${messageText}`);
    }
  }

  async function importCharacterCard(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook-v1') {
      return;
    }
    try {
      const file = await window.rpgraph.loadJsonFile({ title: 'Import RPGraph Character Card' });
      if (file.canceled || !file.contents) {
        return;
      }
      let cardValue: unknown;
      try {
        cardValue = JSON.parse(file.contents);
      } catch {
        updateRuntimeNode(nodeId, { storybookStatus: 'Import failed: selected file is not valid JSON.' });
        return;
      }
      const currentStorybook = node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybookV1;
      const plan = planCharacterCardImport(cardValue, currentStorybook);
      const label = plan.character.name || plan.character.id;
      const action = plan.replacesIndex !== undefined ? 'Replaced' : 'Added';
      const commitError = commitStorybookToNode(nodeId, plan.storybook, {
        storybookStatus: `${action} character ${label} from ${file.fileName ?? 'character card'}.`,
      });
      if (commitError) {
        return;
      }
      notifySystem('info', `${action} character ${label} from a character card. Check scenario texts for consistency and save the storybook.`);
      setStorybookCreatorMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: `${action} character ${label} from ${file.fileName ?? 'a character card'}. Run "Check Story Logic" from the ⋯ menu to align the scenario texts with the new cast, then save the storybook.`,
        },
      ]);
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { storybookStatus: `Character import failed: ${messageText}` });
      notifySystem('error', `Character import failed: ${messageText}`);
    }
  }

  async function importSillyTavernCharacter(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook-v1') {
      return;
    }

    try {
      const file = await window.rpgraph.loadJsonFile();
      if (file.canceled || !file.contents) {
        return;
      }

      let importedCharacter: unknown;
      try {
        importedCharacter = JSON.parse(file.contents);
      } catch {
        updateRuntimeNode(nodeId, { storybookStatus: 'Import failed: selected file is not valid JSON.' });
        return;
      }

      const currentStorybook = node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybookV1;
      const currentJson = rpStorybookPromptJsonText(currentStorybook);
      const importedJson = JSON.stringify(importedCharacter, null, 2);
      const instruction = [
        `Import this SillyTavern character JSON from "${file.fileName ?? 'selected JSON file'}" into the RPGraph Storybook format.`,
        'Import it as a Storybook character. There is no playable-character/NPC distinction in the Storybook JSON.',
        'Map names, description, personality/persona, scenario/first message/greeting, example dialogue, creator notes, and tags into the closest useful Storybook fields.',
        'Preserve existing Storybook fields unless the import clearly fills an empty value or updates the same imported character.',
        'If a character with the same name already exists, update that character instead of adding a duplicate.',
        'Return the RPGraph Storybook assistant response JSON with an RFC 6902 JSON Patch array.',
        '',
        `Imported SillyTavern JSON:\n${importedJson}`,
      ].join('\n');

      updateRuntimeNode(nodeId, {
        storybookStatus: `Importing SillyTavern JSON${file.fileName ? `: ${file.fileName}` : ''} ...`,
        llmCallStats: [],
      });
      setStorybookCreatorMessages((current) => [
        ...current,
        {
          role: 'user',
          text: `Import SillyTavern character${file.fileName ? `: ${file.fileName}` : ''}`,
        },
      ]);

      const completion = await nodeLlm.complete({
        connectionId: node.data.connectionId,
        nodeId,
        label: 'SillyTavern Import',
        prompt: rpStorybookEditPrompt(currentJson, instruction, storyHistoryPresent(currentStorybook)),
      });
      const result = parseRpStorybookAssistantResult(completion.text, currentStorybook);
      const commitError = commitStorybookToNode(nodeId, result.storybook, {
        storybookStatus: `Imported ${file.fileName ?? 'SillyTavern JSON'} via ${completion.connection.label}`,
        storybookFileName: undefined,
        storybookFilePath: undefined,
      });
      if (commitError) {
        setStorybookCreatorMessages((current) => [
          ...current,
          { role: 'error', text: commitError },
        ]);
        return;
      }
      setStorybookCreatorMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: `import ${result.changedFields.slice(0, 4).join(' + ') || 'storybook'}: ${result.reply}`,
        },
      ]);
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { storybookStatus: `Import failed: ${messageText}` });
      setStorybookCreatorMessages((current) => [...current, { role: 'error', text: messageText }]);
    }
  }

  async function loadStorybookFile(nodeId: string) {
    try {
      const file = await window.rpgraph.selectFile();
      if (file.canceled || !file.filePath) {
        return false;
      }
      if (file.type !== 'storybook') {
        const message = file.compatible === false
          ? incompatibleStorybookFileStatus(file)
          : 'Select a compatible RP Storybook file.';
        updateRuntimeNode(nodeId, { storybookStatus: message });
        setFileStorageStatus(message);
        notifySystem('info', message);
        return false;
      }
      if (!file.compatible) {
        const message = incompatibleStorybookFileStatus(file);
        updateRuntimeNode(nodeId, { storybookStatus: message });
        setFileStorageStatus(message);
        notifySystem('info', message);
        return false;
      }
      if (file.protection === 'encrypted') {
        setPendingStorybookLoad({
          nodeId,
          filePath: file.filePath,
          fileName: file.fileName ?? 'encrypted storybook',
        });
        setPendingSessionFilePath(file.filePath);
        setSessionPassword('');
        setFileStorageStatus('This storybook is password protected. Enter its password or PIN to continue.');
        updateRuntimeNode(nodeId, { storybookStatus: 'Encrypted storybook needs a password.' });
        setSessionPasswordAction('load-storybook');
        return false;
      }
      const result = await window.rpgraph.loadFilePath(file.filePath);
      if (result.type !== 'storybook') {
        throw new Error('The selected file is not an RP Storybook.');
      }
      const applied = applyStorybookToNode(nodeId, result.value, result.fileName, result.filePath);
      if (!applied) {
        setFileStorageStatus('Cannot load storybook: it conflicts with the running chat history.');
        return false;
      }
      setActiveStorybookProtection('plain');
      await refreshFiles(result.fileName);
      return true;
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { storybookStatus: `Load failed: ${messageText}` });
      setFileStorageStatus(`Load failed: ${messageText}`);
      return false;
    }
  }

  return {
    storybookCreatorNodeId,
    setStorybookCreatorNodeId,
    storybookCreatorMessages,
    storybookCreatorSubmitting,
    openStorybookCreator,
    submitStorybookCreatorMessage,
    updateStorybook,
    applyStorybookToNode,
    pendingStorybookConversion,
    beginPendingStorybookReview,
    improvePendingStorybookConversion,
    applyPendingStorybookConversion,
    cancelPendingStorybookConversion,
    importCurrentSessionAsOpeningHistory,
    clearStorybookOpeningHistory,
    resetStorybook,
    importSillyTavernCharacter,
    exportStorybookCharacter,
    deleteStorybookCharacter,
    importCharacterCard,
    loadStorybookFile,
  };
}
