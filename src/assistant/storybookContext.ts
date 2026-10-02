import type { WorkflowNodeData } from '../types';
import { parseRpStorybookJson } from '../nodes/rp-storybook/model';

export const storybookContentField = 'storybookContent';

// Select narrative fields explicitly. Never include media or imported runtime state.
export function storybookAssistantContent(data: WorkflowNodeData) {
  if (!data.storybookJson?.trim()) {
    return { status: 'No Storybook content is currently loaded.' };
  }
  try {
    const storybook = parseRpStorybookJson(data.storybookJson);
    return {
      title: storybook.title,
      introduction: storybook.introduction,
      scenario: storybook.scenario,
      characters: storybook.characters.map((character) => ({
        id: character.id,
        name: character.name,
        role: character.role,
        description: character.description,
        personality: character.personality,
        speechStyle: character.speechStyle,
        relationships: character.relationships,
      })),
      openingHistorySummary: storybook.openingHistory.summary,
      omitted: 'Images, audio, imported turns, checkpoints, and phone/app state are excluded. This is narrative content, independent of formatted-text export settings.',
    };
  } catch (error) {
    return { error: `Could not read Storybook content: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function storybookContentRequest(nodeId: string) {
  return { load: 'nodeData', id: nodeId, field: storybookContentField };
}
