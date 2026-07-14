import { isRecord } from '../utils/records';

export type ParsedRpOutput = {
  story: string;
  imageDescription?: string;
  displayImageId?: string;
};

function displayImageIdFromMetadata(metadata: Record<string, unknown>) {
  const direct =
    typeof metadata.displayImageId === 'string'
      ? metadata.displayImageId.trim()
      : typeof metadata.display_image_id === 'string'
        ? metadata.display_image_id.trim()
        : '';
  if (direct) {
    return direct;
  }
  const imageEntry = Array.isArray(metadata.rpImages)
    ? metadata.rpImages[0]
    : isRecord(metadata.rpImage)
      ? metadata.rpImage
      : undefined;
  if (!isRecord(imageEntry)) {
    return undefined;
  }
  return typeof imageEntry.imageId === 'string'
    ? imageEntry.imageId.trim() || undefined
    : typeof imageEntry.image_id === 'string'
      ? imageEntry.image_id.trim() || undefined
      : undefined;
}

function rpOutputMetadata(metadata: unknown) {
  if (!isRecord(metadata)) {
    return undefined;
  }
  const imageDescription =
    typeof metadata.image === 'string' && metadata.image.trim()
      ? metadata.image.trim()
      : undefined;
  const displayImageId = displayImageIdFromMetadata(metadata);
  if (!imageDescription && !displayImageId) {
    return undefined;
  }
  return {
    ...(imageDescription ? { imageDescription } : {}),
    ...(displayImageId ? { displayImageId } : {}),
  };
}

function trailingRpImageMetadataObject(value: string) {
  const text = value.trimEnd();
  if (!text.endsWith('}')) {
    return undefined;
  }
  // NOTE: `String.lastIndexOf('{', -1)` clamps the negative fromIndex to 0 and so
  // returns 0 again when the text starts with '{'. Advancing via `start - 1`
  // therefore spins forever on inputs like `{"image":""}` (a JSON object at
  // index 0 whose metadata is empty/invalid, e.g. an empty/refused image prompt).
  // Stop once we reach the opening brace at index 0 instead of re-searching from -1.
  for (let start = text.lastIndexOf('{'); start >= 0; start = start <= 0 ? -1 : text.lastIndexOf('{', start - 1)) {
    try {
      const metadata = JSON.parse(text.slice(start)) as unknown;
      const parsedMetadata = rpOutputMetadata(metadata);
      if (parsedMetadata) {
        return {
          ...parsedMetadata,
          story: text.slice(0, start).trim(),
        };
      }
    } catch {
      // Try the previous opening brace. The story may contain other JSON objects.
    }
  }
  return undefined;
}

function trailingRpImageMetadata(value: string) {
  // The command pass and the after-reply caption action can each append their
  // own metadata object, so the reply may end with several standalone JSON
  // objects. Strip them one by one; the object closest to the end wins when
  // the same field appears twice.
  let merged: { imageDescription?: string; displayImageId?: string; story: string } | undefined;
  let remaining = value;
  for (
    let trailing = trailingRpImageMetadataObject(remaining);
    trailing;
    trailing = trailingRpImageMetadataObject(remaining)
  ) {
    merged = { ...trailing, ...merged, story: trailing.story };
    remaining = trailing.story;
  }
  return merged;
}

export function parseRpOutput(value: string): ParsedRpOutput {
  const text = value.trim();
  const trailingMetadata = trailingRpImageMetadata(text);
  if (trailingMetadata) {
    return trailingMetadata;
  }
  const jsonMatch = text.match(
    /^(\{[^\r\n]*\})[ \t]*\r?\n(?:[ \t]*\r?\n)?([\s\S]+)$/,
  );
  if (jsonMatch) {
    try {
      const metadata = JSON.parse(jsonMatch[1]) as unknown;
      const parsedMetadata = rpOutputMetadata(metadata);
      if (parsedMetadata) {
        return {
          ...parsedMetadata,
          story: jsonMatch[2].trim(),
        };
      }
    } catch {
      // Fall through so malformed metadata remains visible instead of being silently discarded.
    }
  }
  const legacyMatch = text.match(
    /^image\s*:\s*"([^"]*)"[ \t]*\r?\n(?:[ \t]*\r?\n)?([\s\S]+)$/i,
  );
  if (!legacyMatch) {
    return { story: text };
  }
  return {
    imageDescription: legacyMatch[1].trim() || undefined,
    story: legacyMatch[2].trim(),
  };
}

function couldBecomeJsonRpImageMetadataBlock(value: string) {
  const text = value.trimStart();
  if (!text.startsWith('{')) {
    return false;
  }
  const afterBrace = text.slice(1).trimStart();
  if (!afterBrace) {
    return true;
  }
  const keyMatch = afterBrace.match(/^"([^"]*)"?/);
  if (!keyMatch) {
    return false;
  }
  const partialKey = keyMatch[1].toLocaleLowerCase();
  return ['image', 'displayimageid', 'display_image_id', 'rpimages', 'rpimage']
    .some((key) => key.startsWith(partialKey));
}

function isRpImageMetadataLine(value: string) {
  try {
    const metadata = JSON.parse(value) as unknown;
    if (rpOutputMetadata(metadata)) {
      return true;
    }
  } catch {
    // Keep accepting the earlier text format so existing workflows continue to stream cleanly.
  }
  return /^image\s*:\s*"[^"]*"[ \t]*$/i.test(value);
}

function couldBecomeLegacyRpImageMetadataLine(value: string) {
  const normalized = value.trimStart().toLocaleLowerCase();
  if ('image'.startsWith(normalized)) {
    return true;
  }
  if (!normalized.startsWith('image')) {
    return false;
  }
  const afterLabel = normalized.slice('image'.length).trimStart();
  if (!afterLabel.startsWith(':')) {
    return !afterLabel;
  }
  const afterColon = afterLabel.slice(1).trimStart();
  if (!afterColon.startsWith('"')) {
    return !afterColon;
  }
  const afterOpeningQuote = afterColon.slice(1);
  const closingQuoteIndex = afterOpeningQuote.indexOf('"');
  return closingQuoteIndex < 0 || !afterOpeningQuote.slice(closingQuoteIndex + 1).trim();
}

export function createRpImageOutputStream(onStoryChunk: (text: string) => void) {
  let mode: 'detecting' | 'metadata' | 'story' = 'detecting';
  let metadataLineEnd = 0;

  return (value: string) => {
    const text = value.trimStart();
    if (!text) {
      return;
    }
    if (mode === 'detecting') {
      const lineBreakIndex = text.indexOf('\n');
      if (lineBreakIndex < 0) {
        if (text.startsWith('{') || couldBecomeLegacyRpImageMetadataLine(text)) {
          return;
        }
        mode = 'story';
      } else if (isRpImageMetadataLine(text.slice(0, lineBreakIndex).replace(/\r$/, ''))) {
        mode = 'metadata';
        metadataLineEnd = lineBreakIndex + 1;
      } else {
        mode = 'story';
      }
    }
    const story =
      mode === 'metadata'
        ? text.slice(metadataLineEnd).replace(/^[ \t]*(?:\r?\n)?/, '')
        : text;
    const parsed = parseRpOutput(story);
    const storyWithoutCompleteMetadata = parsed.story;
    const trailingJsonStart = storyWithoutCompleteMetadata.lastIndexOf('\n{');
    const streamedStory =
      trailingJsonStart >= 0 &&
      couldBecomeJsonRpImageMetadataBlock(storyWithoutCompleteMetadata.slice(trailingJsonStart + 1))
        ? storyWithoutCompleteMetadata.slice(0, trailingJsonStart).trimEnd()
        : storyWithoutCompleteMetadata;
    if (streamedStory.trim()) {
      onStoryChunk(streamedStory);
    }
  };
}
