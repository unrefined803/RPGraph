import { captureTurnRuntime } from '../chat/turns';
import { currentSessionFormatVersion } from '../session/version';
import type { MessageRecord, TurnRecord, WorkflowFile, WorkflowNode, WorkflowNodeData } from '../types';
import { getRegisteredCoreNode, registerNode } from '../nodes/registry';
import { currentCoreNodeVersions } from '../nodes/nodeVersion';
import type { ExecuteContext, NodeCreationDefinition } from '../nodes/types';
import {
  emptyRpStorybookV1,
  parseRpStorybookAssistantResult,
  parseRpStorybookJson,
  rpStorybookFormattedText,
  rpStorybookEditPrompt,
  rpStorybookJsonText,
} from '../nodes/rp-storybook-v1/model';
import {
  storybookImageById,
  storybookImageDescriptions,
  storybookImageSourceById,
  withChangedStorybookImageDescriptionsSynchronized,
  withImagesEnsuredForStorybookCharacter,
  withStorybookImageDescriptionUpdated,
} from '../storybook/imageLibrary';
import { storybookAssistantConversationContext } from '../storybook/assistantConversation';
import {
  sillyTavernImportInstruction,
  validateSillyTavernImportResult,
} from '../storybook/sillyTavernImport';
import {
  storybookImageIdsUsedByMessages,
  usedStorybookImageIdsRemoved,
  withStorybookImageDescriptions,
} from '../storybook/imageUsage';
import {
  openingHistoryCheckpointsFromNodes,
  openingHistorySocialLikesFromNodes,
  openingHistoryTurnsFromNodes,
  turnsWithStorybookImageRefs,
  remapOpeningTurnMessageIds,
} from '../storybook/openingHistoryRuntime';
import {
  appStateFromSessionV2,
  latestSessionV2TurnNumber,
  type SessionV2CurrentStateInput,
  sessionV2FromCurrentState,
} from '../data-management/sessionStore';
import { formatPhoneContext } from '../data-management/formatters';
import { isRpgraphSessionV2 } from '../data-management/validation';
import { appointmentFromEventEntity, type TimelineMessageEntry } from '../data-management/types';
import {
  updateAppointmentStatus,
  upcomingAppointments,
} from '../data-management/eventStore';
import {
  buildHistoryOutputs,
  boundedHistoryLastTurnsCount,
} from '../data-management/historyStore';
import { debugTurnSummaryFromTurnRecord } from '../data-management/debugContext';
import { createTurnTrace, turnTraceCopyPayload } from '../app/turnTrace';
import { replacementGraphInputText } from '../app/runOrchestration';
import {
  directPhoneTimelineEntries,
  embeddedPhoneMessageCharacters,
  matchingPhoneName,
  phoneContactsForViewer,
  phoneConversationInfoFromMessages,
  phoneConversationKey,
  phoneConversationMessageViews,
  linkedPhoneMessageIds,
  messageEffectiveRpDateTime,
  phoneMessagesBetween,
  phoneMessagesById,
  selectedPhoneConversationMessages,
  phoneSeenStateFromMessages,
  phoneSwitchCharacters,
  unreadPhoneConversationsForCharacters,
  viewerHasUnreadPhoneMessages,
  visibleMessageRecords,
} from '../data-management/selectors';
import {
  canonicalPhoneName,
  embeddedPhoneMessagesLivePreview,
  parseEmbeddedPhoneMessagesFromRpOutput,
  parsePhoneMessageOutput,
  phoneImageActionMatchesMessage,
} from '../chat/phoneMessages';
import { parseOutputActions } from '../chat/outputActions';
import { directAppActionJson } from '../chat/directAppActions';
import { parseRpOutput } from '../chat/rpOutput';
import { formatPhoneInput } from '../chat/phoneReplies';
import {
  mergePhoneAppRecordsByCharacter,
  normalizeChatGpdChatsByCharacter,
  normalizePhoneNotesByCharacter,
  deletePhoneNotesForTurn,
  createdPhoneNoteActionVerb,
  phoneNoteContentMatches,
  replaceCreatedPhoneNotesForTurn,
  replaceSimulatedAiChatsForTurn,
} from '../chat/phoneAppsSessions';
import {
  archivedSimulatedAiChatIds,
  lastDirectCreatedPhoneNoteTurn,
  removeCreatedPhoneNoteFromLastTurn,
  replaceCreatedPhoneNoteInLastTurn,
  revertCreatedPhoneNotesForMessages,
  revertSimulatedAiChatsForMessages,
} from '../chat/phoneAppHistoryMessages';
import {
  bankingRecipientNamesForCharacter,
  bankingSeenStateFromMessages,
  latestBankTransferMessageIdForCharacter,
  unreadBankTransferCountForCharacter,
} from '../chat/bankTransfers';
import {
  onlyFriendsWalletBalance,
  onlyFriendsWalletName,
} from '../chat/onlyFriendsWallet';
import {
  parseSocialDirectMessageOutput,
  parseSocialReactionsOutput,
  socialDirectMessageInputText,
  socialMessageHiddenFromChat,
  socialPostEngagementByPostId,
  socialPostTextFromInput,
  socialReactionsByPostId,
  socialThreadActionInputText,
  socialThreadCommentTextFromInput,
  socialThreadRunContextFromInput,
} from '../chat/socialMedia';
import type { StorybookCharacter, StorybookCreateImageCharacter } from '../storybook/runtime';
import {
  collectRecentReferenceImages,
  promptWithImageAttachmentMarkers,
  promptWithReferenceImageMarkers,
} from '../chat/referenceImages';
import {
  defaultCreateImageResultTemplate,
  defaultPromptActionConfig,
  countPromptActionUses,
  executePromptAction,
  knownPromptActionId,
  parsePromptActionCall,
  parsePromptActionRequest,
  promptActionConfigs,
  promptActionInstructionText,
  promptActionRuntimeSettings,
  replacePromptActionTitle,
  unwrapJsonCodeFence,
} from '../nodes/shared/promptActions';
import { promptImagePass } from '../nodes/shared/promptImagePass';
import {
  defaultPromptCommandInstructionTemplate,
  formatPromptCommandTokens,
  knownPromptCommandId,
  replacePromptCommandTokensWithHints,
} from '../nodes/shared/promptCommands';
import { runActionAwarePrompt } from '../nodes/shared/promptRun';
import { applyTurnCheckpointToNodes } from '../data-management/checkpointStore';
import { executeGraph, resolveCreateImageCharacterByName } from '../graph/executeGraph';
import { NodeLlmApi } from '../llm/NodeLlmApi';
import { TextMetricsApi } from '../llm/tokenMetrics';
import {
  hydrateNodeData,
  persistentNodeData,
  removeEdgesConnectedToIncompatibleNodes,
} from './persistence';
import { formatAppointments, formatChatHistory } from './textHelpers';
import { isRpSaveFile, isWorkflowFile } from './validation';
import { currentWorkflowFormatVersion } from './version';
import {
  extractWorkflowVariableSetCommands,
  resolveWorkflowVariables,
  workflowVariablePreviewValues,
} from './variables';

const bundledDefaultWorkflows = import.meta.glob<{ default: unknown }>(
  '../../workflow.default*.json',
  { eager: true },
);
const bundledDefaultWorkflowPaths = Object.keys(bundledDefaultWorkflows)
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
const bundledDefaultWorkflowPath =
  bundledDefaultWorkflowPaths[bundledDefaultWorkflowPaths.length - 1];
if (!bundledDefaultWorkflowPath) {
  throw new Error('No workflow.default*.json file was found in the project root.');
}
const currentWorkflow = bundledDefaultWorkflows[bundledDefaultWorkflowPath]
  .default as WorkflowFile;

function assertFixture(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Workflow validation fixture failed: ${message}`);
  }
}

function assertThrowsFixture(action: () => void, message: string) {
  try {
    action();
  } catch {
    return;
  }
  throw new Error(`Workflow validation fixture failed: ${message}`);
}

export function verifyWorkflowValidationFixtures() {
  const normalizedPhoneNotes = normalizePhoneNotesByCharacter({
    alex: [
      { id: 'note-1', title: 'First', text: '', dayLabel: '', color: 'mint' },
      { id: 'note-1', title: 'Duplicate', text: '', dayLabel: '', color: 'rose' },
    ],
  });
  assertFixture(
    normalizedPhoneNotes.alex?.length === 1 && normalizedPhoneNotes.alex[0]?.title === 'First',
    'Phone notes must discard duplicate record ids during normalization',
  );
  const normalizedChatGpdChats = normalizeChatGpdChatsByCharacter({
    alex: [{
      id: 'chat-1',
      title: 'Fixture',
      createdAt: '2026-07-12T00:00:00.000Z',
      messages: [
        { role: 'user', text: 'Hello' },
        { role: 'invalid', text: 'Must not become an assistant message' },
      ],
    }],
  });
  assertFixture(
    normalizedChatGpdChats.alex?.[0]?.messages.length === 1 &&
      normalizedChatGpdChats.alex[0]?.messages[0]?.role === 'user',
    'ChatGPD normalization must reject invalid message roles',
  );
  const mergedPhoneRecords = mergePhoneAppRecordsByCharacter(
    { alex: [{ id: 'note-1' }] },
    { alex: [{ id: 'note-2' }, { id: 'note-2' }] },
  );
  assertFixture(
    mergedPhoneRecords.alex?.length === 2,
    'Opening-history phone records must not introduce duplicate ids',
  );

  const bankingCharacter: StorybookCharacter = {
    id: 'storybook:character:espen',
    storybookNodeId: 'storybook',
    kind: 'character',
    sourceId: 'espen',
    name: 'Espen Harper',
    label: 'Espen Harper',
    profile: {
      name: 'Espen Harper',
      description: '',
      personality: '',
      speechStyle: '',
      role: '',
    },
    phoneSettings: { wallpaperId: 'wallpaper-1' },
    banking: { startBalance: 100, fixedExpenses: [] },
    social: { fotogramUsername: '', onlyfriendsUsername: '' },
  };
  const bankingMessages: MessageRecord[] = [
    {
      id: 10,
      role: 'output',
      originalText: 'Incoming transfer',
      bankTransfer: { from: 'Danny Harper', to: 'Espen Harper', amount: 50 },
    },
    {
      id: 11,
      role: 'output',
      originalText: 'Outgoing transfer',
      bankTransfer: { from: 'Espen Harper', to: 'Ryan Parker', amount: 20 },
    },
    {
      id: 12,
      role: 'output',
      originalText: 'Second incoming transfer',
      bankTransfer: { from: 'Ryan Parker', to: 'Espen Harper', amount: 10 },
    },
  ];
  assertFixture(
    latestBankTransferMessageIdForCharacter(bankingCharacter, bankingMessages) === 12 &&
      unreadBankTransferCountForCharacter(bankingCharacter, bankingMessages, 10) === 1 &&
      bankingSeenStateFromMessages([bankingCharacter], bankingMessages)[bankingCharacter.id] === 12,
    'Banking badges must count unseen incoming transfers once and preserve the latest seen message id',
  );
  assertFixture(
    bankingRecipientNamesForCharacter(
      bankingCharacter,
      [bankingCharacter],
      bankingMessages,
      ['Taylor Reed', 'danny harper'],
    ).join('|') === 'Danny Harper|Ryan Parker|Taylor Reed',
    'Banking recipients must include transfer counterparties and deduplicated saved contacts',
  );
  const onlyFriendsWalletMessages: MessageRecord[] = [
    {
      id: 13,
      role: 'output',
      originalText: 'Wallet top-up',
      bankTransfer: { from: bankingCharacter.name, to: onlyFriendsWalletName, amount: 100 },
    },
    {
      id: 14,
      role: 'output',
      originalText: 'Wallet withdrawal',
      bankTransfer: { from: onlyFriendsWalletName, to: bankingCharacter.name, amount: 20 },
    },
    {
      id: 15,
      role: 'output',
      originalText: 'DM tip',
      socialDirectMessage: {
        app: 'onlyfriends',
        messageId: 'onlyfriends-dm-tip-1',
        from: 'Generous Fan',
        fromHandle: 'generous.fan',
        to: bankingCharacter.name,
        toHandle: 'banking.character',
        text: 'You earned this!',
        tip: 5.5,
        sentAt: '2026-06-01T12:00:00.000Z',
      },
    },
  ];
  assertFixture(
    onlyFriendsWalletBalance(
      bankingCharacter,
      onlyFriendsWalletMessages,
      { 'onlyfriends-post-1': 9.99 },
    ) === 75.51,
    'OnlyFriends balance must combine bank funding, withdrawals, received DM tips, and internal post purchases',
  );

  const socialThreadAction = {
    actionId: 'thread-action-1',
    action: 'comment' as const,
    app: 'fotogram' as const,
    postId: 'post-1',
    postAuthor: 'Alex',
    postAuthorHandle: 'alex',
    postCaption: 'A sunny afternoon.',
    actor: 'Alex',
    actorHandle: 'alex',
    commentText: 'How does everyone like this place?',
  };
  const socialThreadInput = socialThreadActionInputText(
    socialThreadAction,
    [{ from: 'Background Friend', handle: 'background.friend', text: 'Looks great!' }],
    12,
  );
  assertFixture(
    socialThreadInput.includes("Post ownership: actor's own post") &&
      socialThreadInput.includes('Likes: 12') &&
      socialThreadInput.includes('Comment count: 1') &&
      socialThreadInput.includes('Background Friend (@background.friend): Looks great!') &&
      socialPostTextFromInput('[SOCIAL MEDIA POST]\nPost text: Translated caption') ===
        'Translated caption' &&
      socialThreadCommentTextFromInput(
        '[SOCIAL MEDIA THREAD ACTION]\nNew comment from the actor: Translated comment',
      ) === 'Translated comment' &&
      socialThreadRunContextFromInput(socialThreadInput).likeCount === 12 &&
      socialThreadRunContextFromInput(socialThreadInput).existingComments[0]?.handle ===
        'background.friend',
    'social inputs must expose ownership and translated user text for persistence',
  );
  const socialDirectMessage = {
    app: 'fotogram' as const,
    messageId: 'fotogram-dm-user-1',
    from: 'Alex',
    fromHandle: 'alex',
    to: 'Jamie',
    toHandle: 'jamie',
    text: 'Are you free later?',
    sentAt: '2026-06-01T12:30:00.000Z',
    origin: {
      postId: 'post-dress-1',
      postAuthor: 'Alex',
      postAuthorHandle: 'alex',
      postCaption: 'Trying this dress for tonight.',
      postImageId: 'alex_dress_01',
      postImageDescription: 'Alex wears a green evening dress.',
      commentAuthor: 'Jamie',
      commentAuthorHandle: 'jamie',
      commentText: 'That dress looks amazing!',
    },
  };
  const socialDirectInput = socialDirectMessageInputText(socialDirectMessage, [{
    id: 19,
    role: 'output',
    originalText: 'Earlier DM',
    socialDirectMessage: {
      app: 'fotogram',
      messageId: 'fotogram-dm-reply-0',
      from: 'Jamie',
      fromHandle: 'jamie',
      to: 'Alex',
      toHandle: 'alex',
      text: 'Maybe after work.',
      sentAt: '2026-06-01T12:00:00.000Z',
    },
  }]);
  const parsedSocialDirectReply = parseSocialDirectMessageOutput(
    [
      '{"fotogramDirectMessage":{"text":"Yes, message me when you are done!"}}',
      '{"phoneMessages":[{"from":"Jamie","to":"Alex","message":"Here is my number."}]}',
      '{"bankTransfers":[{"from":"Jamie","to":"Alex","amount":20,"note":"For the dress"}]}',
    ].join('\n'),
    socialDirectMessage,
    '2026-06-01T12:31:00.000Z',
  );
  const rejectedSocialDirectReply = parseSocialDirectMessageOutput(
    '{"onlyFriendsDirectMessage":{"text":"Wrong app key"}}',
    socialDirectMessage,
    '2026-06-01T12:31:00.000Z',
  );
  const parsedOnlyFriendsTipReply = parseSocialDirectMessageOutput(
    '{"onlyFriendsDirectMessage":{"text":"You are the best!","tip":10}}',
    { ...socialDirectMessage, app: 'onlyfriends' as const },
    '2026-06-01T12:31:00.000Z',
  );
  assertFixture(
    socialDirectInput.startsWith('[FOTOGRAM DIRECT MESSAGE]') &&
      socialDirectInput.includes('Jamie (@jamie): Maybe after work.') &&
      socialDirectInput.includes('Post text: Trying this dress for tonight.') &&
      socialDirectInput.includes('Original comment from Jamie (@jamie): That dress looks amazing!') &&
      socialDirectInput.includes('New message: Are you free later?') &&
      parsedSocialDirectReply.message?.fromHandle === 'jamie' &&
      parsedSocialDirectReply.message?.toHandle === 'alex' &&
      parsedSocialDirectReply.message?.replyToMessageId === 'fotogram-dm-user-1' &&
      parsedSocialDirectReply.message?.origin?.postImageId === 'alex_dress_01' &&
      parsedSocialDirectReply.phoneMessages[0]?.message === 'Here is my number.' &&
      parsedSocialDirectReply.bankTransfers[0]?.amount === 20 &&
      parsedSocialDirectReply.warnings.length === 0 &&
      rejectedSocialDirectReply.message === undefined &&
      rejectedSocialDirectReply.warnings.some((warning) =>
        warning.includes('fotogramDirectMessage'),
      ) &&
      parsedOnlyFriendsTipReply.message?.tip === 10 &&
      socialMessageHiddenFromChat({
        id: 22,
        role: 'output',
        originalText: 'Hidden DM history',
        socialDirectMessage: parsedSocialDirectReply.message,
      }),
    'social direct messages must include conversation context, parse the recipient reply, and stay hidden in Chat',
  );
  const parsedReactionsWithDms = parseSocialReactionsOutput(
    [
      '{"reactions":{"postId":"onlyfriends-post-01","likes":30,"comments":[{"from":"Fan","text":"Wow!"}]}}',
      '{"onlyFriendsDirectMessages":[{"from":"Marcus Vane","text":"Any chance to see more?","postId":"onlyfriends-post-01","tip":5},{"from":"quiet.admirer","text":"You are stunning."}]}',
    ].join('\n'),
    { app: 'onlyfriends', postId: 'onlyfriends-post-01' },
  );
  const parsedFotogramTipIgnored = parseSocialReactionsOutput(
    [
      '{"reactions":{"postId":"fotogram-post-01","likes":10,"comments":[]}}',
      '{"fotogramDirectMessages":[{"from":"Chloe Whitmore","text":"Long time no see!","tip":5}]}',
    ].join('\n'),
    { app: 'fotogram', postId: 'fotogram-post-01' },
  );
  assertFixture(
    parsedReactionsWithDms.reactions?.likes === 30 &&
      parsedReactionsWithDms.warnings.length === 0 &&
      parsedReactionsWithDms.directMessages.length === 2 &&
      parsedReactionsWithDms.directMessages[0]?.tip === 5 &&
      parsedReactionsWithDms.directMessages[0]?.postId === 'onlyfriends-post-01' &&
      parsedReactionsWithDms.directMessages[1]?.tip === undefined &&
      parsedFotogramTipIgnored.directMessages[0]?.tip === undefined,
    'social reactions must parse standalone incoming DM blocks and keep tips OnlyFriends-only',
  );
  const socialPostOriginInput = socialDirectMessageInputText({
    app: 'onlyfriends',
    messageId: 'onlyfriends-dm-user-2',
    from: 'Helga Harper',
    fromHandle: 'helga.harper',
    to: 'Marcus Vane',
    toHandle: 'marcus.vane',
    text: 'Thanks for the message!',
    sentAt: '2026-06-01T13:00:00.000Z',
    origin: {
      postId: 'onlyfriends-post-01',
      postAuthor: 'Helga Harper',
      postAuthorHandle: 'helga.harper',
      postCaption: 'New set is live.',
      postImageDescription: 'Helga poses in the new outfit set.',
    },
  }, []);
  assertFixture(
    socialPostOriginInput.includes('Conversation origin: a social post') &&
      socialPostOriginInput.includes('Post ID: onlyfriends-post-01') &&
      !socialPostOriginInput.includes('Original comment'),
    'post-only DM origins must describe the post without inventing a comment',
  );
  const parsedSocialThread = parseSocialReactionsOutput(
    '{"reactions":{"postId":"post-1","additionalLikes":2,"comments":[{"from":"Jamie","text":"Love it!"}]},"summary":"Alex asked the thread about the location; Jamie responded positively."}',
    { app: 'fotogram', postId: 'post-1', append: true },
  );
  const socialReactionMessages: MessageRecord[] = [
    {
      id: 20,
      role: 'output',
      originalText: 'Initial reactions',
      socialReactions: {
        app: 'fotogram',
        postId: 'post-1',
        likes: 10,
        comments: [{ from: 'Robin', handle: 'robin', text: 'Beautiful.' }],
      },
    },
    {
      id: 21,
      role: 'output',
      originalText: 'Thread reactions',
      socialThreadAction,
      socialReactions: parsedSocialThread.reactions,
    },
  ];
  const combinedSocialReactions = socialReactionsByPostId('fotogram', socialReactionMessages);
  const combinedSocialEngagement = socialPostEngagementByPostId(
    'fotogram',
    socialReactionMessages,
    // Persisted player likes: one per liking account, only for this app.
    {
      'alex/fotogram': ['post-1'],
      'robin/fotogram': ['post-1', 'post-2'],
      'alex/onlyfriends': ['post-1'],
    },
  );
  assertFixture(
    parsedSocialThread.historySummary?.startsWith('Alex asked') === true &&
      combinedSocialReactions['post-1']?.likes === 12 &&
      combinedSocialReactions['post-1']?.comments.length === 2 &&
      combinedSocialEngagement['post-1']?.likeCount === 14 &&
      combinedSocialEngagement['post-1']?.commentCount === 3 &&
      combinedSocialEngagement['post-2']?.likeCount === 1 &&
      socialReactionMessages.every(socialMessageHiddenFromChat),
    'social thread output must aggregate engagement while reaction history stays hidden in Chat',
  );

  const assistantStorybook = {
    ...emptyRpStorybookV1,
    title: 'Old title',
    openingHistory: {
      ...emptyRpStorybookV1.openingHistory,
      summary: 'Imported opening context',
    },
    characters: [{
      id: 'lara',
      name: 'Lara',
      description: 'Original description',
      personality: '',
      speechStyle: '',
      role: '',
      comfyConfig: { loraName: 'lara.safetensors', appearance: 'dark hair' },
      profileImage: {
        imageId: 'lara_image_01',
        dataUrl: 'data:image/jpeg;base64,PROFILE',
        crop: { x: 20, y: 20, size: 60 },
      },
      images: [{
        id: 'lara_image_01',
        name: 'Lara image',
        mimeType: 'image/jpeg' as const,
        size: 3,
        dataUrl: 'data:image/jpeg;base64,IMAGE',
        description: 'Portrait',
      }],
    }],
  };
  const assistantPatchResult = parseRpStorybookAssistantResult(JSON.stringify({
    reply: 'Renamed.',
    changedFields: ['characters'],
    patch: [{ op: 'replace', path: '/characters/0/name', value: 'Mara' }],
  }), assistantStorybook);
  assertFixture(
    assistantPatchResult.storybook.characters[0]?.name === 'Mara' &&
      assistantPatchResult.storybook.characters[0]?.images[0]?.dataUrl === 'data:image/jpeg;base64,IMAGE' &&
      assistantPatchResult.storybook.characters[0]?.profileImage?.dataUrl === 'data:image/jpeg;base64,PROFILE' &&
      assistantPatchResult.storybook.characters[0]?.comfyConfig?.loraName === 'lara.safetensors' &&
      assistantPatchResult.storybook.openingHistory.summary === 'Imported opening context',
    'Storybook assistant must apply RFC 6902 patches without rewriting preserved image and history data',
  );
  const assistantDerivedFieldsResult = parseRpStorybookAssistantResult(JSON.stringify({
    reply: 'Updated title.',
    patch: [{ op: 'replace', path: '/title', value: 'New title' }],
  }), assistantStorybook);
  assertFixture(
    assistantDerivedFieldsResult.changedFields.includes('title') &&
      assistantDerivedFieldsResult.storybook.title === 'New title',
    'Storybook assistant must derive changed fields from JSON Patch paths when needed',
  );
  const assistantQuestionResult = parseRpStorybookAssistantResult(JSON.stringify({
    reply: 'The title is Old title.',
    changedFields: [],
    patch: [],
  }), assistantStorybook);
  assertFixture(
    assistantQuestionResult.changedFields.length === 0 &&
      assistantQuestionResult.storybook.title === 'Old title',
    'Storybook assistant question responses must keep the storybook unchanged with an empty patch',
  );
  assertThrowsFixture(
    () => parseRpStorybookAssistantResult(JSON.stringify({
      reply: 'Rewrite.',
      changedFields: ['storybook'],
      patch: [{ op: 'replace', path: '', value: emptyRpStorybookV1 }],
    }), assistantStorybook),
    'Storybook assistant must reject root replacement JSON patches',
  );
  const assistantPrompt = rpStorybookEditPrompt(rpStorybookJsonText(assistantStorybook), 'Rename Lara to Mara.');
  assertFixture(
    assistantPrompt.includes('RFC 6902 JSON Patch') &&
      assistantPrompt.includes('Do not return the complete storybook') &&
      assistantPrompt.includes('Do not create, rewrite, append, delete, reorder, summarize, or otherwise patch openingHistory') &&
      assistantPrompt.includes('"patch"'),
    'Storybook assistant prompt must request standard JSON Patch responses',
  );
  const assistantConversation = storybookAssistantConversationContext([
    { role: 'user', text: 'Remember the number 235.' },
    { role: 'assistant', text: 'I will remember 235.' },
  ]);
  assertFixture(
    assistantConversation.includes('USER: Remember the number 235.') &&
      assistantConversation.includes('ASSISTANT: I will remember 235.'),
    'Storybook assistant requests must include the visible user and assistant conversation',
  );

  const sillyTavernCard = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Mira Vale',
      description: 'A traveling archivist.',
      personality: 'Curious and careful.',
      scenario: 'Mira arrives at a sealed library.',
      first_mes: 'The lock was already broken when I arrived.',
      mes_example: '<START>\nMira: Every record leaves a trace.',
    },
  };
  const sillyTavernInstruction = sillyTavernImportInstruction(
    emptyRpStorybookV1,
    sillyTavernCard,
    'mira.json',
  );
  assertFixture(
    sillyTavernInstruction.includes('current RPGraph Storybook') &&
      sillyTavernInstruction.includes('personality') &&
      sillyTavernInstruction.includes('speechStyle') &&
      sillyTavernInstruction.includes('banking.startBalance') &&
      sillyTavernInstruction.includes('social.fotogramUsername') &&
      sillyTavernInstruction.includes('scenario is completely empty'),
    'SillyTavern AI imports must describe the complete RPGraph character mapping and allow filling an empty scenario',
  );
  const importedMira = parseRpStorybookAssistantResult(JSON.stringify({
    reply: 'Imported Mira.',
    changedFields: ['characters', 'scenario'],
    patch: [
      {
        op: 'add',
        path: '/characters/-',
        value: {
          id: 'mira-vale',
          name: 'Mira Vale',
          description: 'A traveling archivist.',
          personality: 'Curious and careful.',
          speechStyle: 'Precise and observant.',
          role: 'Archivist',
          banking: { startBalance: 3200, fixedExpenses: [{ label: 'Mobile plan', amount: 29.99 }] },
          social: { fotogramUsername: 'mira.vale', onlyfriendsUsername: '' },
          comfyConfig: { loraName: '', loraUrl: '', appearance: '' },
          images: [],
        },
      },
      { op: 'replace', path: '/scenario/summary', value: 'Mira arrives at a sealed library.' },
    ],
  }), emptyRpStorybookV1);
  const validatedSillyTavernImport = validateSillyTavernImportResult(
    emptyRpStorybookV1,
    importedMira,
    sillyTavernCard,
  );
  assertFixture(
    validatedSillyTavernImport.action === 'added' &&
      validatedSillyTavernImport.characterName === 'Mira Vale',
    'SillyTavern imports must confirm that the model actually added the requested character',
  );
  const occupiedScenarioStorybook = {
    ...emptyRpStorybookV1,
    scenario: {
      summary: 'An established group story.',
      openingSituation: 'The group is already together.',
      currentSituation: '',
    },
  };
  const occupiedScenarioInstruction = sillyTavernImportInstruction(
    occupiedScenarioStorybook,
    sillyTavernCard,
    'mira.json',
  );
  assertFixture(
    occupiedScenarioInstruction.includes('Do not patch title, introduction, scenario') &&
      occupiedScenarioInstruction.includes('Do not replace the characters array or alter existing characters'),
    'SillyTavern AI imports must protect an established scenario and existing characters',
  );
  const emptySillyTavernResult = parseRpStorybookAssistantResult(JSON.stringify({
    reply: 'Imported Mira.',
    changedFields: [],
    patch: [],
  }), emptyRpStorybookV1);
  assertThrowsFixture(
    () => validateSillyTavernImportResult(
      emptyRpStorybookV1,
      emptySillyTavernResult,
      sillyTavernCard,
    ),
    'SillyTavern imports must reject model replies that claim success without changing a character',
  );

  const usedImageIds = storybookImageIdsUsedByMessages([
    {
      id: 1,
      role: 'user',
      originalText: 'RP image',
      imageAttachments: [{
        id: 'emily_miller_image_01',
        name: 'Emily',
        mimeType: 'image/jpeg',
        size: 1,
        dataUrl: 'data:image/jpeg;base64,AA==',
      }],
    },
    {
      id: 2,
      role: 'output',
      originalText: 'Phone image',
      phoneImageIds: ['sarah_miller_image_01'],
    },
    {
      id: 3,
      role: 'error',
      originalText: 'Ignored error',
      phoneImageIds: ['ignored_image_01'],
    },
    {
      id: 4,
      role: 'output',
      originalText: '[Fotogram] Sarah posted a photo',
      socialPost: {
        app: 'fotogram',
        postId: 'post-1',
        author: 'Sarah Miller',
        authorHandle: 'sarah',
        caption: 'Party!',
        imageId: 'sarah_miller_image_02',
      },
    },
    {
      id: 5,
      role: 'user',
      originalText: 'Social direct message with image',
      socialDirectMessage: {
        app: 'onlyfriends',
        messageId: 'onlyfriends-dm-1',
        from: 'Emily Miller',
        fromHandle: 'emily',
        to: 'Sarah Miller',
        toHandle: 'sarah',
        text: 'Private photo',
        sentAt: '2026-06-01T12:15',
        imageIds: ['emily_miller_image_03'],
        origin: {
          postId: 'post-dress-image',
          postAuthor: 'Emily Miller',
          postAuthorHandle: 'emily',
          postCaption: 'New dress.',
          postImageId: 'emily_miller_image_04',
          commentAuthor: 'Sarah Miller',
          commentAuthorHandle: 'sarah',
          commentText: 'Love this look!',
        },
      },
    },
  ]);
  assertFixture(
    usedImageIds.has('emily_miller_image_01') &&
      usedImageIds.has('sarah_miller_image_01') &&
      usedImageIds.has('sarah_miller_image_02') &&
      usedImageIds.has('emily_miller_image_03') &&
      usedImageIds.has('emily_miller_image_04') &&
      !usedImageIds.has('ignored_image_01'),
    'chat history image usage must include RP, Phone, and social direct-message image IDs',
  );

  const referenceStorybook = {
    ...emptyRpStorybookV1,
    characters: [{
      id: 'sarah-miller',
      name: 'Sarah Miller',
      description: '',
      personality: '',
      speechStyle: '',
      role: '',
      images: [{
        id: 'sarah_miller_image_02',
        name: 'Sarah mirror',
        mimeType: 'image/jpeg' as const,
        size: 1,
        dataUrl: 'data:image/jpeg;base64,story',
        description: 'Sarah in a mirror selfie.',
      }],
    }],
  };
  const referenceNodes = [{
    id: 'storybook',
    type: 'rp-storybook-v1',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'rp-storybook-v1',
      label: 'Storybook',
      description: '',
      preview: '',
      storybookJson: rpStorybookJsonText(referenceStorybook),
    },
  }] as WorkflowNode[];
  const referenceMessages: MessageRecord[] = [{
    id: 1,
    role: 'output',
    originalText: 'Older image.',
    includeInHistory: true,
    imageAttachments: [{
      id: 'old_image_01',
      name: 'Old',
      mimeType: 'image/jpeg',
      size: 1,
      dataUrl: 'data:image/jpeg;base64,old',
      description: 'Old image.',
    }],
    turnNumber: 1,
  }, {
    id: 2,
    role: 'output',
    originalText: 'Duplicate image.',
    includeInHistory: true,
    imageAttachments: [{
      id: 'old_image_01',
      name: 'Old copy',
      mimeType: 'image/jpeg',
      size: 1,
      dataUrl: 'data:image/jpeg;base64,old',
      description: 'Old image copy.',
    }],
    turnNumber: 2,
  }, {
    id: 3,
    role: 'user',
    originalText: 'Storybook id only.',
    includeInHistory: true,
    channel: 'phone',
    phoneFrom: 'Sarah Miller',
    phoneTo: 'Emily Miller',
    phoneImageIds: ['sarah_miller_image_02'],
    phoneImageDescription: 'Sarah shares her mirror selfie.',
    turnNumber: 3,
  }, {
    id: 4,
    role: 'output',
    originalText: 'Newest attached image.',
    includeInHistory: true,
    imageAttachments: [{
      id: 'new_image_01',
      name: 'Newest',
      mimeType: 'image/jpeg',
      size: 1,
      dataUrl: 'data:image/jpeg;base64,new',
      description: 'Newest image.',
    }],
    turnNumber: 4,
  }];
  const referenceImages = collectRecentReferenceImages({
    messages: referenceMessages,
    nodes: referenceNodes,
    options: { enabled: true, turnLookback: 10, maxImages: 3 },
  });
  assertFixture(
    referenceImages.map((image) => image.imageId).join(',') ===
      'new_image_01,sarah_miller_image_02,old_image_01',
    'reference images must collect newest-first, resolve Storybook ids, and dedupe',
  );
  assertFixture(
    collectRecentReferenceImages({
      messages: referenceMessages,
      nodes: referenceNodes,
      options: { enabled: true, turnLookback: 1, maxImages: 3 },
    }).map((image) => image.imageId).join(',') === 'new_image_01',
    'reference image lookback must ignore images outside the selected turns',
  );
  const additionalReferenceImages = collectRecentReferenceImages({
    messages: referenceMessages,
    nodes: referenceNodes,
    options: {
      enabled: true,
      turnLookback: 1,
      maxImages: 1,
      additionalImageIds: ['old_image_01', 'sarah_miller_image_02', 'new_image_01'],
    },
  });
  assertFixture(
    additionalReferenceImages.map((image) => image.imageId).join(',') ===
      'new_image_01,old_image_01,sarah_miller_image_02',
    'temporary reference images must follow automatic references, exceed the max, and dedupe',
  );
  assertFixture(
    collectRecentReferenceImages({
      messages: referenceMessages,
      nodes: referenceNodes,
      options: {
        enabled: false,
        turnLookback: 0,
        maxImages: 0,
        additionalImageIds: ['sarah_miller_image_02'],
      },
    })[0]?.imageId === 'sarah_miller_image_02',
    'temporary reference images must work when automatic reference images are disabled',
  );
  assertFixture(
    collectRecentReferenceImages({
      messages: referenceMessages,
      nodes: referenceNodes,
      options: { enabled: false, turnLookback: 10, maxImages: 3 },
    }).length === 0 &&
      collectRecentReferenceImages({
        messages: referenceMessages,
        nodes: referenceNodes,
        options: { enabled: true, turnLookback: 10, maxImages: 0 },
      }).length === 0,
    'reference image collection must respect disabled and max zero options',
  );
  const limitedReferenceImages = collectRecentReferenceImages({
    messages: referenceMessages,
    nodes: referenceNodes,
    options: { enabled: true, turnLookback: 10, maxImages: 2 },
  });
  const markedPrompt = promptWithReferenceImageMarkers(
    'History: [old_image_01: Old image.] [Image: Sarah shares her mirror selfie.] [Image: Newest image.]',
    limitedReferenceImages,
  );
  assertFixture(
    markedPrompt.includes('[Attached input image Nr1: new_image_01 - Newest image.]') &&
      markedPrompt.includes('[Attached input image Nr2: sarah_miller_image_02 - Sarah shares her mirror selfie.]') &&
      !markedPrompt.includes('Attached input image Nr3:') &&
      !formatChatHistory(referenceMessages, false).includes('Attached input image Nr1:'),
    'reference image markers must be dynamic prompt text only and match selected attachments',
  );
  const markedInputAndReferencePrompt = promptWithReferenceImageMarkers(
    promptWithImageAttachmentMarkers(
      'Emily Miller sends an image to Sarah Miller: [emily_miller_image_15] Or would you prefer it like this in green?',
      [{
        id: 'emily_miller_image_15',
        name: 'emily_miller_image_15',
        mimeType: 'image/jpeg',
        size: 1,
        dataUrl: 'data:image/jpeg;base64,input',
      }],
    ),
    limitedReferenceImages,
    1,
  );
  assertFixture(
    markedInputAndReferencePrompt.includes('[Attached input image Nr1: emily_miller_image_15]') &&
      markedInputAndReferencePrompt.includes('[Attached input image Nr2: new_image_01 - Newest image.]') &&
      !markedInputAndReferencePrompt.includes('[emily_miller_image_15] Or'),
    'input image markers must be inserted before reference image markers and follow LLM image order',
  );
  const actionImage = {
    id: 'action_image_01',
    name: 'Action image',
    mimeType: 'image/jpeg' as const,
    size: 1,
    dataUrl: 'data:image/jpeg;base64,action',
  };
  const inputImage = {
    id: 'input_image_01',
    name: 'Input image',
    mimeType: 'image/jpeg' as const,
    size: 1,
    dataUrl: 'data:image/jpeg;base64,input',
  };
  const referenceImage = {
    id: 'reference_image_01',
    name: 'Reference image',
    mimeType: 'image/jpeg' as const,
    size: 1,
    dataUrl: 'data:image/jpeg;base64,reference',
  };
  const initialImagePass = promptImagePass({
    actionReplay: false,
    actionImages: [actionImage],
    inputImages: [inputImage],
    referenceImages: [referenceImage],
  });
  assertFixture(
    initialImagePass.images.map((image) => image.id).join(',') ===
      'input_image_01,reference_image_01' &&
      initialImagePass.inputImageOffset === 0 &&
      initialImagePass.referenceImageOffset === 1,
    'initial passes must contain input and reference images without action images',
  );
  const replayImagePass = promptImagePass({
    actionReplay: true,
    actionImages: [actionImage],
    inputImages: [inputImage],
    referenceImages: [referenceImage],
  });
  assertFixture(
    replayImagePass.images.map((image) => image.id).join(',') ===
      'action_image_01,input_image_01,reference_image_01' &&
      replayImagePass.inputImageOffset === 1 &&
      replayImagePass.referenceImageOffset === 2,
    'action images may join replay passes ahead of input and reference images',
  );

  const repeatedReferenceMessages: MessageRecord[] = [{
    id: 10,
    role: 'output',
    originalText: 'Older use.',
    includeInHistory: true,
    channel: 'phone',
    phoneFrom: 'Sarah Miller',
    phoneTo: 'Emily Miller',
    phoneImageIds: ['sarah_miller_image_02'],
    phoneImageDescription: 'Sarah first shared the mirror selfie.',
    turnNumber: 1,
  }, {
    id: 11,
    role: 'output',
    originalText: 'Recent use.',
    includeInHistory: true,
    channel: 'phone',
    phoneFrom: 'Sarah Miller',
    phoneTo: 'Ryan Parker',
    phoneImageIds: ['sarah_miller_image_02'],
    phoneImageDescription: 'Sarah shared the same mirror selfie again.',
    turnNumber: 12,
  }];
  const repeatedReferences = collectRecentReferenceImages({
    messages: repeatedReferenceMessages,
    nodes: referenceNodes,
    options: { enabled: true, turnLookback: 1, maxImages: 1 },
  });
  const repeatedMarkedPrompt = promptWithReferenceImageMarkers(
    formatChatHistory(repeatedReferenceMessages, false),
    repeatedReferences,
  );
  assertFixture(
    repeatedReferences[0]?.imageId === 'sarah_miller_image_02' &&
      (repeatedMarkedPrompt.match(/\[Attached input image Nr1: sarah_miller_image_02 -/g)?.length ?? 0) === 2 &&
      repeatedMarkedPrompt.includes('Sarah first shared the mirror selfie.') &&
      repeatedMarkedPrompt.includes('Sarah shared the same mirror selfie again.') &&
      promptWithReferenceImageMarkers(repeatedMarkedPrompt, repeatedReferences) === repeatedMarkedPrompt,
    'a recently selected reference image must receive the same dynamic marker at every history occurrence',
  );

  const storybookWithUsedImage = structuredClone(emptyRpStorybookV1);
  storybookWithUsedImage.characters = [{
    id: 'emily-miller',
    name: 'Emily Miller',
    description: '',
    personality: '',
    speechStyle: '',
    role: '',
    images: [{
      id: 'emily_miller_image_01',
      name: 'Emily',
      mimeType: 'image/jpeg',
      size: 1,
      dataUrl: 'data:image/jpeg;base64,AA==',
      description: '',
    }],
  }];
  const storybookWithoutUsedImage = structuredClone(storybookWithUsedImage);
  storybookWithoutUsedImage.characters[0]!.images = [];
  assertFixture(
    storybookImageById([storybookWithUsedImage], 'emily_miller_image_01')?.name === 'Emily',
    'Phone image IDs must resolve globally without sender ownership',
  );
  assertFixture(
    usedStorybookImageIdsRemoved(
      storybookWithUsedImage,
      storybookWithoutUsedImage,
      usedImageIds,
    ).includes('emily_miller_image_01'),
    'removing an image referenced by chat history must be detected',
  );
  assertFixture(
    usedStorybookImageIdsRemoved(
      storybookWithUsedImage,
      storybookWithUsedImage,
      usedImageIds,
    ).length === 0,
    'keeping a used image while editing the Storybook must remain allowed',
  );

  const openingHistoryStorybook = structuredClone(storybookWithUsedImage);
  const openingImageAttachment = {
    id: 'emily_miller_image_01',
    name: 'Emily',
    mimeType: 'image/jpeg',
    size: 1,
    dataUrl: 'data:image/jpeg;base64,AA==',
    description: 'Emily at the party.',
  };
  openingHistoryStorybook.openingHistory.turns = [{
    id: 'opening-turn-1',
    number: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    input: { graphText: '', messages: [] },
    output: {
      graphText: 'Phone image',
      messages: [{
        id: 1,
        role: 'output',
        originalText: 'Phone image',
        includeInHistory: true,
        channel: 'phone',
        phoneMessage: true,
        phoneFrom: 'Emily Miller',
        phoneTo: 'Sarah Miller',
        phoneImageIds: ['emily_miller_image_01'],
        phoneImageDescription: 'Emily at the party.',
        imageAttachments: [openingImageAttachment],
      }],
    },
  }, {
    id: 'opening-turn-2',
    number: 2,
    createdAt: '2026-06-01T12:05:00.000Z',
    input: {
      graphText: 'RP image',
      messages: [{
        id: 2,
        role: 'user',
        originalText: 'RP image',
        includeInHistory: true,
        channel: 'rp',
        rpImageDescription: 'Emily at the party.',
        imageAttachments: [openingImageAttachment],
      }],
    },
    output: {
      graphText: 'Phone reply',
      messages: [{
        id: 3,
        role: 'user',
        originalText: 'Phone reply',
        includeInHistory: true,
        channel: 'phone',
        phoneMessage: true,
        phoneFrom: 'Sarah Miller',
        phoneTo: 'Emily Miller',
        replyToMessageId: 1,
      }],
    },
  }, {
    id: 'opening-turn-3',
    number: 3,
    createdAt: '2026-06-01T12:10:00.000Z',
    input: { graphText: '', messages: [] },
    output: {
      graphText: 'Social post',
      messages: [{
        id: 4,
        role: 'output',
        originalText: '[Fotogram] Emily Miller (@emily) posted a photo: "Party!"',
        includeInHistory: true,
        socialPost: {
          app: 'fotogram',
          postId: 'post-import-1',
          author: 'Emily Miller',
          authorHandle: 'emily',
          caption: 'Party!',
          imageId: 'emily_miller_image_01',
          imageDescription: 'Emily at the party.',
        },
      }],
    },
  }];
  openingHistoryStorybook.openingHistory.socialLikes = {
    'emily-miller/fotogram': ['post-import-1'],
  };
  openingHistoryStorybook.openingHistory.checkpoints = [{
    turnId: 'opening-turn-2',
    createdTimelineEntryIds: [],
    nodeSnapshots: {
      history: {
        before: { historyCurrentRpDateTime: '2026-06-01T12:00' },
        after: { historyCurrentRpDateTime: '2026-06-01T12:05' },
      },
    },
  }];
  const openingHistoryNode = structuredClone(
    currentWorkflow.nodes.find((node) => node.data.nodeType === 'rp-storybook-v1'),
  ) as WorkflowNode | undefined;
  if (!openingHistoryNode || openingHistoryNode.data.nodeType !== 'rp-storybook-v1') {
    throw new Error('Workflow validation fixture failed: default Storybook node is missing');
  }
  // Import stores gallery-backed images as id-only references (no base64
  // copy); attachments without a gallery entry keep their embedded data.
  openingHistoryNode.data.storybookJson = rpStorybookJsonText(openingHistoryStorybook);
  openingHistoryStorybook.openingHistory.turns = turnsWithStorybookImageRefs(
    openingHistoryStorybook.openingHistory.turns,
    [openingHistoryNode],
  );
  const storedOpeningAttachment = openingHistoryStorybook.openingHistory.turns[0]
    ?.output.messages[0]?.imageAttachments?.[0];
  assertFixture(
    storedOpeningAttachment?.id === 'emily_miller_image_01' &&
      storedOpeningAttachment.dataUrl === '',
    'importing the current chat must strip gallery-backed image copies to id references',
  );
  openingHistoryNode.data.storybookJson = rpStorybookJsonText(openingHistoryStorybook);
  const restoredOpeningMessages = openingHistoryTurnsFromNodes([openingHistoryNode])
    .flatMap((turn) => [...turn.input.messages, ...turn.output.messages]);
  const restoredPhoneImage = restoredOpeningMessages.find((message) => message.channel === 'phone');
  const restoredRpImage = restoredOpeningMessages.find((message) => message.channel === 'rp');
  assertFixture(
    restoredPhoneImage?.phoneImageIds?.[0] === 'emily_miller_image_01' &&
      restoredPhoneImage.imageAttachments?.[0]?.dataUrl === 'data:image/jpeg;base64,AA==' &&
      restoredPhoneImage.includeInHistory === true,
    'Phone Opening History image references must rehydrate from the Storybook image library',
  );
  assertFixture(
    restoredRpImage?.imageAttachments?.[0]?.id === 'emily_miller_image_01' &&
      openingHistoryTurnsFromNodes([openingHistoryNode]).every((turn) => turn.openingHistory),
    'RP Opening History turns must preserve image data and carry only turn-level origin metadata',
  );
  const restoredOpeningTurns = openingHistoryTurnsFromNodes([openingHistoryNode]);
  const remappedOpeningTurns = remapOpeningTurnMessageIds(restoredOpeningTurns, 20).remappedTurns;
  const remappedPhoneImage = remappedOpeningTurns
    .flatMap((turn) => [...turn.input.messages, ...turn.output.messages])
    .find((message) => message.originalText === 'Phone image');
  const remappedPhoneReply = remappedOpeningTurns
    .flatMap((turn) => [...turn.input.messages, ...turn.output.messages])
    .find((message) => message.originalText === 'Phone reply');
  assertFixture(
    remappedPhoneImage?.id === 20 &&
      remappedPhoneReply?.replyToMessageId === remappedPhoneImage.id,
    'Opening History runtime remapping must preserve phone reply links',
  );
  assertFixture(
    openingHistoryCheckpointsFromNodes([openingHistoryNode])[0]?.turnId === restoredOpeningTurns[1]?.id,
    'Opening History checkpoints must follow their namespaced runtime turn ids',
  );
  const restoredSocialPostMessage = restoredOpeningMessages.find((message) => message.socialPost);
  assertFixture(
    restoredSocialPostMessage?.socialPost?.imageId === 'emily_miller_image_01' &&
      restoredSocialPostMessage.socialPost.postId === 'post-import-1' &&
      openingHistorySocialLikesFromNodes([openingHistoryNode])['emily-miller/fotogram']?.[0] ===
        'post-import-1',
    'Opening History must carry social post image ids and imported player likes',
  );

  assertFixture(isWorkflowFile(currentWorkflow), 'workflow.default.json must load');
  assertFixture(
    currentWorkflow.formatVersion === currentWorkflowFormatVersion,
    'workflow.default.json must declare its format version',
  );
  const currentPromptSwitch = currentWorkflow.nodes.find(
    (node) => node.data.nodeType === 'llm-prompt-switch',
  );
  const currentPromptActions = promptActionConfigs(currentPromptSwitch?.data.llmPromptActions);
  assertFixture(
    currentPromptActions.length > 0 &&
      currentPromptActions.every((action) =>
        !('outputChannel' in action) && !('promptSlot' in action),
      ),
    'prompt actions must use the shared slot-free data shape',
  );
  const clampedPromptActions = promptActionConfigs([
    { ...defaultPromptActionConfig('Low limit', 'getImageId'), maxReturnedImages: 0 },
    { ...defaultPromptActionConfig('High limit', 'describeInputImage'), maxReturnedImages: 100 },
  ]);
  assertFixture(
    clampedPromptActions[0]?.maxReturnedImages === 1 &&
      clampedPromptActions[1]?.maxReturnedImages === 20,
    'prompt action image limits must clamp to the supported 1 through 20 range',
  );
  const getImageIdDefaults = defaultPromptActionConfig('Get character phone image list', 'getImageId');
  const normalizedGetImageIdDefaults = promptActionConfigs([{
    title: 'Get character phone image list',
    actionId: 'getImageId',
    preset: 'default',
  }])[0];
  const getImageIdRuntimeDefaults = promptActionRuntimeSettings({
    getImageId: { sendImagesToLlm: true },
  }).getImageId;
  assertFixture(
    getImageIdDefaults.maxReturnedImages === 3 &&
      getImageIdDefaults.sendImagesToLlm &&
      !getImageIdDefaults.hideImageTextWhenSendingToLlm &&
      normalizedGetImageIdDefaults?.maxReturnedImages === 3 &&
      normalizedGetImageIdDefaults.sendImagesToLlm &&
      !normalizedGetImageIdDefaults.hideImageTextWhenSendingToLlm &&
      getImageIdRuntimeDefaults?.sendImagesToLlm === true &&
      getImageIdRuntimeDefaults.hideImageTextWhenSendingToLlm === false &&
      getImageIdDefaults.resultTemplate.includes('Image shown to: {{imageShownTo}}') &&
      getImageIdDefaults.resultTemplate.includes('use the Create character phone image action when it is offered') &&
      getImageIdDefaults.resultTemplate.includes('write the reply without an image') &&
      getImageIdDefaults.resultTemplate.includes('steer the conversation naturally away from sending a photo'),
    'get image id prompt action defaults must send three captioned images, report recipients, offer available image generation, and preserve the current roleplay topic',
  );
  const updatePhoneImageCaptionDefaults = defaultPromptActionConfig(
    'Update phone image caption',
    'updatePhoneImageCaption',
  );
  assertFixture(
      updatePhoneImageCaptionDefaults.runAfterReply &&
      updatePhoneImageCaptionDefaults.afterReplyTemplate.includes('"imageAction": "no_change"') &&
      updatePhoneImageCaptionDefaults.afterReplyTemplate.includes('"imageId": "exact existing imageId"') &&
      updatePhoneImageCaptionDefaults.afterReplyTemplate.includes('imageAction "no_change" is the default') &&
      updatePhoneImageCaptionDefaults.afterReplyTemplate.includes('The visible phone reply is not new evidence by itself') &&
      updatePhoneImageCaptionDefaults.afterReplyTemplate.includes('Forwarding or resending the existing image to another person must not trigger an update') &&
      updatePhoneImageCaptionDefaults.afterReplyTemplate.includes('If there is no clear new fact') &&
      !updatePhoneImageCaptionDefaults.afterReplyTemplate.includes('the latest messages or the visible phone reply establish story-relevant new information'),
    'after-reply phone image captions must default to no change unless explicit new facts materially change the image meaning',
  );
  assertFixture(
    countPromptActionUses([
      '@action:Shared action\nPrompt text',
      'Before\n@action:Shared action',
      '@action:Different action',
    ], 'Shared action') === 2,
    'prompt action usage counts must include every globally linked prompt location',
  );
  assertFixture(
    replacePromptActionTitle(
      '@action temporary text that must not remain\nNext line',
      'Get character image list',
      'Get character image list',
      false,
    ) === '@action:Get character image list\nNext line',
    'saving a bare prompt action must canonicalize its complete dedicated line',
  );
  assertFixture(
    !isWorkflowFile({ ...currentWorkflow, formatVersion: '1' }),
    'an invalid workflow format version must be rejected',
  );
  assertFixture(
    !isWorkflowFile({ ...currentWorkflow, formatVersion: '2.0' }),
    'an unsupported workflow format version must be rejected',
  );
  assertFixture(
    !isWorkflowFile({ ...currentWorkflow, formatVersion: '1.0' }),
    'a different workflow minor format version must be rejected during beta',
  );
  const currentChat: SessionV2CurrentStateInput = {
    name: 'Fixture',
    settings: {
      englishProcessingEnabled: false,
      displayLanguage: 'German',
    },
    workflowVariables: {},
    turns: [],
    turnCheckpoints: [],
    openingMessages: [],
  };
  const currentSession = {
    format: 'rpgraph-session',
    formatVersion: currentSessionFormatVersion,
    name: 'Fixture Session',
    savedAt: '2026-06-01T00:00:00.000Z',
    metadata: {
      settings: currentChat.settings,
    },
    workflow: {
      format: 'rpgraph-workflow',
      formatVersion: '2.0',
      savedAt: '2026-06-01T00:00:00.000Z',
      graph: {
        nodes: [],
        edges: [],
      },
    },
    timeline: [],
    entities: {
      events: {},
      images: {},
      memory: {},
    },
    runtime: {
      current: { nodes: {}, workflowVariables: {} },
      undo: [],
    },
    ui: {
      phoneSeenByConversation: {},
      bankingSeenByCharacter: {},
      bankingContactsByCharacter: {},
      socialLikesByAccount: {},
      onlyFriendsPurchasesByCharacter: {},
      phoneDividerAfterByConversation: {},
    },
  };
  assertFixture(isRpSaveFile(currentSession), 'current RP Save Format v2 must load');
  assertFixture(
    isRpSaveFile({
      ...currentSession,
      timeline: [
        {
          id: 'turn-1-output-1',
          kind: 'message',
          turnId: 'turn-1',
          turnNumber: 1,
          phase: 'output',
          channel: 'rp',
          role: 'assistant',
          text: { original: '[Fotogram] Alex commented and received a reply.' },
          socialThreadAction: {
            actionId: 'social-thread-fotogram-1',
            action: 'comment',
            app: 'fotogram',
            postId: 'post-1',
            postAuthor: 'Jamie',
            postAuthorHandle: 'jamie',
            postCaption: 'A sunny afternoon.',
            actor: 'Alex',
            actorHandle: 'alex',
            commentText: 'Great photo!',
          },
          socialReactions: {
            app: 'fotogram',
            postId: 'post-1',
            likes: 2,
            comments: [{ from: 'Jamie', handle: 'jamie', text: 'Thank you!' }],
            append: true,
          },
        },
      ],
    }),
    'current RP Save Format must accept persisted social thread actions',
  );
  assertFixture(
    isRpSaveFile({
      ...currentSession,
      timeline: [
        {
          id: 'turn-2-input-1',
          kind: 'message',
          turnId: 'turn-2',
          turnNumber: 2,
          phase: 'input',
          channel: 'rp',
          role: 'user',
          text: { original: '[Fotogram DM] Alex: Are you free later?' },
          socialDirectMessage: {
            app: 'fotogram',
            messageId: 'fotogram-dm-1',
            from: 'Alex',
            fromHandle: 'alex',
            to: 'Jamie',
            toHandle: 'jamie',
            text: 'Are you free later?',
            sentAt: '2026-06-01T12:30',
            imageIds: ['alex_image_01'],
          },
        },
        {
          id: 'turn-2-output-1',
          kind: 'message',
          turnId: 'turn-2',
          turnNumber: 2,
          phase: 'output',
          channel: 'rp',
          role: 'assistant',
          text: { original: '[Fotogram DM] Jamie: Yes.' },
          socialDirectMessage: {
            app: 'fotogram',
            messageId: 'fotogram-dm-2',
            from: 'Jamie',
            fromHandle: 'jamie',
            to: 'Alex',
            toHandle: 'alex',
            text: 'Yes.',
            sentAt: '2026-06-01T12:31',
            replyToMessageId: 'fotogram-dm-1',
          },
        },
      ],
    }),
    'current RP Save Format must accept persisted social direct messages',
  );
  assertFixture(
    !isRpSaveFile({
      ...currentSession,
      timeline: [{
        id: 'turn-invalid-input-1',
        kind: 'message',
        turnId: 'turn-invalid',
        turnNumber: 3,
        phase: 'input',
        channel: 'rp',
        role: 'user',
        text: { original: 'Invalid social direct message' },
        socialDirectMessage: {
          app: 'unknown',
          messageId: 'invalid-dm',
          from: 'Alex',
          fromHandle: 'alex',
          to: 'Jamie',
          toHandle: 'jamie',
          text: 'Hello',
          sentAt: '2026-06-01T12:30',
        },
      }],
    }),
    'current RP Save Format must reject invalid social direct-message apps',
  );
  assertFixture(
    !isRpSaveFile({ ...currentSession, formatVersion: '1.1' }),
    'a different session format version must be rejected during beta',
  );
  assertFixture(
    !isRpSaveFile({
      ...currentSession,
      workflow: { ...currentSession.workflow, formatVersion: '1.1' },
    }),
    'sessions with incompatible embedded workflows must be rejected',
  );
  assertFixture(
    !isRpSaveFile({
      format: 'rpgraph-session',
      formatVersion: currentSessionFormatVersion,
      name: 'Old container',
      savedAt: '2026-06-01T00:00:00.000Z',
      workflow: currentWorkflow,
      chat: {
        format: 'rpgraph-chat',
        formatVersion: '1.0',
        name: 'Old chat',
        savedAt: '2026-06-01T00:00:00.000Z',
        settings: {
          englishProcessingEnabled: false,
          displayLanguage: 'German',
        },
        turns: [],
        openingMessages: [],
        currentRuntime: { nodes: {} },
      },
    }),
    'old workflow plus chat session containers must be rejected',
  );
  const roundtripRuntimeNodes = [{
    id: 'event-manager-1',
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'event-manager',
      label: 'Event Manager',
      description: 'Events',
      preview: 'Ready',
      eventAppointments: [{
        id: 'event-1',
        status: 'upcoming',
        title: 'Meet Alice',
        scheduledAt: '2026-06-01T12:00',
        sourceTurnId: 'turn-1',
        sourceTurnNumber: 1,
      }],
    },
  }, {
    id: 'storybook-1',
    type: 'workflow',
    position: { x: 200, y: 0 },
    data: {
      nodeType: 'rp-storybook-v1',
      label: 'Storybook',
      description: 'Storybook',
      preview: 'Ready',
      storybookJson: rpStorybookJsonText({
        ...emptyRpStorybookV1,
        title: 'Fixture Storybook',
        openingHistory: {
          summary: 'Opening event fixture',
          turns: [],
          checkpoints: [],
          events: [{
            id: 'event-1',
            status: 'upcoming',
            title: 'Meet Alice',
            scheduledAt: '2026-06-01T12:00',
            sourceTurnId: 'turn-1',
            sourceTurnNumber: 1,
          }],
          socialLikes: { 'alex/fotogram': ['post-1'] },
          notes: {},
          chatGpdChats: {},
        },
      }),
    },
  }, {
    id: 'history-1',
    type: 'workflow',
    position: { x: 100, y: 0 },
    data: {
      nodeType: 'history',
      label: 'Chat History',
      description: 'History',
      preview: 'Ready',
      llmCallStats: [{ label: 'History Analysis', durationMs: 123, inputTokens: 10, outputTokens: 5 }],
      rawHistory: 'must not be in runtime.current',
      originalHistory: 'must not be in runtime.current',
      translatedHistory: 'must not be in runtime.current',
      lastTurnsHistory: 'must not be in runtime.current',
      historyCurrentRpDateTime: '2026-06-01T12:00',
      historyLastPrompt: 'must not be in runtime.current',
      historyLastResponse: 'must not be in runtime.current',
    },
  }] satisfies WorkflowNode[];
  const roundtripWorkflow = {
    format: 'rpgraph-workflow',
    formatVersion: currentWorkflowFormatVersion,
    savedAt: '2026-06-01T00:00:00.000Z',
    nodes: roundtripRuntimeNodes,
    edges: [],
  } satisfies WorkflowFile;
  const roundtripTurn = {
      id: 'turn-1',
      number: 1,
      createdAt: '2026-06-01T00:00:00.000Z',
      openingHistory: true,
      input: {
        graphText: 'Hello',
        messages: [{
          id: 1,
          role: 'user',
          originalText: 'Hello',
          channel: 'rp',
          turnId: 'turn-1',
          turnNumber: 1,
          turnPart: 'input',
        }],
      },
      output: {
        graphText: 'Hi there',
        messages: [{
          id: 2,
          role: 'output',
          originalText: 'Hi there',
          channel: 'rp',
          turnId: 'turn-1',
          turnNumber: 1,
          turnPart: 'output',
          workflowVariableSetCommands: [{
            name: 'Current Location',
            value: 'Old Harbor',
          }],
          createdPhoneNote: {
            characterId: 'storybook:character:alice',
            characterName: 'Alice Harper',
            note: {
              id: 'note-command-turn-1-1',
              title: 'Harbor reminder',
              text: '- Meet Bob at noon\n- Bring the blue folder',
              dayLabel: 'Mon 1 June',
              color: 'neutral',
            },
          },
          simulatedAiChat: {
            characterId: 'storybook:character:alice',
            characterName: 'Alice Harper',
            chat: {
              id: 'chatgpd-simulated-turn-1-1',
              title: 'Harbor weather',
              createdAt: '2026-06-01T12:00:00.000Z',
              messages: [
                { role: 'user', text: 'Will it rain at the harbor?' },
                { role: 'assistant', text: 'The forecast suggests light rain after noon.' },
              ],
            },
          },
        }, {
          id: 7,
          role: 'output',
          originalText: '[Notes] Alice Harper deleted the note "Old reminder".',
          channel: 'rp',
          turnId: 'turn-1',
          turnNumber: 1,
          turnPart: 'output',
          deletedPhoneNote: {
            characterId: 'storybook:character:alice',
            characterName: 'Alice Harper',
            note: {
              id: 'manual-old-reminder',
              title: 'Old reminder',
              text: 'Outdated details',
              dayLabel: 'Sun 31 May',
              color: 'sand',
            },
          },
        }, {
          id: 4,
          role: 'output',
          originalText: 'Ping from Bob',
          imageAttachments: [{
            id: 'bob_image_01',
            name: 'bob_image_01',
            mimeType: 'image/jpeg',
            size: 1,
            dataUrl: 'data:image/jpeg;base64,a',
          }],
          channel: 'phone',
          phoneMessage: true,
          phoneFrom: 'Bob',
          phoneTo: 'Alice',
          phoneImageIds: ['bob_image_01'],
          phoneImageDescription: 'Bob waving from the bus stop.',
          turnId: 'turn-1',
          turnNumber: 1,
          turnPart: 'output',
        }, {
          id: 5,
          role: 'user',
          originalText: 'That is a great photo.',
          channel: 'phone',
          phoneMessage: true,
          phoneFrom: 'Alice',
          phoneTo: 'Bob',
          replyToMessageId: 4,
          turnId: 'turn-1',
          turnNumber: 1,
          turnPart: 'output',
        }, {
          id: 6,
          role: 'output',
          originalText: 'Bob waves from the bus stop.\n\nAlice pockets her phone.',
          translatedText: 'Bob winkt von der Bushaltestelle.\n\nAlice steckt ihr Handy ein.',
          channel: 'rp',
          embeddedPhoneMessages: [{
            phoneMessageId: 4,
            from: 'Bob',
            to: 'Alice',
            message: 'Ping from Bob',
          }],
          embeddedPhoneTextBefore: 'Bob waves from the bus stop.',
          embeddedPhoneTextAfter: 'Alice pockets her phone.',
          embeddedPhoneTranslatedTextBefore: 'Bob winkt von der Bushaltestelle.',
          embeddedPhoneTranslatedTextAfter: 'Alice steckt ihr Handy ein.',
          turnId: 'turn-1',
          turnNumber: 1,
          turnPart: 'output',
          voiceClips: [{
            speakerName: 'Bob',
            text: 'Bob waves from the bus stop.',
            dataUrl: 'data:audio/mpeg;base64,QUJD',
            filename: 'bob-voice.mp3',
            source: 'dialogue',
            createdAt: '2026-06-01T00:00:00.000Z',
          }],
        }],
      },
  } satisfies TurnRecord;
  const roundtripChat = {
    ...currentChat,
    turns: [roundtripTurn],
    turnCheckpoints: [{
      turnId: 'turn-1',
      createdTimelineEntryIds: ['turn-1-input-1', 'turn-1-output-2', 'turn-1-output-4'],
      nodeSnapshots: {
        'history-1': {
          before: {
            historyCurrentRpDateTime: '2026-06-01T11:00',
            historyProcessedTurnIds: [],
          },
          after: {
            historyCurrentRpDateTime: '2026-06-01T12:00',
            historyProcessedTurnIds: ['turn-1'],
          },
        },
        'event-manager-1': {
          before: {
            eventProcessedTurnIds: [],
          },
          after: {
            eventProcessedTurnIds: ['turn-1'],
          },
        },
      },
      workflowVariables: {
        before: {
          'Current Location': 'Downtown',
        },
        after: {
          'Current Location': 'Old Harbor',
        },
      },
      eventSnapshots: {
        'event-1': {
          after: {
            id: 'event-1',
            status: 'upcoming',
            title: 'Meet Alice',
            scheduledAt: '2026-06-01T12:00',
            source: {
              turnId: 'turn-1',
              turnNumber: 1,
            },
          },
        },
      },
    }],
    openingMessages: [{
      id: 3,
      role: 'user',
      originalText: 'Opening line',
      channel: 'rp',
      isOpening: true,
      turnId: 'opening-message-3',
      turnNumber: 1,
      turnPart: 'input',
    }],
    phoneSeenByConversation: {
      'Alice::Bob': 2,
    },
    bankingSeenByCharacter: {
      'storybook:character:alice': 6,
    },
    bankingContactsByCharacter: {
      'storybook:character:alice': ['Danny Harper'],
    },
    onlyFriendsPurchasesByCharacter: {
      'storybook:character:alice': {
        'onlyfriends-post-1': 9.99,
      },
    },
    phoneDividerAfterByConversation: {
      'Alice::Bob': 1,
    },
    workflowVariables: {
      'Current Location': 'Old Harbor',
    },
  } satisfies SessionV2CurrentStateInput;
  const sessionV2 = sessionV2FromCurrentState(
    roundtripChat,
    roundtripWorkflow,
    roundtripRuntimeNodes,
    '2026-06-01T00:00:00.000Z',
  );
  assertFixture(isRpgraphSessionV2(sessionV2), 'RP Save Format v2 roundtrip payload must validate');
  const invalidReplySession = structuredClone(sessionV2);
  const invalidReplyEntry = invalidReplySession.timeline.find(
    (entry): entry is TimelineMessageEntry => entry.kind === 'message' && !!entry.replyToMessageId,
  );
  if (invalidReplyEntry) {
    (invalidReplyEntry as unknown as Record<string, unknown>).replyToMessageId = 4;
  }
  assertFixture(
    !isRpgraphSessionV2(invalidReplySession),
    'RP Save Format v2 must reject non-string timeline reply ids',
  );
  const danglingReplySession = structuredClone(sessionV2);
  const danglingReplyEntry = danglingReplySession.timeline.find(
    (entry): entry is TimelineMessageEntry => entry.kind === 'message' && !!entry.replyToMessageId,
  );
  if (danglingReplyEntry) {
    danglingReplyEntry.replyToMessageId = 'missing-phone-message';
  }
  assertFixture(
    !isRpgraphSessionV2(danglingReplySession),
    'RP Save Format v2 must reject dangling timeline reply ids',
  );
  const nestedReplySession = structuredClone(sessionV2);
  const nestedReply = nestedReplySession.timeline.find(
    (entry): entry is TimelineMessageEntry => entry.kind === 'message' && !!entry.replyToMessageId,
  );
  const nestedReplyTarget = nestedReplySession.timeline.find(
    (entry): entry is TimelineMessageEntry => entry.kind === 'message' && entry.id === nestedReply?.replyToMessageId,
  );
  if (nestedReply && nestedReplyTarget) {
    nestedReplyTarget.replyToMessageId = nestedReply.id;
  }
  assertFixture(
    !isRpgraphSessionV2(nestedReplySession),
    'RP Save Format v2 must reject nested phone reply links',
  );
  const externalImageSession = structuredClone(sessionV2);
  const externalImageId = Object.keys(externalImageSession.entities.images)[0];
  if (externalImageId) {
    externalImageSession.entities.images[externalImageId]!.dataUrl = 'https://tracker.example/pixel.png';
  }
  assertFixture(
    !!externalImageId && !isRpgraphSessionV2(externalImageSession),
    'RP Save Format v2 must reject non-data image URLs',
  );
  const externalVoiceSession = structuredClone(sessionV2);
  const externalVoiceEntry = externalVoiceSession.timeline.find(
    (entry): entry is TimelineMessageEntry => entry.kind === 'message' && !!entry.voiceClips?.length,
  );
  if (externalVoiceEntry?.voiceClips?.[0]) {
    externalVoiceEntry.voiceClips[0].dataUrl = 'https://tracker.example/clip.mp3';
  }
  assertFixture(
    !!externalVoiceEntry && !isRpgraphSessionV2(externalVoiceSession),
    'RP Save Format v2 must reject non-data voice clip URLs',
  );
  const invalidEventSession = structuredClone(sessionV2);
  const invalidEventId = Object.keys(invalidEventSession.entities.events)[0];
  if (invalidEventId) {
    (invalidEventSession.entities.events[invalidEventId] as unknown as Record<string, unknown>).status = 'bogus';
  }
  assertFixture(
    !!invalidEventId && !isRpgraphSessionV2(invalidEventSession),
    'RP Save Format v2 must reject event entities with invalid status',
  );
  const invalidRuntimeSession = structuredClone(sessionV2);
  (invalidRuntimeSession.runtime.current as unknown as Record<string, unknown>).nodes = 'broken';
  assertFixture(
    !isRpgraphSessionV2(invalidRuntimeSession),
    'RP Save Format v2 must reject non-record runtime node state',
  );
  const invalidCheckpointSession = structuredClone(sessionV2);
  (invalidCheckpointSession.runtime as unknown as Record<string, unknown>).undo = [{ turnId: 7 }];
  assertFixture(
    !isRpgraphSessionV2(invalidCheckpointSession),
    'RP Save Format v2 must reject malformed undo checkpoints',
  );
  const invalidMemorySession = structuredClone(sessionV2);
  (invalidMemorySession.entities as unknown as Record<string, unknown>).memory = {
    'memory-1': { id: 'memory-1', name: 'Notes', text: 42, mode: 'joined' },
  };
  assertFixture(
    !isRpgraphSessionV2(invalidMemorySession),
    'RP Save Format v2 must reject malformed memory entities',
  );
  assertFixture(latestSessionV2TurnNumber(sessionV2) === 1, 'RP Save Format v2 must retain latest turn number');
  const restoredAppState = appStateFromSessionV2(sessionV2);
  assertFixture(
    restoredAppState.turns.length === 1 &&
      restoredAppState.openingMessages.length === 1 &&
      restoredAppState.currentRuntime.nodes['history-1']?.historyCurrentRpDateTime === '2026-06-01T12:00' &&
      restoredAppState.workflowVariables['Current Location'] === 'Old Harbor',
    'RP Save Format v2 must restore app state directly from the V2 session',
  );
  assertFixture(restoredAppState.turns.length === 1, 'RP Save Format v2 must restore normal turns');
  assertFixture(
    restoredAppState.turns[0]?.openingHistory === true,
    'RP Save Format v2 must preserve Opening History turn origin metadata',
  );
  assertFixture(restoredAppState.turns[0]?.output.messages[0]?.originalText === 'Hi there', 'RP Save Format v2 must restore output text');
  assertFixture(
    restoredAppState.turns[0]?.output.messages[0]?.workflowVariableSetCommands?.[0]?.value === 'Old Harbor',
    'RP Save Format v2 must restore output workflow variable metadata',
  );
  assertFixture(
    restoredAppState.turns[0]?.output.messages[0]?.createdPhoneNote?.note.title === 'Harbor reminder' &&
      restoredAppState.turns[0]?.output.messages[0]?.simulatedAiChat?.chat.messages[1]?.text ===
        'The forecast suggests light rain after noon.' &&
      restoredAppState.turns[0]?.output.messages.find((message) => message.deletedPhoneNote)
        ?.deletedPhoneNote?.note.title === 'Old reminder',
    'RP Save Format v2 must restore Notes and simulated ChatGPD message metadata',
  );
  const embeddedPhoneRoundtripMessage = restoredAppState.turns[0]?.output.messages.find((message) =>
    message.originalText.startsWith('Bob waves from the bus stop.'),
  );
  const embeddedPhoneRoundtripLinkedPhone = restoredAppState.turns[0]?.output.messages.find((message) =>
    message.originalText === 'Ping from Bob',
  );
  assertFixture(
    embeddedPhoneRoundtripMessage?.embeddedPhoneTextBefore === 'Bob waves from the bus stop.' &&
      embeddedPhoneRoundtripMessage.embeddedPhoneTextAfter === 'Alice pockets her phone.' &&
      embeddedPhoneRoundtripMessage.embeddedPhoneTranslatedTextBefore === 'Bob winkt von der Bushaltestelle.' &&
      embeddedPhoneRoundtripMessage.embeddedPhoneTranslatedTextAfter === 'Alice steckt ihr Handy ein.' &&
      embeddedPhoneRoundtripMessage.embeddedPhoneMessages?.[0]?.phoneMessageId === embeddedPhoneRoundtripLinkedPhone?.id,
    'RP Save Format v2 must restore embedded phone composite text and relinked phone ids',
  );
  assertFixture(
    embeddedPhoneRoundtripMessage?.voiceClips?.[0]?.dataUrl === 'data:audio/mpeg;base64,QUJD' &&
      sessionV2.timeline.find(
        (entry): entry is TimelineMessageEntry => entry.kind === 'message' && entry.id === 'turn-1-output-6',
      )?.voiceClips?.[0]?.source === 'dialogue',
    'RP Save Format v2 must store and restore generated voice clips',
  );
  assertFixture(restoredAppState.openingMessages[0]?.originalText === 'Opening line', 'RP Save Format v2 must restore opening messages');
  assertFixture(
    sessionV2.ui.phoneSeenByConversation['Alice::Bob'] === 2 &&
      restoredAppState.phoneSeenByConversation?.['Alice::Bob'] === 2 &&
      sessionV2.ui.bankingSeenByCharacter['storybook:character:alice'] === 6 &&
      restoredAppState.bankingSeenByCharacter?.['storybook:character:alice'] === 6 &&
      sessionV2.ui.bankingContactsByCharacter['storybook:character:alice']?.[0] === 'Danny Harper' &&
      restoredAppState.bankingContactsByCharacter?.['storybook:character:alice']?.[0] === 'Danny Harper' &&
      sessionV2.ui.onlyFriendsPurchasesByCharacter['storybook:character:alice']?.['onlyfriends-post-1'] === 9.99 &&
      restoredAppState.onlyFriendsPurchasesByCharacter['storybook:character:alice']?.['onlyfriends-post-1'] === 9.99,
    'RP Save Format v2 must store and restore phone, Banking, and OnlyFriends UI state',
  );
  const timelinePhoneImage = sessionV2.timeline.find(
    (entry): entry is TimelineMessageEntry => entry.kind === 'message' && entry.channel === 'phone',
  );
  assertFixture(
    timelinePhoneImage?.phone?.imageIds?.[0] === 'bob_image_01' &&
      timelinePhoneImage.images?.[0]?.imageId === 'bob_image_01' &&
      sessionV2.entities.images.bob_image_01?.id === 'bob_image_01' &&
      restoredAppState.turns[0]?.output.messages.find((message) => message.channel === 'phone')?.phoneImageIds?.[0] === 'bob_image_01',
    'RP Save Format v2 must retain phone Storybook image ids',
  );
  const timelinePhoneReply = sessionV2.timeline.find(
    (entry): entry is TimelineMessageEntry => entry.kind === 'message' && !!entry.replyToMessageId,
  );
  const restoredPhoneReply = restoredAppState.turns[0]?.output.messages.find(
    (message) => message.replyToMessageId !== undefined,
  );
  assertFixture(
    timelinePhoneReply?.replyToMessageId === timelinePhoneImage?.id &&
      restoredPhoneReply?.replyToMessageId === embeddedPhoneRoundtripLinkedPhone?.id,
    'RP Save Format v2 must retain phone reply message links',
  );
  const restoredReplyHistory = formatChatHistory(
    restoredAppState.turns.flatMap((turn) => [...turn.input.messages, ...turn.output.messages]),
    false,
  );
  assertFixture(
    restoredReplyHistory.includes(
      '[Replied to Bob: [bob_image_01: Bob waving from the bus stop.] Ping from Bob]',
    ),
    'restored Chat History must resolve saved phone reply image ids',
  );
  assertFixture(
    restoredReplyHistory.includes('[Notes] Alice Harper created the note "Harbor reminder":') &&
      restoredReplyHistory.includes('- Bring the blue folder') &&
      restoredReplyHistory.includes('[ChatGPD] Alice Harper used the AI assistant:') &&
      restoredReplyHistory.includes('ChatGPD: The forecast suggests light rain after noon.'),
    'Chat History must include complete created Notes and simulated ChatGPD conversations',
  );
  assertFixture(
    restoredAppState.turnCheckpoints[0]?.nodeSnapshots['history-1']?.before.historyCurrentRpDateTime === '2026-06-01T11:00' &&
      restoredAppState.turnCheckpoints[0]?.nodeSnapshots['history-1']?.after.historyCurrentRpDateTime === '2026-06-01T12:00' &&
      restoredAppState.turnCheckpoints[0]?.workflowVariables?.before['Current Location'] === 'Downtown' &&
      restoredAppState.turnCheckpoints[0]?.workflowVariables?.after['Current Location'] === 'Old Harbor' &&
      restoredAppState.turnCheckpoints[0]?.eventSnapshots?.['event-1']?.after?.title === 'Meet Alice' &&
      !('runtimeBefore' in restoredAppState.turns[0]!) &&
      !('runtimeAfter' in restoredAppState.turns[0]!),
    'RP Save Format v2 must restore undo checkpoints without compatibility runtime snapshots on turns',
  );
  assertFixture(
    appointmentFromEventEntity(sessionV2.entities.events['event-1']!).title === 'Meet Alice',
    'RP Save Format v2 must keep events in entities',
  );
  assertFixture(
    sessionV2.entities.events['event-1']?.source.storybookOpening === true,
    'RP Save Format v2 must mark Storybook Opening History events in event entities',
  );
  assertFixture(
    formatPhoneContext(sessionV2, { encoding: 'json-compact', maxEntries: 10 }).includes('Ping from Bob'),
    'RP Save Format v2 must expose phone messages through focused phone context',
  );
  assertFixture(
    sessionV2.timeline.some((entry) =>
      entry.kind === 'event-change' &&
      entry.operation === 'add' &&
      entry.eventIds.includes('event-1')
    ),
    'RP Save Format v2 must include event changes in the timeline',
  );
  assertFixture(
    sessionV2.runtime.current.nodes['history-1']?.historyCurrentRpDateTime === '2026-06-01T12:00' &&
      !('rawHistory' in sessionV2.runtime.current.nodes['history-1']!) &&
      !('originalHistory' in sessionV2.runtime.current.nodes['history-1']!) &&
      !('historyLastPrompt' in sessionV2.runtime.current.nodes['history-1']!),
    'RP Save Format v2 runtime must keep declared runtime fields and omit derived/debug history fields',
  );
  assertFixture(
    !!sessionV2.debug?.nodeDiagnostics['history-1']?.entries.some((entry) =>
      entry.text.includes('historyLastPrompt') &&
      entry.text.includes('must not be in runtime.current')
    ) &&
      sessionV2.debug.recentLlmCalls.some((call) =>
        call.nodeId === 'history-1' &&
        call.label === 'History Analysis' &&
        call.inputTokens === 10
    ),
    'RP Save Format v2 must keep bounded node debug outside runtime.current',
  );
  assertFixture(
    sessionV2.runtime.undo.length === 1 &&
      sessionV2.runtime.undo[0]?.createdTimelineEntryIds.includes('turn-1-input-1') &&
      sessionV2.runtime.undo[0]?.nodeSnapshots['history-1']?.before.historyCurrentRpDateTime === '2026-06-01T11:00' &&
      sessionV2.runtime.undo[0]?.nodeSnapshots['history-1']?.after.historyCurrentRpDateTime === '2026-06-01T12:00' &&
      sessionV2.runtime.undo[0]?.eventSnapshots?.['event-1']?.after?.title === 'Meet Alice',
    'RP Save Format v2 must create minimal undo checkpoints from committed turns',
  );
  const debugTurnSummary = debugTurnSummaryFromTurnRecord(
    roundtripChat.turns[0]!,
    roundtripRuntimeNodes,
    sessionV2.runtime.undo[0],
  );
  assertFixture(
    debugTurnSummary.checkpoint.createdTimelineEntryCount > 0 &&
      debugTurnSummary.checkpoint.nodeSnapshots['history-1']?.fields.includes('historyCurrentRpDateTime') &&
      debugTurnSummary.checkpoint.eventIds.includes('event-1') &&
      !('runtimeBefore' in debugTurnSummary) &&
      !('runtimeAfter' in debugTurnSummary),
    'debug turn summaries must expose V2 checkpoints without broad runtime snapshots',
  );
  const checkpointBeforeNodes = applyTurnCheckpointToNodes(
    roundtripRuntimeNodes,
    sessionV2.runtime.undo[0]!,
    'before',
  );
  const checkpointBeforeHistory = checkpointBeforeNodes.find((node) => node.id === 'history-1');
  const checkpointBeforeEvents = checkpointBeforeNodes.find((node) => node.id === 'event-manager-1');
  assertFixture(
    checkpointBeforeHistory?.data.historyCurrentRpDateTime === '2026-06-01T11:00' &&
      checkpointBeforeEvents?.data.eventAppointments?.length === 0,
    'RP Save Format v2 checkpoints must restore node and event state before a turn',
  );
  const checkpointAfterNodes = applyTurnCheckpointToNodes(
    checkpointBeforeNodes,
    sessionV2.runtime.undo[0]!,
    'after',
  );
  const checkpointAfterHistory = checkpointAfterNodes.find((node) => node.id === 'history-1');
  const checkpointAfterEvents = checkpointAfterNodes.find((node) => node.id === 'event-manager-1');
  assertFixture(
    checkpointAfterHistory?.data.historyCurrentRpDateTime === '2026-06-01T12:00' &&
      checkpointAfterEvents?.data.eventAppointments?.[0]?.title === 'Meet Alice',
    'RP Save Format v2 checkpoints must restore node and event state after a turn',
  );
  assertFixture(
    upcomingAppointments([
      { ...appointmentFromEventEntity(sessionV2.entities.events['event-1']!), scheduledAt: '2026-06-01T12:00' },
      {
        ...appointmentFromEventEntity(sessionV2.entities.events['event-1']!),
        id: 'event-0',
        scheduledAt: '2026-06-01T10:00',
      },
    ])[0]?.id === 'event-0',
    'event store must sort upcoming events by schedule',
  );
  assertFixture(
    updateAppointmentStatus(
      [appointmentFromEventEntity(sessionV2.entities.events['event-1']!)],
      'event-1',
      'completed',
    )[0]?.status === 'completed',
    'event store must update event status',
  );
  const historyOutputs = buildHistoryOutputs({
    messages: roundtripChat.turns.flatMap((turn) => [...turn.input.messages, ...turn.output.messages]),
    fallbackOriginalHistory: '',
    fallbackTranslatedHistory: '',
    lastTurnsCount: boundedHistoryLastTurnsCount(1),
    rpDateTimeFormat: 'iso',
    rpWeekdayLanguage: 'en-US',
  });
  assertFixture(
    historyOutputs.originalHistory.includes('Hello') &&
      historyOutputs.lastTurnsHistory.includes('Hi there'),
    'history store must derive one formatted history path and last-turn history',
  );
  const phoneMessages = [{
    id: 10,
    role: 'user',
    originalText: 'Ping',
    channel: 'phone',
    phoneFrom: 'Alice',
    phoneTo: 'Bob',
  }, {
    id: 11,
    role: 'output',
    originalText: 'Pong',
    channel: 'phone',
    phoneFrom: 'Bob',
    phoneTo: 'Alice',
  }] satisfies MessageRecord[];
  const aliceBobKey = phoneConversationKey('Alice', 'Bob');
  const phoneInfo = phoneConversationInfoFromMessages(phoneMessages, { [aliceBobKey]: 10 });
  assertFixture(
    phoneMessagesBetween(phoneMessages, 'Alice', 'Bob').length === 2 &&
      phoneInfo.get(aliceBobKey)?.latestId === 11 &&
      phoneInfo.get(aliceBobKey)?.unreadByRecipient.alice?.unreadCount === 1,
    'phone selectors must normalize conversation keys and unread phone messages',
  );
  assertFixture(
    phoneSeenStateFromMessages(phoneMessages)[aliceBobKey] === 11 &&
      viewerHasUnreadPhoneMessages(phoneInfo, 'Alice') &&
      !viewerHasUnreadPhoneMessages(phoneInfo, 'Bob'),
    'phone selectors must derive loaded seen state and viewer unread state',
  );
  assertFixture(
    directPhoneTimelineEntries(phoneMessages)[0]?.phoneMessage.from === 'Alice' &&
      linkedPhoneMessageIds([{ ...phoneMessages[0]!, embeddedPhoneMessages: [{ phoneMessageId: 11, from: 'Bob', to: 'Alice', message: 'Pong' }] }]).has(11),
    'phone selectors must expose direct timeline entries and linked phone message ids',
  );
  assertFixture(
    visibleMessageRecords([
      { ...phoneMessages[0]!, embeddedPhoneMessages: [{ phoneMessageId: 11, from: 'Bob', to: 'Alice', message: 'Pong' }] },
      phoneMessages[1]!,
      { id: 12, role: 'error', originalText: 'Hidden error' },
    ]).map((message) => message.id).join(',') === '10',
    'phone selectors must hide linked phone messages and errors from the visible chat timeline',
  );
  const phoneMessagesWithTime = [
    phoneMessages[0]!,
    { ...phoneMessages[1]!, rpDateTime: '2026-06-01T12:30' },
  ];
  assertFixture(
    messageEffectiveRpDateTime(
      { ...phoneMessages[0]!, channel: 'rp', embeddedPhoneMessages: [{ phoneMessageId: 11, from: 'Bob', to: 'Alice', message: 'Pong' }] },
      phoneMessagesById(phoneMessagesWithTime),
    ) === '2026-06-01T12:30',
    'phone selectors must derive RP time from linked embedded phone messages',
  );
  const phoneMessageViews = phoneConversationMessageViews([
    { ...phoneMessages[0]!, translatedText: 'Translated ping', rpDateTime: '2026-06-01T12:00' },
    { ...phoneMessages[1]!, rpDateTime: '2026-06-01T12:30' },
  ], {
    viewerName: 'Alice Example',
    selectedPhoneDividerAfterId: 10,
    englishProcessingEnabled: true,
    rpTimeTrackingEnabled: true,
  });
  assertFixture(
    phoneMessageViews[0]?.outgoing === true &&
      phoneMessageViews[0]?.visibleText === 'Translated ping' &&
      phoneMessageViews[0]?.dayRpDateTime === '2026-06-01T12:00' &&
      phoneMessageViews[1]?.showNewDivider === true &&
      matchingPhoneName([{ name: 'Alice Example' }], 'Alice')?.name === 'Alice Example',
    'phone selectors must build phone UI message views from canonical message data',
  );
  assertFixture(
    canonicalPhoneName([{ name: 'Lara Miller' }, { name: 'Robert Miller' }], 'Lara Herzchen') === 'Lara Miller' &&
      canonicalPhoneName([{ name: 'Lara Miller' }, { name: 'Robert Miller' }], 'Lara ❤️') === 'Lara Miller' &&
      canonicalPhoneName([{ name: 'Lara Miller' }, { name: 'Lara Meyer' }], 'Lara') === 'Lara',
    'phone names must canonicalize only when a nickname or partial name has one clear character match',
  );
  assertFixture(
    canonicalPhoneName([{ name: 'Postarius' }, { name: 'Post Delivery' }], 'Post') === 'Post Delivery' &&
      canonicalPhoneName([{ name: 'Postarius' }, { name: 'Posta' }], 'Post') === 'Post',
    'phone names must preserve ambiguous optional contact matches',
  );
  const fixtureCharacters = [
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
    { id: 'cara', name: 'Cara' },
  ];
  const phoneContacts = phoneContactsForViewer(fixtureCharacters, {
    viewedCharacter: fixtureCharacters[0],
    messages: phoneMessages,
    conversations: phoneConversationInfoFromMessages(phoneMessages, { [aliceBobKey]: 10 }),
    characterColors: new Map([['Bob', '#123456']]),
    fallbackColor: '#abcdef',
    englishProcessingEnabled: false,
  });
  const selectedPhoneContact = phoneContacts.find((contact) => contact.character.id === 'bob');
  assertFixture(
    selectedPhoneContact?.conversationKey === aliceBobKey &&
      selectedPhoneContact.preview === 'Pong' &&
      selectedPhoneContact.unreadCount === 1 &&
      selectedPhoneConversationMessages(phoneMessages, fixtureCharacters[0], selectedPhoneContact).length === 2,
    'phone selectors must build contact rows and selected conversations for the viewed phone',
  );
  assertFixture(
    unreadPhoneConversationsForCharacters(fixtureCharacters, {
      narratorSelected: true,
      selectedContact: selectedPhoneContact,
      conversations: phoneConversationInfoFromMessages(phoneMessages, { [aliceBobKey]: 10 }),
    }).some((conversation) =>
      conversation.viewerName === 'Alice' &&
      conversation.contactName === 'Bob' &&
      conversation.unreadCount === 1 &&
      conversation.unread
    ),
    'phone selectors must build narrator phone switch rows from unread conversations',
  );
  const unreadSwitch = unreadPhoneConversationsForCharacters(fixtureCharacters, {
    narratorSelected: true,
    selectedContact: selectedPhoneContact,
    conversations: phoneConversationInfoFromMessages(phoneMessages, { [aliceBobKey]: 10 }),
  }).find((conversation) => conversation.unread);
  assertFixture(
    !!unreadSwitch &&
      phoneSwitchCharacters(fixtureCharacters, unreadSwitch, phoneInfo).viewer?.id === 'alice' &&
      phoneSwitchCharacters(fixtureCharacters, unreadSwitch, phoneInfo).contact?.id === 'bob' &&
      embeddedPhoneMessageCharacters(fixtureCharacters, {
        phoneMessageId: 11,
        from: 'Bob',
        to: 'Alice',
        message: 'Pong',
      }).viewer?.id === 'alice',
    'phone selectors must resolve phone switch and embedded phone message characters',
  );
  assertFixture(
    formatPhoneInput(
      'Ryan Parker',
      'Sarah Miller',
      'This is Jessie, do you know her?',
      {
        id: 'ryan_parker_image_01',
        description: 'A woman standing beside an unidentified man outside a café.',
      },
    ) === 'Ryan Parker sends an image to Sarah Miller: [ryan_parker_image_01: A woman standing beside an unidentified man outside a café.] This is Jessie, do you know her?' &&
    formatPhoneInput(
      'Ryan Parker',
      'Sarah Miller',
      'This is Jessie, do you know her?',
      {},
    ) === 'Ryan Parker sends an image to Sarah Miller: This is Jessie, do you know her?' &&
    formatPhoneInput(
      'Ryan Parker',
      'Sarah Miller',
      'Do you know Jessie?',
    ) === 'Ryan Parker texts Sarah Miller: Do you know Jessie?',
    'current phone input must distinguish text, uploaded images, and referenced Storybook images',
  );
  assertFixture(
    formatChatHistory([{
      id: 1,
      role: 'user',
      originalText: 'I am leaving now.',
      rpDateTime: '2026-06-01T12:10',
    }], false, 'eu', 'de-DE') === '[01.06.26 MO 12:10] I am leaving now.',
    'chat history must render RP timestamps',
  );
  assertFixture(
    formatChatHistory([{
      id: 1,
      role: 'user',
      originalText: 'Helga looks at the picture she took last week.',
      imageAttachments: [{
        id: 'image-temp-123',
        name: 'RP Picture 01',
        mimeType: 'image/jpeg',
        size: 1,
        dataUrl: 'data:image/jpeg;base64,AA==',
      }],
      rpImageDescription: 'Ryan and Espen stand close at the party, caught in obvious romantic tension while Helga teases them.',
      rpImageName: 'RP Picture 01',
    }], false) === '[RP Picture 01: Ryan and Espen stand close at the party, caught in obvious romantic tension while Helga teases them.] Helga looks at the picture she took last week.',
    'chat history must render described RP input images with stable RP picture names',
  );
  assertFixture(
    formatChatHistory([{
      id: 1,
      role: 'user',
      originalText: 'I am leaving now.',
      rpDateTime: '2026-06-05T20:00',
    }], false, 'us', 'de-DE') === '[06/05/26 FR 8:00 PM] I am leaving now.',
    'chat history must render US RP timestamps',
  );
  assertFixture(
    formatChatHistory([{
      id: 1,
      role: 'user',
      originalText: 'I am leaving now.',
      rpDateTime: '2026-06-05T20:00',
    }], false, 'iso', 'de-DE') === '[2026-06-05 FR 20:00] I am leaving now.',
    'chat history must render ISO RP timestamps',
  );
  assertFixture(
    formatChatHistory([{
      id: 1,
      role: 'user',
      originalText: 'Robert sees a flower stand.',
      rpDateTime: '2026-06-14T17:15',
    }, {
      id: 2,
      role: 'output',
      originalText: 'Robert pulls over.',
      rpDateTime: '2026-06-14T17:15',
    }, {
      id: 3,
      role: 'output',
      originalText: 'Sara replies.',
      rpDateTime: '2026-06-14T17:16',
    }], false, 'eu', 'en-US') === [
      '[14.06.26 SUN 17:15] Robert sees a flower stand.',
      'Robert pulls over.',
      '[14.06.26 SUN 17:16] Sara replies.',
    ].join('\n\n'),
    'chat history must render RP timestamps only when the time changes',
  );
  assertFixture(
    formatChatHistory([{
      id: 1,
      role: 'user',
      originalText: 'Robert Miller moves the story forward with an action, dialogue, or decision.',
      includeInHistory: true,
      channel: 'rp',
      speakerName: 'Narrator',
    }, {
      id: 2,
      role: 'output',
      originalText: 'Robert opens the door.',
      includeInHistory: true,
    }], false) === 'Robert opens the door.',
    'chat history must omit AutoTurn marker inputs',
  );
  assertFixture(
    formatChatHistory([{
      id: 1,
      role: 'output',
      originalText: 'Robert pulls over.\n\nHe puts his phone away.',
      includeInHistory: true,
      embeddedPhoneMessages: [{
        phoneMessageId: 2,
        from: 'Robert Miller',
        to: 'Sara Steiner',
        message: 'Which flowers does Lara like?',
      }],
      embeddedPhoneTextBefore: 'Robert pulls over.',
      embeddedPhoneTextAfter: 'He puts his phone away.',
    }, {
      id: 2,
      role: 'output',
      originalText: 'Which flowers does Lara like?',
      includeInHistory: true,
      channel: 'phone',
      phoneMessage: true,
      phoneFrom: 'Robert Miller',
      phoneTo: 'Sara Steiner',
    }], false) === [
      'Robert pulls over.',
      'Robert Miller texts Sara Steiner: Which flowers does Lara like?',
      'He puts his phone away.',
    ].join('\n\n'),
    'chat history must inline embedded phone messages at their RP text position',
  );
  assertFixture(
    formatChatHistory([{
      id: 1,
      role: 'user',
      originalText: "Hey that's us together at the party from last weekend jack sent the picture",
      includeInHistory: true,
      channel: 'phone',
      phoneMessage: true,
      phoneFrom: 'Emily Miller',
      phoneTo: 'Sarah Miller',
      phoneImageIds: ['emily_miller_image_01'],
      phoneImageDescription: 'Emily Miller and Sarah Miller sitting on a red tiled patio, both wearing sunglasses; Emily looks forward while Sarah looks down.',
      inputMessageFormat: 1,
      inputPromptSlot: 0,
      rpDateTime: '2026-06-22T15:40',
    }], false, 'eu', 'en-US') === [
      "[22.06.26 MON 15:40] Emily Miller sends an image to Sarah Miller: [emily_miller_image_01: Emily Miller and Sarah Miller sitting on a red tiled patio, both wearing sunglasses; Emily looks forward while Sarah looks down.] Hey that's us together at the party from last weekend jack sent the picture",
    ].join('\n\n'),
    'chat history must label phone user-image inputs with their Storybook image id',
  );
  assertFixture(
    formatChatHistory([{
      id: 1,
      role: 'output',
      originalText: 'Hey, that is us at the party.',
      includeInHistory: true,
      channel: 'phone',
      phoneMessage: true,
      phoneFrom: 'Emily Miller',
      phoneTo: 'Sarah Miller',
      phoneImageIds: ['emily_miller_image_01'],
      phoneImageDescription: 'Emily and Sarah sitting together on a red tiled patio.',
    }, {
      id: 2,
      role: 'user',
      originalText: 'I love this one.',
      includeInHistory: true,
      channel: 'phone',
      phoneMessage: true,
      phoneFrom: 'Sarah Miller',
      phoneTo: 'Emily Miller',
      replyToMessageId: 1,
    }], false) === [
      'Emily Miller sends an image to Sarah Miller: [emily_miller_image_01: Emily and Sarah sitting together on a red tiled patio.] Hey, that is us at the party.',
      'Sarah Miller replies to Emily Miller:\n[Replied to Emily Miller: [emily_miller_image_01: Emily and Sarah sitting together on a red tiled patio.] Hey, that is us at the party.]\nSarah Miller\'s message: I love this one.',
    ].join('\n\n'),
    'chat history must include the replied phone message and its image id',
  );
  const rawReplyHistoryMessages: MessageRecord[] = [{
    id: 1,
    role: 'output',
    originalText: 'Photo from the party.',
    channel: 'phone',
    phoneFrom: 'Emily Miller',
    phoneTo: 'Sarah Miller',
    phoneImageIds: ['emily_miller_image_01'],
    phoneImageDescription: 'Emily and Sarah together at the party.',
    imageAttachments: [{
      id: 'emily_miller_image_01',
      name: 'Party photo',
      mimeType: 'image/jpeg',
      size: 1,
      dataUrl: 'data:image/jpeg;base64,a',
    }],
    turnNumber: 1,
  }, {
    id: 2,
    role: 'user',
    originalText: 'I remember that evening.',
    channel: 'phone',
    phoneFrom: 'Sarah Miller',
    phoneTo: 'Emily Miller',
    replyToMessageId: 1,
    turnNumber: 2,
  }];
  const replyHistoryOutputs = buildHistoryOutputs({
    messages: rawReplyHistoryMessages,
    fallbackOriginalHistory: '',
    fallbackTranslatedHistory: '',
    lastTurnsCount: 1,
    rpDateTimeFormat: 'iso',
    rpWeekdayLanguage: 'en-US',
  });
  const rawReplyHistory = JSON.parse(replyHistoryOutputs.rawHistory) as MessageRecord[];
  assertFixture(
    rawReplyHistory[0]?.phoneImageIds?.[0] === 'emily_miller_image_01' &&
      rawReplyHistory[0]?.imageAttachments?.[0]?.id === 'emily_miller_image_01' &&
      rawReplyHistory[1]?.replyToMessageId === 1,
    'raw Chat History must retain phone image ids and reply message ids',
  );
  assertFixture(
    replyHistoryOutputs.lastTurnsHistory.includes(
      '[Replied to Emily Miller: [emily_miller_image_01: Emily and Sarah together at the party.] Photo from the party.]',
    ) && !replyHistoryOutputs.lastTurnsHistory.startsWith('Emily Miller texts'),
    'last-turn Chat History must resolve reply image context outside the selected turn window',
  );
  const extractedWorkflowVariables = extractWorkflowVariableSetCommands([
    'Robert opens the door.',
    '',
    '@set',
    'Current Location = "Old Harbor"',
    'Tension = 8',
    '@endset',
    '',
    '@set Weather = "Rain"',
  ].join('\n'));
  assertFixture(
    extractedWorkflowVariables.text === 'Robert opens the door.' &&
      extractedWorkflowVariables.commands.length === 3 &&
      extractedWorkflowVariables.commands[0]?.name === 'Current Location' &&
      extractedWorkflowVariables.commands[0]?.value === 'Old Harbor' &&
      extractedWorkflowVariables.commands[1]?.value === '8' &&
      extractedWorkflowVariables.commands[2]?.name === 'Weather',
    'workflow variable extraction must remove @set commands from visible output',
  );
  const previewVariableDefinitions = [{
    key: 'Current Location',
    label: 'Current Location',
  }];
  const previewVariableValues = workflowVariablePreviewValues(
    extractedWorkflowVariables.commands,
    previewVariableDefinitions,
    { 'Current Location': 'Downtown' },
  );
  assertFixture(
    resolveWorkflowVariables(
      'They arrive at <Current Location>.',
      previewVariableDefinitions,
      previewVariableValues,
    ) === 'They arrive at Old Harbor.',
    'workflow variable preview values must resolve variables set in the same output',
  );
  assertFixture(
    resolveWorkflowVariables(
      'Tell the model to write \\<Current Location>, then use <Current Location>.',
      previewVariableDefinitions,
      previewVariableValues,
    ) === 'Tell the model to write <Current Location>, then use Old Harbor.',
    'escaped workflow variable tokens must remain literal in resolved text',
  );
  const fencedEmbeddedPhone = parseEmbeddedPhoneMessagesFromRpOutput([
    'Lara taps out a reminder.',
    '',
    '```json',
    '{"phoneMessages":[{"from":"Lara Miller","to":"Robert Miller","message":"Please get the heavy duty ones."}]}',
    '```',
  ].join('\n'));
  assertFixture(
    fencedEmbeddedPhone.text === 'Lara taps out a reminder.' &&
      fencedEmbeddedPhone.textBefore === 'Lara taps out a reminder.' &&
      fencedEmbeddedPhone.textAfter === '' &&
      fencedEmbeddedPhone.phoneMessages[0]?.from === 'Lara Miller' &&
      fencedEmbeddedPhone.phoneMessages[0]?.message === 'Please get the heavy duty ones.',
    'embedded phone parser must remove markdown fences around phoneMessages JSON',
  );
  assertFixture(
    knownPromptCommandId('SIMULATE_AI_CHAT') === 'simulate_ai_chat' &&
      knownPromptCommandId('Simulate_ChatGPD') === 'simulate_ai_chat' &&
      knownPromptCommandId('PHONE_CONVERSATION') === 'phone_conversation' &&
      defaultPromptCommandInstructionTemplate('simulate_ai_chat').includes('2, 4, 6, or 8 messages') &&
      defaultPromptCommandInstructionTemplate('phone_conversation').includes('exactly two, three, or four messages') &&
      defaultPromptCommandInstructionTemplate('phone_conversation').includes(
        'the first person writes a follow-up, and the other person sends the final reply',
      ) &&
      formatPromptCommandTokens('@command:bank_transfer\n@COMMAND:simulate_chatgpd') ===
        '@command: Bank_transfer\n@command: Simulate_ChatGPD' &&
      replacePromptCommandTokensWithHints('@command: Simulate_ChatGPD') ===
        '[commands: simulate_ai_chat]' &&
      formatPromptCommandTokens('@command:phone_conversation') === '@command: Phone_conversation' &&
      replacePromptCommandTokensWithHints('@command: Phone_conversation') ===
        '[commands: phone_conversation]' &&
      formatPromptCommandTokens('@command:create_note') === '@command: Create_Note' &&
      replacePromptCommandTokensWithHints('@command: Create_Note') === '[commands: create_note]',
    'prompt commands must accept flexible casing and spacing while preserving their internal command requests',
  );
  const createdPhoneNoteOutput = parseEmbeddedPhoneMessagesFromRpOutput([
    'Sarah saves the plan in her Notes app.',
    JSON.stringify({
      phoneNote: {
        character: 'Sarah Miller',
        title: 'Moving checklist',
        text: '- Pack books\n- Call the moving company\n- Keep the blue folder nearby',
      },
    }),
  ].join('\n'));
  assertFixture(
    createdPhoneNoteOutput.text === 'Sarah saves the plan in her Notes app.' &&
      createdPhoneNoteOutput.createdPhoneNotes[0]?.character === 'Sarah Miller' &&
      createdPhoneNoteOutput.createdPhoneNotes[0]?.title === 'Moving checklist' &&
      createdPhoneNoteOutput.createdPhoneNotes[0]?.text.includes('- Call the moving company') &&
      createdPhoneNoteOutput.invalidCreatedPhoneNoteCount === 0,
    'embedded output must extract a complete character note from visible RP text',
  );
  const invalidCreatedPhoneNoteOutput = parseEmbeddedPhoneMessagesFromRpOutput(JSON.stringify({
    phoneNote: {
      character: 'Sarah Miller',
      title: '',
      text: 'Missing title.',
    },
  }));
  assertFixture(
    invalidCreatedPhoneNoteOutput.text === '' &&
      invalidCreatedPhoneNoteOutput.createdPhoneNotes.length === 0 &&
      invalidCreatedPhoneNoteOutput.invalidCreatedPhoneNoteCount === 1,
    'invalid phone notes must be removed and reported instead of being stored',
  );
  const createdNoteState = replaceCreatedPhoneNotesForTurn(
    {
      sarah: [{
        id: 'manual-note',
        title: 'Manual',
        text: 'Keep me',
        dayLabel: 'Sun 12 July',
        color: 'mint',
      }],
    },
    'turn-8',
    [{
      characterId: 'sarah',
      characterName: 'Sarah Miller',
      note: {
        id: 'note-command-turn-8-1',
        title: 'Moving checklist',
        text: createdPhoneNoteOutput.createdPhoneNotes[0]!.text,
        dayLabel: 'Sun 12 July',
        color: 'neutral',
      },
    }],
  );
  const undoneCreatedNoteState = replaceCreatedPhoneNotesForTurn(createdNoteState, 'turn-8', []);
  assertFixture(
    createdNoteState.sarah?.length === 2 &&
      undoneCreatedNoteState.sarah?.length === 1 &&
      undoneCreatedNoteState.sarah[0]?.id === 'manual-note',
    'turn replacement and undo must remove only notes created by that turn',
  );
  const simulatedAiChatOutput = parseEmbeddedPhoneMessagesFromRpOutput([
    'Sarah opens the AI assistant app.',
    JSON.stringify({
      aiAssistantChat: {
        character: 'Sarah Miller',
        messages: [
          { role: 'user', text: 'Are tomatoes fruit?' },
          { role: 'assistant', text: 'Botanically, yes.' },
          { role: 'user', text: 'So Alex was right?' },
          { role: 'assistant', text: 'Botanically, but cooking uses another convention.' },
        ],
      },
    }),
  ].join('\n'));
  assertFixture(
    simulatedAiChatOutput.text === 'Sarah opens the AI assistant app.' &&
      simulatedAiChatOutput.simulatedAiChats[0]?.character === 'Sarah Miller' &&
      simulatedAiChatOutput.simulatedAiChats[0]?.messages.length === 4 &&
      simulatedAiChatOutput.invalidSimulatedAiChatCount === 0,
    'embedded output must extract a valid simulated AI conversation from visible RP text',
  );
  const invalidSimulatedAiChatOutput = parseEmbeddedPhoneMessagesFromRpOutput(JSON.stringify({
    aiAssistantChat: {
      character: 'Sarah Miller',
      messages: [
        { role: 'assistant', text: 'Wrong first role.' },
        { role: 'user', text: 'Wrong second role.' },
      ],
    },
  }));
  assertFixture(
    invalidSimulatedAiChatOutput.text === '' &&
      invalidSimulatedAiChatOutput.simulatedAiChats.length === 0 &&
      invalidSimulatedAiChatOutput.invalidSimulatedAiChatCount === 1,
    'invalid simulated AI conversations must be removed and reported instead of being stored',
  );
  const simulatedChatState = replaceSimulatedAiChatsForTurn(
    {
      sarah: [{
        id: 'manual-chat',
        title: 'Manual',
        createdAt: '2026-07-12T00:00:00.000Z',
        messages: [{ role: 'user', text: 'Keep me' }],
      }],
    },
    'turn-7',
    [{
      characterId: 'sarah',
      characterName: 'Sarah Miller',
      chat: {
        id: 'chatgpd-simulated-turn-7-1',
        title: 'Tomatoes',
        createdAt: '2026-07-12T01:00:00.000Z',
        messages: simulatedAiChatOutput.simulatedAiChats[0]!.messages,
      },
    }],
  );
  const undoneSimulatedChatState = replaceSimulatedAiChatsForTurn(
    simulatedChatState,
    'turn-7',
    [],
  );
  assertFixture(
    simulatedChatState.sarah?.length === 2 &&
      undoneSimulatedChatState.sarah?.length === 1 &&
      undoneSimulatedChatState.sarah[0]?.id === 'manual-chat',
    'turn replacement and undo must remove only chats simulated by that turn',
  );
  const embeddedPhoneWithImageId = parseEmbeddedPhoneMessagesFromRpOutput(
    '{"phoneMessages":[{"from":"Lara Miller","to":"Robert Miller","message":"Look at this.","imageId":"lara_miller_image_01"}]}',
  );
  assertFixture(
    embeddedPhoneWithImageId.phoneMessages[0]?.imageId === 'lara_miller_image_01',
    'embedded phone parser must preserve Storybook image ids',
  );
  const embeddedPhoneWithSendImageId = parseEmbeddedPhoneMessagesFromRpOutput(
    '{"phoneMessages":[{"from":"Lara Miller","to":"Robert Miller","message":"Look at this.","sendImageId":"lara_miller_image_01"}]}',
  );
  assertFixture(
    embeddedPhoneWithSendImageId.phoneMessages[0]?.imageId === 'lara_miller_image_01',
    'embedded phone parser must preserve outgoing sendImageId attachments',
  );
  const embeddedSocialPostComment = parseEmbeddedPhoneMessagesFromRpOutput([
    'Jack grins and pulls out his phone.',
    '{"fotogramPostComment":{"postId":"fotogram-post-01","from":"Jack Carter","text":"Looking stunning! See you tonight."}}',
    '{"onlyFriendsPostComment":{"postId":"onlyfriends-post-02","from":"Generous Fan","text":"Love this set!"}}',
  ].join('\n'));
  assertFixture(
    embeddedSocialPostComment.text === 'Jack grins and pulls out his phone.' &&
      embeddedSocialPostComment.socialPostComments[0]?.app === 'fotogram' &&
      embeddedSocialPostComment.socialPostComments[0]?.postId === 'fotogram-post-01' &&
      embeddedSocialPostComment.socialPostComments[0]?.from === 'Jack Carter' &&
      embeddedSocialPostComment.socialPostComments[1]?.app === 'onlyfriends' &&
      parseEmbeddedPhoneMessagesFromRpOutput(
        '{"fotogramPostComment":{"postId":"fotogram-post-01","text":"Missing commenter"}}',
      ).socialPostComments.length === 0,
    'embedded social post comments must parse per app and require postId, from, and text',
  );
  const embeddedSocialDm = parseEmbeddedPhoneMessagesFromRpOutput([
    'Later that night, her phone buzzes.',
    '{"onlyFriendsDirectMessages":[{"from":"Marcus Vane","to":"Helga Harper","text":"That set was incredible.","postId":"onlyfriends-post-01","tip":10}]}',
  ].join('\n'));
  assertFixture(
    embeddedSocialDm.text === 'Later that night, her phone buzzes.' &&
      embeddedSocialDm.socialDirectMessages[0]?.app === 'onlyfriends' &&
      embeddedSocialDm.socialDirectMessages[0]?.to === 'Helga Harper' &&
      embeddedSocialDm.socialDirectMessages[0]?.tip === 10 &&
      embeddedSocialDm.socialDirectMessages[0]?.postId === 'onlyfriends-post-01',
    'embedded social DM blocks must parse sender, recipient, post reference, and tip',
  );
  const rpOutputWithDisplayImage = parseRpOutput([
    'Lara swipes to the cat photo and smiles.',
    '{"displayImageId":"lara_cat_image_01"}',
  ].join('\n'));
  assertFixture(
    rpOutputWithDisplayImage.story === 'Lara swipes to the cat photo and smiles.' &&
      rpOutputWithDisplayImage.displayImageId === 'lara_cat_image_01',
    'normal RP parser must remove trailing displayImageId metadata',
  );
  const rpOutputWithRpImages = parseRpOutput([
    '{"rpImages":[{"imageId":"lara_cat_image_02"}]}',
    '',
    'The photo fills the screen: whiskers, sunlight, and Lara laughing behind the camera.',
  ].join('\n'));
  assertFixture(
    rpOutputWithRpImages.story === 'The photo fills the screen: whiskers, sunlight, and Lara laughing behind the camera.' &&
      rpOutputWithRpImages.displayImageId === 'lara_cat_image_02',
    'normal RP parser must accept leading rpImages metadata',
  );
  assertFixture(
    parsePhoneMessageOutput(
      '{"from":"Lara Miller","to":"Robert Miller","message":"Look at this."}',
    )?.message === 'Look at this.',
    'phone message parser must accept message-only JSON replies',
  );
  assertFixture(
    parsePhoneMessageOutput(
      '{"from":"Lara Miller","to":"Robert Miller","message":"Look at this.","sendImageId":"lara_miller_image_01"}',
    )?.imageId === 'lara_miller_image_01',
    'phone message parser must accept outgoing sendImageId attachments',
  );
  assertFixture(
    parsePhoneMessageOutput(
      '{"from":"Lara Miller","to":"Robert Miller","message":"Look at this.","imageId":"lara_miller_image_01"}',
    ) === null &&
      parsePhoneMessageOutput(
        '{"from":"Lara Miller","to":"Robert Miller","message":"Look at this.","imageDescription":"Lara smiles beside Daniel after carrying boxes."}',
      ) === null &&
      parsePhoneMessageOutput(
        'from: Lara Miller, to: Robert Miller, image: "Lara smiles beside Daniel.", message: "Look at this."',
      ) === null,
    'phone message parser must reject old image fields and legacy text replies',
  );
  assertFixture(
    parseEmbeddedPhoneMessagesFromRpOutput(
      '{"phoneMessages":[{"from":"Lara Miller","to":"Robert Miller","message":"Look at this.","image_description":"Lara smiles beside Daniel after carrying boxes."}]}',
    ).phoneMessages[0]?.imageDescription === 'Lara smiles beside Daniel after carrying boxes.',
    'embedded phone parser must accept canonical image description aliases',
  );
  const phoneMessageWithNewImageAction = parsePhoneMessageOutput([
    '{"from":"Robert Miller","to":"Lara Miller","message":"That face beside the boxes says this got heavier than planned. Stay there; I am coming down before you try carrying the rest alone."}',
    '{"imageId":"new_image","imageAction":"create","caption":"Lara Miller stands beside stacked moving boxes with a strained, determined expression after trying to carry them herself."}',
  ].join('\n'));
  assertFixture(
    phoneMessageWithNewImageAction?.from === 'Robert Miller' &&
      phoneMessageWithNewImageAction.imageId === undefined &&
      phoneMessageWithNewImageAction.incomingImageAction?.imageId === 'new_image' &&
      phoneMessageWithNewImageAction.incomingImageAction.imageAction === 'create' &&
      phoneMessageWithNewImageAction.incomingImageAction.caption ===
        'Lara Miller stands beside stacked moving boxes with a strained, determined expression after trying to carry them herself.',
    'phone message parser must keep incoming new-image actions separate from the phone reply',
  );
  const mixedPromptSwitchAction = parsePromptActionCall([
    '{"from":"Robert Miller","to":"Lara Miller","message":"That look says the boxes won this round."}',
    '{"action":"update_phone_image_caption","imageId":"image-temp-123","imageAction":"create","caption":"Lara Miller stands beside stacked moving boxes with a strained, determined expression after trying to carry them herself."}',
  ].join('\n'));
  assertFixture(
    mixedPromptSwitchAction?.action === 'updatePhoneImageCaption' &&
      mixedPromptSwitchAction.imageId === 'new_image' &&
      mixedPromptSwitchAction.imageAction === 'create',
    'prompt switch action parser must prefer a caption action over a same-pass phone reply and normalize create image ids',
  );
  const fencedDescribeInputImageAction = parsePromptActionCall([
    '```json',
    '{',
    '"action": "describe_input_image",',
    '"caption": "Helga studies a party photo of Ryan and Espen standing close together, both caught in obvious romantic tension before tonight."',
    '}',
    '```',
  ].join('\n'));
  assertFixture(
    fencedDescribeInputImageAction?.action === 'describeInputImage' &&
      fencedDescribeInputImageAction.caption ===
        'Helga studies a party photo of Ryan and Espen standing close together, both caught in obvious romantic tension before tonight.',
    'prompt action parser must accept fenced JSON action calls',
  );
  assertFixture(
    unwrapJsonCodeFence('```json\n{"action":"describe_input_image"}\n```') ===
      '{"action":"describe_input_image"}' &&
      knownPromptActionId('describe_input_image') === 'describeInputImage' &&
      knownPromptActionId('update_phone_image_caption') === 'updatePhoneImageCaption' &&
      knownPromptActionId('get_image_id') === 'getImageId' &&
      knownPromptActionId('make_coffee') === undefined,
    'fence unwrapping and known action ids must classify LLM action names',
  );
  const plannedImageAction = parsePromptActionRequest(
    '{"action":"create_image","plan":"Lara takes and owns a mirror selfie of herself in her current outfit."}',
  );
  assertFixture(
    plannedImageAction?.action === 'createImage' &&
      plannedImageAction.plan === 'Lara takes and owns a mirror selfie of herself in her current outfit.',
    'pre-reply image actions must carry a first-pass plan into their follow-up pass',
  );
  const createImageAction = parsePromptActionCall(
    '{"action":"create_image","phoneOwner":"Robert Miller","loraCharacter":"Lara Miller","prompt":"A 28-year-old woman stands beside stacked moving boxes."}',
  );
  const createImageWithoutLora = parsePromptActionCall(
    '{"action":"create_image","phoneOwner":"Robert Miller","loraCharacter":0,"prompt":"A small dog lies on a sofa."}',
  );
  const characterOnlyImageSearch = parsePromptActionCall(
    '{"action":"get_image_id","characters":"Robert Miller"}',
  );
  const taggedImageSearch = parsePromptActionCall(
    '{"action":"get_image_id","characters":"Robert Miller","tags":"mirror, selfie"}',
  );
  assertFixture(
    createImageAction?.action === 'createImage' &&
      createImageAction.phoneOwner === 'Robert Miller' &&
      createImageAction.loraCharacter === 'Lara Miller' &&
      createImageAction.prompt === 'A 28-year-old woman stands beside stacked moving boxes.' &&
      createImageWithoutLora?.action === 'createImage' &&
      createImageWithoutLora.loraCharacter === '' &&
      characterOnlyImageSearch === undefined &&
      taggedImageSearch?.action === 'getImageId',
    'image actions must separate optional LoRA selection from phone ownership and reject searches without tags',
  );
  const duplicateFirstNameCharacters = [
    { name: 'Alex Smith' },
    { name: 'Alex Jones' },
    { name: 'Taylor Reed' },
  ] as StorybookCreateImageCharacter[];
  const exactAlexJones = resolveCreateImageCharacterByName(
    duplicateFirstNameCharacters,
    'Alex Jones',
  );
  const ambiguousAlex = resolveCreateImageCharacterByName(
    duplicateFirstNameCharacters,
    'Alex',
  );
  const uniqueTaylor = resolveCreateImageCharacterByName(
    duplicateFirstNameCharacters,
    'Taylor',
  );
  const incorrectAlexSurname = resolveCreateImageCharacterByName(
    duplicateFirstNameCharacters,
    'Alex Unknown',
  );
  assertFixture(
    exactAlexJones.status === 'found' && exactAlexJones.character.name === 'Alex Jones' &&
      ambiguousAlex.status === 'ambiguous' &&
      uniqueTaylor.status === 'found' && uniqueTaylor.character.name === 'Taylor Reed' &&
      incorrectAlexSurname.status === 'not-found',
    'create-image character matching must prefer exact full names and accept only unique first-name fallbacks',
  );
  const outgoingGeneratedImageCaption = parsePhoneMessageOutput([
    '{"from":"Helga Harper","to":"Jack Carter","message":"Caught her off guard.","sendImageId":"helga_harper_image_06"}',
    '{"imageId":"helga_harper_image_06","imageAction":"update","caption":"Espen Harper concentrates on applying makeup at the bathroom mirror, her softly waved hair framing her face as she studies her reflection."}',
  ].join('\n'));
  assertFixture(
    outgoingGeneratedImageCaption?.imageId === 'helga_harper_image_06' &&
      outgoingGeneratedImageCaption.incomingImageAction?.imageId === 'helga_harper_image_06' &&
      outgoingGeneratedImageCaption.incomingImageAction.imageAction === 'update',
    'phone output must preserve a caption update for the generated outgoing image attachment',
  );
  const combinedPhoneOutput = parseEmbeddedPhoneMessagesFromRpOutput([
    '{"from":"Helga Harper","to":"Jack Carter","message":"Caught her off guard.","sendImageId":"helga_harper_image_06"}',
    '{"imageId":"helga_harper_image_06","imageAction":"update","caption":"Espen Harper concentrates on applying makeup at the bathroom mirror."}',
    '{"bankTransfers":[{"from":"Helga Harper","to":"Jack Carter","amount":20}]}',
  ].join('\n'));
  const combinedPhoneMessage = parsePhoneMessageOutput(combinedPhoneOutput.text);
  assertFixture(
    combinedPhoneMessage?.imageId === 'helga_harper_image_06' &&
      combinedPhoneOutput.phoneImageActions[0]?.imageId === 'helga_harper_image_06' &&
      combinedPhoneOutput.phoneImageActions[0]?.imageAction === 'update' &&
      combinedPhoneOutput.bankTransfers.length === 1,
    'phone output splitting must preserve generated image captions alongside phone-app actions',
  );
  const createImageFollowUp = promptActionInstructionText(
    defaultPromptActionConfig('Create character phone image', 'createImage'),
    { createImageCharacters: [] },
    'Lara takes and owns a mirror selfie of herself in her current outfit.',
  );
  assertFixture(
    createImageFollowUp.includes('Lara takes and owns a mirror selfie of herself in her current outfit.') &&
      createImageFollowUp.includes('"phoneOwner": "Phone Owner Name"') &&
      createImageFollowUp.includes('"loraCharacter": 0') &&
      createImageFollowUp.includes('which Phone Gallery stores the generated image') &&
      createImageFollowUp.includes('RPGraph does not prepend it automatically') &&
      createImageFollowUp.includes('Only one character LoRA can be used per image') &&
      createImageFollowUp.includes('State every visible person\'s age in the prompt whenever their age is known') &&
      createImageFollowUp.includes('Write the prompt from the finished image\'s point of view') &&
      createImageFollowUp.includes('The photographer is invisible unless their body or reflection must actually appear') &&
      createImageFollowUp.includes('roughly 80 to 120 words') &&
      createImageFollowUp.includes('one frozen visual snapshot') &&
      createImageFollowUp.includes('latest established state of every person, garment, object, and location') &&
      createImageFollowUp.includes('Do not use Storybook-only character names') &&
      !createImageFollowUp.includes('{{plan}}'),
    'create-image follow-up prompts must turn the first-pass plan into a detailed visual snapshot',
  );
  assertFixture(
    defaultCreateImageResultTemplate.includes('* imagePrompt: {{imagePrompt}}') &&
      defaultCreateImageResultTemplate.includes('"imageAction":"update"') &&
      defaultCreateImageResultTemplate.includes('inspect the attached generated image'),
    'create-image results must distinguish the generation prompt and request a caption for an attached outgoing image',
  );
  const captionDefaults = defaultPromptActionConfig(
    'Update phone image caption',
    'updatePhoneImageCaption',
  );
  const captionMissingCaptionRule =
    'If the image label shows an imageId but no caption yet, always use imageAction "update" with that exact imageId and write its first caption.';
  const legacyCaptionAction = promptActionConfigs([{
    ...captionDefaults,
    instructionTemplate: captionDefaults.instructionTemplate.replace(`\n${captionMissingCaptionRule}`, ''),
    afterReplyTemplate: captionDefaults.afterReplyTemplate.replace(`\n${captionMissingCaptionRule}`, ''),
  }])[0];
  assertFixture(
    captionDefaults.instructionTemplate.includes(captionMissingCaptionRule) &&
      captionDefaults.afterReplyTemplate.includes(captionMissingCaptionRule) &&
      legacyCaptionAction?.instructionTemplate === captionDefaults.instructionTemplate &&
      legacyCaptionAction.afterReplyTemplate === captionDefaults.afterReplyTemplate,
    'phone caption templates must cover uncaptioned image ids and migrate the previous default text',
  );
  const phoneMessageWithUpdateImageAction = parsePhoneMessageOutput([
    '{"from":"Robert Miller","to":"Lara Miller","message":"That is Daniel in the background, right? The whole box situation suddenly makes a lot more sense, and yes, I am absolutely asking about this when I get there."}',
    '{"imageId":"lara_miller_image_01","imageAction":"update","caption":"Lara Miller stands beside stacked moving boxes while Daniel is visible in the background, adding tension to the situation."}',
  ].join('\n'));
  assertFixture(
    phoneMessageWithUpdateImageAction?.incomingImageAction?.imageId === 'lara_miller_image_01' &&
      phoneMessageWithUpdateImageAction.incomingImageAction.imageAction === 'update' &&
      phoneMessageWithUpdateImageAction.incomingImageAction.caption ===
        'Lara Miller stands beside stacked moving boxes while Daniel is visible in the background, adding tension to the situation.',
    'phone message parser must preserve incoming image update actions',
  );
  const currentIncomingPhoneImage: MessageRecord = {
    id: 99,
    role: 'user',
    originalText: 'Incoming phone image',
    channel: 'phone',
    phoneImageIds: ['current_phone_image_01'],
    phoneImageDescription: 'The current image already has a useful caption.',
    imageAttachments: [{
      id: 'current_phone_image_01',
      name: 'Current phone image',
      mimeType: 'image/jpeg',
      size: 1,
      dataUrl: 'data:image/jpeg;base64,current',
    }],
  };
  assertFixture(
    phoneImageActionMatchesMessage(currentIncomingPhoneImage, {
      imageId: 'current_phone_image_01',
      imageAction: 'update',
      caption: 'Current caption.',
    }) &&
      !phoneImageActionMatchesMessage(currentIncomingPhoneImage, {
        imageId: 'older_storybook_image_01',
        imageAction: 'update',
        caption: 'Wrong target.',
      }) &&
      !phoneImageActionMatchesMessage(currentIncomingPhoneImage, {
        imageId: 'new_image',
        imageAction: 'create',
        caption: 'Unwanted replacement caption.',
      }),
    'incoming phone image actions must only match the current image id and must not recreate an already captioned image',
  );
  const phoneMessageWithNoChangeImageAction = parsePhoneMessageOutput([
    '{"from":"Robert Miller","to":"Lara Miller","message":"The tilted lamp in the corner is doing heroic work there. I get why you sent this; the room looks like it is halfway through giving up."}',
    '{"imageId":"lara_miller_image_01","imageAction":"no_change"}',
  ].join('\n'));
  assertFixture(
    phoneMessageWithNoChangeImageAction?.incomingImageAction?.imageId === 'lara_miller_image_01' &&
      phoneMessageWithNoChangeImageAction.incomingImageAction.imageAction === 'no_change' &&
      phoneMessageWithNoChangeImageAction.incomingImageAction.caption === undefined,
    'phone message parser must preserve incoming image no_change actions without captions',
  );
  assertFixture(
    parseOutputActions(
      '{"phoneMessages":[{"from":"Lara Miller","to":"Robert Miller","message":"Look at this.","sendImageId":"lara_miller_image_01"}]}',
    ).phoneMessages[0]?.imageId === 'lara_miller_image_01',
    'output action parser must preserve outgoing sendImageId attachments',
  );
  assertFixture(
    parseOutputActions(
      '{"phoneMessages":[{"from":"Lara Miller","to":"Robert Miller","message":"Look at this.","imageId":"lara_miller_image_01"}]}',
    ).phoneMessages[0]?.imageId === 'lara_miller_image_01',
    'output action parser must preserve Storybook image ids',
  );
  const imageTransferStorybook = {
    ...emptyRpStorybookV1,
    characters: [
      {
        id: 'lara_miller',
        name: 'Lara Miller',
        description: '',
        personality: '',
        speechStyle: '',
        role: '',
        images: [],
      },
      {
        id: 'robert_miller',
        name: 'Robert Miller',
        description: '',
        personality: '',
        speechStyle: '',
        role: '',
        images: [],
      },
    ],
  };
  const sharedAttachment = {
    id: 'lara_miller_image_01',
    name: 'lara_miller_image_01.jpg',
    mimeType: 'image/jpeg' as const,
    size: 12,
    dataUrl: 'data:image/jpeg;base64,transfer',
    width: 100,
    height: 80,
  };
  const senderImageResult = withImagesEnsuredForStorybookCharacter(
    imageTransferStorybook,
    'lara_miller',
    [sharedAttachment],
    'Lara smiles beside the moving boxes.',
  );
  const recipientImageResult = withImagesEnsuredForStorybookCharacter(
    senderImageResult.storybook,
    'robert_miller',
    senderImageResult.images.map((image) => ({
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      size: image.size,
      dataUrl: image.dataUrl,
      width: image.width,
      height: image.height,
    })),
    'Lara smiles beside the moving boxes.',
    { receivedFrom: 'Lara Miller' },
  );
  const transferredImage = recipientImageResult.storybook.characters[1]?.images[0];
  assertFixture(
    transferredImage?.id === 'lara_miller_image_01' &&
      transferredImage.receivedFrom === 'Lara Miller',
    'received Storybook phone images must keep sender image ids and receivedFrom metadata',
  );
  const revisedImageResult = withStorybookImageDescriptionUpdated(
    recipientImageResult.storybook,
    sharedAttachment.id,
    sharedAttachment.dataUrl,
    'Lara smiles beside her brother Daniel and the moving boxes.',
  );
  const revisedDescriptions = storybookImageDescriptions([revisedImageResult.storybook]);
  const revisedHistory = withStorybookImageDescriptions([{
    id: 501,
    role: 'user',
    originalText: 'That is my brother Daniel.',
    channel: 'phone',
    phoneFrom: 'Lara Miller',
    phoneTo: 'Robert Miller',
    phoneImageIds: [sharedAttachment.id],
    phoneImageDescription: 'Lara smiles beside an unidentified man and the moving boxes.',
    inputMessageFormat: 1,
    inputPromptSlot: 0,
  }], revisedDescriptions);
  assertFixture(
    revisedImageResult.updatedCount === 2 &&
      revisedImageResult.storybook.characters.every(
        (character) => character.images[0]?.description === 'Lara smiles beside her brother Daniel and the moving boxes.',
      ) &&
      formatChatHistory(revisedHistory, false).includes(
        `[${sharedAttachment.id}: Lara smiles beside her brother Daniel and the moving boxes.]`,
      ),
    'updated Storybook image descriptions must synchronize gallery copies and prior phone history',
  );
  const differentIdCopyStorybook = {
    ...recipientImageResult.storybook,
    characters: recipientImageResult.storybook.characters.map((character, index) => index === 1
      ? {
          ...character,
          images: character.images.map((image) => ({
            ...image,
            id: 'robert_miller_received_image_01',
            name: 'robert_miller_received_image_01',
          })),
        }
      : character),
  };
  const revisedDifferentIdCopy = withStorybookImageDescriptionUpdated(
    differentIdCopyStorybook,
    sharedAttachment.id,
    sharedAttachment.dataUrl,
    'Lara smiles beside her brother Daniel and the moving boxes.',
  );
  assertFixture(
    revisedDifferentIdCopy.updatedCount === 2 &&
      revisedDifferentIdCopy.storybook.characters.every(
        (character) => character.images[0]?.description === 'Lara smiles beside her brother Daniel and the moving boxes.',
      ),
    'LLM caption updates must synchronize Storybook copies of the same image even when copy ids differ',
  );
  const manuallyEditedStorybook = {
    ...recipientImageResult.storybook,
    characters: recipientImageResult.storybook.characters.map((character, index) => index === 1
      ? {
          ...character,
          images: character.images.map((image) => ({
            ...image,
            description: 'Lara smiles beside her brother Daniel after carrying the moving boxes.',
          })),
        }
      : character),
  };
  const synchronizedManualEdit = withChangedStorybookImageDescriptionsSynchronized(
    recipientImageResult.storybook,
    manuallyEditedStorybook,
  );
  assertFixture(
    synchronizedManualEdit.characters.every(
      (character) => character.images[0]?.description === 'Lara smiles beside her brother Daniel after carrying the moving boxes.',
    ),
    'manual Storybook caption edits must synchronize every copy of the same image',
  );
  const imageAccessResult = withImagesEnsuredForStorybookCharacter(
    senderImageResult.storybook,
    'robert_miller',
    senderImageResult.images.map((image) => ({
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      size: image.size,
      dataUrl: image.dataUrl,
      width: image.width,
      height: image.height,
    })),
    'Lara smiles beside the moving boxes.',
    { imageAccess: true },
  );
  const accessedImage = imageAccessResult.storybook.characters[1]?.images[0];
  assertFixture(
    accessedImage?.id === 'lara_miller_image_01' &&
      accessedImage.imageAccess === true &&
      !accessedImage.receivedFrom,
    'Storybook images copied from known history must retain their id and Image Access marker',
  );
  const directlyReceivedAfterAccess = withImagesEnsuredForStorybookCharacter(
    imageAccessResult.storybook,
    'robert_miller',
    [sharedAttachment],
    'Lara smiles beside the moving boxes.',
    { receivedFrom: 'Lara Miller' },
  );
  const transitionedImage = directlyReceivedAfterAccess.storybook.characters[1]?.images[0];
  assertFixture(
    transitionedImage?.receivedFrom === 'Lara Miller' && !transitionedImage.imageAccess,
    'a direct Phone receipt must replace an existing Image Access marker with receivedFrom',
  );
  assertFixture(
    storybookImageSourceById(
      [imageAccessResult.storybook],
      'lara_miller_image_01',
    )?.ownerName === 'Lara Miller',
    'global Storybook image lookup must prefer the original unmarked owner',
  );
  const ownExistingImageResult = withImagesEnsuredForStorybookCharacter(
    imageTransferStorybook,
    'robert_miller',
    [sharedAttachment],
    'Robert owns this image.',
  );
  const ownExistingReceivedAgain = withImagesEnsuredForStorybookCharacter(
    ownExistingImageResult.storybook,
    'robert_miller',
    [sharedAttachment],
    'Robert owns this image.',
    { receivedFrom: 'Lara Miller' },
  );
  assertFixture(
    !ownExistingReceivedAgain.storybook.characters[1]?.images[0]?.receivedFrom,
    'existing own Storybook images must not be relabeled as received images',
  );
  const normalizedDuplicateIds = parseRpStorybookJson(JSON.stringify({
    ...emptyRpStorybookV1,
    characters: [{
      id: 'lara_miller',
      name: 'Lara Miller',
      description: '',
      personality: '',
      speechStyle: '',
      role: '',
      images: [
        {
          id: 'lara_miller_image_01',
          name: 'received.jpg',
          mimeType: 'image/jpeg',
          size: 1,
          dataUrl: 'data:image/jpeg;base64,received',
          description: 'Received copy.',
          receivedFrom: 'Robert Miller',
        },
        {
          id: 'lara_miller_image_01',
          name: 'own.jpg',
          mimeType: 'image/jpeg',
          size: 1,
          dataUrl: 'data:image/jpeg;base64,own',
          description: 'Own copy.',
        },
      ],
    }],
  }));
  assertFixture(
    new Set(normalizedDuplicateIds.characters[0]?.images.map((image) => image.id)).size ===
      (normalizedDuplicateIds.characters[0]?.images.length ?? 0),
    'storybook image normalization must avoid duplicate ids inside one character library',
  );
  const storybookWithFormattedTextImage = {
    ...emptyRpStorybookV1,
    characters: [{
      id: 'lara_miller',
      name: 'Lara Miller',
      description: '',
      personality: '',
      speechStyle: '',
      role: '',
      images: [{
        id: 'lara_miller_image_01',
        name: 'lara_miller_image_01',
        mimeType: 'image/jpeg' as const,
        size: 1,
        dataUrl: 'data:image/jpeg;base64,abc',
        description: 'Lara smiles beside the moving boxes.',
      }],
    }],
  };
  assertFixture(
    !rpStorybookFormattedText(storybookWithFormattedTextImage).includes('Character Images:') &&
      rpStorybookFormattedText(storybookWithFormattedTextImage, { characterImages: true })
        .includes('Lara smiles beside the moving boxes.'),
    'storybook formatted text settings must control whether character images are included',
  );
  const completeLivePreview = embeddedPhoneMessagesLivePreview([
    'Lara taps out a reminder.',
    '',
    '{"phoneMessages":[{"from":"Lara Miller","to":"Robert Miller","message":"Please get the heavy duty ones."}]}',
    '',
    'Robert glances at the list.',
  ].join('\n'));
  assertFixture(
    completeLivePreview.textBefore === 'Lara taps out a reminder.' &&
      completeLivePreview.textAfter === 'Robert glances at the list.' &&
      completeLivePreview.phoneMessages.length === 1 &&
      completeLivePreview.phoneMessages[0].message === 'Please get the heavy duty ones.',
    'embedded phone live preview must parse complete phoneMessages JSON into bubble data',
  );
  const incompleteLivePreview = embeddedPhoneMessagesLivePreview(
    'Lara types.\n\n{"phoneMessages":[{"from":"Lara","to":"Robert","message":"Please get',
  );
  assertFixture(
    incompleteLivePreview.text === 'Lara types.' &&
      incompleteLivePreview.phoneMessages.length === 0,
    'embedded phone live preview must hide incomplete phoneMessages JSON entirely',
  );
  const fencedLivePreview = embeddedPhoneMessagesLivePreview(
    'Lara types.\n\n```json\n{"phoneMessages":[{"from":"Lara","to":"Robert","message":"Please get',
  );
  assertFixture(
    fencedLivePreview.text === 'Lara types.' && fencedLivePreview.phoneMessages.length === 0,
    'embedded phone live preview must hide incomplete fenced phoneMessages JSON entirely',
  );
  assertFixture(
    formatAppointments([{
      id: 'appointment-1',
      scheduledAt: '2026-06-02T12:10',
      title: 'Message Alex',
      requestedBy: 'Alex',
      sourceTurnId: 'turn-1',
      status: 'upcoming',
    }], 'eu', 'de-DE') === 'Upcoming events:\n- [02.06.26 DI 12:10] Message Alex (requested by Alex)',
    'appointments must render separately from chat history',
  );
  assertFixture(
    formatAppointments([{
      id: 'event-conditional-1',
      title: 'Report back after the meeting',
      condition: 'after the meeting happened',
      details: 'Use the Phone UI to tell the user how it went.',
      channel: 'phone',
      phoneFrom: 'Lara',
      phoneTo: 'Alex',
      sourceTurnId: 'turn-2',
      sourceTurnNumber: 2,
      status: 'upcoming',
    }]) === 'Upcoming events:\n- [after the meeting happened] Report back after the meeting [phone: Lara -> Alex] - Use the Phone UI to tell the user how it went. - Turn 2',
    'conditional events must render without scheduled timestamps',
  );

  const removedCoreNodeWorkflow = structuredClone(currentWorkflow) as {
    nodes: Array<{ data: { nodeType: string } }>;
  };
  if (!removedCoreNodeWorkflow.nodes[0]) {
    throw new Error('Workflow validation fixture failed: default workflow has no nodes');
  }
  removedCoreNodeWorkflow.nodes[0].data.nodeType = 'token-estimator';

  assertFixture(
    !isWorkflowFile(removedCoreNodeWorkflow),
    'an unregistered short core node type must be rejected',
  );

  const workflowWithRuntimeData = structuredClone(currentWorkflow);
  const prompt = workflowWithRuntimeData.nodes.find((node) =>
    node.data.nodeType === 'llm-prompt' || node.data.nodeType === 'llm-prompt-switch',
  );
  if (!prompt) {
    throw new Error('Workflow validation fixture failed: default workflow has no prompt');
  }
  Object.assign(prompt.data, {
    connectionId: 'removed-connection',
    fullText: 'must not be saved',
    generatedText: 'must not be saved',
    runCompleted: true,
    llmCallStats: [{ label: 'Generate', durationMs: 1, inputTokens: 2 }],
  });
  const history = workflowWithRuntimeData.nodes.find((node) => node.data.nodeType === 'history');
  if (!history) {
    throw new Error('Workflow validation fixture failed: default workflow has no chat history');
  }
  Object.assign(history.data, {
    connectionId: 'removed-connection',
    historyTimeTrackingEnabled: true,
    historyCurrentRpDateTime: '2026-06-01T12:10',
    historyLastPrompt: 'must not be saved',
    historyLastResponse: 'must not be saved',
  });
  const eventManager = workflowWithRuntimeData.nodes.find((node) => node.data.nodeType === 'event-manager');
  if (!eventManager) {
    throw new Error('Workflow validation fixture failed: default workflow has no event manager');
  }
  Object.assign(eventManager.data, {
    connectionId: 'removed-connection',
    eventAppointments: [{
      id: 'appointment-1',
      scheduledAt: '2026-06-02T12:10',
      title: 'Message Alex',
      sourceTurnId: 'turn-1',
      sourceTurnNumber: 1,
      sourceNote: 'Turn 1: Alex asked to be messaged.',
      channel: 'phone',
      phoneFrom: 'Lara',
      phoneTo: 'Alex',
      status: 'upcoming',
    }],
    eventLastPrompt: 'must not be saved',
    eventLastResponse: 'must not be saved',
  });
  const memorySlot = workflowWithRuntimeData.nodes.find((node) => node.data.nodeType === 'memory-slot');
  if (!memorySlot) {
    throw new Error('Workflow validation fixture failed: default workflow has no wire link');
  }
  Object.assign(memorySlot.data, {
    preview: 'Stored text loaded',
    memorySlotText: 'SECRET RP MEMORY',
    fullText: 'SECRET RP MEMORY',
  });
  const storybook = workflowWithRuntimeData.nodes.find((node) => node.data.nodeType === 'rp-storybook-v1');
  if (!storybook) {
    throw new Error('Workflow validation fixture failed: default workflow has no storybook');
  }
  Object.assign(storybook.data, {
    storybookStatus: 'Loaded storybook: external.rpgraph-storybook.json',
    storybookFileName: 'external.rpgraph-storybook.json',
    storybookFilePath: '/tmp/external.rpgraph-storybook.json',
  });

  const persistedWorkflow = {
    ...workflowWithRuntimeData,
    nodes: workflowWithRuntimeData.nodes.map((node) => ({
      ...node,
      data: persistentNodeData(node.data as WorkflowNodeData),
    })),
  };
  assertFixture(isWorkflowFile(persistedWorkflow), 'registry-saved workflow must load');
  assertFixture(
    persistedWorkflow.nodes.every((node) => typeof node.data.nodeDataVersion === 'string'),
    'all saved core nodes must carry their data version',
  );
  const persistedPrompt = persistedWorkflow.nodes.find((node) =>
    node.data.nodeType === 'llm-prompt' || node.data.nodeType === 'llm-prompt-switch',
  );
  assertFixture(
    !!persistedPrompt &&
      !('fullText' in persistedPrompt.data) &&
      !('generatedText' in persistedPrompt.data) &&
      !('llmCallStats' in persistedPrompt.data) &&
      !('runCompleted' in persistedPrompt.data),
    'runtime prompt data must not be persisted',
  );
  const persistedHistory = persistedWorkflow.nodes.find((node) => node.data.nodeType === 'history');
  assertFixture(
    !!persistedHistory &&
      persistedHistory.data.historyTimeTrackingEnabled === true &&
      !('historyCurrentRpDateTime' in persistedHistory.data) &&
      !('rawHistory' in persistedHistory.data) &&
      !('originalHistory' in persistedHistory.data) &&
      !('translatedHistory' in persistedHistory.data) &&
      !('lastTurnsHistory' in persistedHistory.data) &&
      !('historyLastPrompt' in persistedHistory.data) &&
      !('historyLastResponse' in persistedHistory.data),
    'history workflow persistence must keep configuration and omit derived/runtime history data',
  );
  const persistedEventManager = persistedWorkflow.nodes.find((node) => node.data.nodeType === 'event-manager');
  assertFixture(
    !!persistedEventManager &&
      !('eventAppointments' in persistedEventManager.data) &&
      !('eventLastPrompt' in persistedEventManager.data) &&
      !('eventLastResponse' in persistedEventManager.data),
    'event manager workflow persistence must omit event runtime data',
  );
  const persistedMemorySlot = persistedWorkflow.nodes.find((node) => node.data.nodeType === 'memory-slot');
  const runtimeSnapshot = captureTurnRuntime(workflowWithRuntimeData.nodes as WorkflowNode[]);
  assertFixture(
    !!persistedMemorySlot &&
      persistedMemorySlot.data.memorySlotText === '' &&
      persistedMemorySlot.data.fullText === '' &&
      runtimeSnapshot.nodes[memorySlot.id]?.memorySlotText === 'SECRET RP MEMORY' &&
      runtimeSnapshot.nodes[memorySlot.id]?.fullText === 'SECRET RP MEMORY',
    'wire link text must be omitted from workflow saves but retained in RP runtime snapshots',
  );
  assertFixture(
    !('historyLastPrompt' in runtimeSnapshot.nodes[history.id]!) &&
      !('historyLastResponse' in runtimeSnapshot.nodes[history.id]!) &&
      !('eventLastPrompt' in runtimeSnapshot.nodes[eventManager.id]!) &&
      !('eventLastResponse' in runtimeSnapshot.nodes[eventManager.id]!),
    'turn runtime snapshots must omit bounded debug prompt and response fields',
  );
  const persistedStorybook = persistedWorkflow.nodes.find((node) => node.data.nodeType === 'rp-storybook-v1');
  assertFixture(
    !!persistedStorybook &&
      typeof persistedStorybook.data.storybookJson === 'string' &&
      persistedStorybook.data.storybookFormattedTextSettings?.characterImages === false &&
      !('storybookText' in persistedStorybook.data) &&
      !('storybookFileName' in persistedStorybook.data) &&
      !('storybookFilePath' in persistedStorybook.data),
    'storybook workflow persistence must embed JSON, keep output settings, and omit derived text and external file references',
  );
  const hydratedStorybook = persistedStorybook
    ? hydrateNodeData(persistedStorybook.data, {
        defaultConnectionId: 'active-default',
        connectionIds: new Set(['active-default']),
      })
    : undefined;
  assertFixture(
    !!hydratedStorybook &&
      typeof hydratedStorybook.storybookJson === 'string' &&
      !('storybookText' in hydratedStorybook),
    'storybook hydration must keep formatted storybook text derived on demand',
  );
  const hydratedPrompt = persistedPrompt
    ? hydrateNodeData(persistedPrompt.data, {
        defaultConnectionId: 'active-default',
        connectionIds: new Set(['active-default']),
      })
    : undefined;
  assertFixture(
    hydratedPrompt?.connectionId === 'active-default',
    'hydration must replace a missing connection with the active default',
  );

  const missingPluginData: Record<string, unknown> & {
    pluginConfiguration: { collection: string; topK: number };
  } = {
    nodeType: 'com.example.memory/vector-search',
    nodeDataVersion: '1.0.0',
    label: 'Vector Search',
    description: 'Installed separately',
    preview: 'Plugin unavailable',
    portsSnapshot: [
      { id: 'query', direction: 'input', valueType: 'text', label: 'Query' },
      { id: 'result', direction: 'output', valueType: 'text', label: 'Result' },
    ],
    pluginConfiguration: { collection: 'story-memory', topK: 4 },
  };
  const workflowWithMissingPlugin = structuredClone(currentWorkflow) as Record<string, unknown> & {
    nodes: unknown[];
    edges: unknown[];
  };
  workflowWithMissingPlugin.nodes.push({
    id: 'missing-vector-search',
    type: 'workflow',
    position: { x: 1, y: 2 },
    data: missingPluginData,
  });
  workflowWithMissingPlugin.edges.push({
    id: 'missing-plugin-edge',
    source: 'missing-vector-search',
    sourceHandle: 'result',
    target: 'rp-output',
    targetHandle: null,
  });
  assertFixture(
    isWorkflowFile(workflowWithMissingPlugin),
    'a namespaced missing plugin node with valid port snapshots must load',
  );
  const hydratedMissing = hydrateNodeData(missingPluginData, {
    defaultConnectionId: 'active-default',
    connectionIds: new Set(['active-default']),
  });
  assertFixture(
    hydratedMissing.kind === 'missing-plugin-node',
    'a missing plugin node must hydrate as a placeholder',
  );
  assertFixture(
    JSON.stringify(persistentNodeData(hydratedMissing)) === JSON.stringify(missingPluginData),
    'a missing plugin node must save its original data unchanged',
  );
  assertFixture(
    workflowWithMissingPlugin.edges.some(
      (edge) => (edge as { id?: string }).id === 'missing-plugin-edge',
    ),
    'edges connected to a missing plugin node must be retained',
  );

  const versionHydrateContext = {
    defaultConnectionId: 'active-default',
    connectionIds: new Set(['active-default']),
  };
  const inputData = currentWorkflow.nodes.find((node) => node.data.nodeType === 'input')?.data;
  if (!inputData) {
    throw new Error('Workflow validation fixture failed: default workflow has no input');
  }
  const identicalVersion = hydrateNodeData(
    { ...inputData, nodeDataVersion: '1.8.1' },
    versionHydrateContext,
  );
  assertFixture(
    identicalVersion.kind === undefined && identicalVersion.nodeDataVersion === '1.8.1',
    'an identical core node version must hydrate normally',
  );
  const patchVersion = hydrateNodeData(
    { ...inputData, nodeDataVersion: '1.8.2' },
    versionHydrateContext,
  );
  assertFixture(
    patchVersion.kind === undefined && patchVersion.nodeDataVersion === '1.8.1',
    'a patch-only core node difference must hydrate normally',
  );
  const minorVersion = hydrateNodeData(
    { ...inputData, nodeDataVersion: '1.9.0' },
    versionHydrateContext,
  );
  assertFixture(
    minorVersion.kind === 'incompatible-core-node' &&
      minorVersion.nodeDataVersion === '1.9.0' &&
      minorVersion.currentNodeVersion === '1.8.1',
    'a minor core node difference must hydrate as an incompatible placeholder',
  );
  const majorVersion = hydrateNodeData(
    { ...inputData, nodeDataVersion: '2.0.0' },
    versionHydrateContext,
  );
  assertFixture(
    majorVersion.kind === 'incompatible-core-node' &&
      majorVersion.nodeDataVersion === '2.0.0' &&
      majorVersion.currentNodeVersion === '1.8.1',
    'a major core node difference must hydrate as an incompatible placeholder',
  );

  const workflowWithInvalidVersion = structuredClone(currentWorkflow);
  workflowWithInvalidVersion.nodes[0]!.data.nodeDataVersion =
    '1.0' as unknown as WorkflowNodeData['nodeDataVersion'];
  assertFixture(
    !isWorkflowFile(workflowWithInvalidVersion),
    'an invalid node version string must be rejected',
  );

  const workflowWithIncompatibleNode = structuredClone(currentWorkflow);
  workflowWithIncompatibleNode.nodes[0]!.data.nodeDataVersion = '1.9.0';
  assertFixture(
    isWorkflowFile(workflowWithIncompatibleNode),
    'a workflow with an incompatible core node version must remain loadable',
  );
  if (!isWorkflowFile(workflowWithIncompatibleNode)) {
    throw new Error('Workflow validation fixture failed: incompatible workflow validation changed');
  }
  const loadedNodes = workflowWithIncompatibleNode.nodes.map((node) => ({
    ...node,
    data: hydrateNodeData(node.data, versionHydrateContext),
  }));
  const filteredEdges = removeEdgesConnectedToIncompatibleNodes(
    loadedNodes,
    workflowWithIncompatibleNode.edges,
  );
  assertFixture(
    filteredEdges.every((edge) => edge.source !== 'user-input' && edge.target !== 'user-input') &&
      filteredEdges.length < workflowWithIncompatibleNode.edges.length,
    'edges connected to an incompatible core node must be removed',
  );

  const workflowWithOldStorybookNode = structuredClone(currentWorkflow);
  const oldStorybookNode = workflowWithOldStorybookNode.nodes.find(
    (node) => node.data.nodeType === 'rp-storybook-v1',
  );
  if (!oldStorybookNode) {
    throw new Error('Workflow validation fixture failed: missing storybook node');
  }
  oldStorybookNode.data.nodeDataVersion = '1.12.0';
  oldStorybookNode.data.storybookJson = JSON.stringify({
    ...emptyRpStorybookV1,
    version: '1.15.0',
  });
  assertFixture(
    isWorkflowFile(workflowWithOldStorybookNode),
    'a workflow with an old storybook node must remain loadable',
  );
  const oldStorybookHydrated = hydrateNodeData(oldStorybookNode.data, versionHydrateContext);
  assertFixture(
    oldStorybookHydrated.kind === 'incompatible-core-node' &&
      oldStorybookHydrated.nodeDataVersion === '1.12.0' &&
      oldStorybookHydrated.currentNodeVersion === currentCoreNodeVersions['rp-storybook-v1'],
    'an old storybook node must hydrate as an incompatible placeholder before parsing old storybook JSON',
  );

  const corruptedStorybookNode = structuredClone(oldStorybookNode);
  corruptedStorybookNode.data.nodeDataVersion = currentCoreNodeVersions['rp-storybook-v1'];
  corruptedStorybookNode.data.storybookJson = '{invalid json';
  assertThrowsFixture(
    () => hydrateNodeData(corruptedStorybookNode.data, versionHydrateContext),
    'a corrupted current-version storybook must fail hydration instead of silently becoming incompatible',
  );

  const longTraceTextInput = [
    ...Array.from({ length: 140 }, (_, index) => `Older context sentence ${index + 1} about party planning.`),
    'Emily Miller texts Sarah Miller: And are you ready? What did you put on?',
  ].join(' ');
  const turnTraceNode = {
    id: 'turn-trace-prompt-switch',
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: {
      label: 'Trace Prompt Switch',
      description: '',
      preview: '',
      nodeType: 'llm-prompt-switch',
      llmPromptSwitchDebug: {
        inputValue: 'large input omitted from the trace',
        promptBefore: 'Before prompt',
        promptAfter: 'A'.repeat(500),
        combinedPrompt: '',
        promptPasses: [
          {
            label: 'Initial action prompt',
            sections: [
              {
                label: 'Text Input',
                text: longTraceTextInput,
                parts: [{ text: longTraceTextInput }],
              },
              {
                label: 'Prompt After Input',
                text: `${'A'.repeat(500)}\n\nStored character image search is available`,
                parts: [
                  { text: 'A'.repeat(500) },
                  { text: 'Stored character image search is available', actionInserted: true },
                ],
              },
            ],
          },
          {
            label: 'Action follow-up: Get character phone image list',
            sections: [
              {
                label: 'Text Input',
                text: longTraceTextInput,
                parts: [{ text: longTraceTextInput }],
              },
              {
                label: 'Prompt After Input (Action Follow-Up)',
                text: 'Action follow-up: search stored character phone images\n\nFirst-pass plan:\nFind Sarah mirror selfies.',
                parts: [{
                  text: 'Action follow-up: search stored character phone images\n\nFirst-pass plan:\nFind Sarah mirror selfies.',
                  actionInserted: true,
                }],
              },
            ],
          },
          {
            label: 'Action replay 1',
            sections: [
              {
                label: 'Text Input',
                text: longTraceTextInput,
                parts: [{ text: longTraceTextInput }],
              },
              {
                label: 'Prompt After Input',
                text: `${'A'.repeat(500)}\n\nImage ID list:\n- img-1: Sarah mirror selfie`,
                parts: [
                  { text: 'A'.repeat(500) },
                  { text: 'Image ID list:\n- img-1: Sarah mirror selfie', actionInserted: true },
                ],
              },
            ],
          },
        ],
        outputPasses: [
          { label: 'Initial action output', text: '{"action":"get_image_id","plan":"Find Sarah mirror selfies."}' },
          { label: 'Action follow-up output: Get character phone image list', text: '{"action":"get_image_id","characters":"Sarah","tags":"mirror,selfie"}' },
          { label: 'Action replay 1 output', text: '{"from":"Sarah","to":"Emily","message":"I found one.","sendImageId":"img-1"}' },
        ],
        actionResults: ['Image ID list:\n- img-1: Sarah mirror selfie'],
        generatedText: 'AI reply',
        selectedOutputChannel: 2,
        selectedPromptSlot: 3,
        outputChannelValue: '2',
        promptSlotValue: '3',
      },
    },
  } as WorkflowNode;
  const tracedTurn: TurnRecord = {
    id: 'trace-turn-40',
    number: 40,
    createdAt: '2026-06-27T12:00:00.000Z',
    mode: 'user',
    messageFormat: 1,
    promptSlot: 3,
    input: {
      graphText: 'duplicated graph input',
      messages: [{
        id: 100,
        role: 'user',
        originalText: 'Show me the picture.',
        includeInHistory: true,
        channel: 'phone',
        phoneMessage: true,
        phoneFrom: 'Emily',
        phoneTo: 'Sarah',
        imageAttachments: [{
          id: 'private-image',
          name: 'private.png',
          mimeType: 'image/png',
          size: 10,
          dataUrl: 'data:image/png;base64,SECRET',
        }],
      }],
    },
    output: {
      graphText: '',
      messages: [{
        id: 101,
        role: 'output',
        originalText: 'Here it is.',
        includeInHistory: true,
        channel: 'phone',
        phoneMessage: true,
        phoneFrom: 'Sarah',
        phoneTo: 'Emily',
      }],
    },
  };
  const turnTrace = createTurnTrace({
    turn: tracedTurn,
    run: {
      runId: 'trace-run-40',
      startedAt: '2026-06-27T12:00:01.000Z',
      calls: [
        {
          order: 1,
          nodeId: turnTraceNode.id,
          nodeLabel: turnTraceNode.data.label,
          label: 'Phone / Reply',
        },
        {
          order: 2,
          nodeId: turnTraceNode.id,
          nodeLabel: turnTraceNode.data.label,
          label: 'Phone / Reply / Action follow-up: Get character phone image list',
        },
        {
          order: 3,
          nodeId: turnTraceNode.id,
          nodeLabel: turnTraceNode.data.label,
          label: 'Phone / Reply / Action replay 1',
        },
      ],
    },
    nodes: [turnTraceNode],
    status: 'completed',
    warnings: ['Prompt fallback used.', 'Prompt fallback used.'],
    traceEvents: [
      {
        kind: 'warning',
        nodeId: turnTraceNode.id,
        nodeLabel: turnTraceNode.data.label,
        nodeType: 'llm-prompt-switch',
        message: 'Prompt slot fallback used.',
      },
      {
        kind: 'format',
        nodeId: turnTraceNode.id,
        nodeLabel: turnTraceNode.data.label,
        nodeType: 'llm-prompt-switch',
        name: 'Phone Message JSON',
        status: 'ok',
        detail: 'Sarah → Emily',
      },
      {
        kind: 'format',
        nodeId: 'rp-output',
        nodeLabel: 'RP Output',
        nodeType: 'output',
        name: 'Output Actions JSON',
        status: 'error',
        detail: 'Could not parse JSON.',
        preview: 'not json',
      },
    ],
    completedAt: '2026-06-27T12:00:02.000Z',
  });
  assertFixture(
    turnTrace.channel === 'phone' &&
      turnTrace.input.messages[0]?.imageCount === 1 &&
      !JSON.stringify(turnTrace).includes('SECRET'),
    'turn traces must retain useful phone/image metadata without storing image data',
  );
  assertFixture(
    turnTrace.steps[0]?.selectedOutputChannel === 2 &&
      turnTrace.steps[0]?.selectedPromptSlot === 3 &&
      turnTrace.steps[0]?.promptAfter === 'A'.repeat(500) &&
      turnTrace.steps[0]?.promptPasses?.[0]?.sections?.[0]?.excerpt?.kind === 'last-text-input-words' &&
      turnTrace.steps[0]?.promptPasses?.[0]?.sections?.[0]?.text.includes('What did you put on?') === true &&
      turnTrace.steps[0]?.promptPasses?.[0]?.sections?.[0]?.text.includes('Older context sentence 1 about party planning.') === false &&
      turnTrace.steps[0]?.promptPasses?.[0]?.sections?.[1]?.parts?.[1]?.actionInserted === true &&
      turnTrace.steps[1]?.promptAfter === undefined &&
      turnTrace.steps[1]?.promptPasses?.[0]?.prompt.includes('First-pass plan:') === true &&
      turnTrace.steps[2]?.promptPasses?.[0]?.prompt.includes('img-1: Sarah mirror selfie') === true,
    'turn traces must identify the Prompt Switch route, include full action prompt passes, and excerpt long text input',
  );
  assertFixture(
    !!turnTrace.steps[0]?.warnings?.includes('Prompt slot fallback used.') &&
      turnTrace.steps[0]?.formatResults?.[0]?.name === 'Phone Message JSON' &&
      turnTrace.steps.some((step) =>
        step.nodeId === 'rp-output' &&
        step.formatResults?.[0]?.status === 'error' &&
        step.formatResults[0].preview === 'not json',
      ),
    'turn traces must attach node warnings and parse results to the relevant route step',
  );
  assertFixture(
    turnTrace.warnings?.length === 1 &&
      turnTraceCopyPayload([turnTrace]).range.fromTurn === 40 &&
      turnTraceCopyPayload([turnTrace]).version === 4 &&
      turnTraceCopyPayload([turnTrace]).privacy === 'memory-only' &&
      JSON.stringify(turnTraceCopyPayload([turnTrace])).includes('Text Input excerpt: showing the last') &&
      !JSON.stringify(turnTraceCopyPayload([turnTrace])).includes('Older context sentence 1 about party planning.') &&
      JSON.stringify(turnTraceCopyPayload([turnTrace])).includes('Stored character image search is available') &&
      JSON.stringify(turnTraceCopyPayload([turnTrace])).includes('First-pass plan:') &&
      JSON.stringify(turnTraceCopyPayload([turnTrace])).includes('img-1: Sarah mirror selfie') &&
      !JSON.stringify(turnTraceCopyPayload([turnTrace])).includes('inputTokens') &&
      !JSON.stringify(turnTraceCopyPayload([turnTrace])).includes('totalTokens') &&
      !JSON.stringify(turnTraceCopyPayload([turnTrace])).includes('durationMs'),
    'turn trace copy payloads must expose a compact memory-only range without token or timing stats',
  );

  const inputDefinition = getRegisteredCoreNode('input');
  if (!inputDefinition) {
    throw new Error('Workflow validation fixture failed: input definition is not registered');
  }
  const outputDefinition = getRegisteredCoreNode('output');
  assertFixture(
    outputDefinition?.ports?.({} as WorkflowNode['data']).some((port) =>
      port.direction === 'input' && port.id === 'autoplay' && port.valueType === 'text'
    ) === true,
    'the RP Output definition must expose a dedicated Autoplay text input',
  );
  assertThrowsFixture(
    () => registerNode(inputDefinition),
    'the registry must reject duplicate node type ids',
  );
  assertThrowsFixture(
    () => registerNode({ type: 'llm-prompt', origin: 'plugin' } as NodeCreationDefinition),
    'plugins must not register under core-style type ids',
  );
  assertThrowsFixture(
    () => registerNode({
      type: 'com.example.invalid/version',
      dataVersion: '1',
      origin: 'plugin',
    } as unknown as NodeCreationDefinition),
    'the registry must reject invalid node version strings',
  );
}

async function verifyPromptRunFixtures() {
  const tracedExistingImageId = 'helga_harper_image_06';
  const tracedCreateCall = parsePromptActionCall(
    `{"action":"update_phone_image_caption","imageId":"${tracedExistingImageId}","imageAction":"create","caption":"Rewritten caption that should not be stored."}`,
  );
  const tracedCaptionResult = tracedCreateCall
    ? await executePromptAction(
        {
          inputImages: [{
            id: tracedExistingImageId,
            name: tracedExistingImageId,
            mimeType: 'image/jpeg',
            size: 1,
            dataUrl: 'data:image/jpeg;base64,trace',
            description: 'Espen Harper stands in a doorway carrying grocery bags filled with drinks and snacks.',
          }],
        } as unknown as ExecuteContext,
        defaultPromptActionConfig('Update phone image caption', 'updatePhoneImageCaption'),
        tracedCreateCall,
      )
    : undefined;
  const tracedCaptionRecord = JSON.parse(tracedCaptionResult?.finalOutputText ?? '{}') as Record<string, unknown>;
  assertFixture(
    tracedCaptionRecord.imageId === tracedExistingImageId &&
      tracedCaptionRecord.imageAction === 'no_change' &&
      tracedCaptionRecord.caption === undefined,
    'after-reply caption actions must turn an invalid create decision for an already captioned input image into no_change',
  );

  const sentImageId = 'sarah_miller_image_01';
  const sentImageDataUrl = 'data:image/jpeg;base64,a';
  const imageListContext = {
    nodes: [{
      id: 'fixture-storybook-images',
      type: 'workflow',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'rp-storybook-v1',
        storybookJson: JSON.stringify({
          ...emptyRpStorybookV1,
          characters: [{
            id: 'sarah-miller',
            name: 'Sarah Miller',
            description: '',
            personality: '',
            speechStyle: '',
            role: '',
            images: [{
              id: sentImageId,
              name: sentImageId,
              mimeType: 'image/jpeg',
              size: 1,
              dataUrl: sentImageDataUrl,
              description: 'Sarah takes a smiling mirror selfie in her party outfit.',
            }],
          }],
        }),
      },
    } as WorkflowNode],
    historyMessages: [
      {
        id: 1,
        role: 'output',
        originalText: 'Look at this.',
        channel: 'phone',
        phoneMessage: true,
        phoneFrom: 'Sarah Miller',
        phoneTo: 'Emily Miller',
        phoneImageIds: [sentImageId],
      },
      {
        id: 2,
        role: 'output',
        originalText: 'This was yesterday.',
        channel: 'phone',
        phoneMessage: true,
        phoneFrom: 'Sarah Miller',
        phoneTo: 'Ryan Parker',
        imageAttachments: [{
          id: sentImageId,
          name: sentImageId,
          mimeType: 'image/jpeg',
          size: 1,
          dataUrl: sentImageDataUrl,
        }],
      },
    ] as MessageRecord[],
  } as unknown as ExecuteContext;
  const imageListResult = await executePromptAction(
    imageListContext,
    defaultPromptActionConfig('Get character phone image list', 'getImageId'),
    {
      action: 'getImageId',
      characters: 'Sarah Miller',
      tags: 'mirror, selfie, party, outfit',
    },
    { visionEnabled: true },
  );
  const hiddenImageTextResult = await executePromptAction(
    imageListContext,
    {
      ...defaultPromptActionConfig('Get character phone image list', 'getImageId'),
      hideImageTextWhenSendingToLlm: true,
    },
    {
      action: 'getImageId',
      characters: 'Sarah Miller',
      tags: 'mirror, selfie, party, outfit',
    },
    { visionEnabled: true },
  );
  assertFixture(
    imageListResult.images.length === 1 &&
      imageListResult.text.includes(
        `* Image 1: ${sentImageId} : Sarah takes a smiling mirror selfie in her party outfit. : Image shown to: Emily Miller, Ryan Parker`,
      ) &&
      imageListResult.text.includes('Do not send a returned image again') &&
      hiddenImageTextResult.text.includes(
        `* Image 1: ${sentImageId} : Image shown to: Emily Miller, Ryan Parker`,
      ) &&
      !hiddenImageTextResult.text.includes('Sarah takes a smiling mirror selfie'),
    'image list action results must identify prior phone recipients with visible or hidden image text and warn against resending',
  );

  const warnings: string[] = [];
  const llmOutputs = [
    '{"action":"describe_input_image","caption":"Ryan and Espen share a look at the party."}',
    'Espen grins and grabs the phone.',
  ];
  let llmCalls = 0;
  const context = {
    nodes: [],
    edges: [],
    historyMessages: [],
    comfyProviderIds: [],
    providerHealthById: {},
    llm: {
      supportsVision: async () => true,
      complete: async () => {
        llmCalls += 1;
        return { text: llmOutputs.shift() ?? '', connection: { label: 'Fixture LLM' } };
      },
    },
    reportWarning: (message: string) => warnings.push(message),
    updateRuntimeData: () => {},
  } as unknown as ExecuteContext;
  const node = {
    id: 'fixture-prompt',
    data: { label: 'Fixture Prompt', connectionId: 'fixture-connection' },
  } as WorkflowNode;
  const result = await runActionAwarePrompt({
    node,
    context,
    inputValue: 'Helga shows the picture.',
    images: [{
      id: 'img-1',
      name: 'RP Picture 01',
      mimeType: 'image/png',
      size: 1,
      dataUrl: 'data:image/png;base64,a',
    }],
    referenceImages: [],
    promptBefore: '',
    promptAfter: 'Write the story.\n\n@action:Describe input image (After Reply Action)',
    actionConfigs: [defaultPromptActionConfig('Describe input image', 'describeInputImage')],
    streamsVisibleOutput: false,
    contributesToTokenCalibration: false,
    callLabel: () => 'Fixture call',
  });
  assertFixture(
    llmCalls === 2 && warnings.length === 0,
    'a premature after-reply caption call must be consumed without warnings or an extra after-reply pass',
  );
  assertFixture(
    result.generatedText.startsWith('Espen grins and grabs the phone.') &&
      result.generatedText.includes('"image": "Ryan and Espen share a look at the party."'),
    'a premature after-reply caption call must keep the visible reply and append the image metadata',
  );

  const runStreamingScenario = async (llmTexts: string[]) => {
    const streamedChunks: string[] = [];
    const promptsForCalls: string[] = [];
    const streamContext = {
      nodes: [],
      edges: [],
      historyMessages: [],
      comfyProviderIds: [],
      providerHealthById: {},
      llm: {
        supportsVision: async () => true,
        complete: async (request: { prompt: string; onChunk?: (text: string) => void }) => {
          promptsForCalls.push(request.prompt);
          const llmText = llmTexts.shift() ?? '';
          for (let end = 4; end <= llmText.length; end += Math.max(8, llmText.length >> 2)) {
            request.onChunk?.(llmText.slice(0, end));
          }
          if (llmText) {
            request.onChunk?.(llmText);
          }
          return { text: llmText, connection: { label: 'Fixture LLM' } };
        },
      },
      streamOutput: (text: string) => streamedChunks.push(text),
      reportWarning: () => {},
      updateRuntimeData: () => {},
    } as unknown as ExecuteContext;
    const streamResult = await runActionAwarePrompt({
      node: {
        id: 'fixture-stream',
        data: { label: 'Fixture Stream', connectionId: 'fixture-connection' },
      } as WorkflowNode,
      context: streamContext,
      inputValue: 'Narrator: Espen checks her phone.',
      images: [],
      referenceImages: [],
      promptBefore: '',
      promptAfter: 'Write the story.\n\n@action:Get character phone image list',
      actionConfigs: [defaultPromptActionConfig('Get character phone image list', 'getImageId')],
      streamsVisibleOutput: true,
      contributesToTokenCalibration: false,
      callLabel: () => 'Fixture call',
    });
    return { streamedChunks, promptsForCalls, streamResult };
  };
  const proseScenario = await runStreamingScenario([
    'Espen laughs and pockets her phone before anyone notices.',
  ]);
  assertFixture(
    proseScenario.streamedChunks.length > 0 &&
      proseScenario.streamedChunks[proseScenario.streamedChunks.length - 1] ===
        'Espen laughs and pockets her phone before anyone notices.' &&
      proseScenario.streamResult.generatedText === 'Espen laughs and pockets her phone before anyone notices.',
    'a prose reply must stream live even while a pre-reply action is still pending',
  );
  assertFixture(
    proseScenario.promptsForCalls[0]?.includes('Stored character image search is available') &&
      !proseScenario.promptsForCalls[0]?.includes('Action follow-up: search stored character phone images'),
    'pending pre-reply actions must show only their compact first-pass hint',
  );
  const actionCallScenario = await runStreamingScenario([
    '{"action":"get_image_id","plan":"Find a stored Espen party selfie that shows her outfit."}',
    '{"action":"get_image_id","characters":"Espen Harper","tags":"selfie, mirror, party, outfit, bedroom, phone, smiling, evening, indoor, portrait"}',
    'Espen scrolls to the party photo and smirks.',
  ]);
  assertFixture(
    actionCallScenario.streamedChunks.every((chunk) => !chunk.includes('{')) &&
      actionCallScenario.streamResult.generatedText === 'Espen scrolls to the party photo and smirks.',
    'an action call must never be streamed into the visible chat while the replay reply still streams',
  );
  assertFixture(
    actionCallScenario.promptsForCalls.length === 3 &&
      actionCallScenario.promptsForCalls[0]?.includes('Stored character image search is available') &&
      actionCallScenario.promptsForCalls[1]?.includes('Action follow-up: search stored character phone images') &&
      actionCallScenario.promptsForCalls[1]?.includes('Find a stored Espen party selfie that shows her outfit.') &&
      !actionCallScenario.promptsForCalls[1]?.includes('Write the story.') &&
      actionCallScenario.promptsForCalls[2]?.includes('Action executed: get character phone image list.') &&
      !actionCallScenario.promptsForCalls[2]?.includes('Stored character image search is available'),
    'pre-reply image actions must run as compact request, focused follow-up, and result replay passes',
  );
}

async function verifyDirectActionsGraphFixture() {
  const inputNode = currentWorkflow.nodes.find((node) => node.data.nodeType === 'input');
  const outputNode = currentWorkflow.nodes.find((node) => node.data.nodeType === 'output');
  if (!inputNode || !outputNode) {
    throw new Error('Workflow validation fixture failed: default workflow has no chat endpoints');
  }
  const directJson = '{"bankTransfers":[{"from":"Espen Harper","to":"Ryan Parker","amount":20}]}';
  let llmCalls = 0;
  const result = await executeGraph({
    outputNodeId: outputNode.id,
    outputSourceHandle: 'direct-actions',
    nodes: [inputNode, outputNode],
    edges: [{
      id: 'direct-actions-fixture',
      source: inputNode.id,
      sourceHandle: 'direct-actions',
      target: outputNode.id,
      targetHandle: 'direct-actions',
    }],
    originalInput: directJson,
    originalHistory: '',
    translatedHistory: '',
    llm: new NodeLlmApi({
      resolveConnection: async () => {
        llmCalls += 1;
        throw new Error('Direct Actions must not call an LLM.');
      },
    }),
    textMetrics: new TextMetricsApi(4),
    updateRuntimeNode: () => undefined,
  });
  assertFixture(
    result === directJson && llmCalls === 0,
    'a direct action must cross the graph without calling an LLM',
  );

  let auxiliaryDirectActions = 'not evaluated';
  const autoplayControlText = '[AUTOPLAY]\nPlayer-controlled character: Helga Harper';
  const normalResult = await executeGraph({
    outputNodeId: outputNode.id,
    nodes: [inputNode, outputNode],
    edges: [
      {
        id: 'normal-input-fixture',
        source: inputNode.id,
        target: outputNode.id,
      },
      {
        id: 'auxiliary-direct-actions-fixture',
        source: inputNode.id,
        sourceHandle: 'direct-actions',
        target: outputNode.id,
        targetHandle: 'direct-actions',
      },
    ],
    originalInput: autoplayControlText,
    originalHistory: '',
    translatedHistory: '',
    auxiliaryOutputHandles: ['direct-actions'],
    onAuxiliaryOutput: (handle, text) => {
      if (handle === 'direct-actions') {
        auxiliaryDirectActions = text;
      }
    },
    llm: new NodeLlmApi({
      resolveConnection: async () => {
        throw new Error('The Direct Actions filter fixture must not call an LLM.');
      },
    }),
    textMetrics: new TextMetricsApi(4),
    updateRuntimeNode: () => undefined,
  });
  assertFixture(
    normalResult === autoplayControlText && auxiliaryDirectActions === '',
    'an Autoplay control block must not be mistaken for Direct Actions JSON',
  );

  // Even valid action JSON typed into the normal chat must not reach the
  // Direct Actions path: the User Input output only carries data on explicit
  // direct-only runs.
  auxiliaryDirectActions = 'not evaluated';
  const normalJsonResult = await executeGraph({
    outputNodeId: outputNode.id,
    nodes: [inputNode, outputNode],
    edges: [
      {
        id: 'normal-json-input-fixture',
        source: inputNode.id,
        target: outputNode.id,
      },
      {
        id: 'auxiliary-json-direct-actions-fixture',
        source: inputNode.id,
        sourceHandle: 'direct-actions',
        target: outputNode.id,
        targetHandle: 'direct-actions',
      },
    ],
    originalInput: directJson,
    originalHistory: '',
    translatedHistory: '',
    auxiliaryOutputHandles: ['direct-actions'],
    onAuxiliaryOutput: (handle, text) => {
      if (handle === 'direct-actions') {
        auxiliaryDirectActions = text;
      }
    },
    llm: new NodeLlmApi({
      resolveConnection: async () => {
        throw new Error('The valid-JSON Direct Actions filter fixture must not call an LLM.');
      },
    }),
    textMetrics: new TextMetricsApi(4),
    updateRuntimeNode: () => undefined,
  });
  assertFixture(
    normalJsonResult === directJson && auxiliaryDirectActions === '',
    'valid action JSON in a normal run must not trigger the Direct Actions path',
  );

  const autoplayText = 'Ryan glances toward the kitchen. "They are still talking in there."';
  const autoplayResult = await executeGraph({
    outputNodeId: outputNode.id,
    outputSourceHandle: 'autoplay',
    nodes: [inputNode, outputNode],
    edges: [{
      id: 'autoplay-output-fixture',
      source: inputNode.id,
      target: outputNode.id,
      targetHandle: 'autoplay',
    }],
    originalInput: autoplayText,
    originalHistory: '',
    translatedHistory: '',
    llm: new NodeLlmApi({
      resolveConnection: async () => {
        throw new Error('The Autoplay output fixture must not call an LLM.');
      },
    }),
    textMetrics: new TextMetricsApi(4),
    updateRuntimeNode: () => undefined,
  });
  assertFixture(
    autoplayResult === autoplayText,
    'the dedicated Autoplay input must preserve plain RP text like Normal RP',
  );
}

function verifyDirectAppActionPayloadFixtures() {
  const noteCommit = {
    characterId: 'sarah',
    characterName: 'Sarah Miller',
    operation: 'update' as const,
    note: {
      id: 'note-manual-1',
      title: 'Groceries',
      text: 'Milk, bread',
      dayLabel: 'Sun 12 July',
      color: 'mint' as const,
    },
  };
  const noteJson = directAppActionJson({ kind: 'createdPhoneNote', commit: noteCommit });
  const parsedNote = parseOutputActions(noteJson, { phoneAppCommits: true });
  assertFixture(
    parsedNote.warnings.length === 0 &&
      parsedNote.createdPhoneNoteCommits.length === 1 &&
      parsedNote.createdPhoneNoteCommits[0]?.operation === 'update' &&
      parsedNote.createdPhoneNoteCommits[0].note.id === 'note-manual-1' &&
      parsedNote.createdPhoneNoteCommits[0].note.color === 'mint',
    'a manual phone note payload must round-trip through the Direct Actions parser',
  );
  assertFixture(
    createdPhoneNoteActionVerb(noteCommit) === 'updated' &&
      createdPhoneNoteActionVerb({ ...noteCommit, operation: 'create' }) === 'created',
    'phone note cards and history must distinguish update and create operations',
  );
  const parsedNoteWithoutOption = parseOutputActions(noteJson);
  assertFixture(
    parsedNoteWithoutOption.createdPhoneNoteCommits.length === 0 &&
      parsedNoteWithoutOption.warnings.length === 1,
    'phone note commits must be rejected outside direct app action runs',
  );
  const invalidNoteJson = JSON.stringify({
    createdPhoneNotes: [{
      ...noteCommit,
      note: { ...noteCommit.note, color: 'ultraviolet' },
    }],
  });
  const parsedInvalidNote = parseOutputActions(invalidNoteJson, { phoneAppCommits: true });
  assertFixture(
    parsedInvalidNote.createdPhoneNoteCommits.length === 0 &&
      parsedInvalidNote.warnings.length === 1,
    'an invalid phone note payload must be rejected with a warning and produce no commit',
  );
  assertFixture(
    phoneNoteContentMatches(
      noteCommit.note,
      { ...noteCommit.note, color: 'rose', dayLabel: 'Mon 13 July' },
    ),
    'note content comparison must ignore color and day-label presentation changes',
  );

  const deletedNoteCommit = {
    characterId: noteCommit.characterId,
    characterName: noteCommit.characterName,
    note: noteCommit.note,
  };
  const deletedNoteJson = directAppActionJson({
    kind: 'deletedPhoneNote',
    commit: deletedNoteCommit,
  });
  const parsedDeletedNote = parseOutputActions(deletedNoteJson, { phoneAppCommits: true });
  assertFixture(
    parsedDeletedNote.warnings.length === 0 &&
      parsedDeletedNote.deletedPhoneNoteCommits.length === 1 &&
      parsedDeletedNote.deletedPhoneNoteCommits[0]?.note.id === noteCommit.note.id,
    'a deleted phone note payload must round-trip through the Direct Actions parser',
  );
  const parsedDeletedNoteWithoutOption = parseOutputActions(deletedNoteJson);
  assertFixture(
    parsedDeletedNoteWithoutOption.deletedPhoneNoteCommits.length === 0 &&
      parsedDeletedNoteWithoutOption.warnings.length === 1,
    'deleted phone notes must be rejected outside direct app action runs',
  );
  const invalidDeletedNote = parseOutputActions(JSON.stringify({
    deletedPhoneNotes: [{
      characterId: 'sarah',
      characterName: 'Sarah Miller',
      note: { id: 'note-manual-1' },
    }],
  }), { phoneAppCommits: true });
  assertFixture(
    invalidDeletedNote.deletedPhoneNoteCommits.length === 0 &&
      invalidDeletedNote.warnings.length === 1,
    'an incomplete deleted phone note payload must not produce a state commit',
  );

  const chatCommit = {
    characterId: 'sarah',
    characterName: 'Sarah Miller',
    chat: {
      id: 'chatgpd-manual-1',
      title: 'Tomatoes',
      createdAt: '2026-07-12T10:00:00.000Z',
      messages: [
        { role: 'user' as const, text: 'Are tomatoes fruit?' },
        { role: 'assistant' as const, text: 'Botanically, yes.' },
      ],
    },
  };
  const chatJson = directAppActionJson({ kind: 'simulatedAiChat', commit: chatCommit });
  const parsedChat = parseOutputActions(chatJson, { phoneAppCommits: true });
  assertFixture(
    parsedChat.warnings.length === 0 &&
      parsedChat.simulatedAiChatCommits.length === 1 &&
      parsedChat.simulatedAiChatCommits[0]?.chat.id === 'chatgpd-manual-1' &&
      parsedChat.simulatedAiChatCommits[0].chat.messages.length === 2,
    'a ChatGPD chat commit payload must round-trip through the Direct Actions parser',
  );
  const invalidChatJson = JSON.stringify({
    simulatedAiChats: [{
      ...chatCommit,
      chat: { ...chatCommit.chat, messages: [{ role: 'user', text: 'No assistant reply.' }] },
    }],
  });
  const parsedInvalidChat = parseOutputActions(invalidChatJson, { phoneAppCommits: true });
  assertFixture(
    parsedInvalidChat.simulatedAiChatCommits.length === 0 &&
      parsedInvalidChat.warnings.length === 1,
    'a ChatGPD chat payload without an assistant reply must be rejected and produce no commit',
  );

  const bankJson = directAppActionJson({
    kind: 'bankTransfer',
    transfer: { from: 'Espen Harper', to: 'Ryan Parker', amount: 20, note: '' },
  });
  const parsedBank = parseOutputActions(bankJson, { phoneAppCommits: true });
  assertFixture(
    parsedBank.warnings.length === 0 &&
      parsedBank.bankTransfers.length === 1 &&
      parsedBank.bankTransfers[0]?.amount === 20 &&
      parsedBank.bankTransfers[0].note === undefined,
    'a banking transfer payload must round-trip through the Direct Actions parser',
  );

  // Applying a commit is an upsert: replaying the same record (regenerate) or
  // updating an existing note must replace it in place instead of duplicating.
  const appliedOnce = replaceCreatedPhoneNotesForTurn({}, 'turn-9', [noteCommit]);
  const appliedTwice = replaceCreatedPhoneNotesForTurn(appliedOnce, 'turn-10', [{
    ...noteCommit,
    note: { ...noteCommit.note, text: 'Milk, bread, cheese' },
  }]);
  assertFixture(
    appliedOnce.sarah?.length === 1 &&
      appliedTwice.sarah?.length === 1 &&
      appliedTwice.sarah[0]?.text === 'Milk, bread, cheese',
    'reapplying a manual note commit must update the stored note instead of duplicating it',
  );
  const chatAppliedOnce = replaceSimulatedAiChatsForTurn({}, 'turn-9', [chatCommit]);
  const chatAppliedTwice = replaceSimulatedAiChatsForTurn(chatAppliedOnce, 'turn-10', [chatCommit]);
  assertFixture(
    chatAppliedOnce.sarah?.length === 1 && chatAppliedTwice.sarah?.length === 1,
    'reapplying a ChatGPD chat commit must stay a single stored chat',
  );

  const createdMessage: MessageRecord = {
    id: 901,
    role: 'output',
    originalText: 'Created note',
    createdPhoneNote: noteCommit,
  };
  const directNoteTurn: TurnRecord = {
    id: 'turn-9',
    number: 9,
    createdAt: '2026-07-12T10:00:00.000Z',
    directAction: true,
    input: { graphText: noteJson, messages: [] },
    output: { graphText: '', messages: [createdMessage] },
  };
  const replacementNoteJson = directAppActionJson({
    kind: 'createdPhoneNote',
    commit: {
      ...noteCommit,
      note: { ...noteCommit.note, text: 'Replacement text' },
    },
  });
  assertFixture(
    lastDirectCreatedPhoneNoteTurn([directNoteTurn], 'sarah', 'note-manual-1')?.id === 'turn-9' &&
      replaceCreatedPhoneNotesForTurn(appliedOnce, 'turn-9', [{
        ...noteCommit,
        note: { ...noteCommit.note, text: 'Replacement text' },
      }]).sarah?.length === 1 &&
      replacementGraphInputText(
        replacementNoteJson,
        { turn: directNoteTurn, replaceInput: false },
        true,
        false,
      ) === replacementNoteJson,
    'replacing the latest direct app turn must use new JSON and keep one stored record',
  );
  const rpResponseMessage: MessageRecord = {
    id: 900,
    role: 'output',
    originalText: 'I wrote that down for you.',
  };
  const mixedRpNoteTurn: TurnRecord = {
    ...directNoteTurn,
    directAction: undefined,
    output: {
      graphText: rpResponseMessage.originalText,
      messages: [rpResponseMessage, createdMessage],
    },
  };
  const patchedMixedTurn = replaceCreatedPhoneNoteInLastTurn(
    [mixedRpNoteTurn],
    [rpResponseMessage, createdMessage],
    {
      ...noteCommit,
      note: { ...noteCommit.note, text: 'Updated inside the current RP turn' },
    },
  );
  const removedMixedNote = removeCreatedPhoneNoteFromLastTurn(
    patchedMixedTurn?.turns ?? [],
    patchedMixedTurn?.messages ?? [],
    'sarah',
    'note-manual-1',
  );
  assertFixture(
    patchedMixedTurn?.turns.length === 1 &&
      patchedMixedTurn.turns[0]?.output.messages.length === 2 &&
      patchedMixedTurn.turns[0].output.messages[0]?.originalText === rpResponseMessage.originalText &&
      patchedMixedTurn.turns[0].output.messages[1]?.createdPhoneNote?.note.text ===
        'Updated inside the current RP turn' &&
      removedMixedNote?.turns[0]?.output.messages.length === 1 &&
      removedMixedNote.turns[0].output.messages[0]?.originalText === rpResponseMessage.originalText,
    'editing or removing a note in the latest mixed RP turn must preserve its RP response',
  );

  const stateBeforeDelete = { sarah: [structuredClone(noteCommit.note)] };
  const stateAfterDelete = deletePhoneNotesForTurn(stateBeforeDelete, [deletedNoteCommit]);
  const deletedMessage: MessageRecord = {
    id: 902,
    role: 'output',
    originalText: 'Deleted note',
    deletedPhoneNote: deletedNoteCommit,
  };
  const stateAfterDeleteUndo = revertCreatedPhoneNotesForMessages(
    stateAfterDelete,
    [deletedMessage],
    [{
      ...createdMessage,
      createdPhoneNote: {
        ...noteCommit,
        note: { ...noteCommit.note, text: 'Older text', color: 'neutral' },
      },
    }],
  );
  assertFixture(
    !stateAfterDelete.sarah &&
      stateAfterDeleteUndo.sarah?.length === 1 &&
      stateAfterDeleteUndo.sarah[0]?.text === 'Milk, bread' &&
      stateAfterDeleteUndo.sarah[0]?.color === 'mint',
    'deleting a committed note must remove it and undo must restore its full snapshot',
  );
  const colorPreservingUndo = revertCreatedPhoneNotesForMessages(
    {
      sarah: [{ ...noteCommit.note, text: 'Updated text', color: 'rose' }],
    },
    [{
      ...createdMessage,
      createdPhoneNote: {
        ...noteCommit,
        note: { ...noteCommit.note, text: 'Updated text', color: 'rose' },
      },
    }],
    [createdMessage],
  );
  assertFixture(
    colorPreservingUndo.sarah?.[0]?.text === 'Milk, bread' &&
      colorPreservingUndo.sarah[0].color === 'rose',
    'undoing note content must preserve the current presentation-only color',
  );

  const chatMessage: MessageRecord = {
    id: 903,
    role: 'output',
    originalText: 'Committed chat',
    simulatedAiChat: chatCommit,
  };
  const chatTurn: TurnRecord = {
    id: 'turn-10',
    number: 10,
    createdAt: '2026-07-12T10:01:00.000Z',
    directAction: true,
    input: { graphText: chatJson, messages: [] },
    output: { graphText: '', messages: [chatMessage] },
  };
  const replacementChatJson = directAppActionJson({
    kind: 'simulatedAiChat',
    commit: {
      ...chatCommit,
      chat: {
        ...chatCommit.chat,
        messages: [
          ...chatCommit.chat.messages,
          { role: 'user' as const, text: 'What about cooking?' },
          { role: 'assistant' as const, text: 'Cooking usually treats them as vegetables.' },
        ],
      },
    },
  });
  const laterTurn: TurnRecord = {
    id: 'turn-11',
    number: 11,
    createdAt: '2026-07-12T10:02:00.000Z',
    input: { graphText: 'Later turn', messages: [] },
    output: { graphText: 'Later output', messages: [] },
  };
  assertFixture(
    replacementGraphInputText(
      replacementChatJson,
      { turn: chatTurn, replaceInput: false },
      true,
      false,
    ) === replacementChatJson &&
      archivedSimulatedAiChatIds([chatTurn], 'sarah').size === 0 &&
      archivedSimulatedAiChatIds([chatTurn, laterTurn], 'sarah').has(chatCommit.chat.id),
    'ChatGPD replacement must use its new transcript before later turns archive it',
  );
  const intentionallyDeletedChatState = revertSimulatedAiChatsForMessages(
    {},
    [{ id: 904, role: 'output', originalText: 'Unrelated later output' }],
    [chatMessage],
  );
  assertFixture(
    Object.keys(intentionallyDeletedChatState).length === 0,
    'undoing an unrelated turn must not resurrect an intentionally deleted archived chat',
  );

  // Undo semantics: removing the only committing message reverts the record.
  const undone = replaceCreatedPhoneNotesForTurn(appliedTwice, 'turn-10', []);
  assertFixture(
    undone.sarah?.length === 1 && undone.sarah[0]?.text === 'Milk, bread, cheese',
    'undoing a turn must only revert notes committed by that turn',
  );
}

verifyWorkflowValidationFixtures();
verifyDirectAppActionPayloadFixtures();
void verifyPromptRunFixtures();
void verifyDirectActionsGraphFixture();
