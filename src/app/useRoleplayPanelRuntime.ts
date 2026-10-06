import { measureUiWork, markUiEvent } from '../diagnostics/uiPerformance';
import { usePanelNavigationState, usePanelNavigationReset } from '../navigation/usePanelNavigation';
import { interactedNpcIds } from '../characters/messageExchanges';
import { useStorybookContentNodes } from '../storybook/useStorybookContentNodes';
import { nextAutoScrollSpeed } from '../chat/autoScrollSpeed';
import { bankingRecipientByName } from '../chat/bankingRecipients';
import { hasAuthoredConnection } from '../characters/relationships';
import { automaticAccountLinkGrants, resolveAccountLink, type AccountLinkTarget } from '../chat/accountLinks';
import { whatsUpAccountId, whatsUpAlias, whatsUpAliasAccountId, whatsUpNamesUsedWith } from '../characters/messageIdentity';
import type { AccountLinkOpenRequest } from '../chat/accountLinkContext';
import { appCharacterImage } from '../characters/appRuntime';
import type { NpcParticipantReference } from '../characters/npcParticipants';
import { matchMeState, unreadMatchMeMatches } from '../chat/matchMe';
import { datingAccountId, datingAccountMatches } from '../chat/datingAccounts';
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
  phoneConversationKeyTwins,
  phoneMessagesForOwner,
  phoneRuntimeCharactersFromMessages,
  whatsUpAliasContact,
  type PhoneRuntimeCharacter,
} from '../chat/phoneCharacters';
import { phoneMarkersWithCurrentNames, phoneMessagesWithCurrentNames } from '../chat/phoneIdentity';
import { usePhoneReply } from '../chat/usePhoneReply';
import {
  bankTransferMessages,
  latestBankTransferMessageIdForCharacter,
  unreadBankTransferCountForCharacter,
  unreadBankTransfersForCharacter,
} from '../chat/bankTransfers';
import {
  bankTransferPhoneBanner,
  directMessagePhoneBanner,
  matchMeMatchPhoneBanner,
  phoneAppEntryPhoneBanner,
  socialReactionsPhoneBanner,
  whatsUpPhoneBanner,
  type PhoneBanner,
} from '../chat/phoneBanners';
import type { OnlyFriendsPurchasesByCharacter } from '../chat/onlyFriendsWallet';
import type {
  ChatGpdChatsByCharacter,
  PhoneNotesByCharacter,
} from '../chat/phoneAppsSessions';
import { normalizePhoneName } from '../chat/phoneMessages';
import {
  buildSocialDirectory,
  withSocialDirectoryConnectionAdded,
  withAuthoredSocialConnections,
  withSocialConnectionAdded,
  socialConnectionIds,
  type DynamicSocialUsers,
  type SocialConnectionsByCharacter,
} from '../chat/socialDirectory';
import {
  socialCharacterForPost,
  socialIdentityMatches,
  socialLikeAccountKey,
  socialMessageHiddenFromChat,
} from '../chat/socialMedia';
import { useCharacterColors } from './useCharacterColors';
import {
  chatAttachmentFromStorybookImage,
  storyCharactersFromNodes,
  type StorybookCharacter,
} from '../storybook/runtime';
import {
  embeddedPhoneMessageCharacters,
  matchingPhoneName,
  phoneContactsForViewer,
  phoneConversationInfoFromMessages,
  phoneConversationKey,
  selectedPhoneConversationMessages,
  phoneSwitchCharacters,
  phoneMessageVisibleText,
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
  type RpStorybook,
} from '../nodes/rp-storybook/model';
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
  SocialMessengerAppKind,
  SocialDirectMessageOpenRequest,
  SocialDmUnreadByHandle,
  SocialPostRecord,
  TurnRecord,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';

export type ChatPanelView = 'chat' | 'phone' | 'events';

const phoneAuthorBadgesStorageKey = 'rpgraph-phone-author-badges-enabled';
const chatReadsPhoneAppsStorageKey = 'rpgraph-chat-reads-phone-apps-enabled';
const chatAutoFollowBottomMargin = 48;

type UseRoleplayPanelRuntimeOptions = {
  appCharacters: StorybookCharacter[];
  captureNpcParticipants: (references: NpcParticipantReference[]) => void;
  nodeViewNodes: WorkflowNode[];
  nodesRef: { current: WorkflowNode[] };
  messages: MessageRecord[];
  turns: TurnRecord[];
  storybooksByNodeId: Map<string, RpStorybook>;
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
  appCharacters,
  captureNpcParticipants,
  nodeViewNodes,
  nodesRef,
  messages: storedMessages,
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
  const messages = useMemo(() => phoneMessagesWithCurrentNames(storedMessages, appCharacters), [storedMessages, appCharacters]);
  const [panelSessionRevision, setPanelSessionRevision] = useState(0);
  const [smoothChatAutoScrollActive, setSmoothChatAutoScrollActive] = useState(false);
  const resetPanelNavigation = usePanelNavigationReset(panelSessionRevision);
  const [storedChatPanelView, setChatPanelView] = usePanelNavigationState<ChatPanelView>('panel.chatPanelView', 'chat');
  // The graph decides which tabs exist: RP Output enables the phone (on unless
  // unchecked), and the Events tab needs an Event Manager node. Without an RP
  // Output node, as in an empty workspace, there is no phone.
  const phoneAvailable = useMemo(
    () => {
      const outputNodes = nodeViewNodes.filter((node) =>
        node.data.kind === undefined && node.data.nodeType === 'output');
      return outputNodes.length > 0 &&
        outputNodes.every((node) => node.data.outputPhoneEnabled !== false);
    },
    [nodeViewNodes],
  );
  const eventManagerNode = useMemo(
    () => nodeViewNodes.find((node) => node.data.kind === undefined && node.data.nodeType === 'event-manager'),
    [nodeViewNodes],
  );
  const eventManagerAvailable = !!eventManagerNode;
  const chatPanelView: ChatPanelView =
    (storedChatPanelView === 'phone' && !phoneAvailable) ||
    (storedChatPanelView === 'events' && !eventManagerAvailable)
      ? 'chat'
      : storedChatPanelView;
  const [selectedCharacterId, setSelectedCharacterId] = usePanelNavigationState('panel.selectedCharacterId', '');
  const [viewedPhoneCharacterId, setViewedPhoneCharacterId] = usePanelNavigationState('panel.viewedPhoneCharacterId', '');
  const [selectedPhoneCharacterId, setSelectedPhoneCharacterId] = usePanelNavigationState('panel.selectedPhoneCharacterId', '');
  const [selectedEventId, setSelectedEventId] = usePanelNavigationState('panel.selectedEventId', '');
  const [storedPhoneSeenByConversation, setPhoneSeenByConversation] = useState<Record<string, number>>({});
  const phoneSeenByConversation = useMemo(() => phoneMarkersWithCurrentNames(storedPhoneSeenByConversation, storedMessages, messages),
    [storedPhoneSeenByConversation, storedMessages, messages]);
  const [bankingSeenByCharacter, setBankingSeenByCharacter] = useState<Record<string, number>>({});
  const [phoneAppSeenByCharacter, setPhoneAppSeenByCharacter] = useState<Record<string, number>>({});
  const [bankingContactsByCharacter, setBankingContactsByCharacter] = useState<Record<string, string[]>>({});
  // Liked post ids per "characterId/app" account key; part of the RP save.
  const [socialLikesByAccount, setSocialLikesByAccount] = useState<Record<string, string[]>>({});
  const [savedDynamicSocialUsers, setDynamicSocialUsers] = useState<DynamicSocialUsers>({});
  const [savedSocialConnectionsByCharacter, setSocialConnectionsByCharacter] =
    useState<SocialConnectionsByCharacter>({});
  // Notes and ChatGPD chats per character id; part of the RP save.
  const [phoneNotesByCharacter, setPhoneNotesByCharacter] = useState<PhoneNotesByCharacter>({});
  const [chatGpdChatsByCharacter, setChatGpdChatsByCharacter] = useState<ChatGpdChatsByCharacter>({});
  const [onlyFriendsPurchasesByCharacter, setOnlyFriendsPurchasesByCharacter] =
    useState<OnlyFriendsPurchasesByCharacter>({});
  const [phoneHomeRequestId, setPhoneHomeRequestId] = usePanelNavigationState('panel.phoneHomeRequestId', 0, false);
  // Opens an app that has no finer-grained open request (Banking, Notes, ChatGPD).
  const [phoneAppOpenRequest, setPhoneAppOpenRequest] = usePanelNavigationState<{
    requestId: number;
    app: 'banking' | 'notes' | 'ai';
  }>('panel.phoneAppOpenRequest');
  // Mirrors the screen shown inside PhonePanel so turn actions can follow it.
  const [phoneScreen, setPhoneScreen] = useState('desktop');
  const accountLinkRequestId = useRef(0);
  const [accountLinkOpenRequest, setAccountLinkOpenRequest] = usePanelNavigationState<AccountLinkOpenRequest>('panel.accountLinkOpenRequest');
  const [socialPostOpenRequest, setSocialPostOpenRequest] = usePanelNavigationState<{
    requestId: number;
    app: SocialPostRecord['app'];
    postId: string;
  }>('panel.socialPostOpenRequest');
  const [socialDirectMessageOpenRequest, setSocialDirectMessageOpenRequest] =
    usePanelNavigationState<SocialDirectMessageOpenRequest>('panel.socialDirectMessageOpenRequest');
  const [phoneDividerAfterByConversation, setPhoneDividerAfterByConversation] = useState<Record<string, number>>({});
  const previousPhoneMessages = useRef(messages);
  useEffect(() => {
    const previous = previousPhoneMessages.current;
    previousPhoneMessages.current = messages;
    // Preserve markers across successive renames, even without a new message
    // recorded under the intermediate name.
    setPhoneSeenByConversation((current) => phoneMarkersWithCurrentNames(current, previous, messages));
    setPhoneDividerAfterByConversation((current) => phoneMarkersWithCurrentNames(current, previous, messages));
  }, [messages]);
  // A deliberate choice of WhatsUp name for one conversation; without one the known name continues.
  const [phoneSenderNameByConversation, setPhoneSenderNameByConversation] = useState<Record<string, { name: 'real' | 'alias'; count: number }>>({});
  const [recentlyUsedEmojis, setRecentlyUsedEmojis] = useState<string[]>([]);
  const [recentChatCharacterIds, setRecentChatCharacterIds] = useState<string[]>([]);
  const [openedPhoneConversationKey, setOpenedPhoneConversationKey] = usePanelNavigationState('panel.openedPhoneConversationKey', '');
  const [phoneAuthorBadgesEnabled, setPhoneAuthorBadgesEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(phoneAuthorBadgesStorageKey) === 'true';
    } catch {
      return false;
    }
  });
  const [chatReadsPhoneAppsEnabled, setChatReadsPhoneAppsEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(chatReadsPhoneAppsStorageKey) !== 'false';
    } catch {
      return true;
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
  const chatScrollRequestFrameRef = useRef(0);
  const chatScrollRequestBehaviorRef = useRef<ScrollBehavior | null>(null);
  const chatAutoFollowAnimationTimeRef = useRef<number | null>(null);
  const chatAutoFollowAnimatingRef = useRef(false);
  const chatAutoFollowProgrammaticScrollRef = useRef(false);
  const chatAutoFollowProgrammaticClearFrameRef = useRef(0);
  const phoneImageInputRef = useRef<HTMLInputElement | null>(null);
  const phoneEmojiPickerRef = useRef<HTMLDivElement | null>(null);
  const phoneThreadRef = useRef<HTMLDivElement | null>(null);

  const {
    replyToMessage: phoneReplyToMessage,
    selectReply: selectPhoneReply,
    clearReply: clearPhoneReply,
  } = usePhoneReply(openedPhoneConversationKey);

  function resetPanelSession() {
    resetPanelNavigation();
    // A new session can reuse every character and message ID. Explicitly
    // invalidate component-local profiles, drafts, and navigation in that case.
    setCharacterColorSlots({});
    setPanelSessionRevision((revision) => revision + 1);
    setSelectedCharacterId('');
    setViewedPhoneCharacterId('');
    setSelectedPhoneCharacterId('');
    setSelectedEventId('');
    setAccountLinkOpenRequest(undefined);
    setSocialPostOpenRequest(undefined);
    setSocialDirectMessageOpenRequest(undefined);
    setHighlightedPhoneMessage(undefined);
    setLastSeenMessageRecordId(0);
    setSeenEventIds(new Set());
    setHighlightedEventIds(new Set());
    setPhoneDraft('');
    setPhoneDraftCommands([]);
    setPhoneImages([]);
    setShowPhoneEmojiPicker(false);
    clearPhoneReply();
  }

  const storybookContentNodes = useStorybookContentNodes(nodeViewNodes);
  const storyCharacters: StorybookCharacter[] = useMemo(
    () => storyCharactersFromNodes(storybookContentNodes),
    [storybookContentNodes],
  );
  const playerCharacters = useMemo(
    () => storyCharacters.filter((character) => character.playerSelectable !== false),
    [storyCharacters],
  );
  const socialDirectory = useMemo(
    () => measureUiWork('phone.socialDirectory', () => buildSocialDirectory({
      storyCharacters: appCharacters,
      messages,
      savedDynamicUsers: savedDynamicSocialUsers,
    })),
    [messages, savedDynamicSocialUsers, appCharacters],
  );
  const persistedSocialConnectionsByCharacter = useMemo(() => measureUiWork('phone.accountLinkGrants', () => {
    let connections = savedSocialConnectionsByCharacter;
    for (const { owner, link } of automaticAccountLinkGrants(messages, appCharacters)) {
      if (link.app === 'matchme' || link.app === 'banking') continue;
      const user = socialDirectory.users.find((entry) => entry.characterId === link.character.id);
      const targetId = link.app === 'whatsup' ? link.accountId : user?.id;
      if (targetId) connections = withSocialConnectionAdded(connections, owner.sourceId, link.app, targetId);
    }
    return connections;
  }), [savedSocialConnectionsByCharacter, messages, appCharacters, socialDirectory]);
  const socialConnectionsByCharacter = useMemo(() => measureUiWork('phone.authoredConnections', () => withAuthoredSocialConnections(
    persistedSocialConnectionsByCharacter, appCharacters, socialDirectory.users,
  )), [persistedSocialConnectionsByCharacter, appCharacters, socialDirectory.users]);
  const phoneCharacters = useMemo(
    () => measureUiWork('phone.runtimeCharacters', () => phoneRuntimeCharactersFromMessages(appCharacters, messages,
      new Set(Object.values(socialConnectionsByCharacter).flatMap((apps) => apps.whatsup ?? [])))),
    [messages, appCharacters, socialConnectionsByCharacter],
  );
  const characterActivity = useMemo(() => [
    [...storybooksByNodeId.values()].map((book) => book.openingHistory),
    turns, messages, socialLikesByAccount, persistedSocialConnectionsByCharacter,
    phoneNotesByCharacter, chatGpdChatsByCharacter,
  ], [storybooksByNodeId, turns, messages, socialLikesByAccount, persistedSocialConnectionsByCharacter,
    phoneNotesByCharacter, chatGpdChatsByCharacter]);
  const interactedCharacterIds = useMemo(() => measureUiWork('characters.interactedIds', () =>
    interactedNpcIds(messages, appCharacters)), [appCharacters, messages]);
  const { characterColors, characterColorSlots, setCharacterColorSlots, characterColorStyle } =
    useCharacterColors(appCharacters, playerCharacters, interactedCharacterIds);
  const fotogramContactsByCharacter = useMemo(
    () => Object.fromEntries(storyCharacters.map((viewer) => [
      viewer.id,
      storyCharacters.flatMap((contact) => {
        if (viewer.relationships !== undefined || viewer.id === contact.id) {
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
  if (selectedCharacterId && selectedCharacterId !== narratorCharacterId &&
      !playerCharacters.some((character) => character.id === selectedCharacterId)) {
    setSelectedCharacterId(playerCharacters[0]?.id ?? narratorCharacterId);
  }
  const selectedCharacter =
    selectedCharacterId === narratorCharacterId
      ? undefined
      : playerCharacters.find((character) => character.id === selectedCharacterId) ?? playerCharacters[0];
  const narratorSelected = selectedCharacterId === narratorCharacterId;
  const viewedPhoneCharacter =
    narratorSelected
      ? phoneCharacters.find((character) => character.id === viewedPhoneCharacterId) ?? playerCharacters[0]
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

  const phoneAppNotifications = useMemo(() => measureUiWork('phone.notifications', () => {
    const byCharacter = new Map<string, {
      counts: Record<'notes' | 'ai' | 'fotogram' | 'onlyfriends' | 'matchme', number>;
      unreadDirectMessages: Record<SocialMessengerAppKind, SocialDmUnreadByHandle>;
      banners: PhoneBanner[];
    }>();
    // DMs rendered as embedded app blocks inside a chat bubble were already
    // read there, so they produce no app notification while the option is on.
    const chatEmbeddedSocialIds = new Set(
      chatReadsPhoneAppsEnabled
        ? messages.flatMap((message) =>
            message.embeddedSocialMessages?.map((link) => link.socialMessageId) ?? [])
        : [],
    );
    const datingState = matchMeState(storyCharacters, messages);
    storyCharacters.forEach((character) => {
      const seen = (app: string) => phoneAppSeenByCharacter[`${character.id}:${app}`] ?? 0;
      const count = (app: string, matches: (message: MessageRecord) => boolean) =>
        messages.filter((message) => !message.isOpening && message.id > seen(app) && matches(message)).length;
      const ownedPostIds = new Set(messages.flatMap((message) =>
        message.socialPost?.author === character.name ? [message.socialPost.postId] : []
      ));
      // One badge per unread DM conversation and per post with unread
      // reactions, instead of one badge per message. DM conversations keep
      // their own seen id (marked when the thread is opened, like phone
      // conversations); reactions clear with the app-level seen id.
      const banners: PhoneBanner[] = [];
      const socialApp = (app: SocialMessengerAppKind) => {
        const unreadDms: SocialDmUnreadByHandle = {};
        const latestDmByHandle = new Map<string, MessageRecord>();
        messages.forEach((message) => {
          const directMessage = message.socialDirectMessage;
          if (
            message.isOpening ||
            directMessage?.app !== app ||
            (app === 'matchme' ? !datingAccountMatches(character, directMessage.toAccountId) : directMessage.to !== character.name) ||
            chatEmbeddedSocialIds.has(message.id)
          ) {
            return;
          }
          const handleKey = app === 'matchme' ? directMessage.fromHandle : directMessage.fromHandle.toLowerCase();
          const dmSeen = phoneAppSeenByCharacter[`${character.id}:${app}:dm:${handleKey}`] ?? 0;
          if (message.id <= dmSeen) {
            return;
          }
          const existing = unreadDms[handleKey] ?? { count: 0, tipTotal: 0 };
          unreadDms[handleKey] = {
            count: existing.count + 1,
            tipTotal: existing.tipTotal + (directMessage.tip ?? 0),
          };
          latestDmByHandle.set(handleKey, message);
        });
        latestDmByHandle.forEach((message, handleKey) => banners.push(
          directMessagePhoneBanner(message.id, message.socialDirectMessage!, unreadDms[handleKey].count)));
        const latestReactionsByPostId = new Map<string, MessageRecord>();
        messages.forEach((message) => {
          if (
            !message.isOpening &&
            message.id > seen(app) &&
            message.socialReactions?.app === app &&
            ownedPostIds.has(message.socialReactions.postId)
          ) {
            latestReactionsByPostId.set(message.socialReactions.postId, message);
          }
        });
        latestReactionsByPostId.forEach((message) => banners.push(
          socialReactionsPhoneBanner(message.id, message.socialReactions!)));
        return {
          count: Object.keys(unreadDms).length + latestReactionsByPostId.size,
          unreadDms,
        };
      };
      const fotogram = socialApp('fotogram');
      const onlyfriends = socialApp('onlyfriends');
      const matchme = socialApp('matchme');
      const newMatches = unreadMatchMeMatches(datingAccountId(character), datingState, messages,
        (partnerId) => phoneAppSeenByCharacter[`${character.id}:matchme:dm:${partnerId}`] ?? 0);
      for (const [partnerId, newMatchId] of Object.entries(newMatches)) {
        if (!matchme.unreadDms[partnerId]) matchme.count += 1;
        matchme.unreadDms[partnerId] = { ...(matchme.unreadDms[partnerId] ?? { count: 0, tipTotal: 0 }), newMatchId };
        banners.push(matchMeMatchPhoneBanner(newMatchId, partnerId,
          datingState.accounts.find((account) => account.id === partnerId)?.name ?? 'New match'));
      }
      (['notes', 'ai'] as const).forEach((app) => {
        const title = (message: MessageRecord) => {
          const commit = app === 'notes' ? message.createdPhoneNote : message.simulatedAiChat;
          if (commit?.characterId !== character.id) return undefined;
          return 'note' in commit ? commit.note.title : commit.chat.title;
        };
        const latest = messages.filter((message) =>
          !message.isOpening && message.id > seen(app) && title(message) !== undefined).slice(-1)[0];
        if (latest) banners.push(phoneAppEntryPhoneBanner(app, latest.id, title(latest) ?? ''));
      });
      byCharacter.set(character.id, {
        counts: {
          notes: count('notes', (message) => message.createdPhoneNote?.characterId === character.id),
          ai: count('ai', (message) => message.simulatedAiChat?.characterId === character.id),
          fotogram: fotogram.count,
          onlyfriends: onlyfriends.count,
          matchme: matchme.count,
        },
        unreadDirectMessages: {
          fotogram: fotogram.unreadDms,
          onlyfriends: onlyfriends.unreadDms,
          matchme: matchme.unreadDms,
        },
        banners,
      });
    });
    return byCharacter;
  }), [chatReadsPhoneAppsEnabled, messages, phoneAppSeenByCharacter, storyCharacters]);
  const phoneAppNotificationCounts = phoneAppNotifications.get(viewedPhoneCharacter?.id ?? '')?.counts ?? {
    notes: 0,
    ai: 0,
    fotogram: 0,
    onlyfriends: 0,
    matchme: 0,
  };
  const unreadSocialDirectMessages = phoneAppNotifications.get(viewedPhoneCharacter?.id ?? '')
    ?.unreadDirectMessages ?? { fotogram: {}, onlyfriends: {}, matchme: {} };

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

  const markViewedSocialDmSeen = useCallback((app: SocialMessengerAppKind, partnerHandle: string) => {
    if (!viewedPhoneCharacter) {
      return;
    }
    const latestId = messages.reduce((highest, message) => Math.max(highest, message.id), 0);
    const key = `${viewedPhoneCharacter.id}:${app}:dm:${app === 'matchme' ? partnerHandle : partnerHandle.toLowerCase()}`;
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
    if (characterId !== narratorCharacterId && !playerCharacters.some((character) => character.id === characterId)) {
      return;
    }
    if (characterId === narratorCharacterId && viewedPhoneCharacter) {
      // Keep showing the current character's phone while the narrator plays.
      setViewedPhoneCharacterId(viewedPhoneCharacter.id);
    }
    setAccountLinkOpenRequest(undefined);
    setSelectedCharacterId(characterId);
    if (characterId !== narratorCharacterId) {
      rememberChatCharacter(characterId);
    }
  }

  const phoneConversationInfo = useMemo(() => {
    return measureUiWork('phone.conversations', () => phoneConversationInfoFromMessages(messages, phoneSeenByConversation));
  }, [messages, phoneSeenByConversation]);
  // History may name a participant differently than the character, so a
  // conversation is attributed to the characters its names resolve to.
  // The owner of a second WhatsUp name reads both names as one inbox on their own phone.
  const viewedPhoneHasAlias = !!whatsUpAlias(viewedPhoneCharacter);
  const viewerPhoneMessages = useMemo(
    () => phoneMessagesForOwner(messages, viewedPhoneCharacter),
    [messages, viewedPhoneCharacter],
  );
  const viewerPhoneConversationInfo = useMemo(() => {
    if (!viewedPhoneHasAlias) return phoneConversationInfo;
    const seen = { ...phoneSeenByConversation };
    for (const [key, latestId] of Object.entries(phoneSeenByConversation)) {
      for (const twin of phoneConversationKeyTwins(key, viewedPhoneCharacter)) seen[twin] = Math.max(seen[twin] ?? 0, latestId);
    }
    return phoneConversationInfoFromMessages(viewerPhoneMessages, seen);
  }, [viewedPhoneHasAlias, phoneConversationInfo, phoneSeenByConversation, viewerPhoneMessages, viewedPhoneCharacter]);
  const phoneConversationPairs = useMemo(() => new Set(
    [...phoneConversationInfo.values(), ...(viewedPhoneHasAlias ? viewerPhoneConversationInfo.values() : [])].flatMap(({ names }) => {
      const [left, right] = names.map((name) => matchingPhoneName(phoneCharacters, name));
      return left && right ? [phoneConversationKey(left.name, right.name)] : [];
    }),
  ), [phoneCharacters, phoneConversationInfo, viewedPhoneHasAlias, viewerPhoneConversationInfo]);

  const phoneContactVisibleForViewer = useCallback((
    viewer: PhoneRuntimeCharacter | undefined,
    contact: PhoneRuntimeCharacter,
  ) => {
    if (!viewer || viewer.id === contact.id || contact.whatsUpAliasOf?.sourceId === viewer.sourceId) {
      return false;
    }
    // A shared link reveals exactly the name it carried: the real account or the second name.
    const sharedPhoneIds = socialConnectionIds(socialConnectionsByCharacter, viewer.id, 'whatsup', appCharacters);
    const contactAccountId = whatsUpAccountId(contact);
    if (sharedPhoneIds.some((id) => resolveAccountLink('whatsup', id, appCharacters)?.accountId === contactAccountId)) return true;
    if (phoneConversationPairs.has(phoneConversationKey(viewer.name, contact.name))) {
      return true;
    }
    if (viewer.relationships !== undefined) return hasAuthoredConnection(viewer, contact, 'whatsup');
    if (viewer.storybookNodeId && viewer.storybookNodeId === contact.storybookNodeId) {
      const storybook = storybooksByNodeId.get(viewer.storybookNodeId);
      if (storybook) {
        return rpStorybookPhoneContactAllowed(storybook, viewer.sourceId, contact.sourceId);
      }
    }
    return viewer.relationships === undefined && !viewer.temporaryPhone && !contact.temporaryPhone && !viewer.libraryNpc && !contact.libraryNpc;
  }, [phoneConversationPairs, storybooksByNodeId, socialConnectionsByCharacter, appCharacters]);

  const markPhoneConversationsSeen = useCallback((updates: Array<{ key: string; latestId: number }>, owner: StorybookCharacter | undefined) => {
    if (updates.length === 0) {
      return;
    }
    setPhoneSeenByConversation((current) => {
      let changed = false;
      const next = { ...current };
      // Reading a conversation also reads its second-name twin; both are one inbox.
      updates.flatMap((update) => [update, ...phoneConversationKeyTwins(update.key, owner)
        .map((key) => ({ key, latestId: update.latestId }))]).forEach(({ key, latestId }) => {
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
    let readingOwner = viewedPhoneCharacter;
    if (select) {
      let { speakerId, contactId } = select;
      if (select.activatePlayer ?? true) {
        if (!playerCharacters.some((character) => character.id === speakerId) &&
            playerCharacters.some((character) => character.id === contactId)) {
          [speakerId, contactId] = [contactId, speakerId];
        }
        setSelectedCharacterId(playerCharacters.some((character) => character.id === speakerId)
          ? speakerId : narratorCharacterId);
      }
      setViewedPhoneCharacterId(speakerId);
      setSelectedPhoneCharacterId(contactId);
      readingOwner = phoneCharacters.find((character) => character.id === speakerId);
    }
    setOpenedPhoneConversationKey(conversationKey);
    setPhoneDividerAfterByConversation((current) => ({
      ...current,
      [conversationKey]: seenBefore,
    }));
    markPhoneConversationsSeen([{ key: conversationKey, latestId }], readingOwner);
  }, [markPhoneConversationsSeen, phoneSeenByConversation, playerCharacters, phoneCharacters, viewedPhoneCharacter, setOpenedPhoneConversationKey, setSelectedPhoneCharacterId, setViewedPhoneCharacterId, setSelectedCharacterId]);

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
        messages: viewerPhoneMessages,
        conversations: viewerPhoneConversationInfo,
        characterColors,
        fallbackColor: '#e8edf3',
        englishProcessingEnabled,
      },
    ),
    [
      characterColors,
      englishProcessingEnabled,
      viewerPhoneMessages,
      viewerPhoneConversationInfo,
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
    .map((id) => playerCharacters.find((character) => character.id === id))
    .filter((character): character is StorybookCharacter => !!character);
  const chatSwitchTarget =
    recentChatCharacters.find((character) => character.id !== selectedCharacter?.id);
  const phoneSwitchTargetPlayable = !!selectedPhoneContact && playerCharacters.some(
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
      viewerPhoneConversationInfo.get(selectedPhoneContact.conversationKey)?.latestId ??
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
    return selectedPhoneConversationMessages(viewerPhoneMessages, viewedPhoneCharacter, selectedPhoneContact);
  }, [viewerPhoneMessages, selectedPhoneContact, viewedPhoneCharacter]);
  // The account the viewed character writes from: the one this conversation last used, until switched by hand.
  // A hand-made choice holds until the conversation moves on, so a message to the other account is followed again.
  const viewedPhoneAlias = whatsUpAlias(viewedPhoneCharacter);
  const phoneNamesUsed = viewedPhoneCharacter && viewedPhoneAlias && selectedPhoneContact
    ? whatsUpNamesUsedWith(viewedPhoneCharacter, selectedPhoneContact.character.name, messages,
        // A history-only contact has no account of its own; its messages are matched by name.
        selectedPhoneContact.character.apps?.whatsup?.accountId)
    : undefined;
  const phoneSenderChoiceKey = viewedPhoneCharacter && selectedPhoneContact
    ? JSON.stringify([whatsUpAccountId(viewedPhoneCharacter), whatsUpAccountId(selectedPhoneContact.character)]) : undefined;
  const storedPhoneSenderChoice = phoneSenderChoiceKey ? phoneSenderNameByConversation[phoneSenderChoiceKey] : undefined;
  const phoneSenderChoice = storedPhoneSenderChoice && storedPhoneSenderChoice.count === phoneNamesUsed?.count
    ? storedPhoneSenderChoice.name
    : undefined;
  const phoneWritesAsAlias = !!phoneNamesUsed && (phoneSenderChoice ?? phoneNamesUsed.latest) === 'alias';
  const phoneSenderAccountId = viewedPhoneCharacter && viewedPhoneAlias && selectedPhoneContact
    ? phoneWritesAsAlias ? whatsUpAliasAccountId(viewedPhoneCharacter) : whatsUpAccountId(viewedPhoneCharacter)
    : undefined;
  // The contact has only ever seen the other account, so this one reaches them as a stranger.
  const phoneSenderUnknownToContact = !!phoneNamesUsed && phoneNamesUsed.known.size > 0 &&
    !phoneNamesUsed.known.has(phoneWritesAsAlias ? 'alias' : 'real');
  const setPhoneWritesAsAlias = (alias: boolean) => {
    if (phoneSenderChoiceKey) {
      setPhoneSenderNameByConversation((current) => ({
        ...current,
        [phoneSenderChoiceKey]: { name: alias ? 'alias' : 'real', count: phoneNamesUsed?.count ?? 0 },
      }));
    }
  };
  const selectedPhoneDividerAfterId = selectedPhoneContact
    ? phoneDividerAfterByConversation[selectedPhoneContact.conversationKey]
    : undefined;
  const selectedPhoneConversationKey = selectedPhoneContact?.conversationKey;
  const selectedPhoneConversationLatestId = selectedPhoneConversationKey
    ? viewerPhoneConversationInfo.get(selectedPhoneConversationKey)?.latestId ?? 0
    : 0;
  const markSelectedPhoneConversationSeen = useCallback(() => {
    if (!selectedPhoneConversationKey || selectedPhoneConversationLatestId <= 0) {
      return;
    }
    markPhoneConversationsSeen([{
      key: selectedPhoneConversationKey,
      latestId: selectedPhoneConversationLatestId,
    }], viewedPhoneCharacter);
  }, [
    markPhoneConversationsSeen,
    viewedPhoneCharacter,
    selectedPhoneConversationKey,
    selectedPhoneConversationLatestId,
  ]);

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
    (total, entry) => total + Object.values(entry.counts).reduce((sum, count) => sum + count, 0),
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
      const appUnreadCount = Object.values(phoneAppNotifications.get(character.id)?.counts ?? {}).reduce(
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
    if (!phoneAvailable) {
      return;
    }
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
    if (!phoneAvailable) {
      return;
    }
    const named = embeddedPhoneMessageCharacters(phoneCharacters, message);
    // A message addressed to a second name opens on its owner's phone, or on the
    // sender's when the owner has no phone here; a second name has no phone of its own.
    const aliasOwner = named.viewer?.whatsUpAliasOf
      ? phoneCharacters.find((character) => character.id === named.viewer!.whatsUpAliasOf!.id) : undefined;
    const viewer = named.viewer?.whatsUpAliasOf ? aliasOwner ?? named.contact : named.viewer;
    const contact = named.viewer?.whatsUpAliasOf && !aliasOwner ? named.viewer : named.contact;
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
    setHighlightedPhoneMessage({
      id: message.phoneMessageId,
      pulseKey: ++accountLinkRequestId.current,
    });
    selectChatPanelView('phone');
  }

  function openAccountLink(link: AccountLinkTarget) {
    const owner = (chatPanelView === 'phone' ? viewedPhoneCharacter : selectedCharacter) ?? viewedPhoneCharacter;
    if (!owner || isRunning || !phoneAvailable) return;
    const target = resolveAccountLink(link.app, link.app === 'banking' ? link.characterId : link.accountId, appCharacters);
    if (!target || target.characterId !== link.characterId) {
      notifySystem('warning', 'This shared account is unavailable.');
      return;
    }
    if (owner.sourceId === target.characterId) return;
    if (target.app === 'banking') {
      addBankingContact(owner.id, target.name);
    } else {
      if (target.app === 'whatsup') {
        setSocialConnectionsByCharacter((current) => withSocialConnectionAdded(current, owner.sourceId, 'whatsup', target.accountId));
        const linkedContact = target.accountId === whatsUpAccountId(target.character)
          ? target.character : whatsUpAliasContact(target.character) ?? target.character;
        openPhoneConversation(phoneConversationKey(owner.name, linkedContact.name), 0,
          { speakerId: owner.id, contactId: linkedContact.id, activatePlayer: false });
      } else if (target.app !== 'matchme') {
        const user = socialDirectory.users.find((entry) => entry.characterId === target.character.id);
        if (!user) { notifySystem('warning', 'This shared social account is unavailable.'); return; }
        addSocialConnection(owner.id, target.app, user.id);
      }
    }
    setViewedPhoneCharacterId(owner.id);
    setHighlightedPhoneMessage(undefined);
    setSocialPostOpenRequest(undefined);
    setSocialDirectMessageOpenRequest(undefined);
    setAccountLinkOpenRequest({ requestId: -(++accountLinkRequestId.current),
      app: target.app, accountId: target.accountId, name: target.name, username: target.username });
    setChatPanelView('phone');
  }

  function openEmbeddedSocialMessage(message: EmbeddedSocialMessageLink) {
    if (!phoneAvailable) {
      return;
    }
    const directMessage = messages.find((entry) => entry.id === message.socialMessageId)
      ?.socialDirectMessage;
    if (!directMessage) {
      notifySystem('warning', 'Could not find the linked social message.');
      return;
    }
    const characterForIdentity = (name: string, handle: string) =>
      storyCharacters.find((character) => {
        if (directMessage.app === 'matchme') return !!character.social.plotTwist && datingAccountMatches(character, handle);
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
    const owner = [senderCharacter, recipientCharacter].find((character) => character && character.playerSelectable !== false)
      ?? senderCharacter ?? recipientCharacter;
    if (!owner) {
      notifySystem('warning', 'Could not find a Storybook participant for this social conversation.');
      return;
    }
    setAccountLinkOpenRequest(undefined);
    const ownerIsSender = owner.id === senderCharacter?.id;
    setSelectedCharacterId(owner.playerSelectable !== false ? owner.id : narratorCharacterId);
    setViewedPhoneCharacterId(owner.id);
    if (owner.playerSelectable !== false) rememberChatCharacter(owner.id);
    setHighlightedPhoneMessage(undefined);
    setSocialPostOpenRequest(undefined);
    setSocialDirectMessageOpenRequest({
      requestId: ++accountLinkRequestId.current,
      app: directMessage.app,
      messageId: directMessage.messageId,
      participantName: ownerIsSender ? directMessage.to : directMessage.from,
      participantHandle: ownerIsSender ? directMessage.toHandle : directMessage.fromHandle,
    });
    setChatPanelView('phone');
  }

  // Posted photos are stored as Storybook/Gallery image ids; resolve the
  // pixels from the image library wherever a post is rendered.
  const socialImageById = useCallback(
    (imageId: string, ownerId?: string) => {
      const image = appCharacterImage(appCharacters, imageId, ownerId);
      return image ? chatAttachmentFromStorybookImage(image) : undefined;
    },
    [appCharacters],
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
    if (!phoneAvailable) {
      return;
    }
    if (post.app === 'onlyfriends') {
      const author = socialCharacterForPost(post, storyCharacters);
      if (!author) {
        notifySystem('warning', `Could not find the OnlyFriends post author "${post.author}".`);
        return;
      }
      setSelectedCharacterId(author.playerSelectable !== false ? author.id : narratorCharacterId);
      setViewedPhoneCharacterId(author.id);
      if (author.playerSelectable !== false) rememberChatCharacter(author.id);
    }
    setHighlightedPhoneMessage(undefined);
    setSocialDirectMessageOpenRequest(undefined);
    setAccountLinkOpenRequest(undefined);
    setSocialPostOpenRequest({
      requestId: ++accountLinkRequestId.current,
      app: post.app,
      postId: post.postId,
    });
    setChatPanelView('phone');
  }

  // Unread events of the viewed phone owner; the Phone view announces new ones as banners.
  const phoneBanners = useMemo((): PhoneBanner[] => viewedPhoneCharacter ? [
    ...phoneContacts.flatMap((contact) => {
      if (contact.unreadCount <= 0) return [];
      const latest = viewerPhoneMessages.find((message) => message.id === contact.latestPhoneId);
      return [whatsUpPhoneBanner(contact, latest && phoneMessageVisibleText(latest, englishProcessingEnabled))];
    }),
    ...(unreadBankingByCharacter.find((entry) => entry.character.id === viewedPhoneCharacter.id)?.transfers ?? [])
      .map((transaction) => bankTransferPhoneBanner(transaction.message.id, transaction.transfer)),
    ...(phoneAppNotifications.get(viewedPhoneCharacter.id)?.banners ?? []),
  ] : [], [englishProcessingEnabled, phoneAppNotifications, phoneContacts, unreadBankingByCharacter, viewedPhoneCharacter, viewerPhoneMessages]);

  function openPhoneBanner(banner: PhoneBanner) {
    if (!viewedPhoneCharacter || !phoneAvailable) {
      return;
    }
    const { target } = banner;
    setAccountLinkOpenRequest(undefined);
    setHighlightedPhoneMessage(undefined);
    setSocialPostOpenRequest(undefined);
    setSocialDirectMessageOpenRequest(undefined);
    const requestId = ++accountLinkRequestId.current;
    if (target.kind === 'whatsup') {
      openPhoneConversation(target.conversationKey, banner.messageId, {
        speakerId: viewedPhoneCharacter.id,
        contactId: target.contactId,
        activatePlayer: !narratorSelected,
      });
      setHighlightedPhoneMessage({ id: banner.messageId, pulseKey: requestId });
    } else if (target.kind === 'directMessage') {
      setSocialDirectMessageOpenRequest({
        requestId,
        app: target.app,
        messageId: target.messageId,
        participantName: target.participantName,
        participantHandle: target.participantHandle,
      });
    } else if (target.kind === 'post') {
      setSocialPostOpenRequest({ requestId, app: target.app, postId: target.postId });
    } else {
      setPhoneAppOpenRequest({ requestId, app: target.app });
    }
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

  function changeChatReadsPhoneAppsEnabled(enabled: boolean) {
    setChatReadsPhoneAppsEnabled(enabled);
    try {
      window.localStorage.setItem(chatReadsPhoneAppsStorageKey, String(enabled));
    } catch {
      // Non-critical UI preference.
    }
  }

  function addBankingContact(characterId: string, contactName: string) {
    const normalizedName = contactName.trim().replace(/\s+/g, ' ');
    if (!normalizedName) {
      return;
    }
    const owner = appCharacters.find((character) => character.id === characterId);
    const target = bankingRecipientByName(normalizedName, appCharacters, owner);
    if (!target) {
      return;
    }
    captureNpcParticipants([{ kind: 'character', id: target.sourceId || target.id }]);
    setBankingContactsByCharacter((current) => {
      const contacts = current[characterId] ?? [];
      if (contacts.some((name) => normalizePhoneName(name) === normalizePhoneName(target.name))) {
        return current;
      }
      return { ...current, [characterId]: [...contacts, target.name] };
    });
  }

  function selectChatPanelView(view: ChatPanelView) {
    if ((view === 'phone' && !phoneAvailable) || (view === 'events' && !eventManagerAvailable)) {
      return;
    }
    setAccountLinkOpenRequest(undefined);
    if (view === 'chat') {
      setLastSeenMessageRecordId(latestMessageRecordId);
    }
    if (view === 'events') {
      setHighlightedEventIds(new Set(newEventIds));
      setSeenEventIds(new Set(upcomingEvents.map((event) => event.id)));
    }
    if (view === 'phone') {
      setSocialPostOpenRequest(undefined);
      setSocialDirectMessageOpenRequest(undefined);
    }
    setChatPanelView(view);
  }

  function selectPhonePanelView() {
    if (!phoneAvailable) {
      return;
    }
    setHighlightedPhoneMessage(undefined);
    setSocialPostOpenRequest(undefined);
    setSocialDirectMessageOpenRequest(undefined);
    setAccountLinkOpenRequest(undefined);
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
    const availableOwners = narratorSelected
      ? phoneNotificationOwners
      : phoneNotificationOwners.filter((entry) => entry.character.playerSelectable !== false);
    if (availableOwners.length > 0) {
      const currentOwnerIndex = availableOwners.findIndex(
        (entry) => entry.character.id === viewedPhoneCharacter?.id,
      );
      const nextOwner = currentOwnerIndex >= 0
        ? availableOwners[(currentOwnerIndex + 1) % availableOwners.length]
        : availableOwners[0];
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
    setSocialDirectMessageOpenRequest(undefined);
    setAccountLinkOpenRequest(undefined);
    setPhoneHomeRequestId((current) => current + 1);
    return switchedOwner;
  }

  const autoTurnTargetName = selectedCharacter?.name;
  // A phone AutoTurn writes into the open conversation, so the remembered
  // contact only counts while that conversation is actually on screen. On the
  // phone desktop the same button starts a Phone Initiative turn instead.
  const phoneConversationOpen = phoneScreen === 'whatsup' && !!selectedPhoneContact;
  const phoneInitiativeAutoTurn = chatPanelView === 'phone' && phoneScreen === 'desktop';
  const autoTurnLabel =
    chatPanelView === 'events' ? 'Run Event' : phoneInitiativeAutoTurn ? 'AutoPhone' : 'AutoTurn';
  const autoTurnDisabled =
    isRunning ||
    characterStorybookNodeCount === 0 ||
    (chatPanelView === 'chat' && !selectedCharacter && !narratorSelected) ||
    (phoneInitiativeAutoTurn && (narratorSelected || !selectedCharacter)) ||
    (chatPanelView === 'phone' && !phoneInitiativeAutoTurn && !narratorSelected && !selectedCharacter) ||
    (chatPanelView === 'phone' && !phoneInitiativeAutoTurn && !phoneConversationOpen) ||
    (chatPanelView === 'events' && (!eventManagerAvailable || !selectedEvent));
  const autoTurnTitle =
    phoneInitiativeAutoTurn
      ? narratorSelected || !autoTurnTargetName
        ? 'Phone Initiative needs a player character'
        : `Phone Initiative for ${autoTurnTargetName} (same as pressing Enter twice)`
      : chatPanelView === 'phone'
      ? !phoneConversationOpen
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
    (chatPanelView === 'phone' && (!viewedPhoneCharacter || !phoneConversationOpen || !phoneSwitchTargetPlayable)) ||
    chatPanelView === 'events';
  const switchPlayerTitle =
    chatPanelView === 'phone'
      ? !phoneConversationOpen || !selectedPhoneContact
        ? 'Open a phone conversation first'
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
    chatScrollRequestBehaviorRef.current = null;
    if (chatScrollRequestFrameRef.current) {
      cancelAnimationFrame(chatScrollRequestFrameRef.current);
      chatScrollRequestFrameRef.current = 0;
    }
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
    setSmoothChatAutoScrollActive(false);
    chatAutoFollowAnimationTimeRef.current = null;
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

    // Keep fractional progress even when the browser rounds scrollTop writes.
    let scrollPosition = thread.scrollTop;
    const baseSpeed = validSmoothChatAutoScrollMinSpeed(smoothChatAutoScrollMinSpeed);
    let pixelsPerSecond = baseSpeed;
    const step = (timestamp: number) => {
      const currentThread = chatThreadRef.current;
      if (!currentThread || !chatAutoFollowBottomRef.current) {
        cancelChatAutoFollowAnimation();
        return;
      }

      const targetTop = measureUiWork('scroll.readLayout', () => Math.max(0, currentThread.scrollHeight - currentThread.clientHeight));
      const distance = targetTop - currentThread.scrollTop;
      if (distance <= 1) {
        markUiEvent('scroll.bottomReached');
        cancelChatAutoFollowAnimation();
        markChatProgrammaticScroll();
        currentThread.scrollTop = targetTop;
        return;
      }

      const previousTimestamp = chatAutoFollowAnimationTimeRef.current ?? timestamp;
      // Do not catch up after a blocked frame or a background-tab pause.
      const elapsedSeconds = Math.min(1 / 30, Math.max(0, (timestamp - previousTimestamp) / 1000));
      chatAutoFollowAnimationTimeRef.current = timestamp;
      pixelsPerSecond = nextAutoScrollSpeed(
        pixelsPerSecond, baseSpeed, distance, currentThread.clientHeight, elapsedSeconds,
      );
      const delta = pixelsPerSecond * elapsedSeconds;

      markChatProgrammaticScroll();
      scrollPosition = Math.min(targetTop, scrollPosition + delta);
      measureUiWork('scroll.writePosition', () => { currentThread.scrollTop = scrollPosition; });
      chatAutoFollowAnimationFrameRef.current = requestAnimationFrame(step);
    };

    if (!chatAutoFollowAnimationFrameRef.current) {
      markUiEvent('scroll.animationStarted');
      chatAutoFollowAnimatingRef.current = true;
      setSmoothChatAutoScrollActive(true);
      chatAutoFollowAnimationFrameRef.current = requestAnimationFrame(step);
    }
  }, [cancelChatAutoFollowAnimation, markChatProgrammaticScroll, smoothChatAutoScrollMinSpeed]);

  const scrollChatThreadToBottom = useCallback((behavior: ScrollBehavior = 'auto', onlyIfFollowing = false) => {
    // Multiple image loads and streamed updates can arrive before the next frame.
    // Keep one pending request, but never replace initial positioning with a
    // smooth follow request: that would animate the entire restored history.
    chatScrollRequestBehaviorRef.current =
      chatScrollRequestBehaviorRef.current === 'auto' ? 'auto' : behavior;
    if (chatScrollRequestFrameRef.current) {
      cancelAnimationFrame(chatScrollRequestFrameRef.current);
    }
    chatScrollRequestFrameRef.current = requestAnimationFrame(() => {
      chatScrollRequestFrameRef.current = 0;
      const requestedBehavior = chatScrollRequestBehaviorRef.current;
      chatScrollRequestBehaviorRef.current = null;
      const thread = chatThreadRef.current;
      if (!thread || (onlyIfFollowing && !chatAutoFollowBottomRef.current)) {
        return;
      }
      if (requestedBehavior === 'smooth') {
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
    // Re-engage auto-follow anywhere in the lower stretch of the viewport, not
    // only within a few pixels of the bottom, so "almost at the bottom" counts.
    const followMargin = Math.max(chatAutoFollowBottomMargin, thread.clientHeight * 0.1);
    return (
      thread.scrollHeight - thread.scrollTop - thread.clientHeight <= followMargin
    );
  }

  const scrollChatThreadToBottomIfFollowing = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (chatAutoFollowBottomRef.current) {
      scrollChatThreadToBottom(behavior, true);
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
    // Pause the follow animation while the user interacts (wheel, touch,
    // scrollbar drag, keys) so it never fights their input. Whether follow
    // stays engaged is decided purely by where actual scrolling ends up: a
    // click that scrolls nothing leaves auto-follow untouched.
    const markUserScrollIntent = () => {
      cancelChatAutoFollowAnimation();
    };
    const updateAutoFollow = () => {
      if (
        chatAutoFollowProgrammaticScrollRef.current ||
        chatAutoFollowAnimatingRef.current
      ) {
        chatAutoFollowBottomRef.current = true;
        return;
      }
      chatAutoFollowBottomRef.current = chatThreadIsNearBottom(thread);
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
  }, [cancelChatAutoFollowAnimation, chatPanelView, panelSessionRevision]);

  useEffect(() => {
    if (chatPanelView === 'chat') {
      chatAutoFollowBottomRef.current = true;
      scrollChatThreadToBottom();
    }
  }, [chatPanelView, panelSessionRevision, scrollChatThreadToBottom]);

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
    panelSessionRevision,
    resetPanelSession,
    chatPanelView,
    selectChatPanelView,
    selectPhonePanelView,
    phoneAvailable,
    cyclePhoneNotificationOwner,
    selectedCharacterId,
    setSelectedCharacterId,
    selectedCharacter,
    narratorSelected,
    storyCharacters,
    playerCharacters,
    phoneCharacters,
    characterColors,
    characterColorSlots,
    setCharacterColorSlots,
    characterColorStyle,
    characterActivity,
    interactedCharacterIds,
    viewedPhoneCharacter,
    phoneGalleryImages,
    selectChatCharacter,
    rememberChatCharacter,
    phoneConversationInfo,
    phoneSenderAccountId,
    phoneWritesAsAlias,
    phoneSenderUnknownToContact,
    setPhoneWritesAsAlias,
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
    persistedSocialConnectionsByCharacter,
    // Automatic grants are rebuilt from timeline messages. Saving the merged
    // view would turn them into permanent manual contacts after reload.
    savedSocialConnectionsByCharacter,
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
    markViewedSocialDmSeen,
    unreadSocialDirectMessages,
    phoneAppSeenByCharacter,
    setPhoneAppSeenByCharacter,
    phoneAuthorBadgesEnabled,
    changePhoneAuthorBadgesEnabled,
    chatReadsPhoneAppsEnabled,
    changeChatReadsPhoneAppsEnabled,
    autoTurnDisabled,
    autoTurnTitle,
    autoTurnLabel,
    phoneInitiativeAutoTurn,
    phoneScreen,
    setPhoneScreen,
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
    accountLinkContext: { characters: appCharacters, owner: (chatPanelView === 'phone' ? viewedPhoneCharacter : selectedCharacter) ?? viewedPhoneCharacter,
      disabled: isRunning, open: openAccountLink, request: accountLinkOpenRequest },
    phoneHomeRequestId,
    phoneAppOpenRequest,
    phoneBanners,
    openPhoneBanner,
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
    smoothChatAutoScrollActive,
    selectPhoneReplyFromComposer,
    selectPhoneGalleryImageFromComposer,
    selectPhoneEmoji,
    parseStorybookJson: parseRpStorybookJson,
    narratorSpeakerName,
  };
}
