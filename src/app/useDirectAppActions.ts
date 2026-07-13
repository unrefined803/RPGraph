// Shared interface for persistent phone-app actions. Every action here is
// serialized to a structured JSON payload and executed as a directActionOnly
// graph run, so it becomes a real turn with history, trace, undo, and
// regeneration instead of a silent app-state write.

import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';
import { directAppActionJson, type DirectAppActionPayload } from '../chat/directAppActions';
import {
  hasCreatedPhoneNoteHistory,
  hasSimulatedAiChatHistory,
  manualCreatedPhoneNoteCommit,
  manualSimulatedAiChatCommit,
} from '../chat/phoneAppHistoryMessages';
import type {
  ChatGpdChatRecord,
  PhoneNoteRecord,
  PhoneNotesByCharacter,
} from '../chat/phoneAppsSessions';
import { onlyFriendsWalletName } from '../chat/onlyFriendsWallet';
import { normalRpMessageFormat } from '../chat/messageFormats';
import type { useGraphRun } from './useGraphRun';

type RunGraph = ReturnType<typeof useGraphRun>['runGraph'];

type UseDirectAppActionsOptions = {
  runGraph: RunGraph;
  isRunning: boolean;
  messagesRef: { current: MessageRecord[] };
  viewedPhoneCharacter: StorybookCharacter | undefined;
  phoneNotesByCharacter: PhoneNotesByCharacter;
  notifySystem: (level: 'info' | 'warning' | 'error', text: string) => void;
};

export function useDirectAppActions({
  runGraph,
  isRunning,
  messagesRef,
  viewedPhoneCharacter,
  phoneNotesByCharacter,
  notifySystem,
}: UseDirectAppActionsOptions) {
  function runDirectAppAction(actor: StorybookCharacter, payload: DirectAppActionPayload) {
    if (isRunning) {
      notifySystem('warning', 'Wait for the current run to finish before starting an app action.');
      return false;
    }
    void runGraph(
      directAppActionJson(payload),
      [],
      undefined,
      messagesRef.current,
      undefined,
      actor,
      false,
      undefined,
      undefined,
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
      return true;
    }
    const existingNotes = phoneNotesByCharacter[character.id] ?? [];
    const operation = existingNotes.some((entry) => entry.id === note.id) ? 'update' : 'create';
    return runDirectAppAction(character, {
      kind: 'createdPhoneNote',
      commit: { ...commit, operation },
    });
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
    return runDirectAppAction(character, { kind: 'simulatedAiChat', commit });
  }

  return {
    submitBankTransfer,
    submitOnlyFriendsWalletTransfer,
    commitCreatedPhoneNote,
    commitChatGpdChat,
  };
}
