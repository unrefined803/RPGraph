import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { restoreTurnRuntime } from './turns';
import {
  applyTurnCheckpointToNodes,
  createTurnCheckpointFromNodesForTurnRecord,
  trimCheckpoints,
  workflowVariablesFromTurnCheckpoint,
} from '../data-management/checkpointStore';
import type { TurnCheckpoint } from '../data-management/types';
import type {
  MessageRecord,
  TurnRecord,
  TurnRecordMode,
  TurnRuntimeSnapshot,
  WorkflowNode,
} from '../types';
import { withStorybookImageDescriptions } from '../storybook/imageUsage';

type ActiveTurnCollector = {
  turnId: string;
  turnNumber: number;
  createdAt: string;
  part: 'input' | 'output';
  inputMessages: MessageRecord[];
  outputMessages: MessageRecord[];
};

export type TurnReplacement = {
  turn: TurnRecord;
  replaceInput: boolean;
};

type UseTurnRecordStateOptions = {
  nodesRef: RefObject<WorkflowNode[]>;
  setNodes: Dispatch<SetStateAction<WorkflowNode[]>>;
  workflowVariablesRef: RefObject<Record<string, string>>;
  setWorkflowVariables: (values: Record<string, string>) => void;
};

type AppendMessageInput = Omit<MessageRecord, 'id' | 'isOpening'>;

export function useTurnRecordState({
  nodesRef,
  setNodes,
  workflowVariablesRef,
  setWorkflowVariables,
}: UseTurnRecordStateOptions) {
  const [messages, setMessagesState] = useState<MessageRecord[]>([]);
  const [turns, setTurnsState] = useState<TurnRecord[]>([]);
  const [turnCheckpoints, setTurnCheckpointsState] = useState<TurnCheckpoint[]>([]);
  const messagesRef = useRef(messages);
  const turnsRef = useRef(turns);
  const turnCheckpointsRef = useRef(turnCheckpoints);
  const nextMessageIdRef = useRef(1);
  const activeTurnCollectorRef = useRef<ActiveTurnCollector | null>(null);

  // All writes must go through these setters so the refs stay in sync with the
  // state without ref writes during render.
  function setMessages(update: SetStateAction<MessageRecord[]>) {
    const next = typeof update === 'function' ? update(messagesRef.current) : update;
    messagesRef.current = next;
    setMessagesState(next);
  }

  function setTurns(update: SetStateAction<TurnRecord[]>) {
    const next = typeof update === 'function' ? update(turnsRef.current) : update;
    turnsRef.current = next;
    setTurnsState(next);
  }

  function setTurnCheckpoints(nextCheckpoints: TurnCheckpoint[]) {
    turnCheckpointsRef.current = nextCheckpoints;
    setTurnCheckpointsState(nextCheckpoints);
  }

  function appendMessage({
    role,
    originalText,
    translatedText,
    imageAttachments,
    includeInHistory = role !== 'error',
    speakerName,
    speakerNames,
    speakerColors,
    originalDialogue,
    translatedDialogue,
    turnContext,
    channel,
    eventInput,
    eventDisplayText,
    phoneMessage,
    phoneFrom,
    phoneTo,
    phoneVoiceMessage,
    phoneAutoTurnSource,
    embeddedPhoneMessages,
    embeddedPhoneTextBefore,
    embeddedPhoneTextAfter,
    embeddedPhoneTranslatedTextBefore,
    embeddedPhoneTranslatedTextAfter,
    phoneImageIds,
    phoneImageDescription,
    phoneImageCaptionChange,
    replyToMessageId,
    inputMessageFormat,
    inputPromptSlot,
    rpImageDescription,
    rpImageName,
    outputActionChoices,
    outputActionsHidden,
    outputActionsHiddenByTurnId,
    outputActionInfoBoxes,
    outputActionProgressBars,
    outputActionContextCapacityBars,
    rpDateTime,
    voiceClips,
    bankTransfer,
    socialPost,
    socialThreadAction,
    socialReactions,
  }: AppendMessageInput) {
    const id = nextMessageIdRef.current;
    nextMessageIdRef.current += 1;
    const collector = activeTurnCollectorRef.current;
    const message: MessageRecord = {
      id,
      role,
      originalText,
      translatedText,
      imageAttachments,
      includeInHistory,
      speakerName,
      speakerNames,
      speakerColors,
      originalDialogue,
      translatedDialogue,
      turnContext,
      channel,
      eventInput,
      eventDisplayText,
      phoneMessage,
      phoneFrom,
      phoneTo,
      phoneVoiceMessage,
      phoneAutoTurnSource,
      embeddedPhoneMessages,
      embeddedPhoneTextBefore,
      embeddedPhoneTextAfter,
      embeddedPhoneTranslatedTextBefore,
      embeddedPhoneTranslatedTextAfter,
      phoneImageIds,
      phoneImageDescription,
      phoneImageCaptionChange,
      replyToMessageId,
      inputMessageFormat,
      inputPromptSlot,
      rpImageDescription,
      rpImageName,
      outputActionChoices,
      outputActionsHidden,
      outputActionsHiddenByTurnId,
      outputActionInfoBoxes,
      outputActionProgressBars,
      outputActionContextCapacityBars,
      rpDateTime,
      voiceClips,
      bankTransfer,
      socialPost,
      socialThreadAction,
      socialReactions,
      turnId: collector?.turnId,
      turnNumber: collector?.turnNumber,
      turnPart: collector?.part,
    };
    if (collector) {
      const collectedMessages =
        collector.part === 'input' ? collector.inputMessages : collector.outputMessages;
      collectedMessages.push(message);
    }
    messagesRef.current = [...messagesRef.current, message];
    setMessages(messagesRef.current);
    return id;
  }

  function updateMessage(messageId: number, patch: Partial<MessageRecord>) {
    const patchMessages = (current: MessageRecord[]) =>
      current.map((message) =>
        message.id === messageId ? { ...message, ...patch } : message,
      );
    const collector = activeTurnCollectorRef.current;
    if (collector) {
      collector.inputMessages = patchMessages(collector.inputMessages);
      collector.outputMessages = patchMessages(collector.outputMessages);
    }
    const nextTurns = turnsRef.current.map((turn) => ({
      ...turn,
      input: {
        ...turn.input,
        messages: patchMessages(turn.input.messages),
      },
      output: {
        ...turn.output,
        messages: patchMessages(turn.output.messages),
      },
    }));
    setTurns(nextTurns);
    messagesRef.current = patchMessages(messagesRef.current);
    setMessages(messagesRef.current);
  }

  function updateHistoryMessageTimes(patches: Array<{ id: number; rpDateTime: string }>) {
    const timeById = new Map(patches.map((patch) => [patch.id, patch.rpDateTime]));
    const patchMessages = (current: MessageRecord[]) =>
      current.map((message) => {
        const rpDateTime = timeById.get(message.id);
        return rpDateTime ? { ...message, rpDateTime } : message;
      });
    const collector = activeTurnCollectorRef.current;
    if (collector) {
      collector.inputMessages = patchMessages(collector.inputMessages);
      collector.outputMessages = patchMessages(collector.outputMessages);
    }
    const nextTurns = turnsRef.current.map((turn) => ({
      ...turn,
      input: { ...turn.input, messages: patchMessages(turn.input.messages) },
      output: { ...turn.output, messages: patchMessages(turn.output.messages) },
    }));
    messagesRef.current = patchMessages(messagesRef.current);
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    setMessages(messagesRef.current);
  }

  function updatePhoneImageDescriptions(descriptionsById: ReadonlyMap<string, string>) {
    const patchMessages = (current: MessageRecord[]) =>
      withStorybookImageDescriptions(current, descriptionsById);
    const collector = activeTurnCollectorRef.current;
    if (collector) {
      collector.inputMessages = patchMessages(collector.inputMessages);
      collector.outputMessages = patchMessages(collector.outputMessages);
    }
    const nextTurns = turnsRef.current.map((turn) => ({
      ...turn,
      input: { ...turn.input, messages: patchMessages(turn.input.messages) },
      output: { ...turn.output, messages: patchMessages(turn.output.messages) },
    }));
    messagesRef.current = patchMessages(messagesRef.current);
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    setMessages(messagesRef.current);
  }

  function removeMessage(messageId: number) {
    messagesRef.current = messagesRef.current.filter((message) => message.id !== messageId);
    setMessages(messagesRef.current);
  }

  function applyTurnRuntime(snapshot: TurnRuntimeSnapshot) {
    const restoredNodes = restoreTurnRuntime(nodesRef.current, snapshot);
    nodesRef.current = restoredNodes;
    setNodes(restoredNodes);
    if (snapshot.workflowVariables) {
      setWorkflowVariables(snapshot.workflowVariables);
    }
  }

  function applyTurnCheckpointRuntime(turn: TurnRecord, target: 'before' | 'after') {
    const checkpoint =
      turnCheckpointsRef.current.find((entry) => entry.turnId === turn.id) ?? {
        turnId: turn.id,
        createdTimelineEntryIds: [],
        nodeSnapshots: {},
      };
    const restoredNodes = applyTurnCheckpointToNodes(nodesRef.current, checkpoint, target);
    nodesRef.current = restoredNodes;
    setNodes(restoredNodes);
    const workflowVariables = workflowVariablesFromTurnCheckpoint(checkpoint, target);
    if (workflowVariables) {
      setWorkflowVariables(workflowVariables);
    }
  }

  function removeTurnCheckpoint(turnId: string) {
    const nextCheckpoints = turnCheckpointsRef.current.filter((checkpoint) => checkpoint.turnId !== turnId);
    turnCheckpointsRef.current = nextCheckpoints;
    setTurnCheckpoints(nextCheckpoints);
  }

  function commitCollectedTurn(
    inputGraphText: string,
    outputGraphText: string,
    checkpointBeforeNodes: WorkflowNode[],
    checkpointBeforeWorkflowVariables: Record<string, string>,
    replacement?: TurnReplacement,
    mode: TurnRecordMode = 'user',
    metadata: Pick<TurnRecord, 'messageFormat' | 'promptSlot'> = {},
  ) {
    const collector = activeTurnCollectorRef.current;
    if (!collector) {
      return undefined;
    }
    const turn: TurnRecord = {
      id: collector.turnId,
      number: collector.turnNumber,
      createdAt: collector.createdAt,
      openingHistory: replacement?.turn.openingHistory || undefined,
      mode,
      messageFormat: metadata.messageFormat,
      promptSlot: metadata.promptSlot,
      input: {
        graphText: inputGraphText,
        messages: collector.inputMessages,
      },
      output: {
        graphText: outputGraphText,
        messages: collector.outputMessages,
      },
    };
    const nextTurns = replacement
      ? turnsRef.current.map((existingTurn) =>
          existingTurn.id === replacement.turn.id ? turn : existingTurn,
        )
      : [...turnsRef.current, turn];
    const checkpoint = createTurnCheckpointFromNodesForTurnRecord(
      turn,
      checkpointBeforeNodes,
      nodesRef.current,
      checkpointBeforeWorkflowVariables,
      workflowVariablesRef.current,
    );
    const existingCheckpointIndex = replacement
      ? turnCheckpointsRef.current.findIndex((entry) => entry.turnId === replacement.turn.id)
      : -1;
    const nextCheckpoints = trimCheckpoints(
      existingCheckpointIndex >= 0
        ? turnCheckpointsRef.current.map((existingCheckpoint, index) =>
            index === existingCheckpointIndex ? checkpoint : existingCheckpoint,
          )
        : [...turnCheckpointsRef.current, checkpoint],
    );
    turnsRef.current = nextTurns;
    turnCheckpointsRef.current = nextCheckpoints;
    setTurns(nextTurns);
    setTurnCheckpoints(nextCheckpoints);
    activeTurnCollectorRef.current = null;
    return turn;
  }

  return {
    messages,
    setMessages,
    messagesRef,
    turns,
    setTurns,
    turnsRef,
    turnCheckpoints,
    setTurnCheckpoints,
    turnCheckpointsRef,
    nextMessageIdRef,
    activeTurnCollectorRef,
    appendMessage,
    updateMessage,
    updateHistoryMessageTimes,
    updatePhoneImageDescriptions,
    removeMessage,
    applyTurnRuntime,
    applyTurnCheckpointRuntime,
    removeTurnCheckpoint,
    commitCollectedTurn,
  };
}
