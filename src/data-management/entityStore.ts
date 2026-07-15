import { parseNodeStorybookJson } from '../nodes/rp-storybook-v1/model';
import { isStorybookSourceNode } from '../storybook/runtime';
import type { TurnRecord, WorkflowNode } from '../types';
import { eventEntitiesFromNodes } from './eventStore';
import type { ImageEntity, SessionEntities } from './types';

function imagesFromTurnRecords(turns: TurnRecord[]) {
  const images: Record<string, ImageEntity> = {};
  turns.forEach((turn) => {
    [...turn.input.messages, ...turn.output.messages].forEach((message) => {
      message.imageAttachments?.forEach((image) => {
        images[image.id] = image;
      });
    });
  });
  return images;
}

export function entitiesFromCurrentState(nodes: WorkflowNode[], turns: TurnRecord[]): SessionEntities {
  const entities: SessionEntities = {
    events: eventEntitiesFromNodes(nodes),
    images: imagesFromTurnRecords(turns),
    memory: {},
  };

  nodes.forEach((node) => {
    if (node.data.kind !== undefined) {
      return;
    }
    if (isStorybookSourceNode(node)) {
      const storybook = parseNodeStorybookJson(node.data.storybookJson);
      if (storybook) {
        entities.storybook = {
          sourceNodeId: node.id,
          value: storybook,
          fileName: node.data.storybookFileName,
          filePath: node.data.storybookFilePath,
        };
      }
    }
    if (node.data.nodeType === 'memory-slot') {
      entities.memory[node.id] = {
        id: node.id,
        name: node.data.memorySlotName,
        text: node.data.memorySlotText,
        mode: node.data.memorySlotMode,
      };
    }
    if (node.data.nodeType === 'character-stats' && node.data.characterStatsState) {
      entities.characterStats = {
        state: node.data.characterStatsState,
        baselineState: node.data.characterStatsBaselineState,
        updatedAtRpDateTime: node.data.characterStatsLastRpDateTime,
      };
    }
  });

  return entities;
}
