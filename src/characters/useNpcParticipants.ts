import { appCharactersFromRegistry } from './appRuntime';
import { createNpcRuntimeCache } from './npcRuntimeCache';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { acquireMessageContacts, reconcileNpcMessageContacts } from './messageContacts';
import { historicalContactCheckpoints } from './historicalContactCheckpoints';
import type { TurnCheckpoint } from '../data-management/types';
import type { MessageRecord, TurnRecord, WorkflowNode } from '../types';
import type { NpcLibrarySnapshot } from './npcLibrary';
import { buildCharacterRegistry } from './registry';
import {
  captureNpcParticipants, npcSnapshotEntries, parseNpcParticipantSnapshots,
  type NpcParticipantReference, type NpcParticipantSnapshots,
} from './npcParticipants';
import {
  openingHistoryNpcParticipantsFromNodes,
  candidateStorybookRegistry,
  type StorybookRegistryCandidateOptions,
} from './npcParticipantRuntime';
import type { Character } from './character';
import {
  createActiveStorybookContextCache, createExternalNpcLibrary, importedNpcSnapshots, parseImportedNpcSnapshots,
  type ImportedNpcSnapshots,
} from './externalNpcs';

const emptyLibraryEntries: NonNullable<NpcLibrarySnapshot>['entries'] = [];

export function useNpcParticipants(nodesRef: { current: WorkflowNode[] }, library: NpcLibrarySnapshot | null,
  setNodes: Dispatch<SetStateAction<WorkflowNode[]>>) {
  const [, setRevision] = useState(0);
  const snapshotsRef = useRef<NpcParticipantSnapshots>({});
  const [runtimeCache] = useState(createNpcRuntimeCache);
  // External Storybook NPC copies restored from the RP Save; they win over the live sources.
  const importsRef = useRef<ImportedNpcSnapshots>({});
  const [externalLibrary] = useState(createExternalNpcLibrary);
  const [activeContext] = useState(createActiveStorybookContextCache);
  const effectiveLibrary = () => externalLibrary(library, importsRef.current, activeContext(nodesRef.current));
  const runtime = () => runtimeCache(nodesRef.current, effectiveLibrary()?.entries ?? emptyLibraryEntries, snapshotsRef.current);
  const entries = () => runtime().entries;
  const registryForStorybook = (nodeId: string, characters: Character[], options?: StorybookRegistryCandidateOptions) =>
    candidateStorybookRegistry(entries(), snapshotsRef.current, nodeId, characters, options);
  const capture = (references: NpcParticipantReference[]) => {
    if (!references.length) return;
    const next = captureNpcParticipants(snapshotsRef.current, entries(), references);
    if (next !== snapshotsRef.current) { snapshotsRef.current = next; setRevision((revision) => revision + 1); }
  };
  const commitContacts = (next: ReturnType<typeof acquireMessageContacts>) => {
    if (next.participants !== snapshotsRef.current) {
      snapshotsRef.current = next.participants;
      setRevision((revision) => revision + 1);
    }
    if (next.nodes !== nodesRef.current) {
      nodesRef.current = next.nodes;
      setNodes(next.nodes);
    }
  };
  return {
    current: () => snapshotsRef.current,
    /** The library with external Storybook characters prepared, pinned and filtered for the active Storybook. */
    library: effectiveLibrary,
    activeStorybookFileNames: () => activeContext(nodesRef.current).storybookFileNames,
    currentImports: () => importedNpcSnapshots(effectiveLibrary()),
    restoreImports: (imports: ImportedNpcSnapshots | undefined) => {
      importsRef.current = parseImportedNpcSnapshots(imports);
      setRevision((revision) => revision + 1);
    },
    registry: () => runtime().registry,
    registryForStorybook,
    characters: () => runtime().characters,
    capture,
    updateImages: (characterId: string, images: Character['images']) => {
      capture([{ kind: 'character', id: characterId }]);
      const snapshot = snapshotsRef.current[characterId];
      if (!snapshot) return;
      snapshotsRef.current = { ...snapshotsRef.current, [characterId]: {
        ...snapshot, character: { ...snapshot.character, images },
      } };
      setRevision((revision) => revision + 1);
    },
    reconcileMessages: (messages: MessageRecord[]) => {
      commitContacts({ nodes: nodesRef.current, participants: reconcileNpcMessageContacts(snapshotsRef.current, entries(), messages) });
    },
    captureMessages: (messages: MessageRecord[]) => {
      commitContacts(acquireMessageContacts(nodesRef.current, snapshotsRef.current, entries(), messages));
    },
    captureHistory: (messages: MessageRecord[], turns: TurnRecord[], checkpoints: TurnCheckpoint[]) => {
      const registryEntries = entries();
      const next = acquireMessageContacts(nodesRef.current, snapshotsRef.current, registryEntries, messages);
      const history = historicalContactCheckpoints(nodesRef.current, next.nodes, messages, turns, checkpoints,
        appCharactersFromRegistry(buildCharacterRegistry([...registryEntries, ...npcSnapshotEntries(next.participants)])));
      commitContacts({ ...next, nodes: history.nodes });
      return history.checkpoints;
    },
    restore: (snapshots: NpcParticipantSnapshots) => { snapshotsRef.current = parseNpcParticipantSnapshots(snapshots); setRevision((revision) => revision + 1); },
    reset: () => { snapshotsRef.current = {}; importsRef.current = {}; },
    importOpeningHistory: (nodes: WorkflowNode[], replace: boolean) => {
      const opening = openingHistoryNpcParticipantsFromNodes(nodes);
      // An already pinned RP revision wins when importing additional history.
      snapshotsRef.current = replace ? opening : { ...opening, ...snapshotsRef.current };
    },
  };
}
