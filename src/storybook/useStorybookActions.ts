import { characterUsageReasons, characterRemovalInfo, storybookWithRetiredCharacter } from '../characters/lifecycle';
import { openingHistoryNpcParticipantsFromNodes } from '../characters/npcParticipantRuntime';
import type { NpcLibraryEntry, NpcLibraryFileSummary, NpcLibrarySnapshot } from '../characters/npcLibrary';
import { characterReferenceCandidates, hydrateAddedCharacterReferences, relationshipReferenceContext, validateRelationshipTargets } from '../characters/relationships';
import { planCharacterImportToNode } from '../characters/promotion';
import type { EffectiveCharacterRegistry } from '../characters/registry';
import { appCharactersFromRegistry } from '../characters/appRuntime';
import type { NpcParticipantSnapshots } from '../characters/npcParticipants';
import { validateCandidateCharacterRegistry, validateCharacterAccountDirectory } from '../characters/profiles';
import { validateCandidateLegacySeedTimeline } from '../characters/publications';
import { validateCharacterPayload, characterPayload } from '../characters/character';
import { prepareV3Document, confirmV3Migration } from '../characters/migration';
import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { StorybookCreatorMessage } from '../components/AppDialogs';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import {
  emptyRpStorybook,
  normalizeRpStorybookCharacter,
  storybookNeedsUpdate,
  parseRpStorybookAssistantResult,
  parseRpStorybookJson,
  rpStorybookEditPrompt,
  rpStorybookIdentityLockViolations,
  rpStorybookJsonText,
  rpStorybookPromptJsonText,
  type RpStorybook,
} from '../nodes/rp-storybook/model';
import { resetCharacterStatsRuntimeData } from '../nodes/character-stats/runtime';
import type { SavedFileSummary, TurnRecord, WorkflowNode, WorkflowNodeData } from '../types';
import type { SystemLogLevel } from '../types';
import {
  appointmentEntitiesFromAppointments,
  appointmentsFromEventEntities,
  normalizeEventAppointments,
  removeEventEntities,
} from '../data-management/eventStore';
import { usedStorybookImageIdsRemoved } from './imageUsage';
import { isStorybookSourceNode } from './runtime';
import { withChangedStorybookImageDescriptionsSynchronized } from './imageLibrary';
import { turnsForStorybookOpeningHistory } from './openingHistoryRuntime';
import storybookFormatVersions from './formatVersions.json';
import {
  convertLegacyRpStorybook,
  isLegacyRpStorybookValue,
  type StorybookConversionResult,
} from './conversion';
import { rpCharacterCardForCharacter } from './characterCard';
import { storybookWithoutCharacter } from './characterManagement';
import { storybookAssistantConversationContext } from './assistantConversation';
import {
  sillyTavernImportInstruction,
  validateSillyTavernImportResult,
} from './sillyTavernImport';
import type { TurnCheckpoint } from '../data-management/types';
import type {
  ChatGpdChatsByCharacter,
  PhoneNotesByCharacter,
} from '../chat/phoneAppsSessions';
import type {
  DynamicSocialUsers,
  SocialConnectionsByCharacter,
} from '../chat/socialDirectory';

type FileProtection = 'plain' | 'encrypted';
type CharacterImportFile = SavedFileSummary | NpcLibraryFileSummary;

export type CharacterImportChoice =
  | {
    key: string;
    source: 'characters' | 'npc-library';
    name: string;
    fileName: string;
    file: CharacterImportFile;
  }
  | {
    key: string;
    source: 'npc-library' | 'built-in';
    name: string;
    fileName: string;
    file: CharacterImportFile;
    character: NpcLibraryEntry['character'];
  };

type PendingStorybookLoad = {
  nodeId: string;
  filePath: string;
  fileName: string;
} | null;

type StorybookFileMetadata = {
  protection?: FileProtection | 'unknown';
  envelopeFormatVersion?: string;
  formatVersion?: string;
};

type SessionPasswordAction =
  | 'save-workflow'
  | 'save-session'
  | 'save-storybook'
  | 'load'
  | 'open-file'
  | 'load-storybook'
  | 'save-character'
  | 'load-character'
  | null;

type UseStorybookActionsOptions = {
  nodesRef: MutableRefObject<WorkflowNode[]>;
  turnsRef: MutableRefObject<TurnRecord[]>;
  turnCheckpointsRef: MutableRefObject<TurnCheckpoint[]>;
  currentNpcParticipants: () => NpcParticipantSnapshots;
  commitLifecycleNodes?: (nodes: WorkflowNode[]) => void;
  restoreNpcParticipants?: (snapshots: NpcParticipantSnapshots) => void;
  currentLibraryEntries?: () => NpcLibraryEntry[];
  currentLibraryFiles?: () => NpcLibraryFileSummary[];
  reloadLibrary?: () => Promise<NpcLibrarySnapshot | undefined>;
  workspacePassword?: () => string;
  lifecycleBusy?: () => boolean;
  saveNpcCharacter?: (character: RpStorybook['characters'][number], overwrite: boolean) => Promise<void>;
  currentCharacterRegistry: () => EffectiveCharacterRegistry;
  characterRegistryForStorybook: (nodeId: string, characters: RpStorybook['characters'], options?: {
    replaceExisting?: boolean; openingSnapshots?: NpcParticipantSnapshots; participantSnapshots?: NpcParticipantSnapshots;
  }) => EffectiveCharacterRegistry;
  currentTimelineMessages: () => import('../types').MessageRecord[];
  currentSocialLikesByAccount: () => Record<string, string[]>;
  currentDynamicSocialUsers: () => DynamicSocialUsers;
  currentSocialConnectionsByCharacter: () => SocialConnectionsByCharacter;
  currentPhoneNotesByCharacter: () => PhoneNotesByCharacter;
  currentChatGpdChatsByCharacter: () => ChatGpdChatsByCharacter;
  replaceCurrentChatWithOpeningHistoryRef: MutableRefObject<boolean>;
  nodeLlm: NodeLlmApi;
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  errorMessage: (error: unknown) => string;
  refreshFiles: (selectedFileName?: string | null) => Promise<void>;
  setPendingStorybookLoad: Dispatch<SetStateAction<PendingStorybookLoad>>;
  setPendingSessionFilePath: Dispatch<SetStateAction<string | null>>;
  setSessionPassword: Dispatch<SetStateAction<string>>;
  sessionPassword: string;
  setFileStorageStatus: Dispatch<SetStateAction<string>>;
  setSessionPasswordAction: Dispatch<SetStateAction<SessionPasswordAction>>;
  setActiveStorybookProtection: Dispatch<SetStateAction<FileProtection>>;
  notifySystem: (level: SystemLogLevel, text: string) => number;
  usedStorybookImageIds: ReadonlySet<string>;
  clearCurrentSession: () => void;
  requestSaveCharacter: (
    nodeId: string,
    characterCard: ReturnType<typeof rpCharacterCardForCharacter>,
    characterCardWithOwnPosts?: ReturnType<typeof rpCharacterCardForCharacter>,
  ) => void;
};

export function useStorybookActions({
  nodesRef,
  turnsRef,
  turnCheckpointsRef,
  currentNpcParticipants,
  restoreNpcParticipants, currentLibraryEntries, currentLibraryFiles, reloadLibrary, workspacePassword, lifecycleBusy, saveNpcCharacter, commitLifecycleNodes,
  currentCharacterRegistry,
  characterRegistryForStorybook,
  currentTimelineMessages,
  currentSocialLikesByAccount,
  currentDynamicSocialUsers,
  currentSocialConnectionsByCharacter,
  currentPhoneNotesByCharacter,
  currentChatGpdChatsByCharacter,
  replaceCurrentChatWithOpeningHistoryRef,
  nodeLlm,
  updateRuntimeNode,
  errorMessage,
  refreshFiles,
  setPendingStorybookLoad,
  setPendingSessionFilePath,
  setSessionPassword,
  sessionPassword,
  setFileStorageStatus,
  setSessionPasswordAction,
  setActiveStorybookProtection,
  notifySystem,
  usedStorybookImageIds,
  clearCurrentSession,
  requestSaveCharacter,
}: UseStorybookActionsOptions) {
  const [pendingStorybookConversion, setPendingStorybookConversion] = useState<{
    nodeId: string;
    fileName?: string;
    filePath?: string;
    sourceValue: unknown;
    result: StorybookConversionResult;
    phase: 'convert' | 'review';
    protection: FileProtection;
  } | null>(null);
  const [storybookCreatorNodeId, setStorybookCreatorNodeId] = useState<string | null>(null);
  const [storybookCreatorMessages, setStorybookCreatorMessages] = useState<StorybookCreatorMessage[]>([]);
  const storybookCreatorMessageNodeIdRef = useRef<string | null>(null);
  const [storybookCreatorSubmitting, setStorybookCreatorSubmitting] = useState(false);
  const creatorRequestActiveRef = useRef(false);
  const pendingConversionRef = useRef(pendingStorybookConversion);
  pendingConversionRef.current = pendingStorybookConversion;
  const [pendingCharacterLoad, setPendingCharacterLoad] = useState<{
    nodeId: string;
    filePath?: string;
    fileName: string;
    storage?: SavedFileSummary['storage'] | 'npc-characters';
  } | null>(null);
  const [showCharacterFiles, setShowCharacterFiles] = useState(false);
  const [characterImportChoices, setCharacterImportChoices] = useState<CharacterImportChoice[]>([]);
  const [selectedCharacterImportKey, setSelectedCharacterImportKey] = useState<string | null>(null);
  const [characterFileStatus, setCharacterFileStatus] = useState('');
  const [characterImportNodeId, setCharacterImportNodeId] = useState<string | null>(null);

  function incompatibleStorybookFileStatus(file: StorybookFileMetadata) {
    if (
      file.protection === 'encrypted' &&
      file.envelopeFormatVersion !== storybookFormatVersions.encryptedStorybookEnvelope
    ) {
      return `Encrypted storybook Envelope Format ${file.envelopeFormatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Envelope Format ${storybookFormatVersions.encryptedStorybookEnvelope}.`;
    }
    return `Storybook Format ${file.formatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Storybook Format ${storybookFormatVersions.storybook}.`;
  }

  function storyHistoryPresent(storybook: RpStorybook) {
    return (
      turnsRef.current.length > 0 ||
      storybook.openingHistory.turns.length > 0 ||
      storybook.openingHistory.events.length > 0
    );
  }

  /** Returns null when the storybook was committed, otherwise the blocking error message. */
  function commitStorybookToNode(
    nodeId: string,
    storybook: ReturnType<typeof parseRpStorybookJson>,
    patch: Partial<WorkflowNodeData>,
    options?: { replaceExisting?: boolean; participantSnapshots?: NpcParticipantSnapshots; changedParticipantId?: string; dryRun?: boolean },
  ): string | null {
    if (lifecycleBusy?.()) return 'Wait for the current generation to finish before editing the Storybook.';
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || !isStorybookSourceNode(node)) {
      return 'Cannot update: the Storybook node no longer exists.';
    }
    const currentStorybook = !options?.replaceExisting && node.data.storybookJson
      ? parseRpStorybookJson(node.data.storybookJson)
      : emptyRpStorybook;
    const committedStorybook = options?.replaceExisting
      ? storybook
      : withChangedStorybookImageDescriptionsSynchronized(
        currentStorybook,
        storybook,
      );
    let candidateRegistry: EffectiveCharacterRegistry;
    let registryWarnings: ReturnType<typeof validateCandidateCharacterRegistry>;
    try {
      validateCharacterAccountDirectory(committedStorybook.characters);
      committedStorybook.characters.forEach((character) => validateCharacterPayload(characterPayload(character)));
      const currentRegistry = currentCharacterRegistry();
      candidateRegistry = characterRegistryForStorybook(nodeId, committedStorybook.characters, {
        replaceExisting: options?.replaceExisting,
        openingSnapshots: committedStorybook.openingHistory.npcParticipants,
        participantSnapshots: options?.participantSnapshots,
      });
      registryWarnings = validateCandidateCharacterRegistry(currentRegistry, candidateRegistry);
      const openingMessages = committedStorybook.openingHistory.turns.flatMap((turn) =>
        [...turn.input.messages, ...turn.output.messages]);
      validateCandidateLegacySeedTimeline(
        options?.replaceExisting ? [] : appCharactersFromRegistry(currentRegistry),
        appCharactersFromRegistry(candidateRegistry),
        [...(options?.replaceExisting ? [] : currentTimelineMessages()), ...openingMessages],
        currentTimelineMessages(),
      );
    } catch (error) {
      const message = errorMessage(error);
      notifySystem('warning', message);
      return message;
    }
    registryWarnings.forEach((warning) => notifySystem('warning', warning.message));
    if (options?.replaceExisting) {
      clearCurrentSession();
      replaceCurrentChatWithOpeningHistoryRef.current = true;
      updateRuntimeNode(nodeId, {
        ...patch,
        storybookJson: rpStorybookJsonText(committedStorybook),
      });
      return null;
    }
    if (node && isStorybookSourceNode(node)) {
      const retained = options?.participantSnapshots
        ? currentStorybook.characters.filter((character) => !committedStorybook.characters.some((next) => next.id === character.id))
          .flatMap((character) => options.participantSnapshots?.[character.id]?.character ?? []) : [];
      const effectiveNext = { ...committedStorybook, characters: [...committedStorybook.characters,
        ...retained.map((character) => normalizeRpStorybookCharacter(character, 0, new Set()))] };
      const removed = currentStorybook.characters.filter((character) => !effectiveNext.characters.some((next) => next.id === character.id));
      for (const character of removed) {
        const reasons = removalInfo(nodeId, character.id).reasons;
        if (reasons.length) return `Cannot delete ${character.name}: ${reasons.join(' ')} Use Make NPC to retain this character.`;
      }
      const removedImageIds = usedStorybookImageIdsRemoved(
        currentStorybook,
        effectiveNext,
        usedStorybookImageIds,
      );
      if (removedImageIds.length > 0) {
        const message = 'Cannot delete: image is used in chat history.';
        updateRuntimeNode(nodeId, { storybookStatus: message });
        notifySystem('info', message);
        return message;
      }
      if (storyHistoryPresent(currentStorybook)) {
        const violations = rpStorybookIdentityLockViolations({ ...currentStorybook, characters: currentStorybook.characters.filter((character) =>
          effectiveNext.characters.some((next) => next.id === character.id)) }, effectiveNext);
        if (violations.length > 0) {
          const message = violations.join(' ');
          updateRuntimeNode(nodeId, { storybookStatus: violations[0] });
          notifySystem('info', message);
          return message;
        }
      }
    }
    if (options?.participantSnapshots) {
      // Commit every portable copy together: intermediate mixed revisions are invalid.
      const nextNodes = nodesRef.current.map((other): WorkflowNode => {
        if (other.id === nodeId) return { ...other, data: { ...other.data, ...patch, storybookJson: rpStorybookJsonText(committedStorybook) } as WorkflowNodeData };
        if (!isStorybookSourceNode(other) || !other.data.storybookJson) return other;
        const otherBook = parseRpStorybookJson(other.data.storybookJson);
        const archive = otherBook.openingHistory.npcParticipants ?? {};
        const id = options.changedParticipantId;
        if (!id || !archive[id]) return other;
        const nextArchive = { ...archive };
        if (options.participantSnapshots![id]) nextArchive[id] = options.participantSnapshots![id];
        else delete nextArchive[id];
        return { ...other, data: { ...other.data, storybookJson: rpStorybookJsonText({ ...otherBook,
          openingHistory: { ...otherBook.openingHistory, npcParticipants: nextArchive } }) } };
      });
      openingHistoryNpcParticipantsFromNodes(nextNodes);
      if (options.dryRun) return null;
      restoreNpcParticipants?.(options.participantSnapshots);
      if (commitLifecycleNodes) commitLifecycleNodes(nextNodes);
      else nextNodes.forEach((next) => { if (next !== nodesRef.current.find((entry) => entry.id === next.id)) updateRuntimeNode(next.id, next.data); });
      return null;
    }
    updateRuntimeNode(nodeId, {
      ...patch,
      storybookJson: rpStorybookJsonText(committedStorybook),
    });
    return null;
  }

  function updateStorybook(nodeId: string, storybook: ReturnType<typeof parseRpStorybookJson>, status?: string) {
    const commitError = commitStorybookToNode(
      nodeId,
      storybook,
      { storybookStatus: status ?? 'Storybook updated.' },
    );
    if (commitError) {
      setStorybookCreatorMessages((current) => [
        ...current,
        { role: 'storybook', text: commitError },
      ]);
      return false;
    }
    return true;
  }

  function ensureCurrentStorybook(nodeId: string): boolean {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (storybookNeedsUpdate(node?.data.storybookJson)) {
      try {
        const updated = prepareV3Document(JSON.parse(node!.data.storybookJson!), confirmV3Migration);
        const error = commitStorybookToNode(nodeId, parseRpStorybookJson(JSON.stringify(updated)), {
          storybookStatus: 'Updated to Storybook 3.0.0 with Character Containers 2.0.0.',
        });
        if (error) return false;
      } catch (error) {
        updateRuntimeNode(nodeId, { storybookStatus: errorMessage(error) });
        return false;
      }
    }
    return true;
  }

  function openStorybookCreator(nodeId: string) {
    if (!ensureCurrentStorybook(nodeId)) return;
    setStorybookCreatorNodeId(nodeId);
    if (
      storybookCreatorMessageNodeIdRef.current !== nodeId &&
      (pendingStorybookConversion?.nodeId !== nodeId || pendingStorybookConversion.phase !== 'review')
    ) {
      setStorybookCreatorMessages([]);
    }
    storybookCreatorMessageNodeIdRef.current = nodeId;
  }

  async function submitStorybookCreatorMessage(message: string, visibleMessage = message, referenceIds: string[] = []) {
    const nodeId = storybookCreatorNodeId;
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (creatorRequestActiveRef.current || !nodeId || !node || node.data.nodeType !== 'rp-storybook') {
      return;
    }

    creatorRequestActiveRef.current = true;
    setStorybookCreatorMessages((current) => [...current, { role: 'user', text: visibleMessage }]);
    setStorybookCreatorSubmitting(true);
    updateRuntimeNode(nodeId, {
      storybookStatus: 'Thinking ...',
      llmCallStats: [],
    });

    try {
      const conversion = pendingStorybookConversion?.nodeId === nodeId && pendingStorybookConversion.phase === 'review'
        ? pendingStorybookConversion
        : null;
      const currentStorybook = conversion?.result.storybook ?? (node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybook);
      const conversionStatus = conversion
        ? [
            `Conversion review: Storybook ${conversion.result.sourceVersion} -> ${conversion.result.targetVersion}.`,
            ...conversion.result.rows.map((row) =>
              `${row.reviewState === 'resolved' || row.reviewState === 'accepted' ? 'GREEN' : row.state === 'suggested' ? 'BLUE' : row.state === 'defaulted' ? 'YELLOW' : 'GREEN'} | ${row.label} | ${row.message}`,
            ),
            'During conversion, patches update the conversion draft only. They do not update the active node.',
          ].join('\n')
        : '';
      const referenceCharacters = characterReferenceCandidates(currentStorybook.characters, currentCharacterRegistry().characters.map((entry) => entry.character));
      const referenceContext = relationshipReferenceContext([...referenceIds, ...currentStorybook.characters.flatMap((character) => (character.relationships ?? []).map((entry) => entry.characterId))], referenceCharacters);
      const conversationContext = storybookAssistantConversationContext(storybookCreatorMessages);
      const instruction = [
        conversionStatus,
        conversationContext,
        referenceContext,
        `Current user message:\n${message}`,
      ].filter(Boolean).join('\n\n');
      const currentJson = rpStorybookPromptJsonText(currentStorybook);
      const completion = await nodeLlm.complete({
        connectionId: node.data.connectionId,
        nodeId,
        label: 'Storybook Chat',
        prompt: rpStorybookEditPrompt(currentJson, instruction, storyHistoryPresent(currentStorybook)),
      });
      const latestNode = nodesRef.current.find((entry) => entry.id === nodeId);
      if (
        !latestNode || latestNode.data.nodeType !== 'rp-storybook' ||
        latestNode.data.storybookJson !== node.data.storybookJson ||
        (conversion ? pendingConversionRef.current !== conversion : pendingConversionRef.current?.nodeId === nodeId)
      ) {
        throw new Error('Storybook changed while the assistant was working. The response was not applied. Please send your request again.');
      }
      const parsedResult = parseRpStorybookAssistantResult(completion.text, currentStorybook);
      const hydratedCharacters = hydrateAddedCharacterReferences(
        parsedResult.storybook.characters,
        currentStorybook.characters,
        referenceIds,
        referenceCharacters,
      );
      const result = hydratedCharacters === parsedResult.storybook.characters
        ? parsedResult
        : {
            ...parsedResult,
            storybook: parseRpStorybookJson(rpStorybookJsonText({
              ...parsedResult.storybook,
              characters: hydratedCharacters,
            })),
          };
      validateRelationshipTargets(result.storybook.characters, currentStorybook.characters, referenceCharacters);
      const changedFields = result.changedFields.slice(0, 4);
      const storybookChanged = JSON.stringify(result.storybook) !== JSON.stringify(currentStorybook);
      const changedSummary = changedFields.length
        ? `edit ${changedFields.join(' + ')}${result.changedFields.length > changedFields.length ? ' + more' : ''}`
        : result.patchPaths.length ? 'no changes applied' : 'answer';
      if (storybookChanged && conversion) {
        const rows = conversion.result.rows.map((row) => {
          const rowWasChanged = row.allowedPatchPaths.some((allowed) =>
            result.patchPaths.some((path) => path === allowed || path.startsWith(`${allowed}/`)),
          );
          return rowWasChanged ? { ...row, reviewState: 'resolved' as const, message: 'Reviewed and updated by the AI assistant.' } : row;
        });
        setPendingStorybookConversion({
          ...conversion,
          result: { ...conversion.result, storybook: result.storybook, rows },
        });
        updateRuntimeNode(nodeId, { storybookStatus: `Conversion draft edited via ${completion.connection.label}` });
      } else if (storybookChanged) {
        const commitError = commitStorybookToNode(nodeId, result.storybook, {
          storybookStatus: `Edited via ${completion.connection.label}`,
        });
        if (commitError) {
          setStorybookCreatorMessages((current) => [
            ...current,
            { role: 'error', text: commitError },
          ]);
          return;
        }
      } else {
        updateRuntimeNode(nodeId, {
          storybookStatus: `Answered via ${completion.connection.label}`,
        });
      }
      setStorybookCreatorMessages((current) => [
        ...current,
        { role: 'assistant', text: `${changedSummary}: ${result.reply}` },
      ]);
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { storybookStatus: `Error: ${messageText}` });
      setStorybookCreatorMessages((current) => [...current, { role: 'error', text: messageText }]);
    } finally {
      creatorRequestActiveRef.current = false;
      setStorybookCreatorSubmitting(false);
    }
  }

  function removalInfo(nodeId: string, characterId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node?.data.storybookJson) throw new Error('The Storybook is no longer available.');
    const book = parseRpStorybookJson(node.data.storybookJson);
    const character = book.characters.find((entry) => entry.id === characterId);
    if (!character) throw new Error('The character is no longer in this Storybook.');
    const effective = currentCharacterRegistry().characters.find((entry) => entry.character.id === characterId);
    const local = (currentLibraryEntries?.() ?? []).filter((entry) => entry.character.id === characterId);
    const users = local.filter((entry) => entry.tier === 'user');
    const library = users.length === 1 ? users[0] : users.length ? undefined : local.find((entry) => entry.tier === 'bundled');
    const history = [currentTimelineMessages(), turnsRef.current,
      nodesRef.current.flatMap<unknown>((entry) => isStorybookSourceNode(entry) && entry.data.storybookJson
        ? [parseRpStorybookJson(entry.data.storybookJson).openingHistory] : entry.data.eventAppointments ?? []),
      currentSocialLikesByAccount?.(), currentSocialConnectionsByCharacter?.(),
      currentPhoneNotesByCharacter?.(), currentChatGpdChatsByCharacter?.()];
    const reasons = characterUsageReasons(character, effective?.aliases ?? {}, history,
      currentCharacterRegistry().characters.map((entry) => entry.character));
    return { ...characterRemovalInfo(character, library?.character, reasons),
      localFileName: users.length === 1 ? users[0].fileName : undefined };
  }

  async function removeStorybookCharacter(nodeId: string, characterId: string, mode: 'delete' | 'npc' | 'save', overwrite = false) {
    if (lifecycleBusy?.()) throw new Error('Wait for the current generation to finish.');
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || !isStorybookSourceNode(node) || !node.data.storybookJson) throw new Error('The Storybook is no longer available.');
    const book = parseRpStorybookJson(node.data.storybookJson);
    const character = book.characters.find((entry) => entry.id === characterId);
    const effective = currentCharacterRegistry().characters.find((entry) => entry.character.id === characterId);
    if (!character || !effective || effective.provenance.source !== nodeId) throw new Error('The character is no longer available in this Storybook.');
    if (mode === 'delete' && removalInfo(nodeId, characterId).reasons.length) throw new Error('This character is in use. Keep it as an NPC instead.');
    const previousParticipants = currentNpcParticipants?.();
    const participants = { ...(previousParticipants ?? {}) };
    let next: RpStorybook;
    if (mode === 'delete') {
      next = storybookWithoutCharacter(book, characterId);
      delete participants[characterId];
      next.openingHistory = { ...next.openingHistory, npcParticipants: { ...next.openingHistory.npcParticipants } };
      delete next.openingHistory.npcParticipants![characterId];
    } else {
      next = storybookWithRetiredCharacter(book, effective);
      participants[characterId] = next.openingHistory.npcParticipants![characterId];
    }
    const patch = { storybookStatus: mode === 'delete'
      ? `Deleted ${character.name} from the Storybook. Library files are unchanged.`
      : `${character.name} is now an NPC. Its RP copy is retained in this Storybook and future RP saves.` };
    const options = { participantSnapshots: participants, changedParticipantId: characterId };
    const preflightError = commitStorybookToNode(nodeId, next, patch, { ...options, dryRun: true });
    if (preflightError) throw new Error(preflightError);
    if (mode === 'save') {
      if (!saveNpcCharacter) throw new Error('Saving requires the desktop application.');
      await saveNpcCharacter({ ...character, playable: false }, overwrite);
      if (lifecycleBusy?.() || nodesRef.current.find((entry) => entry.id === nodeId)?.data.storybookJson !== node.data.storybookJson ||
          currentNpcParticipants?.() !== previousParticipants) {
        throw new Error('The NPC file was saved, but the RP changed. Review it before removing the character.');
      }
    }
    const error = commitStorybookToNode(nodeId, next, patch, options);
    if (error) throw new Error(error);
  }

  function applyStorybookToNode(
    nodeId: string,
    storybookValue: unknown,
    fileName?: string,
    filePath?: string,
    status = 'Loaded storybook',
    protection: FileProtection = 'plain',
  ) {
    if (isLegacyRpStorybookValue(storybookValue)) {
      const result = convertLegacyRpStorybook(storybookValue);
      setStorybookCreatorMessages([]);
      setPendingStorybookConversion({
        nodeId,
        fileName,
        filePath,
        sourceValue: storybookValue,
        result,
        phase: 'convert',
        protection,
      });
      // The conversion checklist lives in the storybook editor's UI Preview.
      setStorybookCreatorNodeId(nodeId);
      updateRuntimeNode(nodeId, {
        storybookStatus: `Storybook Format ${result.sourceVersion} is older than ${result.targetVersion}. Review the conversion in the storybook editor.`,
      });
      return true;
    }
    const storybook = parseRpStorybookJson(JSON.stringify(storybookValue));
    const commitError = commitStorybookToNode(nodeId, storybook, {
      storybookStatus: fileName ? `${status}: ${fileName}` : status,
      storybookFileName: fileName,
      storybookFilePath: filePath,
    }, { replaceExisting: true });
    if (!commitError) {
      setActiveStorybookProtection(protection);
    }
    return commitError === null;
  }

  function beginPendingStorybookReview() {
    const pending = pendingStorybookConversion;
    if (!pending) {
      return;
    }
    const reviewRows = pending.result.rows.filter((row) => row.reviewState === 'pending');
    setPendingStorybookConversion({ ...pending, phase: 'review' });
    if (reviewRows.length === 0) {
      updateRuntimeNode(pending.nodeId, { storybookStatus: 'Conversion draft is ready to apply.' });
    }
  }

  async function improvePendingStorybookConversion() {
    if (pendingStorybookConversion?.phase !== 'review') {
      return;
    }
    await submitStorybookCreatorMessage(
      [
        'Review the conversion report and improve every missing or defaulted value that can be inferred meaningfully from the existing storybook.',
        'Prioritize character banking, social usernames, scenario text, and useful image-generation appearance descriptions.',
        'Leave technical or binary defaults alone when they cannot be inferred safely, including voice samples, wallpaper ids, LoRA file names, and LoRA URLs.',
        'Make one coherent patch for all useful improvements, then summarize what you changed and what correctly remains at its default.',
      ].join(' '),
      'Improve the useful conversion defaults.',
    );
  }

  /** Returns null when applied, otherwise the blocking error message. */
  function applyPendingStorybookConversion(): string | null {
    const pending = pendingStorybookConversion;
    if (!pending || pending.phase !== 'review') {
      return null;
    }
    const { nodeId, fileName, filePath, result, protection } = pending;
    const commitError = commitStorybookToNode(nodeId, result.storybook, {
      storybookStatus: `Converted from Storybook Format ${result.sourceVersion} to ${result.targetVersion}${fileName ? `: ${fileName}` : ''}. Save the storybook to keep the upgrade.`,
      storybookFileName: fileName,
      storybookFilePath: filePath,
    }, { replaceExisting: true });
    if (commitError) {
      return commitError;
    }
    setPendingStorybookConversion(null);
    setActiveStorybookProtection(protection);
    const message = `Storybook converted to Format ${result.targetVersion}. Save it as a new file to keep the upgrade.`;
    setFileStorageStatus(message);
    notifySystem('info', message);
    return null;
  }

  function cancelPendingStorybookConversion() {
    const pending = pendingStorybookConversion;
    if (!pending) {
      return;
    }
    updateRuntimeNode(pending.nodeId, {
      storybookStatus: 'Conversion canceled. The old storybook was not loaded.',
    });
    setPendingStorybookConversion(null);
  }

  function importCurrentSessionAsOpeningHistory(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook') {
      return;
    }
    const storybook = node.data.storybookJson
      ? parseRpStorybookJson(node.data.storybookJson)
      : emptyRpStorybook;
    const historyMedia = turnsForStorybookOpeningHistory(
      turnsRef.current.map((turn) => {
        const { openingHistory: _openingHistory, ...storedTurn } = structuredClone(turn);
        return storedTurn;
      }),
      nodesRef.current,
    );
    const historyTurns = historyMedia.turns;
    const historyMessageCount = historyTurns.reduce(
      (count, turn) => count + turn.input.messages.length + turn.output.messages.length,
      0,
    );
    const historyTurnIds = new Set(historyTurns.map((turn) => turn.id));
    const storybookNodeIds = new Set(
      nodesRef.current
        .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'rp-storybook')
        .map((entry) => entry.id),
    );
    const historyCheckpoints = turnCheckpointsRef.current
      .filter((checkpoint) => historyTurnIds.has(checkpoint.turnId))
      .map((checkpoint) => {
        const storedCheckpoint = structuredClone(checkpoint);
        storybookNodeIds.forEach((storybookNodeId) => {
          delete storedCheckpoint.nodeSnapshots[storybookNodeId];
        });
        return storedCheckpoint;
      });
    const openingEvents = nodesRef.current
      .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'event-manager')
      .flatMap((entry) => entry.data.eventAppointments ?? [])
      .filter((event) => event.status === 'upcoming');
    const normalizedOpeningEvents = normalizeEventAppointments(openingEvents);
    // Player likes, social-directory state, notes, and ChatGPD chats are
    // session UI state, not message records, so Opening History snapshots them
    // explicitly.
    const openingSocialLikes = structuredClone(currentSocialLikesByAccount());
    const openingDynamicSocialUsers = structuredClone(currentDynamicSocialUsers());
    const openingSocialConnections = structuredClone(currentSocialConnectionsByCharacter());
    const openingNotes = structuredClone(currentPhoneNotesByCharacter());
    const openingChatGpdChats = structuredClone(currentChatGpdChatsByCharacter());
    const countRecords = (records: Record<string, unknown[]>) =>
      Object.values(records).reduce((count, entries) => count + entries.length, 0);
    const openingNoteCount = countRecords(openingNotes);
    const openingChatGpdChatCount = countRecords(openingChatGpdChats);
    const openingSocialLikeCount = countRecords(openingSocialLikes);
    const openingSocialConnectionCount = Object.values(openingSocialConnections).reduce(
      (count, apps) => count + (apps.fotogram?.length ?? 0) + (apps.onlyfriends?.length ?? 0),
      0,
    );
    const phoneAppParts = [
      openingNoteCount ? `${openingNoteCount} phone note${openingNoteCount === 1 ? '' : 's'}` : '',
      openingChatGpdChatCount
        ? `${openingChatGpdChatCount} ChatGPD chat${openingChatGpdChatCount === 1 ? '' : 's'}`
        : '',
      openingSocialLikeCount
        ? `${openingSocialLikeCount} social like${openingSocialLikeCount === 1 ? '' : 's'}`
        : '',
      openingSocialConnectionCount
        ? `${openingSocialConnectionCount} added social user${openingSocialConnectionCount === 1 ? '' : 's'}`
        : '',
    ].filter(Boolean);
    const phoneAppSuffix = phoneAppParts.length ? ` Includes ${phoneAppParts.join(', ')}.` : '';
    const hasOpeningContent =
      historyTurns.length > 0 || normalizedOpeningEvents.length > 0 || phoneAppParts.length > 0;
    const nextStorybook = {
      ...storybook,
      openingHistory: {
        summary: hasOpeningContent
          ? `Imported from current RP session: ${historyMessageCount} messages and ${normalizedOpeningEvents.length} events across ${historyTurns.length} turns.${phoneAppSuffix}`
          : '',
        npcParticipants: structuredClone(currentNpcParticipants()),
        turns: historyTurns,
        checkpoints: historyCheckpoints,
        events: normalizedOpeningEvents,
        voiceMedia: historyMedia.voiceMedia,
        socialLikes: openingSocialLikes,
        dynamicSocialUsers: openingDynamicSocialUsers,
        socialConnections: openingSocialConnections,
        notes: openingNotes,
        chatGpdChats: openingChatGpdChats,
      },
    };
    replaceCurrentChatWithOpeningHistoryRef.current = true;
    updateRuntimeNode(nodeId, {
      storybookJson: rpStorybookJsonText(nextStorybook),
      storybookStatus: hasOpeningContent
        ? `Imported ${historyTurns.length} opening history turns and ${normalizedOpeningEvents.length} events.${phoneAppSuffix}`
        : 'No current chat messages, events, or phone app entries to import.',
    });
  }

  function clearStorybookOpeningHistory(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook') {
      return;
    }
    const storybook = node.data.storybookJson
      ? parseRpStorybookJson(node.data.storybookJson)
      : emptyRpStorybook;
    const nextStorybook = {
      ...storybook,
      openingHistory: { ...emptyRpStorybook.openingHistory, npcParticipants: storybook.openingHistory.npcParticipants },
    };
    const openingEventIds = new Set(storybook.openingHistory.events.map((event) => event.id));
    if (openingEventIds.size > 0) {
      nodesRef.current
        .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'event-manager')
        .forEach((entry) => {
          const nextAppointments = appointmentsFromEventEntities(
            removeEventEntities(
              appointmentEntitiesFromAppointments(entry.data.eventAppointments ?? []),
              openingEventIds,
            ),
          );
          if (nextAppointments.length !== (entry.data.eventAppointments ?? []).length) {
            updateRuntimeNode(entry.id, {
              eventAppointments: normalizeEventAppointments(nextAppointments),
              eventStatus: nextAppointments.length
                ? `Opening History cleared. ${nextAppointments.length} events remain.`
                : 'Opening History cleared. No events remain.',
            });
          }
        });
    }
    updateRuntimeNode(nodeId, {
      storybookJson: rpStorybookJsonText(nextStorybook),
      storybookStatus: 'Opening History cleared.',
    });
  }

  // A full reset wipes the running story with the storybook (chat session,
  // events, character stats), so the image-usage and identity locks that
  // protect a running story intentionally do not apply here.
  function resetStorybook(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || node.data.nodeType !== 'rp-storybook') {
      return;
    }
    clearCurrentSession();
    nodesRef.current
      .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'event-manager')
      .forEach((entry) => {
        updateRuntimeNode(entry.id, {
          eventAppointments: [],
          eventStatus: 'Storybook reset. All events cleared.',
        });
      });
    nodesRef.current
      .filter((entry) => entry.data.kind === undefined && entry.data.nodeType === 'character-stats')
      .forEach((entry) => {
        updateRuntimeNode(entry.id, {
          ...resetCharacterStatsRuntimeData(),
          characterStatsStatus: 'Storybook reset. State initializes on next run.',
        });
      });
    updateRuntimeNode(nodeId, {
      storybookJson: rpStorybookJsonText(emptyRpStorybook),
      storybookStatus: 'Storybook and current session reset.',
      storybookFileName: undefined,
      storybookFilePath: undefined,
    });
  }

  async function exportStorybookCharacter(nodeId: string, characterId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || !isStorybookSourceNode(node)) {
      return;
    }
    try {
      const storybook = node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybook;
      const character = storybook.characters.find((entry) => entry.id === characterId);
      if (!character) {
        updateRuntimeNode(nodeId, { storybookStatus: 'Export failed: character not found.' });
        return;
      }
      const posts = [...storybook.openingHistory.turns, ...turnsRef.current].flatMap((turn) =>
        [...turn.input.messages, ...turn.output.messages].flatMap((message) => message.socialPost ? [message.socialPost] : []));
      const card = rpCharacterCardForCharacter(character, { includePosts: false, posts,
        gallery: storybook.characters.flatMap((entry) => entry.images) });
      const cardWithOwnPosts = rpCharacterCardForCharacter(character, { includePosts: true, posts,
        gallery: storybook.characters.flatMap((entry) => entry.images) });
      requestSaveCharacter(nodeId, card, cardWithOwnPosts);
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { storybookStatus: `Character export failed: ${messageText}` });
      notifySystem('error', `Character export failed: ${messageText}`);
    }
  }

  async function importCharacterCard(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || !isStorybookSourceNode(node)) {
      return;
    }
    try {
      setCharacterImportNodeId(nodeId);
      setSelectedCharacterImportKey(null);
      setCharacterFileStatus('');
      setShowCharacterFiles(true);
      const refreshedLibrary = await reloadLibrary?.();
      const libraryEntries = refreshedLibrary?.entries ?? currentLibraryEntries?.() ?? [];
      const libraryFiles = refreshedLibrary?.files ?? currentLibraryFiles?.() ?? libraryEntries.map((entry) => ({
        tier: entry.tier,
        fileName: entry.fileName,
        name: entry.character.name,
        updatedAt: '',
        type: 'character-card' as const,
        protection: 'plain' as const,
        compatible: true,
      }));
      const libraryChoices: CharacterImportChoice[] = [];
      for (const file of libraryFiles) {
        if (file.tier === 'user') {
          const unlockedEntry = 'unlocked' in file && file.unlocked
            ? libraryEntries.find((entry) => entry.tier === 'user' && entry.fileName === file.fileName)
            : undefined;
          libraryChoices.push({
            key: `user:${file.fileName}`,
            source: 'npc-library',
            name: ('characterName' in file && file.characterName) || file.name,
            fileName: file.fileName,
            file: { ...file, storage: 'npc-characters' },
            ...(unlockedEntry ? { character: unlockedEntry.character } : {}),
          });
          continue;
        }
        const entry = libraryEntries.find((candidate) => (
          candidate.tier === 'bundled' && candidate.fileName === file.fileName
        ));
        if (entry) {
          libraryChoices.push({
            key: `bundled:${file.fileName}`,
            source: 'built-in',
            name: entry.character.name,
            fileName: file.fileName,
            file,
            character: entry.character,
          });
        }
      }
      setCharacterImportChoices(libraryChoices);
      const files = await window.rpgraph.listCharacterFiles();
      const characterChoices: CharacterImportChoice[] = files.map((file) => ({
        key: `characters:${file.fileName}`,
        source: 'characters',
        name: file.characterName || file.name,
        fileName: file.fileName,
        file,
      }));
      setCharacterImportChoices([...characterChoices, ...libraryChoices]);
    } catch (error) {
      const messageText = errorMessage(error);
      setCharacterFileStatus(`Unable to list characters: ${messageText}`);
    }
  }

  function closeCharacterFiles() {
    setShowCharacterFiles(false);
    setSelectedCharacterImportKey(null);
    setCharacterFileStatus('');
  }

  function cancelCharacterCardUnlock() {
    setPendingCharacterLoad(null);
    setShowCharacterFiles(true);
  }

  async function beginCharacterCardImport(
    nodeId: string,
    file: Pick<CharacterImportFile, 'fileName' | 'type' | 'protection' | 'compatible' | 'formatVersion' | 'storage'> & {
      filePath?: string;
    },
  ) {
    if (file.type !== 'character-card') {
      setCharacterFileStatus('The selected file is not an RPGraph Character Card.');
      return;
    }
    if (!file.compatible) {
      setCharacterFileStatus(
        `Character Card Format ${file.formatVersion ?? 'Unknown'} is incompatible.`,
      );
      return;
    }
    if (file.protection === 'encrypted') {
      const password = workspacePassword?.();
      if (!password) throw new Error('Open a protected Storybook or RP Save with the same password before importing encrypted characters.');
      const loaded = file.filePath
        ? await window.rpgraph.loadFilePath(file.filePath, password)
        : await window.rpgraph.loadFile(file.fileName, password, file.storage);
      applyCharacterCardToNode(nodeId, loaded.value, loaded.fileName);
      closeCharacterFiles();
      return;
    }
    const loaded = file.filePath
      ? await window.rpgraph.loadFilePath(file.filePath)
      : await window.rpgraph.loadFile(file.fileName, '', file.storage);
    applyCharacterCardToNode(nodeId, loaded.value, loaded.fileName);
    closeCharacterFiles();
  }

  async function importSelectedCharacterCard(choice?: CharacterImportChoice) {
    const nodeId = characterImportNodeId;
    const selected = choice ?? characterImportChoices.find((entry) => entry.key === selectedCharacterImportKey);
    if (!nodeId || !selected) {
      setCharacterFileStatus('Select a character first.');
      return;
    }
    try {
      setSelectedCharacterImportKey(selected.key);
      setCharacterFileStatus('Importing character ...');
      if ('character' in selected && selected.file.protection === 'encrypted') {
        const stillUnlocked = !!workspacePassword?.() && currentLibraryFiles?.().some((file) =>
          file.fileName === selected.fileName && file.tier === (selected.source === 'built-in' ? 'bundled' : 'user') && file.unlocked);
        if (!stillUnlocked) throw new Error('The protected game changed. Reopen the character importer.');
      }
      if (!('character' in selected)) {
        await beginCharacterCardImport(nodeId, selected.file);
      } else {
        applyCharacterCardToNode(nodeId, rpCharacterCardForCharacter(selected.character), selected.fileName);
        closeCharacterFiles();
      }
    } catch (error) {
      const message = `Character import failed: ${errorMessage(error)}`;
      setCharacterFileStatus(message);
      updateRuntimeNode(nodeId, { storybookStatus: message });
      notifySystem('error', message);
    }
  }

  async function openExternalCharacterCard() {
    const nodeId = characterImportNodeId;
    if (!nodeId) {
      setCharacterFileStatus('Open the Character importer again.');
      return;
    }
    try {
      const file = await window.rpgraph.selectCharacterFile();
      if (file.canceled || !file.filePath || !file.fileName) {
        return;
      }
      await beginCharacterCardImport(nodeId, {
        fileName: file.fileName,
        filePath: file.filePath,
        type: file.type ?? 'unknown',
        protection: file.protection ?? 'unknown',
        compatible: file.compatible === true,
        formatVersion: file.formatVersion,
      });
    } catch (error) {
      const message = `Character import failed: ${errorMessage(error)}`;
      setCharacterFileStatus(message);
      updateRuntimeNode(nodeId, { storybookStatus: message });
      notifySystem('error', message);
    }
  }

  function applyCharacterCardToNode(nodeId: string, cardValue: unknown, fileName: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || !isStorybookSourceNode(node)) {
      throw new Error('Add an RP Storybook V3 node before importing a character card.');
    }
    const plan = planCharacterImportToNode({ nodes: nodesRef.current, nodeId,
      card: prepareV3Document(cardValue, confirmV3Migration),
      snapshots: currentNpcParticipants(), registry: currentCharacterRegistry() });
    const label = plan.character.name || plan.character.id;
    const action = plan.replacesIndex !== undefined ? 'Replaced' : 'Added';
    const commitError = commitStorybookToNode(nodeId, plan.storybook, {
      storybookStatus: `${action} character ${label} from ${fileName}.`,
    });
    if (commitError) {
      throw new Error(commitError);
    }
    notifySystem('info', `${action} character ${label} from a character card. Check scenario texts for consistency and save the storybook.`);
    setStorybookCreatorMessages((current) => [
      ...current,
      {
        role: 'assistant',
        text: `${action} character ${label} from ${fileName}. Run "Check Story Logic" from the ⋯ menu to align the scenario texts with the new cast, then save the storybook.`,
      },
    ]);
  }

  async function unlockCharacterCard() {
    const pending = pendingCharacterLoad;
    if (!pending) {
      setSessionPasswordAction(null);
      return;
    }
    if (!sessionPassword) {
      setFileStorageStatus('Enter a password or PIN for the encrypted character card.');
      return;
    }
    try {
      setFileStorageStatus('Unlocking character card ...');
      const result = pending.filePath
        ? await window.rpgraph.loadFilePath(pending.filePath, sessionPassword)
        : await window.rpgraph.loadFile(pending.fileName, sessionPassword, pending.storage);
      applyCharacterCardToNode(pending.nodeId, result.value, result.fileName);
      setPendingCharacterLoad(null);
      setPendingSessionFilePath(null);
      setSessionPassword('');
      setSessionPasswordAction(null);
      setShowCharacterFiles(false);
      setFileStorageStatus(`Imported encrypted character: ${result.name}`);
    } catch (error) {
      const message = `Character import failed: ${errorMessage(error)}`;
      updateRuntimeNode(pending.nodeId, { storybookStatus: message });
      setFileStorageStatus(message);
    }
  }

  async function importSillyTavernCharacter(nodeId: string) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node || !isStorybookSourceNode(node)) {
      return;
    }

    try {
      const file = await window.rpgraph.loadJsonFile();
      if (file.canceled || !file.contents) {
        return;
      }

      let importedCharacter: unknown;
      try {
        importedCharacter = JSON.parse(file.contents);
      } catch {
        updateRuntimeNode(nodeId, { storybookStatus: 'Import failed: selected file is not valid JSON.' });
        return;
      }

      const currentStorybook = node.data.storybookJson
        ? parseRpStorybookJson(node.data.storybookJson)
        : emptyRpStorybook;
      const currentJson = rpStorybookPromptJsonText(currentStorybook);
      const instruction = sillyTavernImportInstruction(
        currentStorybook,
        importedCharacter,
        file.fileName ?? 'selected JSON file',
      );
      updateRuntimeNode(nodeId, {
        storybookStatus: `Importing SillyTavern JSON${file.fileName ? `: ${file.fileName}` : ''} ...`,
        llmCallStats: [],
      });
      setStorybookCreatorMessages((current) => [
        ...current,
        {
          role: 'user',
          text: `Import SillyTavern character${file.fileName ? `: ${file.fileName}` : ''}`,
        },
      ]);

      const completion = await nodeLlm.complete({
        connectionId: node.data.connectionId,
        nodeId,
        label: 'SillyTavern Import',
        prompt: rpStorybookEditPrompt(currentJson, instruction, storyHistoryPresent(currentStorybook)),
      });
      const result = parseRpStorybookAssistantResult(completion.text, currentStorybook);
      const validatedImport = validateSillyTavernImportResult(
        currentStorybook,
        result,
        importedCharacter,
      );
      const commitError = commitStorybookToNode(nodeId, result.storybook, {
        storybookStatus: `${validatedImport.action === 'added' ? 'Added' : 'Updated'} ${validatedImport.characterName} from ${file.fileName ?? 'SillyTavern JSON'} via ${completion.connection.label}`,
        storybookFileName: undefined,
        storybookFilePath: undefined,
      });
      if (commitError) {
        setStorybookCreatorMessages((current) => [
          ...current,
          { role: 'error', text: commitError },
        ]);
        return;
      }
      setStorybookCreatorMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: `${validatedImport.action === 'added' ? 'Added' : 'Updated'} character ${validatedImport.characterName}: ${result.reply}`,
        },
      ]);
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { storybookStatus: `Import failed: ${messageText}` });
      setStorybookCreatorMessages((current) => [...current, { role: 'error', text: messageText }]);
    }
  }

  async function loadStorybookFile(nodeId: string) {
    try {
      const file = await window.rpgraph.selectFile();
      if (file.canceled || !file.filePath) {
        return false;
      }
      if (file.type !== 'storybook') {
        const message = file.compatible === false
          ? incompatibleStorybookFileStatus(file)
          : 'Select a compatible RP Storybook file.';
        updateRuntimeNode(nodeId, { storybookStatus: message });
        setFileStorageStatus(message);
        notifySystem('info', message);
        return false;
      }
      if (!file.compatible) {
        const message = incompatibleStorybookFileStatus(file);
        updateRuntimeNode(nodeId, { storybookStatus: message });
        setFileStorageStatus(message);
        notifySystem('info', message);
        return false;
      }
      if (file.protection === 'encrypted') {
        setPendingStorybookLoad({
          nodeId,
          filePath: file.filePath,
          fileName: file.fileName ?? 'encrypted storybook',
        });
        setPendingSessionFilePath(file.filePath);
        setSessionPassword('');
        setFileStorageStatus('This storybook is password protected. Enter its password or PIN to continue.');
        updateRuntimeNode(nodeId, { storybookStatus: 'Encrypted storybook needs a password.' });
        setSessionPasswordAction('load-storybook');
        return false;
      }
      const result = await window.rpgraph.loadFilePath(file.filePath);
      if (result.type !== 'storybook') {
        throw new Error('The selected file is not an RP Storybook.');
      }
      const applied = applyStorybookToNode(nodeId, result.value, result.fileName, result.filePath);
      if (!applied) {
        setFileStorageStatus('Cannot load storybook: it conflicts with the running chat history.');
        return false;
      }
      setActiveStorybookProtection('plain');
      await refreshFiles(result.fileName);
      return true;
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { storybookStatus: `Load failed: ${messageText}` });
      setFileStorageStatus(`Load failed: ${messageText}`);
      return false;
    }
  }

  return {
    storybookCreatorNodeId,
    setStorybookCreatorNodeId,
    storybookCreatorMessages,
    storybookCreatorSubmitting,
    openStorybookCreator,
    ensureCurrentStorybook,
    submitStorybookCreatorMessage,
    updateStorybook,
    commitStorybookToNode,
    applyStorybookToNode,
    pendingStorybookConversion,
    beginPendingStorybookReview,
    improvePendingStorybookConversion,
    applyPendingStorybookConversion,
    cancelPendingStorybookConversion,
    importCurrentSessionAsOpeningHistory,
    clearStorybookOpeningHistory,
    resetStorybook,
    importSillyTavernCharacter,
    exportStorybookCharacter,
    removeStorybookCharacter,
    removalInfo,
    importCharacterCard,
    showCharacterFiles,
    characterImportChoices,
    selectedCharacterImportKey,
    characterFileStatus,
    setSelectedCharacterImportKey,
    closeCharacterFiles,
    cancelCharacterCardUnlock,
    importSelectedCharacterCard,
    openExternalCharacterCard,
    applyCharacterCardToNode,
    unlockCharacterCard,
    loadStorybookFile,
  };
}
