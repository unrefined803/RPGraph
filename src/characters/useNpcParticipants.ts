import { appCharactersFromRegistry } from './appRuntime';
import { useRef, useState } from 'react';
import type { MessageRecord, WorkflowNode } from '../types';
import type { NpcLibrarySnapshot } from './npcLibrary';
import { buildCharacterRegistry } from './registry';
import {
  captureNpcParticipants, npcReferencesFromMessages, npcSnapshotEntries, parseNpcParticipantSnapshots,
  type NpcParticipantReference, type NpcParticipantSnapshots,
} from './npcParticipants';
import {
  openingHistoryNpcParticipantsFromNodes,
  storybookRegistryEntries,
  candidateStorybookRegistry,
  type StorybookRegistryCandidateOptions,
} from './npcParticipantRuntime';
import type { Character } from './character';

export function useNpcParticipants(nodesRef: { current: WorkflowNode[] }, library: NpcLibrarySnapshot | null) {
  const [, setRevision] = useState(0);
  const snapshotsRef = useRef<NpcParticipantSnapshots>({});
  const entries = () => [...(library?.entries ?? []), ...storybookRegistryEntries(nodesRef.current)];
  const registryForStorybook = (nodeId: string, characters: Character[], options?: StorybookRegistryCandidateOptions) =>
    candidateStorybookRegistry(entries(), snapshotsRef.current, nodeId, characters, options);
  const capture = (references: NpcParticipantReference[]) => {
    if (!references.length) return;
    const next = captureNpcParticipants(snapshotsRef.current, entries(), references);
    if (next !== snapshotsRef.current) { snapshotsRef.current = next; setRevision((revision) => revision + 1); }
  };
  return {
    current: () => snapshotsRef.current,
    registry: () => buildCharacterRegistry([...entries(), ...npcSnapshotEntries(snapshotsRef.current)]),
    registryForStorybook,
    characters: () => appCharactersFromRegistry(buildCharacterRegistry([...entries(), ...npcSnapshotEntries(snapshotsRef.current)])),
    capture,
    captureMessages: (messages: MessageRecord[]) => capture(npcReferencesFromMessages(messages)),
    restore: (snapshots: NpcParticipantSnapshots) => { snapshotsRef.current = parseNpcParticipantSnapshots(snapshots); setRevision((revision) => revision + 1); },
    reset: () => { snapshotsRef.current = {}; },
    importOpeningHistory: (nodes: WorkflowNode[], replace: boolean) => {
      const opening = openingHistoryNpcParticipantsFromNodes(nodes);
      // An already pinned RP revision wins when importing additional history.
      snapshotsRef.current = replace ? opening : { ...opening, ...snapshotsRef.current };
    },
  };
}
