import { useEffect, useMemo, useRef } from 'react';
import {
  phoneImageActionMatchesMessage,
  phoneNamesMatch,
  type ParsedPhoneImageAction,
} from '../chat/phoneMessages';
import {
  parseRpStorybookJson,
  rpStorybookJsonText,
  withRpStorybookCharacterPhoneWallpaper,
  withRpStorybookCharacterSocialUsername,
  withRpStorybookPhoneContactPairAllowed,
  type RpStorybook,
} from '../nodes/rp-storybook/model';
import {
  storybookImageDescriptions,
  storybookImageSourceById,
  withImagesEnsuredForStorybookCharacter,
  withStorybookExternalImagesPruned,
  withStorybookImageDescriptionUpdated,
  type StorybookImageLibraryEnsureOptions,
} from './imageLibrary';
import { chatAttachmentFromStorybookImage, type StorybookCharacter } from './runtime';
import type {
  ChatImageAttachment,
  ImageCaptionChange,
  MessageRecord,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';

type UseStorybookPhoneImagesOptions = {
  storybooksByNodeId: ReadonlyMap<string, RpStorybook>;
  storyCharacters: StorybookCharacter[];
  messages: MessageRecord[];
  messagesRef: { current: MessageRecord[] };
  nodesRef: { current: WorkflowNode[] };
  currentTurnInputMessages: () => MessageRecord[];
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  updateMessage: (messageId: number, patch: Partial<MessageRecord>) => void;
  updatePhoneImageDescriptions: (descriptionsById: ReadonlyMap<string, string>) => void;
  notifySystem: (level: 'info' | 'warning' | 'error', message: string) => void;
};

export function useStorybookPhoneImages({
  storybooksByNodeId,
  storyCharacters,
  messages,
  messagesRef,
  nodesRef,
  currentTurnInputMessages,
  updateRuntimeNode,
  updateMessage,
  updatePhoneImageDescriptions,
  notifySystem,
}: UseStorybookPhoneImagesOptions) {
  const imageDescriptionById = useMemo(
    () => storybookImageDescriptions(storybooksByNodeId.values()),
    [storybooksByNodeId],
  );
  const imageDescriptionSignature = JSON.stringify(
    [...imageDescriptionById].sort(([left], [right]) => left.localeCompare(right)),
  );
  const imageDescriptionByIdRef = useRef(imageDescriptionById);
  const updatePhoneImageDescriptionsRef = useRef(updatePhoneImageDescriptions);

  useEffect(() => {
    imageDescriptionByIdRef.current = imageDescriptionById;
  }, [imageDescriptionById]);

  useEffect(() => {
    updatePhoneImageDescriptionsRef.current = updatePhoneImageDescriptions;
  }, [updatePhoneImageDescriptions]);

  useEffect(() => {
    updatePhoneImageDescriptionsRef.current(imageDescriptionByIdRef.current);
  }, [imageDescriptionSignature]);

  const imageCaptionChangesById = useMemo(() => {
    const changes = new Map<string, ImageCaptionChange[]>();
    messages.forEach((message) => {
      const change = message.phoneImageCaptionChange;
      const imageId = change?.imageId.trim();
      if (!change || !imageId) {
        return;
      }
      changes.set(imageId, [...(changes.get(imageId) ?? []), change]);
    });
    return changes;
  }, [messages]);

  function currentImageSourceById(imageId: string) {
    const normalizedImageId = imageId.trim();
    if (!normalizedImageId) {
      return undefined;
    }
    for (const node of nodesRef.current) {
      if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook' || !node.data.storybookJson) {
        continue;
      }
      try {
        const source = storybookImageSourceById(
          [parseRpStorybookJson(node.data.storybookJson)],
          normalizedImageId,
        );
        if (source) {
          return source;
        }
      } catch {
        // Storybook validation reports invalid JSON through its normal UI path.
      }
    }
    return undefined;
  }

  function characterByPhoneName(name: string) {
    return storyCharacters.find((character) => phoneNamesMatch(character.name, name));
  }

  function allowPhoneContactPair(fromName: string, toName: string) {
    const fromCharacter = characterByPhoneName(fromName);
    const toCharacter = characterByPhoneName(toName);
    if (
      !fromCharacter ||
      !toCharacter ||
      fromCharacter.storybookNodeId !== toCharacter.storybookNodeId
    ) {
      return;
    }
    const storybookNode = nodesRef.current.find(
      (node) => node.id === fromCharacter.storybookNodeId && node.data.nodeType === 'rp-storybook',
    );
    if (!storybookNode?.data.storybookJson) {
      return;
    }
    const storybook = parseRpStorybookJson(storybookNode.data.storybookJson);
    const nextStorybook = withRpStorybookPhoneContactPairAllowed(
      storybook,
      fromCharacter.sourceId,
      toCharacter.sourceId,
    );
    const nextJson = rpStorybookJsonText(nextStorybook);
    if (nextJson === storybookNode.data.storybookJson) {
      return;
    }
    updateRuntimeNode(storybookNode.id, {
      storybookJson: nextJson,
      storybookStatus: `Phone + Fotogram contact added: ${fromCharacter.name} <-> ${toCharacter.name}`,
    });
  }

  function changePhoneWallpaper(character: StorybookCharacter, wallpaperId: string) {
    const storybookNode = nodesRef.current.find(
      (node) => node.id === character.storybookNodeId && node.data.nodeType === 'rp-storybook',
    );
    if (!storybookNode?.data.storybookJson) {
      return;
    }
    const storybook = parseRpStorybookJson(storybookNode.data.storybookJson);
    const nextStorybook = withRpStorybookCharacterPhoneWallpaper(
      storybook,
      character.sourceId,
      wallpaperId,
    );
    const nextJson = rpStorybookJsonText(nextStorybook);
    if (nextJson === storybookNode.data.storybookJson) {
      return;
    }
    updateRuntimeNode(storybookNode.id, {
      storybookJson: nextJson,
      storybookStatus: `Phone wallpaper updated for ${character.name}.`,
    });
  }

  function saveSocialUsername(
    character: StorybookCharacter,
    app: 'fotogram' | 'onlyfriends',
    username: string,
  ) {
    const storybookNode = nodesRef.current.find(
      (node) => node.id === character.storybookNodeId && node.data.nodeType === 'rp-storybook',
    );
    if (!storybookNode?.data.storybookJson) {
      return;
    }
    const storybook = parseRpStorybookJson(storybookNode.data.storybookJson);
    const nextStorybook = withRpStorybookCharacterSocialUsername(
      storybook,
      character.sourceId,
      app,
      username,
    );
    const nextJson = rpStorybookJsonText(nextStorybook);
    if (nextJson === storybookNode.data.storybookJson) {
      return;
    }
    updateRuntimeNode(storybookNode.id, {
      storybookJson: nextJson,
      storybookStatus: `${app === 'fotogram' ? 'Fotogram' : 'OnlyFriends'} account saved for ${character.name}.`,
    });
  }

  function imageIdsFromAttachments(images: ChatImageAttachment[] | undefined) {
    const imageIds = images?.map((image) => image.id.trim()).filter(Boolean) ?? [];
    return imageIds.length ? imageIds : undefined;
  }

  function imageDescriptionFromAttachments(images: ChatImageAttachment[] | undefined) {
    return images?.map((image) => image.description?.trim()).find(Boolean);
  }

  function ensureImagesForCharacter(
    character: StorybookCharacter | undefined,
    images: ChatImageAttachment[] | undefined,
    description: string | undefined,
    status: (addedCount: number, updatedCount: number) => string,
    options?: StorybookImageLibraryEnsureOptions,
  ) {
    if (!character || !images?.length) {
      return undefined;
    }
    const storybookNode = nodesRef.current.find(
      (node) => node.id === character.storybookNodeId && node.data.nodeType === 'rp-storybook',
    );
    if (!storybookNode?.data.storybookJson) {
      return undefined;
    }
    const storybook = parseRpStorybookJson(storybookNode.data.storybookJson);
    const result = withImagesEnsuredForStorybookCharacter(
      storybook,
      character.sourceId,
      images,
      description ?? '',
      options,
    );
    const changedCount = result.addedCount + result.updatedCount;
    if (changedCount > 0) {
      updateRuntimeNode(storybookNode.id, {
        storybookJson: rpStorybookJsonText(result.storybook),
        storybookStatus: status(result.addedCount, result.updatedCount),
      });
    }
    return result.images.map(chatAttachmentFromStorybookImage);
  }

  function updateImageDescriptionEverywhere(
    image: ChatImageAttachment | undefined,
    description: string,
  ) {
    if (!image || !description.trim()) {
      return;
    }
    nodesRef.current.forEach((node) => {
      if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook' || !node.data.storybookJson) {
        return;
      }
      const storybook = parseRpStorybookJson(node.data.storybookJson);
      const result = withStorybookImageDescriptionUpdated(
        storybook,
        image.id,
        image.dataUrl,
        description.trim(),
      );
      if (result.updatedCount === 0) {
        return;
      }
      updateRuntimeNode(node.id, {
        storybookJson: rpStorybookJsonText(result.storybook),
        storybookStatus: `Updated ${image.id} description.`,
      });
    });
  }

  function updateImageDescriptionById(
    imageId: string,
    description: string,
  ): ImageCaptionChange | undefined {
    const normalizedImageId = imageId.trim();
    const normalizedDescription = description.trim();
    if (!normalizedImageId || normalizedImageId === 'new_image' || !normalizedDescription) {
      return undefined;
    }
    const beforeCaption = imageDescriptionById.get(normalizedImageId)?.trim() || undefined;
    let updated = false;
    nodesRef.current.forEach((node) => {
      if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook' || !node.data.storybookJson) {
        return;
      }
      const storybook = parseRpStorybookJson(node.data.storybookJson);
      const result = withStorybookImageDescriptionUpdated(
        storybook,
        normalizedImageId,
        '',
        normalizedDescription,
      );
      if (result.updatedCount === 0) {
        return;
      }
      updated = true;
      updateRuntimeNode(node.id, {
        storybookJson: rpStorybookJsonText(result.storybook),
        storybookStatus: `Updated ${normalizedImageId} description.`,
      });
    });
    if (updated) {
      const immediateDescriptions = new Map(imageDescriptionById);
      immediateDescriptions.set(normalizedImageId, normalizedDescription);
      updatePhoneImageDescriptions(immediateDescriptions);
    }
    return updated
      ? { imageId: normalizedImageId, beforeCaption, afterCaption: normalizedDescription }
      : undefined;
  }

  function changeCaptionUpdate(change: ImageCaptionChange, caption: string) {
    const normalizedCaption = caption.trim();
    const normalizedImageId = change.imageId.trim();
    if (!normalizedCaption || !normalizedImageId) {
      return;
    }
    let targetMessage = messagesRef.current.find((message) => message.phoneImageCaptionChange === change);
    if (!targetMessage) {
      for (let index = messagesRef.current.length - 1; index >= 0; index -= 1) {
        const message = messagesRef.current[index];
        const currentChange = message.phoneImageCaptionChange;
        if (
          currentChange?.imageId.trim() === normalizedImageId &&
          (currentChange.beforeCaption ?? '') === (change.beforeCaption ?? '')
        ) {
          targetMessage = message;
          break;
        }
      }
    }
    if (!targetMessage?.phoneImageCaptionChange) {
      notifySystem('warning', `Caption update for ${normalizedImageId} was not found.`);
      return;
    }
    if (targetMessage.phoneImageCaptionChange.afterCaption === normalizedCaption) {
      updateImageDescriptionById(normalizedImageId, normalizedCaption);
      return;
    }
    updateImageDescriptionById(normalizedImageId, normalizedCaption);
    updateMessage(targetMessage.id, {
      phoneImageCaptionChange: {
        ...targetMessage.phoneImageCaptionChange,
        afterCaption: normalizedCaption,
      },
    });
    notifySystem('info', `Changed caption update for ${normalizedImageId}.`);
  }

  function pruneExternalImagesForMessages(activeMessages = messagesRef.current) {
    nodesRef.current.forEach((node) => {
      if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook' || !node.data.storybookJson) {
        return;
      }
      const storybook = parseRpStorybookJson(node.data.storybookJson);
      const result = withStorybookExternalImagesPruned(storybook, activeMessages);
      if (result.removedCount === 0) {
        return;
      }
      updateRuntimeNode(node.id, {
        storybookJson: rpStorybookJsonText(result.storybook),
        storybookStatus: `Removed ${result.removedCount} inactive received image${result.removedCount === 1 ? '' : 's'}.`,
      });
    });
  }

  function addImagesToRecipientStorybook(
    fromName: string,
    toName: string,
    images: ChatImageAttachment[] | undefined,
    description?: string,
  ) {
    const sender = characterByPhoneName(fromName);
    const recipient = characterByPhoneName(toName);
    if (
      !sender ||
      !recipient ||
      sender.id === recipient.id ||
      sender.storybookNodeId !== recipient.storybookNodeId
    ) {
      return;
    }
    ensureImagesForCharacter(
      recipient,
      images,
      description,
      (addedCount, updatedCount) =>
        addedCount > 0
          ? `Added ${addedCount} phone image${addedCount === 1 ? '' : 's'} to ${recipient.name} from ${sender.name}.`
          : `Updated ${updatedCount} phone image description${updatedCount === 1 ? '' : 's'} for ${recipient.name}.`,
      { receivedFrom: sender.name },
    );
  }

  function ensurePhoneImages(
    fromName: string,
    toName: string,
    images: ChatImageAttachment[] | undefined,
    description?: string,
    sourceOwnerName?: string,
  ) {
    if (!images?.length) {
      return undefined;
    }
    const sender = characterByPhoneName(fromName);
    const imagesAlreadyStored = images.every((image) => {
      const storedImage = currentImageSourceById(image.id)?.image;
      return storedImage?.dataUrl === image.dataUrl;
    });
    const senderNeedsImageAccess = !!sender && !!sourceOwnerName && !phoneNamesMatch(sender.name, sourceOwnerName);
    const senderAttachments = imagesAlreadyStored && !senderNeedsImageAccess
      ? images
      : ensureImagesForCharacter(
          sender,
          images,
          description,
          (addedCount, updatedCount) =>
            addedCount > 0
              ? `Added ${addedCount} phone image${addedCount === 1 ? '' : 's'} for ${sender?.name ?? 'Storybook character'}${senderNeedsImageAccess ? ' with Image Access' : ''}.`
              : `Updated ${updatedCount} phone image description${updatedCount === 1 ? '' : 's'} for ${sender?.name ?? 'Storybook character'}.`,
          senderNeedsImageAccess ? { imageAccess: true } : undefined,
        );
    const ensuredAttachments = senderAttachments?.length ? senderAttachments : images;
    addImagesToRecipientStorybook(fromName, toName, ensuredAttachments, description);
    return ensuredAttachments;
  }

  function updatePhoneImageDescription(
    message: MessageRecord,
    description: string,
  ): ImageCaptionChange | undefined {
    const trimmedDescription = description.trim();
    if (!trimmedDescription || !message.imageAttachments?.length) {
      return undefined;
    }
    const beforeCaption =
      message.phoneImageDescription?.trim() ||
      message.phoneImageIds
        ?.map((imageId) => imageDescriptionById.get(imageId)?.trim())
        .find(Boolean) ||
      undefined;
    const storybookAttachments = ensurePhoneImages(
      message.phoneFrom ?? '',
      message.phoneTo ?? '',
      message.imageAttachments,
      trimmedDescription,
    );
    const imageAttachments = storybookAttachments?.length
      ? storybookAttachments
      : message.imageAttachments;
    const phoneImageIds = imageIdsFromAttachments(imageAttachments) ?? message.phoneImageIds;
    updateImageDescriptionEverywhere(imageAttachments[0], trimmedDescription);
    if (phoneImageIds?.length) {
      const immediateDescriptions = new Map(imageDescriptionById);
      phoneImageIds.forEach((imageId) => immediateDescriptions.set(imageId, trimmedDescription));
      updatePhoneImageDescriptions(immediateDescriptions);
    }
    updateMessage(message.id, {
      phoneImageDescription: trimmedDescription,
      ...(phoneImageIds?.length ? { phoneImageIds } : {}),
      ...(storybookAttachments?.length ? { imageAttachments: storybookAttachments } : {}),
    });
    const imageId = phoneImageIds?.[0]?.trim() || imageAttachments[0]?.id.trim();
    return imageId
      ? { imageId, beforeCaption, afterCaption: trimmedDescription }
      : undefined;
  }

  function latestIncomingPhoneImageMessage(phoneReplyTo?: MessageRecord) {
    const describedInput = currentTurnInputMessages().find(
      (message) => message.channel === 'phone' && !!message.imageAttachments?.length,
    );
    return describedInput ?? (phoneReplyTo?.imageAttachments?.length ? phoneReplyTo : undefined);
  }

  function applyPhoneImageAction(
    action: ParsedPhoneImageAction,
    phoneReplyTo?: MessageRecord,
    outgoingImageId?: string,
  ): ImageCaptionChange | undefined {
    if (action.imageAction === 'no_change') {
      return undefined;
    }
    const normalizedOutgoingImageId = outgoingImageId?.trim();
    if (
      normalizedOutgoingImageId &&
      action.imageAction === 'update' &&
      action.imageId.trim() === normalizedOutgoingImageId &&
      action.caption
    ) {
      return updateImageDescriptionById(normalizedOutgoingImageId, action.caption);
    }
    const describedMessage = latestIncomingPhoneImageMessage(phoneReplyTo);
    if (describedMessage && phoneImageActionMatchesMessage(describedMessage, action)) {
      return action.caption
        ? updatePhoneImageDescription(describedMessage, action.caption)
        : undefined;
    }
    if (!describedMessage) {
      notifySystem(
        'warning',
        `RP Output returned a phone image action for ${action.imageId}, but no matching phone image was found.`,
      );
      return undefined;
    }
    notifySystem(
      'warning',
      `RP Output returned a phone image action for ${action.imageId}, but the latest phone input uses a different image.`,
    );
    return undefined;
  }

  return {
    imageDescriptionById,
    imageCaptionChangesById,
    currentImageSourceById,
    allowPhoneContactPair,
    changePhoneWallpaper,
    saveSocialUsername,
    imageIdsFromAttachments,
    imageDescriptionFromAttachments,
    ensureImagesForCharacter,
    ensurePhoneImages,
    changeCaptionUpdate,
    pruneExternalImagesForMessages,
    applyPhoneImageAction,
  };
}
