import type { RpgraphSessionV2, TimelineEntry } from './types';
import { phoneNoteColors } from '../chat/phoneAppsSessions';
import {
  currentSessionFormatVersion,
  currentSessionWorkflowFormatVersion,
} from '../session/version';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Media in a session must be inline data: URLs. Anything else (http, file,
// blob, ...) could make the app call an external address when the session is
// displayed, leaking IP, time, and a unique tracking marker.
function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function isAudioDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:audio/');
}

function isImageEntityRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === 'string' &&
        typeof entry.name === 'string' &&
        typeof entry.mimeType === 'string' &&
        isImageDataUrl(entry.dataUrl),
    )
  );
}

function isTimelineEntry(value: unknown): value is TimelineEntry {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return false;
  }
  if (value.kind === 'message') {
    const validImages = value.images === undefined || (
      Array.isArray(value.images) &&
      value.images.every((image) => isRecord(image) && typeof image.imageId === 'string')
    );
    const validEmbeddedMessageIds = [
      value.embeddedPhoneMessageIds,
      value.embeddedSocialMessageIds,
    ].every((ids) => ids === undefined || (
      Array.isArray(ids) && ids.every((id) => typeof id === 'string')
    ));
    const validEmbeddedPhoneText = value.embeddedPhoneText === undefined || (
      isRecord(value.embeddedPhoneText) &&
      (
        value.embeddedPhoneText.before === undefined ||
        typeof value.embeddedPhoneText.before === 'string'
      ) &&
      (
        value.embeddedPhoneText.after === undefined ||
        typeof value.embeddedPhoneText.after === 'string'
      ) &&
      (
        value.embeddedPhoneText.translatedBefore === undefined ||
        typeof value.embeddedPhoneText.translatedBefore === 'string'
      ) &&
      (
        value.embeddedPhoneText.translatedAfter === undefined ||
        typeof value.embeddedPhoneText.translatedAfter === 'string'
      )
    );
    const validPhone = value.channel !== 'phone' || (
      isRecord(value.phone) &&
      typeof value.phone.from === 'string' &&
      typeof value.phone.to === 'string' &&
      (value.phone.voiceMessage === undefined || typeof value.phone.voiceMessage === 'boolean') &&
      (
        value.phone.imageIds === undefined ||
        (Array.isArray(value.phone.imageIds) && value.phone.imageIds.every((id) => typeof id === 'string'))
      )
    );
    const validVoiceClips = value.voiceClips === undefined || (
      Array.isArray(value.voiceClips) &&
      value.voiceClips.every((clip) =>
        isRecord(clip) &&
        (typeof clip.speakerName === 'string' || clip.speakerName === null) &&
        typeof clip.text === 'string' &&
        isAudioDataUrl(clip.dataUrl) &&
        (clip.filename === undefined || typeof clip.filename === 'string') &&
        (
          clip.source === undefined ||
          clip.source === 'dialogue' ||
          clip.source === 'narration' ||
          clip.source === 'phone'
        ) &&
        (clip.createdAt === undefined || typeof clip.createdAt === 'string')
      )
    );
    const validSocialPost = value.socialPost === undefined || (
      isRecord(value.socialPost) &&
      (value.socialPost.app === 'fotogram' || value.socialPost.app === 'onlyfriends') &&
      typeof value.socialPost.postId === 'string' &&
      typeof value.socialPost.author === 'string' &&
      typeof value.socialPost.authorHandle === 'string' &&
      typeof value.socialPost.caption === 'string' &&
      (value.socialPost.textOnly === undefined || typeof value.socialPost.textOnly === 'boolean') &&
      (value.socialPost.imageId === undefined || typeof value.socialPost.imageId === 'string') &&
      (value.socialPost.imageDescription === undefined || typeof value.socialPost.imageDescription === 'string')
    );
    const validSocialThreadAction = value.socialThreadAction === undefined || (
      isRecord(value.socialThreadAction) &&
      typeof value.socialThreadAction.actionId === 'string' &&
      (value.socialThreadAction.action === 'comment' || value.socialThreadAction.action === 'load-more') &&
      (value.socialThreadAction.app === 'fotogram' || value.socialThreadAction.app === 'onlyfriends') &&
      typeof value.socialThreadAction.postId === 'string' &&
      typeof value.socialThreadAction.postAuthor === 'string' &&
      typeof value.socialThreadAction.postAuthorHandle === 'string' &&
      typeof value.socialThreadAction.postCaption === 'string' &&
      typeof value.socialThreadAction.actor === 'string' &&
      typeof value.socialThreadAction.actorHandle === 'string' &&
      (
        value.socialThreadAction.commentText === undefined ||
        typeof value.socialThreadAction.commentText === 'string'
      )
    );
    const validSocialReactions = value.socialReactions === undefined || (
      isRecord(value.socialReactions) &&
      (value.socialReactions.app === 'fotogram' || value.socialReactions.app === 'onlyfriends') &&
      typeof value.socialReactions.postId === 'string' &&
      typeof value.socialReactions.likes === 'number' &&
      (value.socialReactions.append === undefined || typeof value.socialReactions.append === 'boolean') &&
      Array.isArray(value.socialReactions.comments) &&
      value.socialReactions.comments.every((comment) =>
        isRecord(comment) &&
        typeof comment.from === 'string' &&
        typeof comment.handle === 'string' &&
        typeof comment.text === 'string'
      )
    );
    const validSocialDirectMessage = value.socialDirectMessage === undefined || (
      isRecord(value.socialDirectMessage) &&
      (value.socialDirectMessage.app === 'fotogram' || value.socialDirectMessage.app === 'onlyfriends') &&
      typeof value.socialDirectMessage.messageId === 'string' &&
      typeof value.socialDirectMessage.from === 'string' &&
      typeof value.socialDirectMessage.fromHandle === 'string' &&
      typeof value.socialDirectMessage.to === 'string' &&
      typeof value.socialDirectMessage.toHandle === 'string' &&
      typeof value.socialDirectMessage.text === 'string' &&
      (
        value.socialDirectMessage.tip === undefined ||
        (
          typeof value.socialDirectMessage.tip === 'number' &&
          value.socialDirectMessage.tip > 0 &&
          value.socialDirectMessage.app === 'onlyfriends'
        )
      ) &&
      (
        value.socialDirectMessage.internalText === undefined ||
        typeof value.socialDirectMessage.internalText === 'string'
      ) &&
      (
        value.socialDirectMessage.displayText === undefined ||
        typeof value.socialDirectMessage.displayText === 'string'
      ) &&
      typeof value.socialDirectMessage.sentAt === 'string' &&
      (
        value.socialDirectMessage.imageIds === undefined ||
        (
          Array.isArray(value.socialDirectMessage.imageIds) &&
          value.socialDirectMessage.imageIds.every((id) => typeof id === 'string')
        )
      ) &&
      (
        value.socialDirectMessage.replyToMessageId === undefined ||
        typeof value.socialDirectMessage.replyToMessageId === 'string'
      ) &&
      (
        value.socialDirectMessage.origin === undefined ||
        (
          isRecord(value.socialDirectMessage.origin) &&
          typeof value.socialDirectMessage.origin.postId === 'string' &&
          typeof value.socialDirectMessage.origin.postAuthor === 'string' &&
          typeof value.socialDirectMessage.origin.postAuthorHandle === 'string' &&
          typeof value.socialDirectMessage.origin.postCaption === 'string' &&
          (
            value.socialDirectMessage.origin.postImageId === undefined ||
            typeof value.socialDirectMessage.origin.postImageId === 'string'
          ) &&
          (
            value.socialDirectMessage.origin.postImageDescription === undefined ||
            typeof value.socialDirectMessage.origin.postImageDescription === 'string'
          ) &&
          (
            value.socialDirectMessage.origin.commentAuthor === undefined ||
            typeof value.socialDirectMessage.origin.commentAuthor === 'string'
          ) &&
          (
            value.socialDirectMessage.origin.commentAuthorHandle === undefined ||
            typeof value.socialDirectMessage.origin.commentAuthorHandle === 'string'
          ) &&
          (
            value.socialDirectMessage.origin.commentText === undefined ||
            typeof value.socialDirectMessage.origin.commentText === 'string'
          )
        )
      )
    );
    const validCreatedPhoneNote = value.createdPhoneNote === undefined || (
      isRecord(value.createdPhoneNote) &&
      typeof value.createdPhoneNote.characterId === 'string' &&
      typeof value.createdPhoneNote.characterName === 'string' &&
      isRecord(value.createdPhoneNote.note) &&
      typeof value.createdPhoneNote.note.id === 'string' &&
      typeof value.createdPhoneNote.note.title === 'string' &&
      typeof value.createdPhoneNote.note.text === 'string' &&
      typeof value.createdPhoneNote.note.dayLabel === 'string' &&
      phoneNoteColors.includes(value.createdPhoneNote.note.color as (typeof phoneNoteColors)[number]) &&
      (
        value.createdPhoneNote.operation === undefined ||
        value.createdPhoneNote.operation === 'create' ||
        value.createdPhoneNote.operation === 'update'
      )
    );
    const validSimulatedAiChat = value.simulatedAiChat === undefined || (
      isRecord(value.simulatedAiChat) &&
      typeof value.simulatedAiChat.characterId === 'string' &&
      typeof value.simulatedAiChat.characterName === 'string' &&
      isRecord(value.simulatedAiChat.chat) &&
      typeof value.simulatedAiChat.chat.id === 'string' &&
      typeof value.simulatedAiChat.chat.title === 'string' &&
      typeof value.simulatedAiChat.chat.createdAt === 'string' &&
      Array.isArray(value.simulatedAiChat.chat.messages) &&
      value.simulatedAiChat.chat.messages.length >= 2 &&
      // Manual ChatGPD commits can be longer than LLM-simulated chats and may
      // contain consecutive user messages after a failed send, so only the
      // message shape is validated here. The strict 2-8 alternating rule for
      // LLM output lives in parseSimulatedAiChat.
      value.simulatedAiChat.chat.messages.every((message) =>
        isRecord(message) &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.text === 'string' &&
        !!message.text.trim()
      ) &&
      value.simulatedAiChat.chat.messages.some((message) =>
        isRecord(message) && message.role === 'assistant'
      )
    );
    const validDeletedPhoneNote = value.deletedPhoneNote === undefined || (
      isRecord(value.deletedPhoneNote) &&
      typeof value.deletedPhoneNote.characterId === 'string' &&
      typeof value.deletedPhoneNote.characterName === 'string' &&
      isRecord(value.deletedPhoneNote.note) &&
      typeof value.deletedPhoneNote.note.id === 'string' &&
      typeof value.deletedPhoneNote.note.title === 'string' &&
      typeof value.deletedPhoneNote.note.text === 'string' &&
      typeof value.deletedPhoneNote.note.dayLabel === 'string' &&
      phoneNoteColors.includes(value.deletedPhoneNote.note.color as (typeof phoneNoteColors)[number])
    );
    return (
      typeof value.turnId === 'string' &&
      typeof value.turnNumber === 'number' &&
      (value.phase === 'input' || value.phase === 'output') &&
      (value.channel === 'rp' || value.channel === 'phone') &&
      (value.role === 'user' || value.role === 'assistant' || value.role === 'error') &&
      isRecord(value.text) &&
      typeof value.text.original === 'string' &&
      (
        value.replyToMessageId === undefined ||
        (value.channel === 'phone' && typeof value.replyToMessageId === 'string')
      ) &&
      validImages &&
      validEmbeddedMessageIds &&
      validVoiceClips &&
      validEmbeddedPhoneText &&
      validPhone &&
      validSocialPost &&
      validSocialThreadAction &&
      validSocialReactions &&
      validSocialDirectMessage &&
      validCreatedPhoneNote &&
      validDeletedPhoneNote &&
      validSimulatedAiChat
    );
  }
  if (value.kind === 'event-change') {
    return Array.isArray(value.eventIds) && value.eventIds.every((id) => typeof id === 'string');
  }
  return value.kind === 'state' || value.kind === 'system';
}

function isNumberRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

function isStringArrayRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) => Array.isArray(entry) && entry.every((item) => typeof item === 'string'),
    )
  );
}

function isNestedNonNegativeNumberRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) =>
      isRecord(entry) &&
      Object.values(entry).every(
        (amount) => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0,
      )
    )
  );
}

function isSocialConnectionsRecord(value: unknown) {
  return isRecord(value) && Object.values(value).every((apps) =>
    isRecord(apps) &&
    (apps.fotogram === undefined || (
      Array.isArray(apps.fotogram) && apps.fotogram.every((entry) => typeof entry === 'string')
    )) &&
    (apps.onlyfriends === undefined || (
      Array.isArray(apps.onlyfriends) && apps.onlyfriends.every((entry) => typeof entry === 'string')
    ))
  );
}

function isDynamicSocialUsersRecord(value: unknown) {
  return isRecord(value) && Object.entries(value).every(([id, user]) =>
    isRecord(user) &&
    user.id === id &&
    typeof user.name === 'string' &&
    user.source === 'dynamic' &&
    isRecord(user.handles) &&
    (user.handles.fotogram === undefined || typeof user.handles.fotogram === 'string') &&
    (user.handles.onlyfriends === undefined || typeof user.handles.onlyfriends === 'string')
  );
}

function hasValidReplyReferences(timeline: unknown[]) {
  const phoneMessagesById = new Map<string, Record<string, unknown>>();
  timeline.forEach((entry) => {
    if (
      isRecord(entry) &&
      entry.kind === 'message' &&
      entry.channel === 'phone' &&
      typeof entry.id === 'string'
    ) {
      phoneMessagesById.set(entry.id, entry);
    }
  });
  return timeline.every(
    (entry) =>
      !isRecord(entry) ||
      entry.kind !== 'message' ||
      entry.replyToMessageId === undefined ||
      (typeof entry.replyToMessageId === 'string' &&
        phoneMessagesById.has(entry.replyToMessageId) &&
        phoneMessagesById.get(entry.replyToMessageId)?.replyToMessageId === undefined),
  );
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function isEventEntityRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === 'string' &&
        (entry.status === 'upcoming' || entry.status === 'completed' || entry.status === 'cancelled') &&
        typeof entry.title === 'string' &&
        isOptionalString(entry.scheduledAt) &&
        isOptionalString(entry.condition) &&
        isOptionalString(entry.details) &&
        (entry.channel === undefined || entry.channel === 'chat' || entry.channel === 'phone') &&
        (
          entry.phone === undefined ||
          (isRecord(entry.phone) && Object.values(entry.phone).every(isOptionalString))
        ) &&
        isOptionalString(entry.requestedBy) &&
        isOptionalString(entry.assignedTo) &&
        isRecord(entry.source),
    )
  );
}

function isMemoryEntityRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === 'string' &&
        typeof entry.name === 'string' &&
        typeof entry.text === 'string' &&
        (entry.mode === 'joined' || entry.mode === 'input' || entry.mode === 'output'),
    )
  );
}

function isNodeRuntimeRecord(value: unknown) {
  return isRecord(value) && Object.values(value).every(isRecord);
}

function isSnapshotPairRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) => isRecord(entry) && isRecord(entry.before) && isRecord(entry.after),
    )
  );
}

function isTurnCheckpoint(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.turnId === 'string' &&
    Array.isArray(value.createdTimelineEntryIds) &&
    value.createdTimelineEntryIds.every((id) => typeof id === 'string') &&
    isSnapshotPairRecord(value.nodeSnapshots) &&
    (
      value.workflowVariables === undefined ||
      (
        isRecord(value.workflowVariables) &&
        isWorkflowVariableRecord(value.workflowVariables.before) &&
        isWorkflowVariableRecord(value.workflowVariables.after)
      )
    ) &&
    (
      value.eventSnapshots === undefined ||
      (
        isRecord(value.eventSnapshots) &&
        Object.values(value.eventSnapshots).every(
          (entry) =>
            isRecord(entry) &&
            (entry.before === undefined || isRecord(entry.before)) &&
            (entry.after === undefined || isRecord(entry.after)),
        )
      )
    )
  );
}

function isWorkflowVariableRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) =>
        typeof entry === 'string' ||
        (typeof entry === 'number' && Number.isFinite(entry)),
    )
  );
}

export function isRpgraphSessionV2(value: unknown): value is RpgraphSessionV2 {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.format === 'rpgraph-session' &&
    value.formatVersion === currentSessionFormatVersion &&
    typeof value.savedAt === 'string' &&
    typeof value.name === 'string' &&
    isRecord(value.metadata) &&
    isRecord(value.metadata.settings) &&
    typeof value.metadata.settings.englishProcessingEnabled === 'boolean' &&
    (
      value.metadata.settings.inputTranslationOnlyEnabled === undefined ||
      typeof value.metadata.settings.inputTranslationOnlyEnabled === 'boolean'
    ) &&
    typeof value.metadata.settings.displayLanguage === 'string' &&
    isRecord(value.workflow) &&
    value.workflow.format === 'rpgraph-workflow' &&
    value.workflow.formatVersion === currentSessionWorkflowFormatVersion &&
    isRecord(value.workflow.graph) &&
    Array.isArray(value.workflow.graph.nodes) &&
    Array.isArray(value.workflow.graph.edges) &&
    Array.isArray(value.timeline) &&
    value.timeline.every(isTimelineEntry) &&
    hasValidReplyReferences(value.timeline) &&
    isRecord(value.entities) &&
    isImageEntityRecord(value.entities.images) &&
    isEventEntityRecord(value.entities.events) &&
    isMemoryEntityRecord(value.entities.memory) &&
    isRecord(value.runtime) &&
    isRecord(value.runtime.current) &&
    isWorkflowVariableRecord(value.runtime.current.workflowVariables) &&
    isNodeRuntimeRecord(value.runtime.current.nodes) &&
    Array.isArray(value.runtime.undo) &&
    value.runtime.undo.every(isTurnCheckpoint) &&
    isRecord(value.ui) &&
    isNumberRecord(value.ui.phoneSeenByConversation) &&
    isNumberRecord(value.ui.bankingSeenByCharacter) &&
    (value.ui.phoneAppSeenByCharacter === undefined || isNumberRecord(value.ui.phoneAppSeenByCharacter)) &&
    isStringArrayRecord(value.ui.bankingContactsByCharacter) &&
    isStringArrayRecord(value.ui.socialLikesByAccount) &&
    isDynamicSocialUsersRecord(value.ui.dynamicSocialUsers) &&
    isSocialConnectionsRecord(value.ui.socialConnectionsByCharacter) &&
    isNestedNonNegativeNumberRecord(value.ui.onlyFriendsPurchasesByCharacter) &&
    isNumberRecord(value.ui.phoneDividerAfterByConversation) &&
    (
      value.ui.recentlyUsedEmojis === undefined ||
      (
        Array.isArray(value.ui.recentlyUsedEmojis) &&
        value.ui.recentlyUsedEmojis.every((emoji) => typeof emoji === 'string')
      )
    ) &&
    // Notes and ChatGPD chats are normalized element-wise on load; only the
    // container shape is validated here.
    (value.ui.phoneNotesByCharacter === undefined || isRecord(value.ui.phoneNotesByCharacter)) &&
    (value.ui.chatGpdChatsByCharacter === undefined || isRecord(value.ui.chatGpdChatsByCharacter))
  );
}
