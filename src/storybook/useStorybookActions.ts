import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { StorybookCreatorMessage } from '../components/AppDialogs';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import {
  emptyRpStorybookV1,
  parseRpStorybookAssistantResult,
  parseRpStorybookJson,
  rpStorybookEditPrompt,
  rpStorybookJsonText,
  rpStorybookPromptJsonText,
} from '../nodes/rp-storybook-v1/model';
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
import type { TurnCheckpoint } from '../data-management/types';

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
};

export function useStorybookActions({
  nodesRef,
  turnsRef,
  turnCheckpointsRef,
  currentSocialLikesByAccount,
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
}: UseStorybookActionsOptions) {
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

  function commitStorybookToNode(
    nodeId: string,
    storybook: ReturnType<typeof parseRpStorybookJson>,
    patch: Partial<WorkflowNodeData>,
  ) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    let committedStorybook = storybook;
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
        return false;
      }
    }
    updateRuntimeNode(nodeId, {
      ...patch,
      storybookJson: rpStorybookJsonText(committedStorybook),
    });
    return true;
  }

  function updateStorybook(nodeId: string, storybook: ReturnType<typeof parseRpStorybookJson>, status?: string) {
    return commitStorybookToNode(
      nodeId,
      storybook,
      { storybookStatus: status ?? 'Storybook updated.' },
    );
  }

  function openStorybookCreator(nodeId: string) {
    setStorybookCreatorNodeId(nodeId);
    setStorybookCreatorMessages([]);
  }

  async function submitStorybookCreatorMessage(message: string) {
    const nodeId = storybookCreatorNodeId;
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!nodeId || !node || node.data.nodeType !== 'rp-storybook-v1') {
      return;
    }

    setStorybookCreatorMessages((current) => [...current, { role: 'user', text: message }]);
    setStorybookCreatorSubmitting(true);
    updateRuntimeNode(nodeId, {
      storybookStatus: 'Thinking ...',
      llmCallStats: [],
    });

    try {
      const currentStorybook = node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybookV1;
      const currentJson = rpStorybookPromptJsonText(currentStorybook);
      const completion = await nodeLlm.complete({
        connectionId: node.data.connectionId,
        nodeId,
        label: 'Storybook Chat',
        prompt: rpStorybookEditPrompt(currentJson, message),
      });
      const result = parseRpStorybookAssistantResult(completion.text, currentStorybook);
      const changedFields = result.changedFields.slice(0, 4);
      const changedSummary = changedFields.length
        ? `edit ${changedFields.join(' + ')}${result.changedFields.length > changedFields.length ? ' + more' : ''}`
        : 'answer';
      if (result.changedFields.length) {
        const applied = commitStorybookToNode(nodeId, result.storybook, {
          storybookStatus: `Edited via ${completion.connection.label}`,
        });
        if (!applied) {
          setStorybookCreatorMessages((current) => [
            ...current,
            { role: 'error', text: 'Cannot delete: image is used in chat history.' },
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

  function applyStorybookToNode(
    nodeId: string,
    storybookValue: unknown,
    fileName?: string,
    filePath?: string,
    status = 'Loaded storybook',
  ) {
    const storybook = parseRpStorybookJson(JSON.stringify(storybookValue));
    const applied = commitStorybookToNode(nodeId, storybook, {
      storybookStatus: fileName ? `${status}: ${fileName}` : status,
      storybookFileName: fileName,
      storybookFilePath: filePath,
    });
    return applied;
  }

  function importCurrentChatAsOpeningHistory(nodeId: string) {
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
    const nextStorybook = {
      ...storybook,
      openingHistory: {
        summary: historyTurns.length || normalizedOpeningEvents.length
          ? `Imported from current RP session: ${historyMessageCount} messages and ${normalizedOpeningEvents.length} events across ${historyTurns.length} turns.`
          : '',
        turns: historyTurns,
        checkpoints: historyCheckpoints,
        events: normalizedOpeningEvents,
        // Player likes are session UI state, not message records, so they are
        // snapshotted into the opening history explicitly.
        socialLikes: structuredClone(currentSocialLikesByAccount()),
      },
    };
    replaceCurrentChatWithOpeningHistoryRef.current = true;
    updateRuntimeNode(nodeId, {
      storybookJson: rpStorybookJsonText(nextStorybook),
      storybookStatus: historyTurns.length || normalizedOpeningEvents.length
        ? `Imported ${historyTurns.length} opening history turns and ${normalizedOpeningEvents.length} events.`
        : 'No current chat messages or events to import.',
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

  function resetStorybook(nodeId: string) {
    commitStorybookToNode(nodeId, emptyRpStorybookV1, {
      storybookStatus: 'Storybook reset.',
      storybookFileName: undefined,
      storybookFilePath: undefined,
    });
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
        `Import this SillyTavern character JSON from "${file.fileName ?? 'selected JSON file'}" into the RPGraph Storybook V1 format.`,
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
        prompt: rpStorybookEditPrompt(currentJson, instruction),
      });
      const result = parseRpStorybookAssistantResult(completion.text, currentStorybook);
      const applied = commitStorybookToNode(nodeId, result.storybook, {
        storybookStatus: `Imported ${file.fileName ?? 'SillyTavern JSON'} via ${completion.connection.label}`,
        storybookFileName: undefined,
        storybookFilePath: undefined,
      });
      if (!applied) {
        setStorybookCreatorMessages((current) => [
          ...current,
          { role: 'error', text: 'Cannot delete: image is used in chat history.' },
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
        setFileStorageStatus('Cannot load storybook: an image is used in chat history.');
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
    importCurrentChatAsOpeningHistory,
    clearStorybookOpeningHistory,
    resetStorybook,
    importSillyTavernCharacter,
    loadStorybookFile,
  };
}
