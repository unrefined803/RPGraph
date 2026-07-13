// Payloads for direct app actions: persistent phone-app operations that run
// through the workflow as a directActionOnly turn (User Input "Direct
// Actions" -> RP Output "Direct Actions") instead of being written silently
// into the app state. The JSON produced here is parsed and validated by
// parseOutputActions with the phoneAppCommits option enabled.

import type {
  CreatedPhoneNoteCommit,
  DeletedPhoneNoteCommit,
  SimulatedAiChatCommit,
} from './phoneAppsSessions';

export type DirectAppActionPayload =
  | {
      kind: 'bankTransfer';
      transfer: { from: string; to: string; amount: number; note: string };
    }
  | { kind: 'createdPhoneNote'; commit: CreatedPhoneNoteCommit }
  | { kind: 'deletedPhoneNote'; commit: DeletedPhoneNoteCommit }
  | { kind: 'simulatedAiChat'; commit: SimulatedAiChatCommit };

export function directAppActionJson(payload: DirectAppActionPayload): string {
  if (payload.kind === 'bankTransfer') {
    const { transfer } = payload;
    return JSON.stringify({
      bankTransfers: [{
        from: transfer.from,
        to: transfer.to,
        amount: transfer.amount,
        ...(transfer.note.trim() ? { note: transfer.note.trim() } : {}),
      }],
    });
  }
  if (payload.kind === 'createdPhoneNote') {
    const { commit } = payload;
    return JSON.stringify({
      createdPhoneNotes: [{
        characterId: commit.characterId,
        characterName: commit.characterName,
        operation: commit.operation ?? 'create',
        note: commit.note,
      }],
    });
  }
  if (payload.kind === 'deletedPhoneNote') {
    const { commit } = payload;
    return JSON.stringify({
      deletedPhoneNotes: [{
        characterId: commit.characterId,
        characterName: commit.characterName,
        note: commit.note,
      }],
    });
  }
  const { commit } = payload;
  return JSON.stringify({
    simulatedAiChats: [{
      characterId: commit.characterId,
      characterName: commit.characterName,
      chat: commit.chat,
    }],
  });
}
