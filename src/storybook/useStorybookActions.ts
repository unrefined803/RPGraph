import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { StorybookCreatorMessage } from '../components/AppDialogs';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import {
  emptyRpStorybook,
  parseRpStorybookAssistantResult,
  parseRpStorybookJson,
  rpStorybookEditPrompt,
  rpStorybookIdentityLockViolations,
  rpStorybookJsonText,
  rpStorybookPromptJsonText,
  type RpStorybook,
} from '../nodes/rp-storybook/model';
import { resetCharacterStatsRuntimeData } from '../nodes/character-stats/runtime';
import type { SavedFileSummary, TurnRecord, WorkflowNode, WorkflowNodeData } from '../types';
import type { SystemLogLevel } from '../types';
import {
  appointmentEntitiesFromAppointments,
  appointmentsFromEventEntities,
  normalizeEventAppointments,
  removeEventEntities,
} from '../data-management/eventStore';
import { usedStorybookImageIdsRemoved } from './imageUsage';
import { isStorybookSourceNode } from './runtime';
import { withChangedStorybookImageDescriptionsSynchronized } from './imageLibrary';
import { turnsForStorybookOpeningHistory } from './openingHistoryRuntime';
import storybookFormatVersions from './formatVersions.json';
import {
  convertLegacyRpStorybook,
  isLegacyRpStorybookValue,
  type StorybookConversionResult,
} from './conversion';
import { planCharacterCardImport, rpCharacterCardForCharacter } from './characterCard';
import { storybookWithoutCharacter } from './characterManagement';
import { storybookAssistantConversationContext } from './assistantConversation';
import {
  sillyTavernImportInstruction,
  validateSillyTavernImportResult,
} from './sillyTavernImport';
import type { TurnCheckpoint } from '../data-management/types';
import type {
  ChatGpdChatsByCharacter,
  PhoneNotesByCharacter,
} from '../chat/phoneAppsSessions';
import type {
  DynamicSocialUsers,
  SocialConnectionsByCharacter,
} from '../chat/socialDirectory';

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
  | 'save-character'
  | 'load-character'
  | null;

type UseStorybookActionsOptions = {
  nodesRef: MutableRefObject<WorkflowNode[]>;
  turnsRef: MutableRefObject<TurnRecord[]>;
  turnCheckpointsRef: MutableRefObject<TurnCheckpoint[]>;
  currentSocialLikesByAccount: () => Record<string, string[]>;
  currentDynamicSocialUsers: () => DynamicSocialUsers;
  currentSocialConnectionsByCharacter: () => SocialConnectionsByCharacter;
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
  sessionPassword: string;
  setFileStorageStatus: Dispatch<SetStateAction<string>>;
  setSessionPasswordAction: Dispatch<SetStateAction<SessionPasswordAction>>;
  setActiveStorybookProtection: Dispatch<SetStateAction<FileProtection>>;
  notifySystem: (level: SystemLogLevel, text: string) => number;
  usedStorybookImageIds: ReadonlySet<string>;
  clearCurrentSession: () => void;
  requestSaveCharacter: (
    nodeId: string,
    characterCard: ReturnType<typeof rpCharacterCardForCharacter>,
  ) => void;
};

export function useStorybookActions({
  nodesRef,
  turnsRef,
  turnCheckpointsRef,
  currentSocialLikesByAccount,
  currentDynamicSocialUsers,
  currentSocialConnectionsByCharacter,
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
  sessionPassword,
  setFileStorageStatus,
  setSessionPasswordAction,
  setActiveStorybookProtection,
  notifySystem,
  usedStorybookImageIds,
  clearCurrentSession,
  requestSaveCharacter,
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
  const storybookCreatorMessageNodeIdRef = useRef<string | null>(null);
  const [storybookCreatorSubmitting, setStorybookCreatorSubmitting] = useState(false);
  const [pendingCharacterLoad, setPendingCharacterLoad] = useState<{
    nodeId: string;
    filePath?: string;
    fileName: string;
    storage?: SavedFileSummary['storage'];
  } | null>(null);
  const [showCharacterFiles, setShowCharacterFiles] = useState(false);
  const [characterFiles, setCharacterFiles] = useState<SavedFileSummary[]>([]);
  const [selectedCharacterFile, setSelectedCharacterFile] = useState<string | null>(null);
  const [characterFileStatus, setCharacterFileStatus] = useState('');
  const [characterImportNodeId, setCharacterImportNodeId] = useState<string | null>(null);

  function incompatibleStorybookFileStatus(file: StorybookFileMetadata) {
    if (
      file.protection === 'encrypted' &&
      file.envelopeFormatVersion !== storybookFormatVersions.encryptedStorybookEnvelope
    ) {
      return `Encrypted storybook Envelope Format ${file.envelopeFormatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Envelope Format ${storybookFormatVersions.encryptedStorybookEnvelope}.`;
    }
    return `Storybook Format ${file.formatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Storybook Format ${storybookFormatVersions.storybook}.`;
  }

  function storyHistoryPresent(storybook: RpStorybook) {
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
    if (node && isStorybookSourceNode(node)) {
      const currentStorybook = node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybook;
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
    if (
      storybookCreatorMessageNodeIdRef.current !== nodeId &&
      (pendingStorybookConversion?.nodeId !== nodeId || pendingStorybookConversion.phase !== 'review')
    ) {
      setStorybookCreatorMessages([]);
    }
    storybookCreatorMessageNodeIdRef.current = nodeId;
  }

  async function submitStorybookCreatorMessage(message: string, visibleMessage = message) {
    const nodeId = storybookCreatorNodeId;
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!nodeId || !node || node.data.nodeType !== 'rp-storybook') {
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
        : emptyRpStorybook);
      const conversionStatus = conversion
        ? [
            `Conversion review: Storybook ${conversion.result.sourceVersion} -> ${conversion.result.targetVersion}.`,
            ...conversion.result.rows.map((row) =>
              `${row.reviewState === 'resolved' || row.reviewState === 'accepted' ? 'GREEN' : row.state === 'suggested' ? 'BLUE' : row.state === 'defaulted' ? 'YELLOW' : 'GREEN'} | ${row.label} | ${row.message}`,
            ),
            'During conversion, patches update the conversion draft only. They do not update the active node.',
          ].join('\n')
        : '';
      const conversationContext = storybookAssistantConversationContext(storybookCreatorMessages);
      const instruction = [
        conversionStatus,
        conversationContext,
        `Current user message:\n${message}`,
      ].filter(Boolean).join('\n\n');
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
    if (!node || node.data.nodeType !== 'rp-storybook') {
      return;
    }
    const storybook = node.data.storybookJson
      ? parseRpStorybookJson(node.data.storybookJson)
      : emptyRpStorybook;
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
    if (!node || node.data.nodeType !== 'rp-storybook') {
      return;
    }
    const storybook = node.data.storybookJson
      ? parseRpStorybookJson(node.data.storybookJson)
      : emptyRpStorybook;
    const historyMedia = turnsForStorybookOpeningHistory(
      turnsRef.current.map((turn) => {
        const { openingHistory: _openingHistory, ...storedTurn } = structuredClone(turn);
        return storedTurn;
      }),
      nodesRef.current,
    );
    const historyTurns = historyMedia.turns;
    const historyMessageCount = historyTurns.reduce(
      (count, turn) => count + turn.input.messages.length + turn.output.messages.length,
      0,
    );
    const historyTurnIds = new Set(historyTurns.map((turn) => turn.id));
    const storybookNodeIds = new Set(
      nodesRef.current
        .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'rp-storybook')
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
    // Player likes, social-directory state, notes, and ChatGPD chats are
    // session UI state, not message records, so Opening History snapshots them
    // explicitly.
    const openingSocialLikes = structuredClone(currentSocialLikesByAccount());
    const openingDynamicSocialUsers = structuredClone(currentDynamicSocialUsers());
    const openingSocialConnections = structuredClone(currentSocialConnectionsByCharacter());
    const openingNotes = structuredClone(currentPhoneNotesByCharacter());
    const openingChatGpdChats = structuredClone(currentChatGpdChatsByCharacter());
    const countRecords = (records: Record<string, unknown[]>) =>
      Object.values(records).reduce((count, entries) => count + entries.length, 0);
    const openingNoteCount = countRecords(openingNotes);
    const openingChatGpdChatCount = countRecords(openingChatGpdChats);
    const openingSocialLikeCount = countRecords(openingSocialLikes);
    const openingSocialConnectionCount = Object.values(openingSocialConnections).reduce(
      (count, apps) => count + (apps.fotogram?.length ?? 0) + (apps.onlyfriends?.length ?? 0),
      0,
    );
    const phoneAppParts = [
      openingNoteCount ? `${openingNoteCount} phone note${openingNoteCount === 1 ? '' : 's'}` : '',
      openingChatGpdChatCount
        ? `${openingChatGpdChatCount} ChatGPD chat${openingChatGpdChatCount === 1 ? '' : 's'}`
        : '',
      openingSocialLikeCount
        ? `${openingSocialLikeCount} social like${openingSocialLikeCount === 1 ? '' : 's'}`
        : '',
      openingSocialConnectionCount
        ? `${openingSocialConnectionCount} added social user${openingSocialConnectionCount === 1 ? '' : 's'}`
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
        voiceMedia: historyMedia.voiceMedia,
        socialLikes: openingSocialLikes,
        dynamicSocialUsers: openingDynamicSocialUsers,
        socialConnections: openingSocialConnections,
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
    if (!node || node.data.nodeType !== 'rp-storybook') {
      return;
    }
    const storybook = node.data.storybookJson
      ? parseRpStorybookJson(node.data.storybookJson)
      : emptyRpStorybook;
    const nextStorybook = {
      ...storybook,
      openingHistory: emptyRpStorybook.openingHistory,
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
    if (!node || node.data.nodeType !== 'rp-storybook') {
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
      storybookJson: rpStorybookJsonText(emptyRpStorybook),
      storybookStatus: 'Storybook and current session reset.',
      storybookFileName: undefined,
      storybookFilePath: undefined,
    });
  }

  async function exportStorybookCharacter(nodeId: string, characterId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook') {
      return;
    }
    try {
      const storybook = node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybook;
      const character = storybook.characters.find((entry) => entry.id === characterId);
      if (!character) {
        updateRuntimeNode(nodeId, { storybookStatus: 'Export failed: character not found.' });
        return;
      }
      requestSaveCharacter(nodeId, rpCharacterCardForCharacter(character));
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { storybookStatus: `Character export failed: ${messageText}` });
      notifySystem('error', `Character export failed: ${messageText}`);
    }
  }

  async function importCharacterCard(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook') {
      return;
    }
    try {
      setCharacterImportNodeId(nodeId);
      setSelectedCharacterFile(null);
      setCharacterFileStatus('');
      setShowCharacterFiles(true);
      setCharacterFiles(await window.rpgraph.listCharacterFiles());
    } catch (error) {
      const messageText = errorMessage(error);
      setCharacterFileStatus(`Unable to list characters: ${messageText}`);
    }
  }

  function closeCharacterFiles() {
    setShowCharacterFiles(false);
    setSelectedCharacterFile(null);
    setCharacterFileStatus('');
  }

  function cancelCharacterCardUnlock() {
    setPendingCharacterLoad(null);
    setShowCharacterFiles(true);
  }

  async function beginCharacterCardImport(
    nodeId: string,
    file: Pick<SavedFileSummary, 'fileName' | 'type' | 'protection' | 'compatible' | 'formatVersion' | 'storage'> & {
      filePath?: string;
    },
  ) {
    if (file.type !== 'character-card') {
      setCharacterFileStatus('The selected file is not an RPGraph Character Card.');
      return;
    }
    if (!file.compatible) {
      setCharacterFileStatus(
        `Character Card Format ${file.formatVersion ?? 'Unknown'} is incompatible.`,
      );
      return;
    }
    if (file.protection === 'encrypted') {
      setPendingCharacterLoad({
        nodeId,
        fileName: file.fileName,
        ...(file.filePath ? { filePath: file.filePath } : {}),
        ...(file.storage ? { storage: file.storage } : {}),
      });
      setPendingSessionFilePath(file.filePath ?? null);
      setSessionPassword('');
      setFileStorageStatus('This character card is password protected. Enter its password or PIN to import it.');
      setShowCharacterFiles(false);
      setSessionPasswordAction('load-character');
      return;
    }
    const loaded = file.filePath
      ? await window.rpgraph.loadFilePath(file.filePath)
      : await window.rpgraph.loadFile(file.fileName, '', file.storage);
    applyCharacterCardToNode(nodeId, loaded.value, loaded.fileName);
    closeCharacterFiles();
  }

  async function importSelectedCharacterCard(file?: SavedFileSummary) {
    const nodeId = characterImportNodeId;
    const selected = file ?? characterFiles.find((entry) => entry.fileName === selectedCharacterFile);
    if (!nodeId || !selected) {
      setCharacterFileStatus('Select a character first.');
      return;
    }
    try {
      setSelectedCharacterFile(selected.fileName);
      setCharacterFileStatus('Importing character ...');
      await beginCharacterCardImport(nodeId, selected);
    } catch (error) {
      const message = `Character import failed: ${errorMessage(error)}`;
      setCharacterFileStatus(message);
      updateRuntimeNode(nodeId, { storybookStatus: message });
      notifySystem('error', message);
    }
  }

  async function openExternalCharacterCard() {
    const nodeId = characterImportNodeId;
    if (!nodeId) {
      setCharacterFileStatus('Open the Character importer again.');
      return;
    }
    try {
      const file = await window.rpgraph.selectCharacterFile();
      if (file.canceled || !file.filePath || !file.fileName) {
        return;
      }
      await beginCharacterCardImport(nodeId, {
        fileName: file.fileName,
        filePath: file.filePath,
        type: file.type ?? 'unknown',
        protection: file.protection ?? 'unknown',
        compatible: file.compatible === true,
        formatVersion: file.formatVersion,
      });
    } catch (error) {
      const message = `Character import failed: ${errorMessage(error)}`;
      setCharacterFileStatus(message);
      updateRuntimeNode(nodeId, { storybookStatus: message });
      notifySystem('error', message);
    }
  }

  function applyCharacterCardToNode(nodeId: string, cardValue: unknown, fileName: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook') {
      throw new Error('Add an RP Storybook V2 node before importing a character card.');
    }
    const currentStorybook = node.data.storybookJson
      ? parseRpStorybookJson(node.data.storybookJson)
      : emptyRpStorybook;
    const plan = planCharacterCardImport(cardValue, currentStorybook);
    const label = plan.character.name || plan.character.id;
    const action = plan.replacesIndex !== undefined ? 'Replaced' : 'Added';
    const commitError = commitStorybookToNode(nodeId, plan.storybook, {
      storybookStatus: `${action} character ${label} from ${fileName}.`,
    });
    if (commitError) {
      throw new Error(commitError);
    }
    notifySystem('info', `${action} character ${label} from a character card. Check scenario texts for consistency and save the storybook.`);
    setStorybookCreatorMessages((current) => [
      ...current,
      {
        role: 'assistant',
        text: `${action} character ${label} from ${fileName}. Run "Check Story Logic" from the ⋯ menu to align the scenario texts with the new cast, then save the storybook.`,
      },
    ]);
  }

  async function unlockCharacterCard() {
    const pending = pendingCharacterLoad;
    if (!pending) {
      setSessionPasswordAction(null);
      return;
    }
    if (!sessionPassword) {
      setFileStorageStatus('Enter a password or PIN for the encrypted character card.');
      return;
    }
    try {
      setFileStorageStatus('Unlocking character card ...');
      const result = pending.filePath
        ? await window.rpgraph.loadFilePath(pending.filePath, sessionPassword)
        : await window.rpgraph.loadFile(pending.fileName, sessionPassword, pending.storage);
      applyCharacterCardToNode(pending.nodeId, result.value, result.fileName);
      setPendingCharacterLoad(null);
      setPendingSessionFilePath(null);
      setSessionPassword('');
      setSessionPasswordAction(null);
      setShowCharacterFiles(false);
      setFileStorageStatus(`Imported encrypted character: ${result.name}`);
    } catch (error) {
      const message = `Character import failed: ${errorMessage(error)}`;
      updateRuntimeNode(pending.nodeId, { storybookStatus: message });
      setFileStorageStatus(message);
    }
  }

  async function importSillyTavernCharacter(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook') {
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
        : emptyRpStorybook;
      const currentJson = rpStorybookPromptJsonText(currentStorybook);
      const instruction = sillyTavernImportInstruction(
        currentStorybook,
        importedCharacter,
        file.fileName ?? 'selected JSON file',
      );
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
      const validatedImport = validateSillyTavernImportResult(
        currentStorybook,
        result,
        importedCharacter,
      );
      const commitError = commitStorybookToNode(nodeId, result.storybook, {
        storybookStatus: `${validatedImport.action === 'added' ? 'Added' : 'Updated'} ${validatedImport.characterName} from ${file.fileName ?? 'SillyTavern JSON'} via ${completion.connection.label}`,
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
          text: `${validatedImport.action === 'added' ? 'Added' : 'Updated'} character ${validatedImport.characterName}: ${result.reply}`,
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
    commitStorybookToNode,
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
    showCharacterFiles,
    characterFiles,
    selectedCharacterFile,
    characterFileStatus,
    setSelectedCharacterFile,
    closeCharacterFiles,
    cancelCharacterCardUnlock,
    importSelectedCharacterCard,
    openExternalCharacterCard,
    applyCharacterCardToNode,
    unlockCharacterCard,
    loadStorybookFile,
  };
}
