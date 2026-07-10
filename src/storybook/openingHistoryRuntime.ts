import { parseRpStorybookJson } from '../nodes/rp-storybook-v1/model';
import type { MessageRecord, TurnRecord, RpAppointment, WorkflowNode } from '../types';
import type { TurnCheckpoint } from '../data-management/types';

export function openingHistoryEventsFromNodes(nodes: WorkflowNode[]): RpAppointment[] {
  return nodes.flatMap((node) => {
    if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook-v1' || !node.data.storybookJson) {
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
  return nodes.flatMap((node) => {
    if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook-v1' || !node.data.storybookJson) {
      return [];
    }
    let storybook;
    try {
      storybook = parseRpStorybookJson(node.data.storybookJson);
    } catch {
      return [];
    }
    return storybook.openingHistory.turns.map((storedTurn) => {
      const turnId = `opening-history-${node.id}-${storedTurn.id}`;
      const withRuntimeMetadata = (
        message: MessageRecord,
        turnPart: MessageRecord['turnPart'],
      ): MessageRecord => {
        const { isOpening: _isOpening, ...storedMessage } = structuredClone(message);
        return {
          ...storedMessage,
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
    if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook-v1' || !node.data.storybookJson) {
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
    if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook-v1' || !node.data.storybookJson) {
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
