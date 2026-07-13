// Shared interface for persistent phone-app actions. Every action here is
// serialized to a structured JSON payload and executed as a directActionOnly
// graph run, so it becomes a real turn with history, trace, undo, and
// regeneration instead of a silent app-state write.

import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, TurnRecord } from '../types';
import { directAppActionJson, type DirectAppActionPayload } from '../chat/directAppActions';
import {
  hasCreatedPhoneNoteHistory,
  hasCreatedPhoneNoteRecordHistory,
  hasSimulatedAiChatHistory,
  lastCreatedPhoneNoteTurn,
  lastDirectCreatedPhoneNoteTurn,
  lastDirectSimulatedAiChatTurn,
  manualCreatedPhoneNoteCommit,
  manualSimulatedAiChatCommit,
} from '../chat/phoneAppHistoryMessages';
import type {
  ChatGpdChatRecord,
  CreatedPhoneNoteCommit,
  PhoneNoteRecord,
  PhoneNotesByCharacter,
} from '../chat/phoneAppsSessions';
import type { PhoneNoteColor } from '../chat/phoneAppsSessions';
import { onlyFriendsWalletName } from '../chat/onlyFriendsWallet';
import { normalRpMessageFormat } from '../chat/messageFormats';
import { turnMessageIds } from '../chat/turns';
import type { useGraphRun } from './useGraphRun';

type RunGraph = ReturnType<typeof useGraphRun>['runGraph'];

type UseDirectAppActionsOptions = {
  runGraph: RunGraph;
  isRunning: boolean;
  messagesRef: { current: MessageRecord[] };
  turnsRef: { current: TurnRecord[] };
  applyTurnCheckpointRuntime: (turn: TurnRecord, target: 'before' | 'after') => void;
  undoLastTurn: () => void;
  replaceLastTurnCreatedPhoneNote: (commit: CreatedPhoneNoteCommit) => boolean;
  removeLastTurnCreatedPhoneNote: (characterId: string, noteId: string) => boolean;
  viewedPhoneCharacter: StorybookCharacter | undefined;
  phoneNotesByCharacter: PhoneNotesByCharacter;
  setPhoneNotesByCharacter: (
    updater: (current: PhoneNotesByCharacter) => PhoneNotesByCharacter,
  ) => void;
  notifySystem: (level: 'info' | 'warning' | 'error', text: string) => void;
};

export function useDirectAppActions({
  runGraph,
  isRunning,
  messagesRef,
  turnsRef,
  applyTurnCheckpointRuntime,
  undoLastTurn,
  replaceLastTurnCreatedPhoneNote,
  removeLastTurnCreatedPhoneNote,
  viewedPhoneCharacter,
  phoneNotesByCharacter,
  setPhoneNotesByCharacter,
  notifySystem,
}: UseDirectAppActionsOptions) {
  function runDirectAppAction(
    actor: StorybookCharacter,
    payload: DirectAppActionPayload,
    replacementTurn?: TurnRecord,
  ) {
    if (isRunning) {
      notifySystem('warning', 'Wait for the current run to finish before starting an app action.');
      return false;
    }
    const replacedMessageIds = replacementTurn
      ? new Set(replacementTurn.output.messages.map((message) => message.id))
      : undefined;
    const historyMessages = replacementTurn
      ? messagesRef.current.filter((message) => !turnMessageIds(replacementTurn).has(message.id))
      : messagesRef.current;
    if (replacementTurn) {
      applyTurnCheckpointRuntime(replacementTurn, 'before');
    }
    void runGraph(
      directAppActionJson(payload),
      [],
      undefined,
      historyMessages,
      replacedMessageIds,
      actor,
      false,
      undefined,
      replacementTurn ? { turn: replacementTurn, replaceInput: false } : undefined,
      'user',
      undefined,
      undefined,
      undefined,
      false,
      normalRpMessageFormat,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    return true;
  }

  function submitBankTransfer(request: {
    from: StorybookCharacter;
    to: string;
    amount: number;
    note: string;
  }) {
    runDirectAppAction(request.from, {
      kind: 'bankTransfer',
      transfer: {
        from: request.from.name,
        to: request.to,
        amount: request.amount,
        note: request.note,
      },
    });
  }

  function submitOnlyFriendsWalletTransfer(request: {
    owner: StorybookCharacter;
    direction: 'top-up' | 'withdraw';
    amount: number;
  }) {
    const topUp = request.direction === 'top-up';
    runDirectAppAction(request.owner, {
      kind: 'bankTransfer',
      transfer: {
        from: topUp ? request.owner.name : onlyFriendsWalletName,
        to: topUp ? onlyFriendsWalletName : request.owner.name,
        amount: request.amount,
        note: topUp ? 'OnlyFriends wallet top-up' : 'OnlyFriends wallet withdrawal',
      },
    });
  }

  function commitCreatedPhoneNote(note: PhoneNoteRecord) {
    const character = viewedPhoneCharacter;
    const commit = manualCreatedPhoneNoteCommit(character, note);
    if (!character || !commit) {
      return false;
    }
    if (hasCreatedPhoneNoteHistory(messagesRef.current, commit)) {
      const storedNote = (phoneNotesByCharacter[character.id] ?? []).find(
        (entry) => entry.id === note.id,
      );
      if (storedNote && storedNote.color !== note.color) {
        updatePhoneNoteColor(note.id, note.color);
      }
      return true;
    }
    const existingNotes = phoneNotesByCharacter[character.id] ?? [];
    const operation = existingNotes.some((entry) => entry.id === note.id) ? 'update' : 'create';
    const lastCommitTurn = lastCreatedPhoneNoteTurn(turnsRef.current, character.id, note.id);
    if (lastCommitTurn && !lastCommitTurn.directAction) {
      if (isRunning) {
        notifySystem('warning', 'Wait for the current run to finish before updating this note.');
        return false;
      }
      if (!replaceLastTurnCreatedPhoneNote(commit)) {
        return false;
      }
      setPhoneNotesByCharacter((current) => ({
        ...current,
        [character.id]: (current[character.id] ?? []).map((entry) =>
          entry.id === commit.note.id ? structuredClone(commit.note) : entry,
        ),
      }));
      return true;
    }
    const replacementTurn = lastDirectCreatedPhoneNoteTurn(
      turnsRef.current,
      character.id,
      note.id,
    );
    return runDirectAppAction(character, {
      kind: 'createdPhoneNote',
      commit: { ...commit, operation },
    }, replacementTurn);
  }

  function updatePhoneNoteColor(noteId: string, color: PhoneNoteColor) {
    const character = viewedPhoneCharacter;
    if (!character) {
      return;
    }
    setPhoneNotesByCharacter((current) => ({
      ...current,
      [character.id]: (current[character.id] ?? []).map((note) =>
        note.id === noteId ? { ...note, color } : note,
      ),
    }));
  }

  function deletePhoneNote(noteId: string) {
    const character = viewedPhoneCharacter;
    const note = character
      ? (phoneNotesByCharacter[character.id] ?? []).find((entry) => entry.id === noteId)
      : undefined;
    if (!character || !note) {
      return true;
    }
    const lastCommitTurn = lastCreatedPhoneNoteTurn(
      turnsRef.current,
      character.id,
      noteId,
    );
    if (lastCommitTurn) {
      if (isRunning) {
        notifySystem('warning', 'Wait for the current run to finish before deleting this note.');
        return false;
      }
      if (lastCommitTurn.directAction) {
        undoLastTurn();
      } else {
        if (!removeLastTurnCreatedPhoneNote(character.id, noteId)) {
          return false;
        }
        setPhoneNotesByCharacter((current) => {
          const retained = (current[character.id] ?? []).filter((entry) => entry.id !== noteId);
          const next = { ...current };
          if (retained.length) {
            next[character.id] = retained;
          } else {
            delete next[character.id];
          }
          return next;
        });
      }
      return true;
    }
    if (hasCreatedPhoneNoteRecordHistory(messagesRef.current, character.id, noteId)) {
      return runDirectAppAction(character, {
        kind: 'deletedPhoneNote',
        commit: {
          characterId: character.id,
          characterName: character.name,
          note: structuredClone(note),
        },
      });
    }
    setPhoneNotesByCharacter((current) => {
      const retained = (current[character.id] ?? []).filter((entry) => entry.id !== noteId);
      const next = { ...current };
      if (retained.length) {
        next[character.id] = retained;
      } else {
        delete next[character.id];
      }
      return next;
    });
    return true;
  }

  function commitChatGpdChat(chat: ChatGpdChatRecord) {
    const character = viewedPhoneCharacter;
    const commit = manualSimulatedAiChatCommit(character, chat);
    if (!character || !commit) {
      return false;
    }
    if (hasSimulatedAiChatHistory(messagesRef.current, commit)) {
      return true;
    }
    const replacementTurn = lastDirectSimulatedAiChatTurn(
      turnsRef.current,
      character.id,
      chat.id,
    );
    return runDirectAppAction(
      character,
      { kind: 'simulatedAiChat', commit },
      replacementTurn,
    );
  }

  return {
    submitBankTransfer,
    submitOnlyFriendsWalletTransfer,
    commitCreatedPhoneNote,
    updatePhoneNoteColor,
    deletePhoneNote,
    commitChatGpdChat,
  };
}
