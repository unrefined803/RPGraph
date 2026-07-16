import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  validSmoothChatAutoScrollMinSpeed,
} from '../settings';
import type { CommandInputCommand } from '../chat/structuredCommands';
import {
  phoneRuntimeCharactersFromMessages,
  type PhoneRuntimeCharacter,
} from '../chat/phoneCharacters';
import { usePhoneReply } from '../chat/usePhoneReply';
import {
  bankTransferMessages,
  latestBankTransferMessageIdForCharacter,
  unreadBankTransferCountForCharacter,
  unreadBankTransfersForCharacter,
} from '../chat/bankTransfers';
import type { OnlyFriendsPurchasesByCharacter } from '../chat/onlyFriendsWallet';
import type {
  ChatGpdChatsByCharacter,
  PhoneNotesByCharacter,
} from '../chat/phoneAppsSessions';
import { normalizePhoneName } from '../chat/phoneMessages';
import {
  buildSocialDirectory,
  withSocialDirectoryConnectionAdded,
  type DynamicSocialUsers,
  type SocialConnectionsByCharacter,
} from '../chat/socialDirectory';
import {
  socialCharacterForPost,
  socialIdentityMatches,
  socialLikeAccountKey,
  socialMessageHiddenFromChat,
} from '../chat/socialMedia';
import { storybookImageById } from '../storybook/imageLibrary';
import { dialogueColors } from '../chat/textRendering';
import {
  chatAttachmentFromStorybookImage,
  storyCharactersFromNodes,
  type StorybookCharacter,
} from '../storybook/runtime';
import {
  embeddedPhoneMessageCharacters,
  phoneContactsForViewer,
  phoneConversationInfoFromMessages,
  phoneConversationKey,
  selectedPhoneConversationMessages,
  phoneSwitchCharacters,
  unreadPhoneConversationsForCharacters,
} from '../data-management/selectors';
import {
  appointmentEntitiesFromAppointments,
  appointmentsFromEventEntities,
  eventEntitiesFromNodes,
  normalizeEventAppointments,
  updateEventEntityStatus,
  upcomingAppointments,
} from '../data-management/eventStore';
import { openingHistoryMessageIds } from '../chat/turns';
import {
  parseRpStorybookJson,
  rpStorybookPhoneContactAllowed,
  type RpStorybookV1,
} from '../nodes/rp-storybook-v1/model';
import {
  narratorCharacterId,
  narratorSpeakerName,
} from './runOrchestration';
import type {
  ChatImageAttachment,
  EmbeddedPhoneMessageLink,
  EmbeddedSocialMessageLink,
  MessageRecord,
  SocialAppKind,
  SocialDirectMessageOpenRequest,
  SocialPostRecord,
  TurnRecord,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';

export type ChatPanelView = 'chat' | 'phone' | 'events';

const phoneAuthorBadgesStorageKey = 'rpgraph-phone-author-badges-enabled';
const chatAutoFollowBottomMargin = 48;

type UseRoleplayPanelRuntimeOptions = {
  nodeViewNodes: WorkflowNode[];
  nodesRef: { current: WorkflowNode[] };
  messages: MessageRecord[];
  turns: TurnRecord[];
  storybooksByNodeId: Map<string, RpStorybookV1>;
  characterStorybookNodeCount: number;
  imageUploadVisionEnabled: boolean;
  englishProcessingEnabled: boolean;
  smoothChatAutoScrollEnabled: boolean;
  smoothChatAutoScrollMinSpeed: number;
  isRunning: boolean;
  commitNodes: (nodes: WorkflowNode[]) => void;
  notifySystem: (level: 'info' | 'warning' | 'error', message: string) => void;
};

export function useRoleplayPanelRuntime({
  nodeViewNodes,
  nodesRef,
  messages,
  turns,
  storybooksByNodeId,
  characterStorybookNodeCount,
  imageUploadVisionEnabled,
  englishProcessingEnabled,
  smoothChatAutoScrollEnabled,
  smoothChatAutoScrollMinSpeed,
  isRunning,
  commitNodes,
  notifySystem,
}: UseRoleplayPanelRuntimeOptions) {
  const [chatPanelView, setChatPanelView] = useState<ChatPanelView>('chat');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [viewedPhoneCharacterId, setViewedPhoneCharacterId] = useState('');
  const [selectedPhoneCharacterId, setSelectedPhoneCharacterId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [phoneSeenByConversation, setPhoneSeenByConversation] = useState<Record<string, number>>({});
  const [bankingSeenByCharacter, setBankingSeenByCharacter] = useState<Record<string, number>>({});
  const [phoneAppSeenByCharacter, setPhoneAppSeenByCharacter] = useState<Record<string, number>>({});
  const [bankingContactsByCharacter, setBankingContactsByCharacter] = useState<Record<string, string[]>>({});
  // Liked post ids per "characterId/app" account key; part of the RP save.
  const [socialLikesByAccount, setSocialLikesByAccount] = useState<Record<string, string[]>>({});
  const [savedDynamicSocialUsers, setDynamicSocialUsers] = useState<DynamicSocialUsers>({});
  const [socialConnectionsByCharacter, setSocialConnectionsByCharacter] =
    useState<SocialConnectionsByCharacter>({});
  // Notes and ChatGPD chats per character id; part of the RP save.
  const [phoneNotesByCharacter, setPhoneNotesByCharacter] = useState<PhoneNotesByCharacter>({});
  const [chatGpdChatsByCharacter, setChatGpdChatsByCharacter] = useState<ChatGpdChatsByCharacter>({});
  const [onlyFriendsPurchasesByCharacter, setOnlyFriendsPurchasesByCharacter] =
    useState<OnlyFriendsPurchasesByCharacter>({});
  const [phoneHomeRequestId, setPhoneHomeRequestId] = useState(0);
  const [socialPostOpenRequest, setSocialPostOpenRequest] = useState<{
    requestId: number;
    app: SocialPostRecord['app'];
    postId: string;
  }>();
  const [socialDirectMessageOpenRequest, setSocialDirectMessageOpenRequest] =
    useState<SocialDirectMessageOpenRequest>();
  const [phoneDividerAfterByConversation, setPhoneDividerAfterByConversation] = useState<Record<string, number>>({});
  const [recentlyUsedEmojis, setRecentlyUsedEmojis] = useState<string[]>([]);
  const [recentChatCharacterIds, setRecentChatCharacterIds] = useState<string[]>([]);
  const [openedPhoneConversationKey, setOpenedPhoneConversationKey] = useState('');
  const [phoneAuthorBadgesEnabled, setPhoneAuthorBadgesEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(phoneAuthorBadgesStorageKey) === 'true';
    } catch {
      return false;
    }
  });
  const [highlightedPhoneMessage, setHighlightedPhoneMessage] = useState<{
    id: number;
    pulseKey: number;
  }>();
  const [lastSeenMessageRecordId, setLastSeenMessageRecordId] = useState(0);
  const [seenEventIds, setSeenEventIds] = useState<Set<string>>(() => new Set());
  const [highlightedEventIds, setHighlightedEventIds] = useState<Set<string>>(() => new Set());
  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneDraftCommands, setPhoneDraftCommands] = useState<CommandInputCommand[]>([]);
  const [phoneImages, setPhoneImages] = useState<ChatImageAttachment[]>([]);
  const [showPhoneEmojiPicker, setShowPhoneEmojiPicker] = useState(false);

  const chatThreadRef = useRef<HTMLDivElement | null>(null);
  const chatAutoFollowBottomRef = useRef(true);
  const chatAutoFollowAnimationFrameRef = useRef(0);
  const chatAutoFollowAnimationTimeRef = useRef(0);
  const chatAutoFollowAnimatingRef = useRef(false);
  const chatAutoFollowProgrammaticScrollRef = useRef(false);
  const chatAutoFollowProgrammaticClearFrameRef = useRef(0);
  const chatAutoFollowUserScrollRef = useRef(false);
  const isRunningRef = useRef(isRunning);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);
  const phoneImageInputRef = useRef<HTMLInputElement | null>(null);
  const phoneEmojiPickerRef = useRef<HTMLDivElement | null>(null);
  const phoneThreadRef = useRef<HTMLDivElement | null>(null);

  const {
    replyToMessage: phoneReplyToMessage,
    selectReply: selectPhoneReply,
    clearReply: clearPhoneReply,
  } = usePhoneReply(openedPhoneConversationKey);

  const storyCharacters: StorybookCharacter[] = useMemo(
    () => storyCharactersFromNodes(nodeViewNodes),
    [nodeViewNodes],
  );
  const phoneCharacters = useMemo(
    () => phoneRuntimeCharactersFromMessages(storyCharacters, messages),
    [messages, storyCharacters],
  );
  const characterColors = useMemo(
    () =>
      new Map(
        phoneCharacters.map((character, index) => [
          character.name,
          dialogueColors[index % dialogueColors.length],
        ]),
      ),
    [phoneCharacters],
  );
  const socialDirectory = useMemo(
    () => buildSocialDirectory({
      storyCharacters,
      messages,
      savedDynamicUsers: savedDynamicSocialUsers,
    }),
    [messages, savedDynamicSocialUsers, storyCharacters],
  );
  const fotogramContactsByCharacter = useMemo(
    () => Object.fromEntries(storyCharacters.map((viewer) => [
      viewer.id,
      storyCharacters.flatMap((contact) => {
        if (viewer.id === contact.id) {
          return [];
        }
        if (viewer.storybookNodeId !== contact.storybookNodeId) {
          return [contact.id];
        }
        const storybook = storybooksByNodeId.get(viewer.storybookNodeId);
        return storybook && rpStorybookPhoneContactAllowed(
          storybook,
          viewer.sourceId,
          contact.sourceId,
        )
          ? [contact.id]
          : [];
      }),
    ])),
    [storyCharacters, storybooksByNodeId],
  );
  function addSocialConnection(characterId: string, app: SocialAppKind, socialUserId: string) {
    setSocialConnectionsByCharacter((current) =>
      withSocialDirectoryConnectionAdded(
        current,
        socialDirectory.users,
        characterId,
        app,
        socialUserId,
      )
    );
  }
  const selectedCharacter =
    selectedCharacterId === narratorCharacterId
      ? undefined
      : storyCharacters.find((character) => character.id === selectedCharacterId) ?? storyCharacters[0];
  const narratorSelected = selectedCharacterId === narratorCharacterId;
  const viewedPhoneCharacter =
    narratorSelected
      ? phoneCharacters.find((character) => character.id === viewedPhoneCharacterId) ?? storyCharacters[0]
      : selectedCharacter;
  const viewedBankingCharacter = viewedPhoneCharacter && storyCharacters.some(
    (character) => character.id === viewedPhoneCharacter.id,
  )
    ? viewedPhoneCharacter
    : undefined;
  const bankingMessages = useMemo(() => bankTransferMessages(messages), [messages]);
  const unreadBankingCount = viewedBankingCharacter
    ? unreadBankTransferCountForCharacter(
        viewedBankingCharacter,
        bankingMessages,
        bankingSeenByCharacter[viewedBankingCharacter.id] ?? 0,
      )
    : 0;

  const phoneAppNotifications = useMemo(() => {
    const byCharacter = new Map<string, Record<'notes' | 'ai' | 'fotogram' | 'onlyfriends', number>>();
    storyCharacters.forEach((character) => {
      const seen = (app: string) => phoneAppSeenByCharacter[`${character.id}:${app}`] ?? 0;
      const count = (app: string, matches: (message: MessageRecord) => boolean) =>
        messages.filter((message) => !message.isOpening && message.id > seen(app) && matches(message)).length;
      const ownedPostIds = new Set(messages.flatMap((message) =>
        message.socialPost?.author === character.name ? [message.socialPost.postId] : []
      ));
      byCharacter.set(character.id, {
        notes: count('notes', (message) => message.createdPhoneNote?.characterId === character.id),
        ai: count('ai', (message) => message.simulatedAiChat?.characterId === character.id),
        fotogram: count('fotogram', (message) => (
          message.socialReactions?.app === 'fotogram' && ownedPostIds.has(message.socialReactions.postId)
        ) || (
          message.socialDirectMessage?.app === 'fotogram' && message.socialDirectMessage.to === character.name
        )),
        onlyfriends: count('onlyfriends', (message) => (
          message.socialReactions?.app === 'onlyfriends' && ownedPostIds.has(message.socialReactions.postId)
        ) || (
          message.socialDirectMessage?.app === 'onlyfriends' && message.socialDirectMessage.to === character.name
        )),
      });
    });
    return byCharacter;
  }, [messages, phoneAppSeenByCharacter, storyCharacters]);
  const phoneAppNotificationCounts = phoneAppNotifications.get(viewedPhoneCharacter?.id ?? '') ?? {
    notes: 0,
    ai: 0,
    fotogram: 0,
    onlyfriends: 0,
  };

  const markViewedPhoneAppSeen = useCallback((app: 'notes' | 'ai' | 'fotogram' | 'onlyfriends') => {
    if (!viewedPhoneCharacter) {
      return;
    }
    const latestId = messages.reduce((highest, message) => Math.max(highest, message.id), 0);
    const key = `${viewedPhoneCharacter.id}:${app}`;
    setPhoneAppSeenByCharacter((current) =>
      latestId > (current[key] ?? 0) ? { ...current, [key]: latestId } : current
    );
  }, [messages, viewedPhoneCharacter]);

  const markViewedBankingSeen = useCallback(() => {
    if (!viewedBankingCharacter) {
      return;
    }
    const latestId = latestBankTransferMessageIdForCharacter(
      viewedBankingCharacter,
      bankingMessages,
    );
    setBankingSeenByCharacter((current) =>
      latestId > (current[viewedBankingCharacter.id] ?? 0)
        ? { ...current, [viewedBankingCharacter.id]: latestId }
        : current
    );
  }, [bankingMessages, viewedBankingCharacter]);

  // Drafted attachments and a pending reply belong to the character who
  // composed them; drop both when the viewed phone owner changes.
  const [phoneDraftOwnerId, setPhoneDraftOwnerId] = useState<string | undefined>(undefined);
  if (phoneDraftOwnerId !== viewedPhoneCharacter?.id) {
    setPhoneDraftOwnerId(viewedPhoneCharacter?.id);
    setPhoneImages([]);
    clearPhoneReply();
  }
  const phoneGalleryImages = useMemo(() => {
    const storybook = viewedPhoneCharacter
      ? storybooksByNodeId.get(viewedPhoneCharacter.storybookNodeId)
      : undefined;
    const imageOwner = storybook?.characters.find(
      (entry) => entry.id === viewedPhoneCharacter?.sourceId,
    );
    const images = imageOwner?.images.map(chatAttachmentFromStorybookImage) ?? [];
    return imageUploadVisionEnabled
      ? images
      : images.filter((image) => image.description?.trim());
  }, [imageUploadVisionEnabled, storybooksByNodeId, viewedPhoneCharacter]);

  function rememberChatCharacter(characterId: string) {
    setRecentChatCharacterIds((current) => [
      characterId,
      ...current.filter((id) => id !== characterId),
    ].slice(0, 2));
  }

  function selectChatCharacter(characterId: string) {
    if (characterId === narratorCharacterId && viewedPhoneCharacter) {
      // Keep showing the current character's phone while the narrator plays.
      setViewedPhoneCharacterId(viewedPhoneCharacter.id);
    }
    setSelectedCharacterId(characterId);
    if (characterId !== narratorCharacterId) {
      rememberChatCharacter(characterId);
    }
  }

  const phoneConversationInfo = useMemo(() => {
    return phoneConversationInfoFromMessages(messages, phoneSeenByConversation);
  }, [messages, phoneSeenByConversation]);

  const phoneContactVisibleForViewer = useCallback((
    viewer: PhoneRuntimeCharacter | undefined,
    contact: PhoneRuntimeCharacter,
  ) => {
    if (!viewer || viewer.id === contact.id) {
      return false;
    }
    if (phoneConversationInfo.has(phoneConversationKey(viewer.name, contact.name))) {
      return true;
    }
    if (viewer.storybookNodeId && viewer.storybookNodeId === contact.storybookNodeId) {
      const storybook = storybooksByNodeId.get(viewer.storybookNodeId);
      if (storybook) {
        return rpStorybookPhoneContactAllowed(storybook, viewer.sourceId, contact.sourceId);
      }
    }
    return !viewer.temporaryPhone && !contact.temporaryPhone;
  }, [phoneConversationInfo, storybooksByNodeId]);

  const markPhoneConversationsSeen = useCallback((updates: Array<{ key: string; latestId: number }>) => {
    if (updates.length === 0) {
      return;
    }
    setPhoneSeenByConversation((current) => {
      let changed = false;
      const next = { ...current };
      updates.forEach(({ key, latestId }) => {
        if (latestId > (next[key] ?? 0)) {
          next[key] = latestId;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, []);

  const openPhoneConversation = useCallback((
    conversationKey: string,
    latestId: number,
    select?: { speakerId: string; contactId: string; activatePlayer?: boolean },
  ) => {
    const seenBefore = phoneSeenByConversation[conversationKey] ?? 0;
    if (select) {
      const speakerIsPlayable = storyCharacters.some((character) => character.id === select.speakerId);
      if ((select.activatePlayer ?? true) && speakerIsPlayable) {
        setSelectedCharacterId(select.speakerId);
      }
      setViewedPhoneCharacterId(select.speakerId);
      setSelectedPhoneCharacterId(select.contactId);
    }
    setOpenedPhoneConversationKey(conversationKey);
    setPhoneDividerAfterByConversation((current) => ({
      ...current,
      [conversationKey]: seenBefore,
    }));
    markPhoneConversationsSeen([{ key: conversationKey, latestId }]);
  }, [markPhoneConversationsSeen, phoneSeenByConversation, storyCharacters]);

  const phoneContacts = useMemo(
    () => phoneContactsForViewer(
      viewedPhoneCharacter
        ? phoneCharacters.filter((character) =>
            character.id === viewedPhoneCharacter.id ||
            phoneContactVisibleForViewer(viewedPhoneCharacter, character),
          )
        : phoneCharacters,
      {
        viewedCharacter: viewedPhoneCharacter,
        messages,
        conversations: phoneConversationInfo,
        characterColors,
        fallbackColor: dialogueColors[0],
        englishProcessingEnabled,
      },
    ),
    [
      characterColors,
      englishProcessingEnabled,
      messages,
      phoneConversationInfo,
      phoneCharacters,
      phoneContactVisibleForViewer,
      viewedPhoneCharacter,
    ],
  );
  const selectedPhoneContact =
    phoneContacts.find((contact) => contact.character.id === selectedPhoneCharacterId);

  function openPhoneContact(contact: typeof phoneContacts[number]) {
    if (!viewedPhoneCharacter) {
      return;
    }
    openPhoneConversation(contact.conversationKey, contact.latestPhoneId, {
      speakerId: viewedPhoneCharacter.id,
      contactId: contact.character.id,
      activatePlayer: !narratorSelected,
    });
  }

  const recentChatCharacters = recentChatCharacterIds
    .map((id) => storyCharacters.find((character) => character.id === id))
    .filter((character): character is StorybookCharacter => !!character);
  const chatSwitchTarget =
    recentChatCharacters.find((character) => character.id !== selectedCharacter?.id) ??
    recentChatCharacters[0];
  const phoneSwitchTargetPlayable = !!selectedPhoneContact && storyCharacters.some(
    (character) => character.id === selectedPhoneContact.character.id,
  );

  function switchChatPlayer() {
    if (!chatSwitchTarget) {
      return;
    }
    selectChatCharacter(chatSwitchTarget.id);
  }

  function switchPhoneConversationSide() {
    if (!viewedPhoneCharacter || !selectedPhoneContact || !phoneSwitchTargetPlayable) {
      return;
    }
    const latestId =
      phoneConversationInfo.get(selectedPhoneContact.conversationKey)?.latestId ??
      selectedPhoneContact.latestPhoneId;
    openPhoneConversation(selectedPhoneContact.conversationKey, latestId, {
      speakerId: selectedPhoneContact.character.id,
      contactId: viewedPhoneCharacter.id,
      activatePlayer: true,
    });
  }

  function switchActivePlayer() {
    if (chatPanelView === 'phone') {
      switchPhoneConversationSide();
      return;
    }
    if (chatPanelView === 'chat') {
      switchChatPlayer();
    }
  }

  const selectedPhoneConversation = useMemo(() => {
    return selectedPhoneConversationMessages(messages, viewedPhoneCharacter, selectedPhoneContact);
  }, [messages, selectedPhoneContact, viewedPhoneCharacter]);
  const selectedPhoneDividerAfterId = selectedPhoneContact
    ? phoneDividerAfterByConversation[selectedPhoneContact.conversationKey]
    : undefined;
  const selectedPhoneConversationKey = selectedPhoneContact?.conversationKey;
  const selectedPhoneConversationLatestId = selectedPhoneConversationKey
    ? phoneConversationInfo.get(selectedPhoneConversationKey)?.latestId ?? 0
    : 0;
  const markSelectedPhoneConversationSeen = useCallback(() => {
    if (!selectedPhoneConversationKey || selectedPhoneConversationLatestId <= 0) {
      return;
    }
    markPhoneConversationsSeen([{
      key: selectedPhoneConversationKey,
      latestId: selectedPhoneConversationLatestId,
    }]);
  }, [
    markPhoneConversationsSeen,
    selectedPhoneConversationKey,
    selectedPhoneConversationLatestId,
  ]);

  const eventManagerNode = useMemo(
    () => nodeViewNodes.find((node) => node.data.kind === undefined && node.data.nodeType === 'event-manager'),
    [nodeViewNodes],
  );
  const eventManagerAvailable = !!eventManagerNode;
  const eventEntities = useMemo(
    () => eventEntitiesFromNodes(nodeViewNodes),
    [nodeViewNodes],
  );
  const upcomingEvents = useMemo(
    () => upcomingAppointments(appointmentsFromEventEntities(eventEntities)),
    [eventEntities],
  );
  const selectedEvent =
    upcomingEvents.find((event) => event.id === selectedEventId) ?? upcomingEvents[0];

  function closeEvent(eventId: string, status: 'completed' | 'cancelled') {
    // Runs as a deferred callback after an event turn; nodeViewNodes would be
    // a stale render snapshot that wipes out the turn's runtime updates.
    const nextNodes = nodesRef.current.map((node) => {
      if (node.data.nodeType !== 'event-manager' || !node.data.eventAppointments) {
        return node;
      }
      const nextEvents = updateEventEntityStatus(
        appointmentEntitiesFromAppointments(node.data.eventAppointments),
        eventId,
        status,
      );
      return {
        ...node,
        data: {
          ...node.data,
          eventAppointments: normalizeEventAppointments(appointmentsFromEventEntities(nextEvents)),
          eventStatus:
            status === 'cancelled' ? 'Event cancelled' : 'Event completed',
        } as WorkflowNodeData,
      };
    });
    commitNodes(nextNodes);
    setHighlightedEventIds((current) => {
      const next = new Set(current);
      next.delete(eventId);
      return next;
    });
    setSeenEventIds((current) => {
      const next = new Set(current);
      next.delete(eventId);
      return next;
    });
    if (selectedEventId === eventId) {
      setSelectedEventId('');
    }
  }

  function cancelEvent(eventId: string) {
    closeEvent(eventId, 'cancelled');
  }

  const unreadPhoneConversations = useMemo(
    () => unreadPhoneConversationsForCharacters(phoneCharacters, {
      narratorSelected,
      selectedContact: selectedPhoneContact,
      conversations: phoneConversationInfo,
    }),
    [narratorSelected, phoneCharacters, phoneConversationInfo, selectedPhoneContact],
  );
  const unreadPhoneCount = unreadPhoneConversations.reduce(
    (count, conversation) => count + conversation.unreadCount,
    0,
  );
  const unreadBankingByCharacter = useMemo(
    () => storyCharacters.flatMap((character) => {
      const transfers = unreadBankTransfersForCharacter(
        character,
        bankingMessages,
        bankingSeenByCharacter[character.id] ?? 0,
      );
      return transfers.length > 0 ? [{ character, transfers }] : [];
    }),
    [bankingMessages, bankingSeenByCharacter, storyCharacters],
  );
  const unreadBankingTotalCount = unreadBankingByCharacter.reduce(
    (count, entry) => count + entry.transfers.length,
    0,
  );
  const unreadPhoneAppCount = Array.from(phoneAppNotifications.values()).reduce(
    (total, counts) => total + Object.values(counts).reduce((sum, count) => sum + count, 0),
    0,
  );
  const unreadPhoneNotificationCount = unreadPhoneCount + unreadBankingTotalCount + unreadPhoneAppCount;
  const phoneNotificationOwners = useMemo(
    () => storyCharacters.flatMap((character) => {
      const phoneEntry = unreadPhoneConversations.find(
        (conversation) =>
          conversation.unread &&
          normalizePhoneName(conversation.viewerName) === normalizePhoneName(character.name),
      );
      const bankingEntry = unreadBankingByCharacter.find(
        (entry) => entry.character.id === character.id,
      );
      const bankingLatestId = bankingEntry?.transfers.reduce(
        (latestId, transaction) => Math.max(latestId, transaction.message.id),
        0,
      ) ?? 0;
      const appUnreadCount = Object.values(phoneAppNotifications.get(character.id) ?? {}).reduce(
        (count, appCount) => count + appCount,
        0,
      );
      const unreadCount =
        (phoneEntry?.unreadCount ?? 0) +
        (bankingEntry?.transfers.length ?? 0) +
        appUnreadCount;
      return unreadCount > 0
        ? [{
            character,
            unreadCount,
            latestId: Math.max(phoneEntry?.latestId ?? 0, bankingLatestId),
          }]
        : [];
    }).sort((left, right) =>
      right.unreadCount - left.unreadCount ||
      right.latestId - left.latestId
    ),
    [phoneAppNotifications, storyCharacters, unreadBankingByCharacter, unreadPhoneConversations],
  );
  const viewedPhoneHasNotifications = phoneNotificationOwners.some(
    (entry) => entry.character.id === viewedPhoneCharacter?.id,
  );
  const unreadPhoneSwitchName = (conversation: typeof unreadPhoneConversations[number]) =>
    conversation.viewerName;

  function openUnreadPhoneConversation(conversation: typeof unreadPhoneConversations[number]) {
    const { viewer, contact } = phoneSwitchCharacters(
      phoneCharacters,
      conversation,
      phoneConversationInfo,
    );
    if (!viewer || !contact) {
      return;
    }
    openPhoneConversation(conversation.conversationKey, conversation.latestId, {
      speakerId: viewer.id,
      contactId: contact.id,
      activatePlayer: !narratorSelected,
    });
    selectChatPanelView('phone');
  }

  function openEmbeddedPhoneMessage(message: EmbeddedPhoneMessageLink) {
    const { viewer, contact } = embeddedPhoneMessageCharacters(phoneCharacters, message);
    if (!viewer || !contact) {
      notifySystem('warning', 'Could not find both phone characters.');
      return;
    }
    const conversationKey = phoneConversationKey(message.from, message.to);
    const latestId = phoneConversationInfo.get(conversationKey)?.latestId ?? message.phoneMessageId;
    openPhoneConversation(conversationKey, latestId, {
      speakerId: viewer.id,
      contactId: contact.id,
      activatePlayer: !narratorSelected,
    });
    setHighlightedPhoneMessage((current) => ({
      id: message.phoneMessageId,
      pulseKey: (current?.pulseKey ?? 0) + 1,
    }));
    selectChatPanelView('phone');
  }

  function openEmbeddedSocialMessage(message: EmbeddedSocialMessageLink) {
    const directMessage = messages.find((entry) => entry.id === message.socialMessageId)
      ?.socialDirectMessage;
    if (!directMessage) {
      notifySystem('warning', 'Could not find the linked social message.');
      return;
    }
    const characterForIdentity = (name: string, handle: string) =>
      storyCharacters.find((character) => {
        const accountHandle = directMessage.app === 'fotogram'
          ? character.social.fotogramUsername
          : character.social.onlyfriendsUsername;
        return !!accountHandle.trim() && (
          socialIdentityMatches(character.name, name) ||
          socialIdentityMatches(accountHandle, handle)
        );
      });
    const senderCharacter = characterForIdentity(directMessage.from, directMessage.fromHandle);
    const recipientCharacter = characterForIdentity(directMessage.to, directMessage.toHandle);
    const owner = senderCharacter ?? recipientCharacter;
    if (!owner) {
      notifySystem('warning', 'Could not find a playable character for this social conversation.');
      return;
    }
    const ownerIsSender = owner.id === senderCharacter?.id;
    setSelectedCharacterId(owner.id);
    setViewedPhoneCharacterId(owner.id);
    rememberChatCharacter(owner.id);
    setHighlightedPhoneMessage(undefined);
    setSocialPostOpenRequest(undefined);
    setSocialDirectMessageOpenRequest((current) => ({
      requestId: (current?.requestId ?? 0) + 1,
      app: directMessage.app,
      messageId: directMessage.messageId,
      participantName: ownerIsSender ? directMessage.to : directMessage.from,
      participantHandle: ownerIsSender ? directMessage.toHandle : directMessage.fromHandle,
    }));
    setChatPanelView('phone');
  }

  // Posted photos are stored as Storybook/Gallery image ids; resolve the
  // pixels from the image library wherever a post is rendered.
  const socialImageById = useCallback(
    (imageId: string) => {
      const image = storybookImageById(storybooksByNodeId.values(), imageId);
      return image ? chatAttachmentFromStorybookImage(image) : undefined;
    },
    [storybooksByNodeId],
  );

  function toggleSocialLike(characterId: string, app: SocialAppKind, postId: string) {
    const accountKey = socialLikeAccountKey(characterId, app);
    setSocialLikesByAccount((current) => {
      const liked = current[accountKey] ?? [];
      return {
        ...current,
        [accountKey]: liked.includes(postId)
          ? liked.filter((id) => id !== postId)
          : [...liked, postId],
      };
    });
  }

  function unlockOnlyFriendsPost(characterId: string, postId: string, price: number) {
    setOnlyFriendsPurchasesByCharacter((current) => {
      const purchases = current[characterId] ?? {};
      if (purchases[postId] !== undefined) {
        return current;
      }
      return {
        ...current,
        [characterId]: {
          ...purchases,
          [postId]: Math.round(price * 100) / 100,
        },
      };
    });
  }

  function openSocialPost(post: SocialPostRecord) {
    if (post.app === 'onlyfriends') {
      const author = socialCharacterForPost(post, storyCharacters);
      if (!author) {
        notifySystem('warning', `Could not find the OnlyFriends post author "${post.author}".`);
        return;
      }
      setSelectedCharacterId(author.id);
      setViewedPhoneCharacterId(author.id);
      rememberChatCharacter(author.id);
    }
    setHighlightedPhoneMessage(undefined);
    setSocialDirectMessageOpenRequest(undefined);
    setSocialPostOpenRequest((current) => ({
      requestId: (current?.requestId ?? 0) + 1,
      app: post.app,
      postId: post.postId,
    }));
    setChatPanelView('phone');
  }

  const newEventIds = useMemo(
    () => upcomingEvents.flatMap((event) => (seenEventIds.has(event.id) ? [] : [event.id])),
    [seenEventIds, upcomingEvents],
  );
  const unreadEventCount = newEventIds.length;
  const openingMessageIds = useMemo(() => openingHistoryMessageIds(turns), [turns]);
  const latestMessageRecordId = useMemo(
    () =>
      messages.reduce(
        (latestId, message) =>
          message.role === 'output' &&
          message.channel !== 'phone' &&
          !message.isOpening &&
          !openingMessageIds.has(message.id) &&
          !socialMessageHiddenFromChat(message) &&
          message.includeInHistory !== false
            ? Math.max(latestId, message.id)
            : latestId,
        0,
      ),
    [messages, openingMessageIds],
  );
  const unreadChatCount = useMemo(
    () =>
      chatPanelView === 'chat'
        ? 0
        : messages.filter(
            (message) =>
              message.id > lastSeenMessageRecordId &&
              message.role === 'output' &&
              message.channel !== 'phone' &&
              !message.isOpening &&
              !openingMessageIds.has(message.id) &&
              !socialMessageHiddenFromChat(message) &&
              message.includeInHistory !== false,
          ).length,
    [chatPanelView, lastSeenMessageRecordId, messages, openingMessageIds],
  );

  useEffect(() => {
    if (chatPanelView === 'chat') {
      queueMicrotask(() => setLastSeenMessageRecordId(latestMessageRecordId));
    }
  }, [chatPanelView, latestMessageRecordId]);

  function changePhoneAuthorBadgesEnabled(enabled: boolean) {
    setPhoneAuthorBadgesEnabled(enabled);
    try {
      window.localStorage.setItem(phoneAuthorBadgesStorageKey, String(enabled));
    } catch {
      // Non-critical UI preference.
    }
  }

  function addBankingContact(characterId: string, contactName: string) {
    const normalizedName = contactName.trim().replace(/\s+/g, ' ');
    if (!normalizedName) {
      return;
    }
    setBankingContactsByCharacter((current) => {
      const contacts = current[characterId] ?? [];
      if (contacts.some((name) => normalizePhoneName(name) === normalizePhoneName(normalizedName))) {
        return current;
      }
      return { ...current, [characterId]: [...contacts, normalizedName] };
    });
  }

  function selectChatPanelView(view: ChatPanelView) {
    if (view === 'chat') {
      setLastSeenMessageRecordId(latestMessageRecordId);
    }
    if (view === 'events') {
      setHighlightedEventIds(new Set(newEventIds));
      setSeenEventIds(new Set(upcomingEvents.map((event) => event.id)));
    }
    if (view === 'phone') {
      setSocialPostOpenRequest(undefined);
    }
    setChatPanelView(view);
  }

  function selectPhonePanelView() {
    setHighlightedPhoneMessage(undefined);
    setSocialPostOpenRequest(undefined);
    if (chatPanelView !== 'phone') {
      setChatPanelView('phone');
      return;
    }

    setPhoneHomeRequestId((current) => current + 1);
  }

  function cyclePhoneNotificationOwner() {
    if (chatPanelView !== 'phone') {
      return false;
    }
    let switchedOwner = false;
    if (phoneNotificationOwners.length > 0) {
      const currentOwnerIndex = phoneNotificationOwners.findIndex(
        (entry) => entry.character.id === viewedPhoneCharacter?.id,
      );
      const nextOwner = currentOwnerIndex >= 0
        ? phoneNotificationOwners[(currentOwnerIndex + 1) % phoneNotificationOwners.length]
        : phoneNotificationOwners[0];
      if (nextOwner) {
        switchedOwner = nextOwner.character.id !== viewedPhoneCharacter?.id;
        if (narratorSelected) {
          setViewedPhoneCharacterId(nextOwner.character.id);
        } else {
          setSelectedCharacterId(nextOwner.character.id);
          rememberChatCharacter(nextOwner.character.id);
        }
        setSelectedPhoneCharacterId('');
      }
    }

    setSocialPostOpenRequest(undefined);
    setPhoneHomeRequestId((current) => current + 1);
    return switchedOwner;
  }

  const autoTurnTargetName = selectedCharacter?.name;
  const autoTurnDisabled =
    isRunning ||
    characterStorybookNodeCount === 0 ||
    (chatPanelView === 'chat' && !selectedCharacter && !narratorSelected) ||
    (chatPanelView === 'phone' && !narratorSelected && !selectedCharacter) ||
    (chatPanelView === 'phone' && !selectedPhoneContact) ||
    (chatPanelView === 'events' && (!eventManagerAvailable || !selectedEvent));
  const autoTurnTitle =
    chatPanelView === 'phone'
      ? !selectedPhoneContact
        ? 'Open a phone conversation first'
        : narratorSelected
        ? 'Continue the phone story with the most fitting sender and recipient'
        : autoTurnTargetName
        ? `Trigger ${autoTurnTargetName} to write a phone message`
        : 'Select a phone contact first'
      : chatPanelView === 'events'
        ? !eventManagerAvailable
          ? 'Connect Event Manager to the workflow'
          : selectedEvent
          ? `Run ${selectedEvent.title}`
          : 'Select an event first'
      : narratorSelected
        ? 'Continue the story with the most fitting character or characters'
        : autoTurnTargetName
          ? `Trigger ${autoTurnTargetName} to move the story forward`
          : 'Select a character first';
  const switchPlayerDisabled =
    isRunning ||
    (chatPanelView === 'chat' && !chatSwitchTarget) ||
    (chatPanelView === 'phone' && (!viewedPhoneCharacter || !selectedPhoneContact || !phoneSwitchTargetPlayable)) ||
    chatPanelView === 'events';
  const switchPlayerTitle =
    chatPanelView === 'phone'
      ? !selectedPhoneContact
        ? 'Select a phone contact first'
        : !phoneSwitchTargetPlayable
          ? `${selectedPhoneContact.character.name} is not a playable Storybook character`
          : `Switch to ${selectedPhoneContact.character.name}'s phone`
      : chatPanelView === 'chat'
        ? chatSwitchTarget
          ? `Switch to ${chatSwitchTarget.name}`
          : 'Use at least two chat characters first'
        : 'Switch is available in Chat and Phone';

  const scrollPhoneThreadToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (chatPanelView === 'phone' && highlightedPhoneMessage) {
      return;
    }
    requestAnimationFrame(() => {
      const thread = phoneThreadRef.current;
      if (thread) {
        thread.scrollTo({ top: thread.scrollHeight, behavior });
      }
    });
  }, [chatPanelView, highlightedPhoneMessage]);

  useEffect(() => {
    if (chatPanelView === 'phone' && highlightedPhoneMessage) {
      return;
    }
    scrollPhoneThreadToBottom();
  }, [
    chatPanelView,
    highlightedPhoneMessage,
    selectedPhoneContact?.character.id,
    selectedPhoneConversation.length,
    scrollPhoneThreadToBottom,
  ]);

  useEffect(() => {
    if (chatPanelView !== 'phone' || !highlightedPhoneMessage) {
      return;
    }
    let frame = 0;
    let timeout = 0;
    const scrollToHighlightedPhoneMessage = (attempt = 0) => {
      const thread = phoneThreadRef.current;
      const target = thread?.querySelector<HTMLElement>(
        `[data-phone-message-id="${highlightedPhoneMessage.id}"]`,
      );
      if (!thread || !target) {
        if (attempt < 10) {
          timeout = window.setTimeout(() => scrollToHighlightedPhoneMessage(attempt + 1), 40);
        }
        return;
      }
      const threadRect = thread.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetTop =
        thread.scrollTop +
        targetRect.top -
        threadRect.top -
        Math.max(0, (thread.clientHeight - targetRect.height) / 2);
      thread.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    };
    frame = requestAnimationFrame(() => scrollToHighlightedPhoneMessage());
    const clearHighlight = window.setTimeout(() => {
      setHighlightedPhoneMessage((current) =>
        current?.pulseKey === highlightedPhoneMessage.pulseKey ? undefined : current,
      );
    }, 3000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      window.clearTimeout(clearHighlight);
    };
  }, [
    chatPanelView,
    highlightedPhoneMessage,
    selectedPhoneContact?.character.id,
    selectedPhoneConversation.length,
  ]);

  const cancelChatAutoFollowAnimation = useCallback(() => {
    if (chatAutoFollowAnimationFrameRef.current) {
      cancelAnimationFrame(chatAutoFollowAnimationFrameRef.current);
      chatAutoFollowAnimationFrameRef.current = 0;
    }
    if (chatAutoFollowProgrammaticClearFrameRef.current) {
      cancelAnimationFrame(chatAutoFollowProgrammaticClearFrameRef.current);
      chatAutoFollowProgrammaticClearFrameRef.current = 0;
    }
    chatAutoFollowProgrammaticScrollRef.current = false;
    chatAutoFollowAnimatingRef.current = false;
    chatAutoFollowAnimationTimeRef.current = 0;
  }, []);

  const markChatProgrammaticScroll = useCallback(() => {
    chatAutoFollowProgrammaticScrollRef.current = true;
    if (chatAutoFollowProgrammaticClearFrameRef.current) {
      cancelAnimationFrame(chatAutoFollowProgrammaticClearFrameRef.current);
    }
    chatAutoFollowProgrammaticClearFrameRef.current = requestAnimationFrame(() => {
      chatAutoFollowProgrammaticScrollRef.current = false;
      chatAutoFollowProgrammaticClearFrameRef.current = 0;
    });
  }, []);

  const animateChatThreadToBottom = useCallback(() => {
    const thread = chatThreadRef.current;
    if (!thread || !chatAutoFollowBottomRef.current) {
      cancelChatAutoFollowAnimation();
      return;
    }

    const step = (timestamp: number) => {
      const currentThread = chatThreadRef.current;
      if (!currentThread || !chatAutoFollowBottomRef.current) {
        cancelChatAutoFollowAnimation();
        return;
      }

      const targetTop = Math.max(0, currentThread.scrollHeight - currentThread.clientHeight);
      const distance = targetTop - currentThread.scrollTop;
      if (distance <= 1) {
        markChatProgrammaticScroll();
        currentThread.scrollTop = targetTop;
        if (isRunningRef.current) {
          chatAutoFollowAnimationTimeRef.current = timestamp;
          chatAutoFollowAnimationFrameRef.current = requestAnimationFrame(step);
          return;
        }
        cancelChatAutoFollowAnimation();
        return;
      }

      const previousTimestamp = chatAutoFollowAnimationTimeRef.current || timestamp;
      const elapsedSeconds = Math.max(0, (timestamp - previousTimestamp) / 1000);
      chatAutoFollowAnimationTimeRef.current = timestamp;
      const pixelsPerSecond = validSmoothChatAutoScrollMinSpeed(smoothChatAutoScrollMinSpeed);
      const delta = Math.max(0.25, pixelsPerSecond * elapsedSeconds);

      markChatProgrammaticScroll();
      currentThread.scrollTop = Math.min(targetTop, currentThread.scrollTop + delta);
      chatAutoFollowAnimationFrameRef.current = requestAnimationFrame(step);
    };

    if (!chatAutoFollowAnimationFrameRef.current) {
      chatAutoFollowAnimatingRef.current = true;
      chatAutoFollowAnimationFrameRef.current = requestAnimationFrame(step);
    }
  }, [cancelChatAutoFollowAnimation, markChatProgrammaticScroll, smoothChatAutoScrollMinSpeed]);

  const scrollChatThreadToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (!thread) {
        return;
      }
      if (behavior === 'smooth') {
        if (!smoothChatAutoScrollEnabled) {
          cancelChatAutoFollowAnimation();
          markChatProgrammaticScroll();
          thread.scrollTo({ top: thread.scrollHeight, behavior: 'auto' });
          return;
        }
        animateChatThreadToBottom();
        return;
      }
      cancelChatAutoFollowAnimation();
      markChatProgrammaticScroll();
      thread.scrollTo({ top: thread.scrollHeight, behavior: 'auto' });
    });
  }, [
    animateChatThreadToBottom,
    cancelChatAutoFollowAnimation,
    markChatProgrammaticScroll,
    smoothChatAutoScrollEnabled,
  ]);

  function chatThreadIsNearBottom(thread: HTMLDivElement) {
    return (
      thread.scrollHeight - thread.scrollTop - thread.clientHeight <=
      chatAutoFollowBottomMargin
    );
  }

  const scrollChatThreadToBottomIfFollowing = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (chatAutoFollowBottomRef.current) {
      scrollChatThreadToBottom(behavior);
    }
  }, [scrollChatThreadToBottom]);

  useEffect(() => {
    if (chatPanelView !== 'chat') {
      return undefined;
    }
    const thread = chatThreadRef.current;
    if (!thread) {
      return undefined;
    }
    const markUserScrollIntent = () => {
      chatAutoFollowUserScrollRef.current = true;
      cancelChatAutoFollowAnimation();
    };
    const updateAutoFollow = () => {
      const nearBottom = chatThreadIsNearBottom(thread);
      if (
        (chatAutoFollowProgrammaticScrollRef.current || chatAutoFollowAnimatingRef.current) &&
        !chatAutoFollowUserScrollRef.current
      ) {
        chatAutoFollowBottomRef.current = true;
        return;
      }
      chatAutoFollowBottomRef.current = nearBottom;
      if (nearBottom) {
        chatAutoFollowUserScrollRef.current = false;
      }
    };
    thread.addEventListener('wheel', markUserScrollIntent, { passive: true });
    thread.addEventListener('touchstart', markUserScrollIntent, { passive: true });
    thread.addEventListener('pointerdown', markUserScrollIntent, { passive: true });
    thread.addEventListener('keydown', markUserScrollIntent);
    thread.addEventListener('scroll', updateAutoFollow, { passive: true });
    return () => {
      cancelChatAutoFollowAnimation();
      thread.removeEventListener('wheel', markUserScrollIntent);
      thread.removeEventListener('touchstart', markUserScrollIntent);
      thread.removeEventListener('pointerdown', markUserScrollIntent);
      thread.removeEventListener('keydown', markUserScrollIntent);
      thread.removeEventListener('scroll', updateAutoFollow);
    };
  }, [cancelChatAutoFollowAnimation, chatPanelView]);

  useEffect(() => {
    if (chatPanelView === 'chat') {
      chatAutoFollowBottomRef.current = true;
      scrollChatThreadToBottom();
    }
  }, [chatPanelView, scrollChatThreadToBottom]);

  useEffect(() => {
    if (chatPanelView === 'chat') {
      scrollChatThreadToBottomIfFollowing();
    }
  }, [chatPanelView, messages, scrollChatThreadToBottomIfFollowing]);

  function selectPhoneReplyFromComposer(message: MessageRecord) {
    selectPhoneReply(message);
  }

  function selectPhoneGalleryImageFromComposer(image: ChatImageAttachment) {
    setPhoneImages([image]);
  }

  function selectPhoneEmoji(emoji: string) {
    setPhoneDraft((current) => `${current}${emoji}`);
    setShowPhoneEmojiPicker(false);
    setRecentlyUsedEmojis((current) => {
      const filtered = current.filter((e) => e !== emoji);
      return [emoji, ...filtered].slice(0, 8);
    });
  }

  return {
    chatPanelView,
    selectChatPanelView,
    selectPhonePanelView,
    cyclePhoneNotificationOwner,
    selectedCharacterId,
    setSelectedCharacterId,
    selectedCharacter,
    narratorSelected,
    storyCharacters,
    phoneCharacters,
    characterColors,
    viewedPhoneCharacter,
    phoneGalleryImages,
    selectChatCharacter,
    rememberChatCharacter,
    phoneConversationInfo,
    openPhoneConversation,
    phoneContacts,
    selectedPhoneContact,
    openPhoneContact,
    phoneSwitchTargetPlayable,
    switchActivePlayer,
    selectedPhoneConversation,
    selectedPhoneDividerAfterId,
    eventManagerAvailable,
    upcomingEvents,
    selectedEvent,
    selectedEventId,
    setSelectedEventId,
    closeEvent,
    cancelEvent,
    unreadPhoneConversations,
    unreadPhoneNotificationCount,
    viewedPhoneHasNotifications,
    unreadPhoneSwitchName,
    openUnreadPhoneConversation,
    openEmbeddedPhoneMessage,
    openEmbeddedSocialMessage,
    openSocialPost,
    socialPostOpenRequest,
    socialDirectMessageOpenRequest,
    socialImageById,
    socialLikesByAccount,
    setSocialLikesByAccount,
    socialDirectoryUsers: socialDirectory.users,
    fotogramContactsByCharacter,
    dynamicSocialUsers: socialDirectory.dynamicUsers,
    setDynamicSocialUsers,
    socialConnectionsByCharacter,
    setSocialConnectionsByCharacter,
    addSocialConnection,
    phoneNotesByCharacter,
    setPhoneNotesByCharacter,
    chatGpdChatsByCharacter,
    setChatGpdChatsByCharacter,
    toggleSocialLike,
    onlyFriendsPurchasesByCharacter,
    setOnlyFriendsPurchasesByCharacter,
    unlockOnlyFriendsPost,
    unreadEventCount,
    unreadChatCount,
    unreadBankingCount,
    markViewedBankingSeen,
    phoneAppNotificationCounts,
    markViewedPhoneAppSeen,
    phoneAppSeenByCharacter,
    setPhoneAppSeenByCharacter,
    phoneAuthorBadgesEnabled,
    changePhoneAuthorBadgesEnabled,
    autoTurnDisabled,
    autoTurnTitle,
    switchPlayerDisabled,
    switchPlayerTitle,
    highlightedPhoneMessage,
    highlightedEventIds,
    phoneSeenByConversation,
    setPhoneSeenByConversation,
    bankingSeenByCharacter,
    setBankingSeenByCharacter,
    bankingContactsByCharacter,
    setBankingContactsByCharacter,
    addBankingContact,
    markSelectedPhoneConversationSeen,
    phoneHomeRequestId,
    phoneDividerAfterByConversation,
    setPhoneDividerAfterByConversation,
    openedPhoneConversationKey,
    setOpenedPhoneConversationKey,
    phoneReplyToMessage,
    selectPhoneReply,
    clearPhoneReply,
    phoneDraft,
    setPhoneDraft,
    phoneDraftCommands,
    setPhoneDraftCommands,
    phoneImages,
    setPhoneImages,
    showPhoneEmojiPicker,
    setShowPhoneEmojiPicker,
    recentlyUsedEmojis,
    setRecentlyUsedEmojis,
    setRecentChatCharacterIds,
    chatThreadRef,
    phoneImageInputRef,
    phoneEmojiPickerRef,
    phoneThreadRef,
    scrollPhoneThreadToBottom,
    scrollChatThreadToBottomIfFollowing,
    selectPhoneReplyFromComposer,
    selectPhoneGalleryImageFromComposer,
    selectPhoneEmoji,
    parseStorybookJson: parseRpStorybookJson,
    narratorSpeakerName,
  };
}
