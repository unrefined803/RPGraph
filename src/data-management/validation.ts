import type { RpgraphSessionV2, TimelineEntry } from './types';
import {
  currentSessionFormatVersion,
  currentSessionWorkflowFormatVersion,
} from '../session/version';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
        typeof clip.dataUrl === 'string' &&
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
      validVoiceClips &&
      validEmbeddedPhoneText &&
      validPhone &&
      validSocialPost &&
      validSocialThreadAction &&
      validSocialReactions
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
    isRecord(value.runtime) &&
    isRecord(value.runtime.current) &&
    isWorkflowVariableRecord(value.runtime.current.workflowVariables) &&
    isRecord(value.ui) &&
    isNumberRecord(value.ui.phoneSeenByConversation) &&
    isNumberRecord(value.ui.bankingSeenByCharacter) &&
    isStringArrayRecord(value.ui.bankingContactsByCharacter) &&
    isStringArrayRecord(value.ui.socialLikesByAccount) &&
    isNumberRecord(value.ui.phoneDividerAfterByConversation)
  );
}
