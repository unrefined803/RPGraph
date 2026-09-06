import { normalizeCharacterApps } from './character';
import formatVersions from '../storybook/formatVersions.json';

export type V3MigrationResult<T> = { value: T; migratedDocuments: number; sourceVersions: string[] };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Pure, deterministic conversion including embedded workflow/runtime/checkpoint Storybooks. */
export function migrateV3Document<T>(input: T): V3MigrationResult<T> {
  let migratedDocuments = 0;
  const versions = new Set<string>();
  function character(value: unknown, index: number) {
    if (!isRecord(value)) throw new Error('Invalid character in legacy document.');
    const id = typeof value.id === 'string' && value.id.trim() ? value.id : `character-${index + 1}`;
    const name = typeof value.name === 'string' && value.name.trim() ? value.name : `Character ${index + 1}`;
    const { social, ...rest } = value;
    const apps = normalizeCharacterApps(value.apps, social, id, name);
    const portrait = isRecord(value.profileImage) ? value.profileImage : undefined;
    const images = Array.isArray(value.images) ? [...value.images] : [];
    if (portrait?.dataUrl && portrait.imageId && !images.some((image) => isRecord(image) && image.id === portrait.imageId)) {
      images.push({ id: portrait.imageId, name: 'Portrait', mimeType: 'image/jpeg', dataUrl: portrait.dataUrl,
        size: String(portrait.dataUrl).length, description: '' });
    }
    return { ...rest, id, name, playable: value.playable !== false, apps, images,
      ...(portrait ? { profileImage: { imageId: portrait.imageId, crop: portrait.crop } } : {}) };
  }
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!isRecord(value)) return value;
    // Encrypted payloads are opaque; callers must explicitly unlock them first.
    if (typeof value.format === 'string' && value.format.startsWith('rpgraph-encrypted-')) return { ...value };
    let result: Record<string, unknown> = { ...value };
    if (value.format === 'rpgraph-storybook' || value.format === 'rpgraph-character') {
      const version = typeof value.version === 'string' ? value.version : '';
      if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error('Invalid character or Storybook format version.');
      const target = value.format === 'rpgraph-character' ? formatVersions.characterCard : formatVersions.storybook;
      const major = Number(target.split('.')[0]);
      const parts = version.split('.').map(Number);
      if (parts[0] > major || parts[0] === major && (parts[1] > 0 || (parts[2] ?? 0) > 0)) throw new Error(`Unsupported newer character or Storybook format: ${version}`);
      if (version !== target) {
        migratedDocuments += 1;
        versions.add(version);
        result = value.format === 'rpgraph-character'
          ? { ...result, version: target, character: character(value.character, 0) }
          : { ...result, version: target, characters: (Array.isArray(value.characters) ? value.characters : []).map(character) };
      }
    }
    return Object.fromEntries(Object.entries(result).map(([key, entry]) => {
      if (key === 'storybookJson' && typeof entry === 'string' && entry.trim()) {
        const nested = JSON.parse(entry);
        const previousCount = migratedDocuments;
        const converted = visit(nested);
        return [key, migratedDocuments === previousCount ? entry : JSON.stringify(converted, null, 2)];
      }
      return [key, visit(entry)];
    }));
  }
  return { value: visit(input) as T, migratedDocuments, sourceVersions: [...versions] };
}

/** Ask before committing any converted file content; declining leaves live state untouched. */
export function prepareV3Document<T>(input: T, approve: (summary: string) => boolean): T {
  const result = migrateV3Document(input);
  const source: Record<string, unknown> = isRecord(input) ? input : {};
  const characterCount = Array.isArray(source.characters) ? source.characters.length : source.format === 'rpgraph-character' ? 1 : undefined;
  const countSummary = characterCount === undefined ? '' : ` This document contains ${characterCount} character(s); their images and app accounts will be retained.`;
  if (result.migratedDocuments && !approve(
    `Update ${result.migratedDocuments} document(s) from ${result.sourceVersions.join(', ')} to Storybook ${formatVersions.storybook} / Character Container ${formatVersions.characterCard}? ${countSummary} The source file will remain unchanged until you save.`,
  )) throw new Error('V3 migration cancelled. The current document was kept.');
  return result.value;
}

export function confirmV3Migration(summary: string) {
  return window.rpgraph?.confirmV3Migration ? window.rpgraph.confirmV3Migration(summary) : window.confirm(summary);
}
