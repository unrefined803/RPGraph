import { useRef } from 'react';
import type { MessageRecord, WorkflowNode } from '../types';
import type { NpcLibrarySnapshot } from './npcLibrary';
import { buildCharacterRegistry } from './registry';
import {
  captureNpcParticipants, npcReferencesFromMessages, npcSnapshotEntries, parseNpcParticipantSnapshots,
  type NpcParticipantReference, type NpcParticipantSnapshots,
} from './npcParticipants';
import { openingHistoryNpcParticipantsFromNodes, storybookRegistryEntries } from './npcParticipantRuntime';

export function useNpcParticipants(nodesRef: { current: WorkflowNode[] }, library: NpcLibrarySnapshot | null) {
  const snapshotsRef = useRef<NpcParticipantSnapshots>({});
  const entries = () => [...(library?.entries ?? []), ...storybookRegistryEntries(nodesRef.current)];
  const capture = (references: NpcParticipantReference[]) => {
    if (!references.length) return;
    snapshotsRef.current = captureNpcParticipants(snapshotsRef.current, entries(), references);
  };
  return {
    current: () => snapshotsRef.current,
    registry: () => buildCharacterRegistry([...entries(), ...npcSnapshotEntries(snapshotsRef.current)]),
    capture,
    captureMessages: (messages: MessageRecord[]) => capture(npcReferencesFromMessages(messages)),
    restore: (snapshots: NpcParticipantSnapshots) => { snapshotsRef.current = parseNpcParticipantSnapshots(snapshots); },
    reset: () => { snapshotsRef.current = {}; },
    importOpeningHistory: (nodes: WorkflowNode[], replace: boolean) => {
      const opening = openingHistoryNpcParticipantsFromNodes(nodes);
      // An already pinned RP revision wins when importing additional history.
      snapshotsRef.current = replace ? opening : { ...opening, ...snapshotsRef.current };
    },
  };
}
