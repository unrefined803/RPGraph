import type { WorkflowNode } from '../types';
import { isStorybookSourceNode } from '../storybook/runtime';
import { appCharactersFromRegistry } from './appRuntime';
import { storybookRegistryEntries } from './npcParticipantRuntime';
import { npcSnapshotEntries, type NpcParticipantSnapshots } from './npcParticipants';
import { buildCharacterRegistry, type CharacterRegistryEntry } from './registry';

/** Cache only the latest character inputs, independently of graph runtime updates. */
export function createNpcRuntimeCache() {
  let previous: {
    library: readonly CharacterRegistryEntry[];
    snapshots: NpcParticipantSnapshots;
    books: { id: string; json: string | undefined }[];
    entries: CharacterRegistryEntry[];
    registry: ReturnType<typeof buildCharacterRegistry>;
    characters: ReturnType<typeof appCharactersFromRegistry>;
  } | undefined;
  return (nodes: WorkflowNode[], library: readonly CharacterRegistryEntry[], snapshots: NpcParticipantSnapshots) => {
    const books = nodes.filter(isStorybookSourceNode).map((node) => ({ id: node.id, json: node.data.storybookJson }));
    if (previous && previous.library === library && previous.snapshots === snapshots &&
      previous.books.length === books.length && books.every((book, index) =>
        book.id === previous!.books[index].id && book.json === previous!.books[index].json)) {
      return previous;
    }
    const entries = [...library, ...storybookRegistryEntries(nodes)];
    const registry = buildCharacterRegistry([...entries, ...npcSnapshotEntries(snapshots)]);
    previous = { library, snapshots, books, entries, registry, characters: appCharactersFromRegistry(registry) };
    return previous;
  };
}
