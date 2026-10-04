import { validateCharacterPayload, type Character } from './character';
import { prepareCharacterPublicationExport } from './publicationExport';
import { storybookRegistryEntries } from './npcParticipantRuntime';
import { isStorybookSourceNode } from '../storybook/runtime';
import type {
  NpcLibraryDiagnostic, NpcLibraryEntry, NpcLibrarySnapshot, NpcPublicationProvenance, NpcPublicationSource,
} from './npcLibrary';
import type { SocialPostRecord, WorkflowNode } from '../types';

/**
 * External Storybook NPC copies kept by one RP. They stay library NPCs: unlike
 * participant snapshots they neither mark interaction nor outrank local files.
 */
export type ImportedNpcSnapshots = Record<string, {
  character: Character;
  /** Diagnostic source of the original library entry. */
  source: string;
  fileName: string;
  publication: NpcPublicationProvenance;
}>;

export type ActiveStorybookContext = {
  /** Stable IDs and identity aliases of every character in the active Storybooks. */
  characterIds: ReadonlySet<string>;
  storybookFileNames: readonly string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const optionalString = (value: unknown) => value === undefined || typeof value === 'string';

/** Missing fields in older saves mean no imports; malformed archives must not be dropped. */
export function parseImportedNpcSnapshots(value: unknown): ImportedNpcSnapshots {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('Invalid saved imported NPC archive.');
  for (const [id, snapshot] of Object.entries(value)) {
    if (!isRecord(snapshot) || !isRecord(snapshot.character) || snapshot.character.id !== id ||
        typeof snapshot.source !== 'string' || typeof snapshot.fileName !== 'string') {
      throw new Error('Invalid saved imported NPC identity.');
    }
    validateCharacterPayload(snapshot.character);
    const publication = snapshot.publication;
    if (!isRecord(publication) || typeof publication.storybookFileName !== 'string' ||
        typeof publication.storybookName !== 'string' || (publication.kind !== 'save' && publication.kind !== 'storybook') ||
        !optionalString(publication.saveFileName) || !optionalString(publication.saveName) || !optionalString(publication.savedAt)) {
      throw new Error('Invalid saved imported NPC provenance.');
    }
  }
  return structuredClone(value) as ImportedNpcSnapshots;
}

/** Active-session identities, recomputed only when a Storybook node's content or file changes. */
export function createActiveStorybookContextCache() {
  let previous: { books: { id: string; json: string | undefined; fileName: string | undefined }[]; context: ActiveStorybookContext } | undefined;
  return (nodes: WorkflowNode[]): ActiveStorybookContext => {
    const books = nodes.filter(isStorybookSourceNode).map((node) => ({ id: node.id, json: node.data.storybookJson,
      fileName: node.data.storybookFileName }));
    if (previous && previous.books.length === books.length && books.every((book, index) =>
      book.id === previous!.books[index].id && book.json === previous!.books[index].json &&
      book.fileName === previous!.books[index].fileName)) {
      return previous.context;
    }
    const characterIds = new Set(storybookRegistryEntries(nodes).flatMap((entry) =>
      [entry.character.id, ...(entry.aliases?.characterIds ?? [])]));
    const storybookFileNames = [...new Set(books.flatMap((book) => book.fileName ? [book.fileName] : []))].sort();
    previous = { books, context: { characterIds, storybookFileNames } };
    return previous.context;
  };
}

type PublicationIndex = {
  byAccount: Map<string, number[]>;
  byCharacter: Map<string, number[]>;
  legacy: Map<string, number[]>;
};

/** Bucket every post once by the identity that can own it; ownership itself is decided by the export rules. */
function publicationIndex(posts: SocialPostRecord[]): PublicationIndex {
  const index: PublicationIndex = { byAccount: new Map(), byCharacter: new Map(), legacy: new Map() };
  const add = (bucket: Map<string, number[]>, key: string, position: number) => {
    const positions = bucket.get(key);
    if (positions) positions.push(position); else bucket.set(key, [position]);
  };
  posts.forEach((post, position) => {
    if (post.authorAccountId) add(index.byAccount, `${post.app}\u0000${post.authorAccountId}`, position);
    else if (post.authorCharacterId) add(index.byCharacter, `${post.app}\u0000${post.authorCharacterId}`, position);
    else add(index.legacy, post.app, position);
  });
  return index;
}

function candidatePosts(character: Character, posts: SocialPostRecord[], index: PublicationIndex) {
  const positions = (['fotogram', 'onlyfriends'] as const).flatMap((app) => {
    const accountId = character.apps?.[app]?.accountId;
    return [
      ...(accountId ? index.byAccount.get(`${app}\u0000${accountId}`) ?? [] : []),
      ...(index.byCharacter.get(`${app}\u0000${character.id}`) ?? []),
      ...(index.legacy.get(app) ?? []),
    ];
  });
  // Keep the source order so repeated refreshes produce identical snapshots.
  return [...new Set(positions)].sort((left, right) => left - right).map((position) => posts[position]);
}

function sourceProvenance(source: NpcPublicationSource): NpcPublicationProvenance {
  return { storybookFileName: source.storybookFileName, storybookName: source.storybookName, kind: source.kind,
    ...(source.saveFileName ? { saveFileName: source.saveFileName } : {}),
    ...(source.saveName ? { saveName: source.saveName } : {}),
    ...(source.savedAt ? { savedAt: source.savedAt } : {}) };
}

/** "Summer Storybook · Evening Save", or the Storybook alone for its Opening History. */
export function publicationSourceLabel(publication: NpcPublicationProvenance) {
  return publication.kind === 'save'
    ? `${publication.storybookName} · ${publication.saveName || publication.saveFileName || 'RP Save'}`
    : publication.storybookName;
}

type Prepared = { revision: string; entry?: NpcLibraryEntry; diagnostics: NpcLibraryDiagnostic[] };

/**
 * Turns the scanned external Storybook characters into prepared NPC copies.
 * Source-level work (indexing, export preparation) is cached by source revision
 * and never depends on the active Storybook; exclusion and RP pins are applied
 * per call, before a character's posts or media are collected.
 */
export function createExternalNpcLibrary() {
  const prepared = new Map<string, Prepared>();
  const pinnedEntries = new WeakMap<ImportedNpcSnapshots[string], NpcLibraryEntry>();
  let previous: { snapshot: NpcLibrarySnapshot; pinned: ImportedNpcSnapshots; context: ActiveStorybookContext;
    result: NpcLibrarySnapshot } | undefined;

  const pinnedEntry = (snapshot: ImportedNpcSnapshots[string]) => {
    let entry = pinnedEntries.get(snapshot);
    if (!entry) {
      entry = { tier: 'saved-storybook', source: snapshot.source, fileName: snapshot.fileName,
        character: snapshot.character, publication: { ...snapshot.publication, pinned: true } };
      pinnedEntries.set(snapshot, entry);
    }
    return entry;
  };

  return (snapshot: NpcLibrarySnapshot | null, pinned: ImportedNpcSnapshots, context: ActiveStorybookContext) => {
    if (!snapshot) return null;
    if (previous && previous.snapshot === snapshot && previous.pinned === pinned && previous.context === context) {
      return previous.result;
    }
    const sources = new Map((snapshot.publicationSources ?? []).map((source) => [source.key, source]));
    const activeFiles = new Set(context.storybookFileNames);
    const scanned = snapshot.entries.filter((entry) => entry.tier === 'saved-storybook');
    const indexes = new Map<string, PublicationIndex>();
    const galleries = new Map<string, Character['images']>();
    const entries: NpcLibraryEntry[] = Object.values(pinned)
      .filter((imported) => !context.characterIds.has(imported.character.id)).map(pinnedEntry);
    const diagnostics: NpcLibraryDiagnostic[] = [];
    const seen = new Set<string>();
    for (const entry of scanned) {
      seen.add(entry.fileName);
      const source = entry.publicationSource === undefined ? undefined : sources.get(entry.publicationSource);
      // Exclusion precedes any collection of this character's posts or media.
      if (context.characterIds.has(entry.character.id) || Object.prototype.hasOwnProperty.call(pinned, entry.character.id)) continue;
      if (!source) {
        entries.push(entry);
        continue;
      }
      // A snapshot selected for other active Storybooks must not leak their own copies.
      if (activeFiles.has(source.storybookFileName)) continue;
      let cached = prepared.get(entry.fileName);
      if (!cached || cached.revision !== source.revision) {
        let index = indexes.get(source.key);
        if (!index) indexes.set(source.key, index = publicationIndex(source.posts));
        let gallery = galleries.get(source.key);
        if (!gallery) {
          galleries.set(source.key, gallery = [...scanned.filter((candidate) => candidate.publicationSource === source.key)
            .flatMap((candidate) => candidate.character.images), ...source.gallery]);
        }
        cached = prepareExternalNpc(entry, source, candidatePosts(entry.character, source.posts, index), gallery);
        prepared.set(entry.fileName, cached);
      }
      diagnostics.push(...cached.diagnostics);
      if (cached.entry) entries.push(cached.entry);
    }
    for (const fileName of prepared.keys()) {
      if (!seen.has(fileName)) prepared.delete(fileName);
    }
    const result: NpcLibrarySnapshot = { ...snapshot,
      entries: [...snapshot.entries.filter((entry) => entry.tier !== 'saved-storybook'), ...entries],
      diagnostics: [...snapshot.diagnostics, ...diagnostics] };
    previous = { snapshot, pinned, context, result };
    return result;
  };
}

function prepareExternalNpc(entry: NpcLibraryEntry, source: NpcPublicationSource, posts: SocialPostRecord[],
  gallery: Character['images']): Prepared {
  const diagnostics: NpcLibraryDiagnostic[] = [];
  const label = publicationSourceLabel(source);
  try {
    const container = prepareCharacterPublicationExport({ character: entry.character, posts, gallery,
      includePosts: true, receivedImages: 'referenced',
      onMissingImage: (post) => diagnostics.push({ tier: 'saved-storybook', fileName: entry.fileName, code: 'missing-media',
        message: `${entry.character.name}: post ${post.postId} from ${label} was skipped because its image ${post.imageId} is missing.` }) });
    return { revision: source.revision, diagnostics, entry: { tier: 'saved-storybook', source: entry.source,
      fileName: entry.fileName, character: { ...container.character, playable: false } as Character,
      publication: sourceProvenance(source) } };
  } catch (error) {
    return { revision: source.revision, diagnostics: [...diagnostics, { tier: 'saved-storybook', fileName: entry.fileName,
      code: 'invalid-container', message: `${entry.character.name} from ${label} could not be prepared as an NPC: ${
        error instanceof Error ? error.message : String(error)}` }] };
  }
}

/** The external NPC copies in effect, as stored with an RP Save. */
export function importedNpcSnapshots(library: NpcLibrarySnapshot | null): ImportedNpcSnapshots {
  return Object.fromEntries((library?.entries ?? []).flatMap((entry) => {
    if (entry.tier !== 'saved-storybook' || !entry.publication) return [];
    const { pinned: _pinned, ...publication } = entry.publication;
    return [[entry.character.id, { character: entry.character, source: entry.source, fileName: entry.fileName, publication }]];
  }));
}
