import type { ChatImageAttachment, WorkflowNode } from '../types';
import {
  parseNodeStorybookJson,
  defaultRpStorybookCharacterBanking,
  defaultRpStorybookCharacterSocial,
  defaultRpStorybookCharacterPhoneSettings,
  storybookCharacterId,
  type RpStorybookCharacterBanking,
  type RpStorybookCharacterSocial,
  type RpStorybookCharacterComfyConfig,
  type RpStorybookCharacterImage,
  type RpStorybookCharacterProfileImage,
  type RpStorybookCharacterVoiceConfig,
  type RpStorybookCharacterPhoneSettings,
} from '../nodes/rp-storybook-v1/model';

type StorybookCharacterKind = 'character';

type StorybookCharacterProfile = {
  name: string;
  description: string;
  personality: string;
  speechStyle: string;
  role: string;
};

export type StorybookCharacter = {
  id: string;
  storybookNodeId: string;
  kind: StorybookCharacterKind;
  sourceId: string;
  name: string;
  label: string;
  profile: StorybookCharacterProfile;
  comfyConfig?: RpStorybookCharacterComfyConfig;
  voiceConfig?: RpStorybookCharacterVoiceConfig;
  profileImage?: RpStorybookCharacterProfileImage;
  phoneSettings: RpStorybookCharacterPhoneSettings;
  banking: RpStorybookCharacterBanking;
  social: RpStorybookCharacterSocial;
};

export type StorybookImageList = {
  id: string;
  storybookNodeId: string;
  kind: StorybookCharacterKind;
  sourceId: string;
  name: string;
  label: string;
  images: Array<Pick<RpStorybookCharacterImage, 'id' | 'name' | 'mimeType' | 'size' | 'dataUrl' | 'width' | 'height' | 'description' | 'receivedFrom' | 'imageAccess'>>;
};

export type StorybookCreateImageCharacter = StorybookCharacter & {
  createImage: {
    appearance: string;
    loraName: string;
    hasAppearance: boolean;
    hasLora: boolean;
    available: boolean;
  };
};

export function chatAttachmentFromStorybookImage(image: RpStorybookCharacterImage): ChatImageAttachment {
  return {
    id: image.id,
    name: image.name || image.id,
    mimeType: image.mimeType,
    size: image.size,
    dataUrl: image.dataUrl,
    width: image.width,
    height: image.height,
    description: image.description,
    receivedFrom: image.receivedFrom,
    imageAccess: image.imageAccess,
  };
}

export type StorybookCharacterRef = {
  nodeId: string;
  label: string;
  kind: StorybookCharacterKind;
};

export function storyCharactersFromNodes(nodes: WorkflowNode[]): StorybookCharacter[] {
  return nodes.flatMap((node) => {
    if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook-v1') {
      return [];
    }
    const storybook = parseNodeStorybookJson(node.data.storybookJson);
    if (!storybook) {
      return [];
    }
    return storybook.characters.map((character, index) => {
      const name = character.name.trim();
      return {
        id: storybookCharacterId(node.id, character.id, index),
        storybookNodeId: node.id,
        kind: 'character' as const,
        sourceId: character.id || `character-${index + 1}`,
        name: name || `Unnamed Character ${index + 1}`,
        label: name || `Unnamed Character ${index + 1}`,
        profile: {
          name: character.name,
          description: character.description,
          personality: character.personality,
          speechStyle: character.speechStyle,
          role: character.role,
        },
        ...(character.comfyConfig ? { comfyConfig: character.comfyConfig } : {}),
        ...(character.voiceConfig?.sampleDataUrl ? { voiceConfig: character.voiceConfig } : {}),
        ...(character.profileImage ? { profileImage: character.profileImage } : {}),
        phoneSettings: character.phoneSettings ?? defaultRpStorybookCharacterPhoneSettings(),
        banking: character.banking ?? defaultRpStorybookCharacterBanking(),
        social: character.social ?? defaultRpStorybookCharacterSocial(),
      };
    });
  });
}

export function storyCharacterRefsFromNodes(nodes: WorkflowNode[]): StorybookCharacterRef[] {
  return storyCharactersFromNodes(nodes).map((character) => ({
    nodeId: character.id,
    label: character.label,
    kind: character.kind,
  }));
}

export function storybookCreateImageCharactersFromNodes(nodes: WorkflowNode[]): StorybookCreateImageCharacter[] {
  return storyCharactersFromNodes(nodes).map((character) => {
    const appearance = character.comfyConfig?.appearance.trim() ?? '';
    const loraName = character.comfyConfig?.loraName.trim() ?? '';
    const hasAppearance = appearance.length > 0;
    const hasLora = loraName.length > 0;
    return {
      ...character,
      createImage: {
        appearance,
        loraName,
        hasAppearance,
        hasLora,
        available: !!character.name.trim() && (hasAppearance || hasLora),
      },
    };
  });
}

function storybookImageListId(characterId: string) {
  return `${characterId}:images`;
}

export function storybookImageListsFromNodes(nodes: WorkflowNode[]): StorybookImageList[] {
  return nodes.flatMap((node) => {
    if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook-v1') {
      return [];
    }
    const storybook = parseNodeStorybookJson(node.data.storybookJson);
    if (!storybook) {
      return [];
    }
    return storybook.characters.flatMap((character, index) => {
      const describedImages = character.images.filter((image) => image.description.trim());
      if (describedImages.length === 0) {
        return [];
      }
      const name = character.name.trim() || character.id || `Character ${index + 1}`;
      return [{
        id: storybookImageListId(storybookCharacterId(node.id, character.id, index)),
        storybookNodeId: node.id,
        kind: 'character' as const,
        sourceId: character.id || `character-${index + 1}`,
        name,
        label: name,
        images: describedImages.map((image) => ({
          id: image.id,
          name: image.name,
          mimeType: image.mimeType,
          size: image.size,
          dataUrl: image.dataUrl,
          width: image.width,
          height: image.height,
          description: image.description,
          receivedFrom: image.receivedFrom,
          imageAccess: image.imageAccess,
        })),
      }];
    });
  });
}

export function storybookOpeningSituation(nodes: WorkflowNode[]) {
  return nodes
    .flatMap((node) => {
      if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook-v1') {
        return [];
      }
      const storybook = parseNodeStorybookJson(node.data.storybookJson);
      const opening = storybook?.scenario.openingSituation.trim();
      return opening ? [opening] : [];
    })[0] ?? '';
}

export function storybookContextBuilderSections(text: string) {
  const storybook = parseNodeStorybookJson(text);
  if (!storybook) {
    return undefined;
  }
  return [
    ['scenarioSummary', storybook.scenario.summary],
    ['openingSituation', storybook.scenario.openingSituation],
    ['currentSituation', storybook.scenario.currentSituation],
    ['characters', storybook.characters.map((character) => [
      character.name ? `Name: ${character.name}` : '',
      character.role ? `Role: ${character.role}` : '',
      character.description ? `Description: ${character.description}` : '',
      character.personality ? `Personality: ${character.personality}` : '',
      character.speechStyle ? `Speech Style: ${character.speechStyle}` : '',
    ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n')],
  ] as Array<[string, string]>;
}

export function storybookCharacterInfoText(text: string) {
  const storybook = parseNodeStorybookJson(text);
  if (!storybook) {
    return '';
  }
  return [
    '## Charakter',
    storybook.characters.length
      ? storybook.characters.map((character) => [
          `Charakter: ${character.name || character.id}`,
          character.role ? `Role: ${character.role}` : '',
          character.description ? `Description: ${character.description}` : '',
          character.personality ? `Personality: ${character.personality}` : '',
          character.speechStyle ? `Speech Style: ${character.speechStyle}` : '',
        ].filter(Boolean).join('\n')).join('\n\n')
      : 'No characters defined.',
  ].join('\n').trim();
}

export function findChatEndpoints(nodes: WorkflowNode[]) {
  const storybookNodes = nodes.filter(
    (node) => node.data.kind === undefined && node.data.nodeType === 'rp-storybook-v1',
  );
  const storybookHasCharacters = storybookNodes.some((node) => {
    const storybook = parseNodeStorybookJson(node.data.storybookJson);
    return !!storybook?.characters.some((character) => character.name.trim());
  });
  return {
    inputNode: nodes.find((node) => node.data.kind === undefined && node.data.nodeType === 'input'),
    outputNode: nodes.find((node) => node.data.kind === undefined && node.data.nodeType === 'output'),
    characterStorybookNodes: [
      ...(storybookHasCharacters ? storybookNodes : []),
    ],
  };
}
