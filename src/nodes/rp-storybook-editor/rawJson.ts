import { sanitizeDataUrls } from '../../utils/sanitize';
import {
  parseRpStorybookJson,
  type RpStorybook,
} from '../rp-storybook/model';

// sanitizeDataUrls replaces every dataUrl with this placeholder prefix.
const REDACTED_PREFIX = '[Data URL redacted:';

function isRedacted(value: unknown): value is string {
  // `includes`, not `startsWith`: sanitizeDataUrls replaces data-URL substrings
  // even inside larger strings, so a placeholder need not be at position 0.
  return typeof value === 'string' && value.includes(REDACTED_PREFIX);
}

/**
 * The editable Raw JSON string: Opening History is pruned to its summary (it
 * holds imported runtime memory and binaries the human cannot author) and all
 * image/voice data URLs are redacted so the text stays small and readable.
 */
export function rpStorybookEditorJsonView(storybook: RpStorybook): string {
  // Opening History is imported runtime memory the user cannot author, so it is
  // omitted from the editable view entirely and restored wholesale on apply.
  const { openingHistory: _openingHistory, ...editable } = storybook;
  return JSON.stringify(sanitizeDataUrls(editable), null, 2);
}

/**
 * Characters whose image/voice/profile still hold a redaction placeholder after
 * rehydration — their binary could not be matched back (e.g. an edited id). The
 * apply must abort rather than let the normalizer silently drop the data.
 */
function unresolvedRedactedBinaries(draftValue: Record<string, unknown>): string[] {
  const affected: string[] = [];
  const characters = Array.isArray(draftValue.characters) ? draftValue.characters : [];
  for (const entry of characters) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const character = entry as Record<string, unknown>;
    const id = typeof character.id === 'string' && character.id ? character.id : '(unknown)';
    const parts: string[] = [];
    if (
      Array.isArray(character.images) &&
      character.images.some(
        (image) => image && typeof image === 'object' && isRedacted((image as Record<string, unknown>).dataUrl),
      )
    ) {
      parts.push('image');
    }
    const voice = character.voiceConfig as Record<string, unknown> | undefined;
    if (voice && typeof voice === 'object' && isRedacted(voice.sampleDataUrl)) {
      parts.push('voice');
    }
    const profile = character.profileImage as Record<string, unknown> | undefined;
    if (profile && typeof profile === 'object' && isRedacted(profile.dataUrl)) {
      parts.push('profile image');
    }
    if (parts.length) {
      affected.push(`${id} (${parts.join(', ')})`);
    }
  }
  return affected;
}

export type RpStorybookEditorJsonApplyResult =
  | { storybook: RpStorybook; warnings: string[] }
  | { error: string };

function rehydrateCharacterBinaries(draftValue: Record<string, unknown>, current: RpStorybook) {
  const currentById = new Map(current.characters.map((character) => [character.id, character]));
  const draftCharacters = Array.isArray(draftValue.characters) ? draftValue.characters : [];
  for (const entry of draftCharacters) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const character = entry as Record<string, unknown>;
    const source = typeof character.id === 'string' ? currentById.get(character.id) : undefined;
    if (!source) {
      continue;
    }
    if (Array.isArray(character.images)) {
      const sourceImageById = new Map(source.images.map((image) => [image.id, image]));
      for (const imageEntry of character.images) {
        if (!imageEntry || typeof imageEntry !== 'object') {
          continue;
        }
        const image = imageEntry as Record<string, unknown>;
        if (isRedacted(image.dataUrl) && typeof image.id === 'string') {
          const sourceImage = sourceImageById.get(image.id);
          if (sourceImage) {
            image.dataUrl = sourceImage.dataUrl;
          }
        }
      }
    }
    if (character.voiceConfig && typeof character.voiceConfig === 'object') {
      const voice = character.voiceConfig as Record<string, unknown>;
      if (isRedacted(voice.sampleDataUrl) && source.voiceConfig?.sampleDataUrl) {
        voice.sampleDataUrl = source.voiceConfig.sampleDataUrl;
      }
    }
    if (character.profileImage && typeof character.profileImage === 'object') {
      const profile = character.profileImage as Record<string, unknown>;
      if (isRedacted(profile.dataUrl) && source.profileImage?.dataUrl) {
        profile.dataUrl = source.profileImage.dataUrl;
      }
    }
  }
}

/**
 * Image ids are derived from the character name at normalization time, so
 * renaming a character reassigns its image ids and drops the name-linked
 * profile image. When the images are otherwise unchanged we best-effort restore
 * the profile-image link (pointing at the new id) and warn; when the images were
 * genuinely edited we only warn. Image content is never lost (it was rehydrated
 * before normalization).
 */
function relinkRenamedCharacters(normalized: RpStorybook, current: RpStorybook, warnings: string[]) {
  const currentById = new Map(current.characters.map((character) => [character.id, character]));
  normalized.characters = normalized.characters.map((character) => {
    const source = currentById.get(character.id);
    if (!source || source.name === character.name || source.images.length === 0) {
      return character;
    }
    const sameImages =
      character.images.length === source.images.length &&
      character.images.every((image, index) => image.dataUrl === source.images[index].dataUrl);
    if (!sameImages) {
      warnings.push(`Renamed "${character.name || character.id}" with edited images; its image ids were reassigned.`);
      return character;
    }
    let profileImage = character.profileImage;
    if (!profileImage && source.profileImage) {
      const oldIndex = source.images.findIndex((image) => image.id === source.profileImage!.imageId);
      if (oldIndex >= 0 && character.images[oldIndex]) {
        profileImage = { ...source.profileImage, imageId: character.images[oldIndex].id };
      }
    }
    warnings.push(`Renamed "${character.name || character.id}"; its image ids were updated to match the new name.`);
    return profileImage ? { ...character, profileImage } : character;
  });
}

/**
 * Applies the edited Raw JSON draft to the current storybook: restore Opening
 * History wholesale, rehydrate redacted binaries by id, then strictly
 * validate/normalize. Returns the normalized storybook or a validation error
 * (in which case the node must be left unchanged).
 */
export function applyRpStorybookEditorJson(current: RpStorybook, draft: string): RpStorybookEditorJsonApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(draft);
  } catch (error) {
    return { error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'The storybook JSON must be an object.' };
  }
  const draftValue = parsed as Record<string, unknown>;

  // Opening History is never hand-edited; restore it exactly from the node.
  draftValue.openingHistory = structuredClone(current.openingHistory);
  rehydrateCharacterBinaries(draftValue, current);

  // A surviving redaction placeholder means a binary could not be resolved (e.g.
  // an id was edited). Abort rather than let the normalizer silently drop it.
  const unresolved = unresolvedRedactedBinaries(draftValue);
  if (unresolved.length > 0) {
    return {
      error: `Could not resolve image/voice data for ${unresolved.join(', ')}. An id may have changed — fix the id(s) or Revert.`,
    };
  }

  let normalized: RpStorybook;
  try {
    // parseRpStorybookJson may return a cached object; clone before relinking
    // mutates it, so the parse cache stays consistent with its key text.
    normalized = structuredClone(parseRpStorybookJson(JSON.stringify(draftValue)));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const warnings: string[] = [];
  relinkRenamedCharacters(normalized, current, warnings);
  return { storybook: normalized, warnings };
}
