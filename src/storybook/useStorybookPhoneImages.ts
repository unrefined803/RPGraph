import {
  profileIdentityError,
  validateCandidateCharacterRegistry,
  validateCharacterAccountDirectory,
  whatsUpAliasConflict,
  withCharacterAppProfile,
} from '../characters/profiles';
import { characterPayload, validateCharacterPayload, type CharacterAppAccount, type AppAvatarChoice, type WhatsUpAlias } from '../characters/character';
import { resolveWhatsUpRecipient } from '../characters/messageIdentity';
import type { EffectiveCharacterRegistry } from '../characters/registry';
import { appCharactersFromRegistry } from '../characters/appRuntime';
import { validateCandidateLegacySeedTimeline } from '../characters/publications';
import { normalizeDatingProfile, type DatingProfile } from '../chat/datingProfile';
import { useEffect, useMemo, useRef } from 'react';
import { buildSocialDirectory, socialHandleAvailable, type DynamicSocialUsers } from '../chat/socialDirectory';
import {
  phoneImageActionMatchesMessage,
  phoneNamesMatch,
  type ParsedPhoneImageAction,
} from '../chat/phoneMessages';
import {
  emptyRpStorybook,
  parseRpStorybookJson,
  rpStorybookJsonText,
  withRpStorybookCharacterPhoneWallpaper,
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
import { chatAttachmentFromStorybookImage, isStorybookSourceNode, storyCharactersFromNodes, type StorybookCharacter } from './runtime';
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
  dynamicSocialUsers: DynamicSocialUsers;
  messages: MessageRecord[];
  messagesRef: { current: MessageRecord[] };
  nodesRef: { current: WorkflowNode[] };
  updateNpcImages?: (characterId: string, images: RpStorybook['characters'][number]['images']) => void;
  currentCharacterRegistry: () => EffectiveCharacterRegistry;
  characterRegistryForStorybook: (nodeId: string, characters: RpStorybook['characters']) => EffectiveCharacterRegistry;
  currentTurnInputMessages: () => MessageRecord[];
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  updateMessage: (messageId: number, patch: Partial<MessageRecord>) => void;
  updatePhoneImageDescriptions: (descriptionsById: ReadonlyMap<string, string>) => void;
  notifySystem: (level: 'info' | 'warning' | 'error', message: string) => void;
};

export function useStorybookPhoneImages({
  storybooksByNodeId,
  dynamicSocialUsers,
  messages,
  messagesRef,
  nodesRef,
  currentCharacterRegistry,
  updateNpcImages,
  characterRegistryForStorybook,
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
  function validateProfileCandidate(nodeId: string, storybook: RpStorybook) {
    validateCharacterAccountDirectory(storybook.characters);
    storybook.characters.forEach((entry) => validateCharacterPayload(characterPayload(entry)));
    const current = currentCharacterRegistry();
    const candidate = characterRegistryForStorybook(nodeId, storybook.characters);
    validateCandidateCharacterRegistry(current, candidate);
    validateCandidateLegacySeedTimeline(
      appCharactersFromRegistry(current), appCharactersFromRegistry(candidate), messagesRef.current,
    );
  }
  const imageDescriptionSignature = useMemo(() => JSON.stringify(
    [...imageDescriptionById].sort(([left], [right]) => left.localeCompare(right)),
  ), [imageDescriptionById]);
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
      if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
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
    const characters = appCharactersFromRegistry(currentCharacterRegistry());
    try {
      const identity = resolveWhatsUpRecipient(characters, messagesRef.current, name);
      const character = characters.find((entry) => entry.sourceId === identity.characterId);
      return character ? { character, ...identity } : undefined;
    } catch {
      return undefined;
    }
  }

  function changePhoneWallpaper(character: StorybookCharacter, wallpaperId: string) {
    const storybookNode = nodesRef.current.find(
      (node) => node.id === character.storybookNodeId && isStorybookSourceNode(node),
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

  /**
   * Set or remove the second WhatsUp name; the account and its real name stay
   * untouched. Returns true, or the reason the change was rejected.
   */
  function saveWhatsUpAlias(character: StorybookCharacter, alias: WhatsUpAlias | undefined): true | string {
    const node = nodesRef.current.find((entry) => entry.id === character.storybookNodeId && isStorybookSourceNode(entry));
    const unavailable = 'This character’s Storybook is not available for editing.';
    if (!node?.data.storybookJson) return unavailable;
    const storybook = parseRpStorybookJson(node.data.storybookJson);
    const source = storybook.characters.find((entry) => entry.id === character.sourceId);
    if (!source) return unavailable;
    let next: RpStorybook;
    try {
      const { alias: _previous, ...account } = { accountId: `character:${source.id}:whatsup`, enabled: true, bio: '', ...source.apps?.whatsup };
      next = { ...storybook, characters: storybook.characters.map((entry) => entry.id === source.id
        ? withCharacterAppProfile(entry, 'whatsup', { ...account, ...(alias ? { alias } : {}) } as CharacterAppAccount) : entry) };
      validateProfileCandidate(node.id, next);
      // NPCs outside this Storybook take part in the same chats, so their names are taken as well.
      const conflict = whatsUpAliasConflict(alias?.name ?? '', source.id,
        appCharactersFromRegistry(characterRegistryForStorybook(node.id, next.characters))
          .map((entry) => ({ id: entry.sourceId, name: entry.name, alias: entry.apps?.whatsup?.alias?.name })));
      if (conflict) throw new Error(conflict);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notifySystem('warning', reason);
      return reason;
    }
    updateRuntimeNode(node.id, { storybookJson: rpStorybookJsonText(next),
      storybookStatus: `WhatsUp second name ${alias ? 'saved' : 'removed'} for ${character.name}.` });
    return true;
  }

  /** `avatar`: a newly chosen dating profile picture; undefined keeps the stored one. */
  function saveDatingProfile(character: StorybookCharacter, profile: DatingProfile, avatar?: AppAvatarChoice) {
    const normalized = normalizeDatingProfile(profile);
    const node = nodesRef.current.find((entry) => entry.id === character.storybookNodeId && isStorybookSourceNode(entry));
    if (!normalized || !node?.data.storybookJson) return false;
    const storybook = parseRpStorybookJson(node.data.storybookJson);
    if (!storybook.characters.some((entry) => entry.id === character.sourceId)) return false;
    const current = storybook.characters.find((entry) => entry.id === character.sourceId)!;
    if (normalized.photoIds.some((id) => !current.images.some((image) => image.id === id))) {
      notifySystem('warning', 'MatchMe photos must belong to the character gallery.'); return false;
    }
    let next: RpStorybook;
    try {
      next = { ...storybook, characters: storybook.characters.map((entry) => entry.id === character.sourceId
        ? withCharacterAppProfile(entry, 'matchme', { accountId: entry.apps?.matchme?.accountId ?? `character:${entry.id}:matchme`, ...entry.apps?.matchme, ...(avatar ? { avatarImageId: avatar.imageId, avatarCrop: avatar.crop } : {}), enabled: true, profileName: normalized.name, bio: normalized.bio, profile: normalized })
        : entry) };
      validateProfileCandidate(node.id, next);
    } catch (error) {
      notifySystem('warning', error instanceof Error ? error.message : String(error));
      return false;
    }
    updateRuntimeNode(node.id, { storybookJson: rpStorybookJsonText(next), storybookStatus: `MatchMe profile saved for ${character.name}.` });
    return true;
  }

  function saveSocialUsername(
    character: StorybookCharacter,
    app: 'fotogram' | 'onlyfriends',
    username: string,
    profile?: CharacterAppAccount,
  ) {
    const currentCharacters = storyCharactersFromNodes(nodesRef.current);
    const directory = buildSocialDirectory({
      storyCharacters: currentCharacters,
      messages: messagesRef.current,
      savedDynamicUsers: dynamicSocialUsers,
    });
    if (!socialHandleAvailable(directory.users, app, username, character.id)) {
      notifySystem('warning', `The username @${username} is already taken or invalid.`);
      return false;
    }
    const storybookNode = nodesRef.current.find(
      (node) => node.id === character.storybookNodeId && isStorybookSourceNode(node),
    );
    if (!storybookNode?.data.storybookJson) {
      return false;
    }
    if (!currentCharacters.some((entry) => entry.id === character.id)) {
      return false;
    }
    const storybook = parseRpStorybookJson(storybookNode.data.storybookJson);
    const source = storybook.characters.find((entry) => entry.id === character.sourceId)!;
    const account = { accountId: source.apps?.[app]?.accountId ?? `character:${source.id}:${app}`,
      enabled: true, bio: '', ...source.apps?.[app], ...profile,
      profileName: profile?.profileName ?? username };
    const reason = profileIdentityError(source.apps?.[app], account, messagesRef.current.length > 0 ||
      storybook.openingHistory.turns.length > 0 || storybook.openingHistory.events.length > 0);
    if (reason) { notifySystem('warning', reason); return false; }
    let nextStorybook: RpStorybook;
    try {
      nextStorybook = { ...storybook, characters: storybook.characters.map((entry) =>
        entry.id === source.id ? withCharacterAppProfile(entry, app, account) : entry) };
      validateProfileCandidate(storybookNode.id, nextStorybook);
    } catch (error) {
      notifySystem('warning', error instanceof Error ? error.message : String(error));
      return false;
    }
    const nextJson = rpStorybookJsonText(nextStorybook);
    if (nextJson === storybookNode.data.storybookJson) {
      return true;
    }
    updateRuntimeNode(storybookNode.id, {
      storybookJson: nextJson,
      storybookStatus: `${app === 'fotogram' ? 'Fotogram' : 'OnlyFriends'} account saved for ${character.name}.`,
    });
    return true;
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
      (node) => node.id === character.storybookNodeId && isStorybookSourceNode(node),
    );
    if (!storybookNode?.data.storybookJson) {
      const entry = currentCharacterRegistry().characters.find((entry) => entry.character.id === character.sourceId);
      if (!entry || !updateNpcImages) return undefined;
      const result = withImagesEnsuredForStorybookCharacter(
        { ...emptyRpStorybook, characters: [entry.character] }, character.sourceId, images, description ?? '', options,
      );
      if (result.addedCount + result.updatedCount > 0) {
        updateNpcImages(character.sourceId, result.storybook.characters[0].images);
      }
      return result.images.map(chatAttachmentFromStorybookImage);
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
      if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
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
      if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
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

  function pruneExternalImagesForMessages(activeMessages = messagesRef.current, removedMessages: readonly MessageRecord[] = []) {
    const previousNpcImages: Array<{ id: string; images: RpStorybook['characters'][number]['images'] }> = [];
    const entries = currentCharacterRegistry().characters;
    const directory = entries.map((entry) => entry.character);
    const accountAliases = new Map(entries.map((entry) => [entry.character.id, entry.aliases.accountIds?.whatsup ?? []]));
    for (const entry of entries) {
      if (entry.provenance.tier !== 'snapshot' || !updateNpcImages) continue;
      const result = withStorybookExternalImagesPruned(
        { ...emptyRpStorybook, characters: [entry.character] }, activeMessages, removedMessages, directory, accountAliases,
      );
      if (result.removedCount + result.updatedCount) {
        previousNpcImages.push({ id: entry.character.id, images: entry.character.images });
        updateNpcImages(entry.character.id, result.storybook.characters[0].images);
      }
    }
    nodesRef.current.forEach((node) => {
      if (!isStorybookSourceNode(node) || !node.data.storybookJson) {
        return;
      }
      const storybook = parseRpStorybookJson(node.data.storybookJson);
      const result = withStorybookExternalImagesPruned(storybook, activeMessages, removedMessages, directory, accountAliases);
      if (result.removedCount + result.updatedCount === 0) {
        return;
      }
      updateRuntimeNode(node.id, {
        storybookJson: rpStorybookJsonText(result.storybook),
        storybookStatus: `Removed ${result.removedCount} inactive timeline image${result.removedCount === 1 ? '' : 's'}; updated ${result.updatedCount} receipt${result.updatedCount === 1 ? '' : 's'}.`,
      });
    });
    return () => previousNpcImages.forEach(({ id, images }) => updateNpcImages?.(id, images));
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
      sender.character.id === recipient.character.id
    ) {
      return;
    }
    ensureImagesForCharacter(
      recipient.character,
      images,
      description,
      (addedCount, updatedCount) =>
        addedCount > 0
          ? `Added ${addedCount} phone image${addedCount === 1 ? '' : 's'} to ${recipient.name} from ${sender.name}.`
          : `Updated ${updatedCount} phone image description${updatedCount === 1 ? '' : 's'} for ${recipient.name}.`,
      { receivedFrom: sender.name, receivedFromCharacterId: sender.character.sourceId, receivedFromAccountId: sender.accountId },
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
    const senderNeedsImageAccess = !!sender && !!sourceOwnerName && !phoneNamesMatch(sender.character.name, sourceOwnerName);
    const senderAttachments = imagesAlreadyStored && !senderNeedsImageAccess
      ? images
      : ensureImagesForCharacter(
          sender?.character,
          images,
          description,
          (addedCount, updatedCount) =>
            addedCount > 0
              ? `Added ${addedCount} phone image${addedCount === 1 ? '' : 's'} for ${sender?.name ?? 'Storybook character'}${senderNeedsImageAccess ? ` from ${sourceOwnerName}` : ''}.`
              : `Updated ${updatedCount} phone image description${updatedCount === 1 ? '' : 's'} for ${sender?.name ?? 'Storybook character'}.`,
          senderNeedsImageAccess ? { receivedFrom: sourceOwnerName } : { turnUpload: true },
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
      message.phoneFromAccountId ?? message.phoneFrom ?? '',
      message.phoneToAccountId ?? message.phoneTo ?? '',
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
    changePhoneWallpaper,
    saveSocialUsername,
    saveWhatsUpAlias,
    saveDatingProfile,
    imageIdsFromAttachments,
    imageDescriptionFromAttachments,
    ensureImagesForCharacter,
    ensurePhoneImages,
    changeCaptionUpdate,
    pruneExternalImagesForMessages,
    applyPhoneImageAction,
  };
}
