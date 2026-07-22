import { parseRpStorybookJson, type RpStorybook } from '../nodes/rp-storybook/model';
import { chatAttachmentFromStorybookImage, isStorybookSourceNode } from './runtime';
import { storybookImageSourceById } from './imageLibrary';
import type { MessageRecord, TurnRecord, RpAppointment, WorkflowNode } from '../types';
import type { TurnCheckpoint } from '../data-management/types';
import {
  mergePhoneAppRecordsByCharacter,
  type ChatGpdChatsByCharacter,
  type PhoneNotesByCharacter,
} from '../chat/phoneAppsSessions';
import {
  normalizeDynamicSocialUsers,
  normalizeSocialConnectionsByCharacter,
  type DynamicSocialUsers,
  type SocialConnectionsByCharacter,
} from '../chat/socialDirectory';
import {
  turnsWithRehydratedStorybookVoices,
  turnsWithStorybookVoiceRefs,
} from './openingHistoryVoiceMedia';

function storybooksFromNodes(nodes: WorkflowNode[]): RpStorybook[] {
  return nodes.flatMap((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
      return [];
    }
    try {
      return [parseRpStorybookJson(node.data.storybookJson)];
    } catch {
      return [];
    }
  });
}

/**
 * Prepare runtime turns for storage in Storybook Opening History.
 * Gallery-backed images become id-only references, while generated voice clips
 * move into one deduplicated Storybook-level media pool. Unknown image
 * attachments keep their embedded copy so their content is not lost.
 */
export function turnsForStorybookOpeningHistory(
  turns: TurnRecord[],
  nodes: WorkflowNode[],
): Pick<RpStorybook['openingHistory'], 'turns' | 'voiceMedia'> {
  const storybooks = storybooksFromNodes(nodes);
  const forOpeningHistory = (message: MessageRecord): MessageRecord => {
    if (!message.imageAttachments?.length) {
      return message;
    }
    return {
      ...message,
      imageAttachments: message.imageAttachments.map((image) =>
        storybookImageSourceById(storybooks, image.id) ? { ...image, dataUrl: '' } : image,
      ),
    };
  };
  const turnsWithImageRefs = turns.map((turn) => ({
    ...turn,
    input: { ...turn.input, messages: turn.input.messages.map(forOpeningHistory) },
    output: { ...turn.output, messages: turn.output.messages.map(forOpeningHistory) },
  }));
  return turnsWithStorybookVoiceRefs(turnsWithImageRefs);
}

/**
 * Restore id-only image references back into full attachments from the
 * Storybook image library. References whose image was deleted from the
 * library are dropped.
 */
function messageWithRehydratedImages(
  message: MessageRecord,
  storybooks: RpStorybook[],
): MessageRecord {
  if (!message.imageAttachments?.some((image) => !image.dataUrl)) {
    return message;
  }
  const imageAttachments = message.imageAttachments.flatMap((image) => {
    if (image.dataUrl) {
      return [image];
    }
    const source = storybookImageSourceById(storybooks, image.id);
    return source ? [chatAttachmentFromStorybookImage(source.image)] : [];
  });
  return {
    ...message,
    imageAttachments: imageAttachments.length ? imageAttachments : undefined,
  };
}

export function openingHistoryEventsFromNodes(nodes: WorkflowNode[]): RpAppointment[] {
  return nodes.flatMap((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
      return [];
    }
    try {
      return parseRpStorybookJson(node.data.storybookJson).openingHistory.events;
    } catch {
      return [];
    }
  });
}

export function openingHistoryTurnsFromNodes(nodes: WorkflowNode[]) {
  // Image resolution spans every storybook: opening history messages store
  // id-only image references whose pixels live in the character galleries.
  const storybooks = storybooksFromNodes(nodes);
  return nodes.flatMap((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
      return [];
    }
    let storybook;
    try {
      storybook = parseRpStorybookJson(node.data.storybookJson);
    } catch {
      return [];
    }
    const rehydratedTurns = turnsWithRehydratedStorybookVoices(
      storybook.openingHistory.turns,
      storybook.openingHistory.voiceMedia,
    );
    return rehydratedTurns.map((storedTurn) => {
      const turnId = `opening-history-${node.id}-${storedTurn.id}`;
      const withRuntimeMetadata = (
        message: MessageRecord,
        turnPart: MessageRecord['turnPart'],
      ): MessageRecord => {
        const { isOpening: _isOpening, ...storedMessage } = structuredClone(message);
        return {
          ...messageWithRehydratedImages(storedMessage as MessageRecord, storybooks),
          turnId,
          turnNumber: storedTurn.number,
          turnPart,
        };
      };
      return {
        ...structuredClone(storedTurn),
        id: turnId,
        openingHistory: true,
        input: {
          ...structuredClone(storedTurn.input),
          messages: storedTurn.input.messages.map((message) => withRuntimeMetadata(message, 'input')),
        },
        output: {
          ...structuredClone(storedTurn.output),
          messages: storedTurn.output.messages.map((message) => withRuntimeMetadata(message, 'output')),
        },
      } satisfies TurnRecord;
    });
  }).sort((left, right) => left.number - right.number);
}

export function openingHistoryCheckpointsFromNodes(nodes: WorkflowNode[]) {
  return nodes.flatMap((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
      return [];
    }
    try {
      const storybook = parseRpStorybookJson(node.data.storybookJson);
      const runtimeTurnIds = new Map(
        storybook.openingHistory.turns.map((turn) => [
          turn.id,
          `opening-history-${node.id}-${turn.id}`,
        ]),
      );
      return storybook.openingHistory.checkpoints.flatMap((checkpoint) => {
        const turnId = runtimeTurnIds.get(checkpoint.turnId);
        return turnId
          ? [{ ...structuredClone(checkpoint), turnId } satisfies TurnCheckpoint]
          : [];
      });
    } catch {
      return [];
    }
  });
}

export function remapOpeningTurnMessageIds(openingTurns: TurnRecord[], startId: number) {
  let nextId = startId;
  const idMap = new Map<number, number>();
  const remappedTurns = structuredClone(openingTurns);
  remappedTurns.forEach((turn) => {
    [...turn.input.messages, ...turn.output.messages].forEach((message) => {
      const storedId = message.id;
      message.id = nextId;
      idMap.set(storedId, nextId);
      nextId += 1;
    });
  });
  remappedTurns.forEach((turn) => {
    [...turn.input.messages, ...turn.output.messages].forEach((message) => {
      if (message.embeddedPhoneMessages?.length) {
        message.embeddedPhoneMessages = message.embeddedPhoneMessages.map((embeddedMessage) => ({
          ...embeddedMessage,
          phoneMessageId: idMap.get(embeddedMessage.phoneMessageId) ?? embeddedMessage.phoneMessageId,
        }));
      }
      if (message.replyToMessageId !== undefined) {
        message.replyToMessageId = idMap.get(message.replyToMessageId) ?? message.replyToMessageId;
      }
    });
  });
  return { remappedTurns, nextId };
}

/** Union of the imported player likes from every storybook's opening history. */
export function openingHistorySocialLikesFromNodes(nodes: WorkflowNode[]) {
  const likesByAccount: Record<string, string[]> = {};
  nodes.forEach((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
      return;
    }
    let storybook;
    try {
      storybook = parseRpStorybookJson(node.data.storybookJson);
    } catch {
      return;
    }
    Object.entries(storybook.openingHistory.socialLikes).forEach(([accountKey, postIds]) => {
      const current = likesByAccount[accountKey] ?? [];
      likesByAccount[accountKey] = [
        ...current,
        ...postIds.filter((postId) => !current.includes(postId)),
      ];
    });
  });
  return likesByAccount;
}

/** Dynamic social identities imported with Opening History. */
export function openingHistoryDynamicSocialUsersFromNodes(
  nodes: WorkflowNode[],
): DynamicSocialUsers {
  return Object.assign({}, ...storybooksFromNodes(nodes).map((storybook) =>
    normalizeDynamicSocialUsers(storybook.openingHistory.dynamicSocialUsers)
  ));
}

/** Added social users imported with Opening History. */
export function openingHistorySocialConnectionsFromNodes(
  nodes: WorkflowNode[],
): SocialConnectionsByCharacter {
  const merged: SocialConnectionsByCharacter = {};
  storybooksFromNodes(nodes).forEach((storybook) => {
    const connections = normalizeSocialConnectionsByCharacter(
      storybook.openingHistory.socialConnections,
    );
    Object.entries(connections).forEach(([characterId, apps]) => {
      const mergeApp = (app: 'fotogram' | 'onlyfriends') => {
        const current = merged[characterId]?.[app] ?? [];
        const incoming = apps[app] ?? [];
        return [...current, ...incoming.filter((id) => !current.includes(id))];
      };
      const fotogram = mergeApp('fotogram');
      const onlyfriends = mergeApp('onlyfriends');
      merged[characterId] = {
        ...(fotogram.length ? { fotogram } : {}),
        ...(onlyfriends.length ? { onlyfriends } : {}),
      };
    });
  });
  return merged;
}

/** Union of the imported Notes cards from every storybook's opening history. */
export function openingHistoryNotesFromNodes(nodes: WorkflowNode[]): PhoneNotesByCharacter {
  let notes: PhoneNotesByCharacter = {};
  nodes.forEach((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
      return;
    }
    try {
      notes = mergePhoneAppRecordsByCharacter(
        notes,
        parseRpStorybookJson(node.data.storybookJson).openingHistory.notes,
      );
    } catch {
      return;
    }
  });
  return structuredClone(notes);
}

/** Union of the imported ChatGPD chats from every storybook's opening history. */
export function openingHistoryChatGpdChatsFromNodes(nodes: WorkflowNode[]): ChatGpdChatsByCharacter {
  let chats: ChatGpdChatsByCharacter = {};
  nodes.forEach((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
      return;
    }
    try {
      chats = mergePhoneAppRecordsByCharacter(
        chats,
        parseRpStorybookJson(node.data.storybookJson).openingHistory.chatGpdChats,
      );
    } catch {
      return;
    }
  });
  return structuredClone(chats);
}
