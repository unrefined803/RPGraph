import { parseNodeStorybookJson } from '../nodes/rp-storybook/model';
import { isStorybookSourceNode } from '../storybook/runtime';
import type {
  ChatImageAttachment,
  MessageRecord,
  SocialDirectMessageRecord,
  WorkflowNode,
} from '../types';
import { normalizePhoneName } from './phoneMessages';
import { rpPictureGalleryId } from './rpPictures';

export type ReferenceImageOptions = {
  enabled: boolean;
  turnLookback: number;
  /** Lookback for messenger conversations; falls back to `turnLookback`. */
  phoneTurnLookback?: number;
  maxImages: number;
  additionalImageIds?: string[];
  /** Conversation where the manual selection was made. */
  additionalImageScope?: string;
  /**
   * Conversation the next model call belongs to. Automatic references are
   * limited to messages of the same conversation, except recent cards in RP.
   * Explicit selections belong to their originating view. Without a scope
   * every recent message qualifies.
   */
  scope?: string;
};

export const fixedReferenceImageOptions: ReferenceImageOptions = {
  enabled: true,
  turnLookback: 5,
  phoneTurnLookback: 10,
  maxImages: 3,
};
const rpCardTurnLookback = 3;

export const rpReferenceImageScope = 'rp';
const phoneScopePrefix = 'phone:';
const latestPhoneConversationMessageCount = 2;
/** Scope of a run or view without a known conversation; it matches no message. */
export const unknownConversationReferenceImageScope = 'unknown';

export function phoneReferenceImageScope(from: string, to: string) {
  return `${phoneScopePrefix}${[normalizePhoneName(from), normalizePhoneName(to)].sort().join('::')}`;
}

export function socialReferenceImageScope(app: string) {
  return `social:${app}`;
}

function socialHandleKey(handle: string) {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

export function socialDirectReferenceImageScope(
  message: Pick<SocialDirectMessageRecord, 'app' | 'fromHandle' | 'toHandle'>,
) {
  const handles = [socialHandleKey(message.fromHandle), socialHandleKey(message.toHandle)].sort();
  return `dm:${message.app}:${handles.join('::')}`;
}

export function referenceImageScopeForMessage(message: MessageRecord) {
  if (message.socialDirectMessage) {
    return socialDirectReferenceImageScope(message.socialDirectMessage);
  }
  const socialApp = (
    message.socialPost ?? message.socialThreadAction ?? message.socialReactions
  )?.app;
  if (socialApp) {
    return socialReferenceImageScope(socialApp);
  }
  if ((message.phoneMessage || message.channel === 'phone') && message.phoneFrom && message.phoneTo) {
    return phoneReferenceImageScope(message.phoneFrom, message.phoneTo);
  }
  return rpReferenceImageScope;
}

export type ReferenceImage = {
  index: number;
  imageId: string;
  attachment: ChatImageAttachment;
  messageId: number;
  turnId?: string;
  turnNumber?: number;
  caption?: string;
};

type ReferenceImageCandidate = Omit<ReferenceImage, 'index'>;

function includedHistoryMessage(message: MessageRecord) {
  return (
    message.includeInHistory !== false &&
    (message.role === 'user' || message.role === 'output')
  );
}

function turnKey(message: MessageRecord) {
  if (typeof message.turnNumber === 'number' && Number.isFinite(message.turnNumber)) {
    return `number:${message.turnNumber}`;
  }
  if (message.turnId) {
    return `id:${message.turnId}`;
  }
  return undefined;
}

function recentReferenceMessages(messages: MessageRecord[], turnLookback: number) {
  const included = messages.filter(includedHistoryMessage);
  if (turnLookback <= 0 || included.length === 0) {
    return [];
  }
  const turnKeys: string[] = [];
  included.forEach((message) => {
    const key = turnKey(message);
    if (key && !turnKeys.includes(key)) {
      turnKeys.push(key);
    }
  });
  if (turnKeys.length === 0) {
    return included.slice(-turnLookback * 2);
  }
  const selectedTurns = new Set(turnKeys.slice(-turnLookback));
  return included.filter((message) => {
    const key = turnKey(message);
    return key ? selectedTurns.has(key) : false;
  });
}

/**
 * Messages of one conversation that qualify for automatic references: those
 * inside the turn lookback plus the conversation's latest messages, so a
 * messenger picture is still attached when the user returns to that chat
 * after the lookback.
 */
function scopedReferenceMessages(
  messages: MessageRecord[],
  lookbackMessages: MessageRecord[],
  scope: string,
  latestMessageCount: number,
) {
  const conversation = messages.filter(
    (message) => includedHistoryMessage(message) && referenceImageScopeForMessage(message) === scope,
  );
  const qualifying = new Set([
    ...lookbackMessages,
    ...(latestMessageCount > 0 ? conversation.slice(-latestMessageCount) : []),
  ]);
  return conversation.filter((message) => qualifying.has(message));
}

function attachmentKey(attachment: ChatImageAttachment) {
  const imageId = attachment.id.trim();
  return imageId ? `id:${imageId}` : `data:${attachment.dataUrl}`;
}

function storybookImagesById(nodes: WorkflowNode[]) {
  const images = new Map<string, ChatImageAttachment>();
  nodes.forEach((node) => {
    if (!isStorybookSourceNode(node)) {
      return;
    }
    const storybook = parseNodeStorybookJson(node.data.storybookJson);
    storybook?.characters.forEach((character) => {
      character.images.forEach((image) => {
        if (!image.id.trim() || images.has(image.id)) {
          return;
        }
        images.set(image.id, {
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
        });
      });
    });
  });
  return images;
}

export function messageImageIds(message: MessageRecord) {
  return [...new Set([
    ...(message.phoneImageIds ?? []),
    ...(message.imageAttachments?.map((image) => image.id) ?? []),
    ...(message.socialDirectMessage?.imageIds ?? []),
    ...(message.socialPost?.imageId ? [message.socialPost.imageId] : []),
    ...(message.socialDirectMessage?.origin?.postImageId
      ? [message.socialDirectMessage.origin.postImageId] : []),
  ].map((id) => id.trim()).filter(Boolean))];
}

function candidateCaption(message: MessageRecord, attachment: ChatImageAttachment) {
  return (
    message.phoneImageDescription?.trim() ||
    message.rpImageDescription?.trim() ||
    message.socialPost?.imageDescription?.trim() ||
    attachment.description?.trim() ||
    undefined
  );
}

function imageCandidatesForMessage(
  message: MessageRecord,
  storybookImages: ReadonlyMap<string, ChatImageAttachment>,
) {
  const attachmentById = new Map(
    (message.imageAttachments ?? [])
      .filter((image) => image.id.trim())
      .map((image) => [image.id.trim(), image] as const),
  );
  const explicitIds = messageImageIds(message);
  const images = explicitIds.length
    ? explicitIds
        .map((imageId) => attachmentById.get(imageId) ?? storybookImages.get(imageId))
        .filter((image): image is ChatImageAttachment => !!image)
    : message.imageAttachments ?? [];
  return images.map((attachment) => ({
    imageId: attachment.id.trim(),
    attachment,
    messageId: message.id,
    turnId: message.turnId,
    turnNumber: message.turnNumber,
    caption: candidateCaption(message, attachment),
  }));
}

export function collectRecentReferenceImages({
  messages,
  nodes,
  options,
}: {
  messages: MessageRecord[];
  nodes: WorkflowNode[];
  options: ReferenceImageOptions;
}): ReferenceImage[] {
  const maxImages = Math.max(0, Math.round(options.maxImages));
  const additionalImageIds = (options.additionalImageScope === options.scope
    ? options.additionalImageIds : [])
    ?.map((imageId) => imageId.trim())
    .filter(Boolean) ?? [];
  if ((!options.enabled || maxImages <= 0) && additionalImageIds.length === 0) {
    return [];
  }
  const storybookImages = storybookImagesById(nodes);
  const scope = options.scope;
  const phoneScope = !!scope?.startsWith(phoneScopePrefix);
  const turnLookback = phoneScope
    ? options.phoneTurnLookback ?? options.turnLookback
    : options.turnLookback;
  const lookbackMessages = recentReferenceMessages(
    messages,
    Math.max(0, Math.round(turnLookback)),
  );
  let recentMessages = scope === undefined
    ? lookbackMessages
    : scopedReferenceMessages(
        messages,
        lookbackMessages,
        scope,
        phoneScope ? latestPhoneConversationMessageCount : 0,
      );
  if (scope === rpReferenceImageScope) {
    // Phone and social cards are visible in the RP timeline. Their images have
    // a shorter lifetime than images attached directly to RP messages.
    const cardMessages = recentReferenceMessages(messages, rpCardTurnLookback)
      .filter((message) => referenceImageScopeForMessage(message) !== rpReferenceImageScope);
    const qualifying = new Set([...recentMessages, ...cardMessages]);
    recentMessages = messages.filter((message) => qualifying.has(message));
  }
  const recentCandidates = recentMessages
    .slice()
    .reverse()
    .flatMap((message) => imageCandidatesForMessage(message, storybookImages).reverse());
  const allCandidates = messages
    .filter(includedHistoryMessage)
    .slice()
    .reverse()
    .flatMap((message) => imageCandidatesForMessage(message, storybookImages).reverse());
  const seen = new Set<string>();
  const selected: ReferenceImageCandidate[] = [];
  const addCandidate = (candidate: ReferenceImageCandidate) => {
    if (!candidate.attachment.dataUrl) {
      return false;
    }
    const key = attachmentKey(candidate.attachment);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    selected.push(candidate);
    return true;
  };
  if (options.enabled && maxImages > 0) {
    recentCandidates.forEach((candidate) => {
      if (selected.length < maxImages) {
        addCandidate(candidate);
      }
    });
  }
  additionalImageIds.forEach((imageId) => {
    const candidate = allCandidates.find((entry) => entry.imageId === imageId);
    if (candidate) {
      addCandidate(candidate);
    }
  });
  return selected.map((candidate, index) => ({
    ...candidate,
    index: index + 1,
  }));
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function referenceImageMarker(reference: ReferenceImage, imageNumber = reference.index) {
  const friendlyName = reference.attachment.name.trim();
  const imageId = rpPictureGalleryId(friendlyName) ?? (
    reference.imageId || reference.attachment.id || friendlyName
  );
  const caption = reference.caption?.trim();
  return `[Attached input image Nr${imageNumber}: ${imageId}${caption ? ` - ${caption}` : ''}]`;
}

function replaceBracketedImageContexts(
  prompt: string,
  reference: ReferenceImage,
  imageNumber: number,
) {
  const imageId = reference.imageId.trim();
  const caption = reference.caption?.trim();
  const marker = referenceImageMarker(reference, imageNumber);
  let replacements = 0;
  let markedPrompt = prompt;

  if (imageId) {
    const imageContextPattern = new RegExp(
      `\\[${escapeRegExp(imageId)}(?:\\s*:\\s*([^\\]]*))?\\]`,
      'g',
    );
    markedPrompt = markedPrompt.replace(
      imageContextPattern,
      (_match, occurrenceCaption: string | undefined) => {
        replacements += 1;
        const trimmedCaption = occurrenceCaption?.trim();
        return referenceImageMarker(
          trimmedCaption ? { ...reference, caption: trimmedCaption } : reference,
          imageNumber,
        );
      },
    );
  }

  if (caption) {
    const legacyImageContextPattern = new RegExp(
      `\\[Image:\\s*${escapeRegExp(caption)}\\]`,
      'g',
    );
    markedPrompt = markedPrompt.replace(legacyImageContextPattern, () => {
      replacements += 1;
      return marker;
    });
  }

  return { prompt: markedPrompt, replacements };
}

export function promptWithReferenceImageMarkers(
  prompt: string,
  references: ReferenceImage[],
  imageOffset = 0,
) {
  return references.reduce((currentPrompt, reference) => {
    const imageId = reference.imageId.trim();
    const imageNumber = imageOffset + reference.index;
    const marker = referenceImageMarker(reference, imageNumber);
    const contextResult = replaceBracketedImageContexts(
      currentPrompt,
      reference,
      imageNumber,
    );
    if (contextResult.replacements > 0) {
      return contextResult.prompt;
    }
    if (!imageId) {
      return `${currentPrompt}\n\n${marker}`;
    }
    if (currentPrompt.includes(marker)) {
      return currentPrompt;
    }
    const pattern = new RegExp(
      `(^|[^\\w-])(${escapeRegExp(imageId)})(?=$|[^\\w-])`,
      'g',
    );
    let replacements = 0;
    const markedPrompt = currentPrompt.replace(pattern, (_match, prefix: string) => {
      replacements += 1;
      return `${prefix}${marker}`;
    });
    if (replacements === 0) {
      return `${currentPrompt}\n\n${marker}`;
    }
    return markedPrompt;
  }, prompt);
}

export function promptWithImageAttachmentMarkers(
  prompt: string,
  images: ChatImageAttachment[],
  imageOffset = 0,
) {
  return images.reduce((currentPrompt, attachment, index) => {
    const reference: ReferenceImage = {
      index: index + 1,
      imageId: attachment.id.trim(),
      attachment,
      messageId: -1,
      caption: attachment.description?.trim() || undefined,
    };
    const imageId = reference.imageId;
    const imageNumber = imageOffset + reference.index;
    const marker = referenceImageMarker(reference, imageNumber);
    const contextResult = replaceBracketedImageContexts(
      currentPrompt,
      reference,
      imageNumber,
    );
    if (contextResult.replacements > 0) {
      return contextResult.prompt;
    }
    if (!imageId) {
      return `${currentPrompt}\n\n${marker}`;
    }
    if (currentPrompt.includes(marker)) {
      return currentPrompt;
    }
    const pattern = new RegExp(
      `(^|[^\\w-])(${escapeRegExp(imageId)})(?=$|[^\\w-])`,
      'g',
    );
    let replacements = 0;
    const markedPrompt = currentPrompt.replace(pattern, (_match, prefix: string) => {
      replacements += 1;
      return `${prefix}${marker}`;
    });
    return replacements === 0 ? `${currentPrompt}\n\n${marker}` : markedPrompt;
  }, prompt);
}

export function referenceImageAttachments(references: ReferenceImage[]) {
  return references.map((reference) => reference.attachment);
}
