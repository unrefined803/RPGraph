/**
 * Deduplicates embedded media (base64 `data:` URLs) at the session
 * serialization boundary. Timeline voice clips store typed media references;
 * media inside runtime and undo `storybookJson` snapshots is replaced by
 * `rpgraph-data-ref:<ref>` sentinels. Both use one shared pool
 * (`entities.mediaData`), so identical generated audio, images, and voice
 * samples are stored at most once outside the embedded workflow.
 *
 * Redaction is plain text substitution, not JSON rewriting: base64 data URLs
 * contain no JSON escapes, so replacing them by sentinel text and back is an
 * exact inverse and a rehydrated snapshot is byte-identical to the original
 * (string-equality checks like checkpoint change detection keep working).
 * In-memory state is never redacted; both directions run only on save/load.
 */

// A raw NUL cannot occur in valid JSON text. Wrapping references with it keeps
// user-authored text such as "rpgraph-data-ref:media-1" from being mistaken
// for an internal reference while the storybook JSON is stored as a string in
// the outer session JSON (which safely escapes the NUL during serialization).
const mediaRefPrefix = '\u0000rpgraph-data-ref:';
const mediaRefSuffix = '\u0000';

// Only inline base64 image/audio payloads are pooled; other data: forms stay
// embedded. Matches the media types the session validation accepts.
const mediaDataUrlPattern = /data:(?:image|audio)\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

const mediaRefPattern = new RegExp(`${mediaRefPrefix}(media-\\d+)${mediaRefSuffix}`, 'g');

export type MediaPool = Record<string, string>;

export function createMediaPoolWriter() {
  const refByDataUrl = new Map<string, string>();
  const mediaData: MediaPool = {};
  const mediaRefForDataUrl = (dataUrl: string): string => {
    let ref = refByDataUrl.get(dataUrl);
    if (!ref) {
      ref = `media-${refByDataUrl.size + 1}`;
      refByDataUrl.set(dataUrl, ref);
      mediaData[ref] = dataUrl;
    }
    return ref;
  };
  const redactedStorybookJson = (json: string): string =>
    json.replace(mediaDataUrlPattern, (dataUrl) =>
      `${mediaRefPrefix}${mediaRefForDataUrl(dataUrl)}${mediaRefSuffix}`
    );
  return { mediaRefForDataUrl, redactedStorybookJson, mediaData };
}

export function createMediaPoolReader(mediaData: MediaPool | undefined) {
  const dataUrlForMediaRef = (ref: string): string => {
    const dataUrl = mediaData?.[ref];
    if (dataUrl === undefined) {
      throw new Error(`The RP save is corrupted: media reference ${ref} has no stored data.`);
    }
    return dataUrl;
  };
  // before(N+1) usually equals after(N); the cache keeps identical snapshots
  // as one rebuilt string instead of one multi-megabyte copy per checkpoint.
  const rehydratedByRedacted = new Map<string, string>();
  const rehydratedStorybookJson = (json: string): string => {
    if (!json.includes(mediaRefPrefix)) {
      return json;
    }
    const cached = rehydratedByRedacted.get(json);
    if (cached !== undefined) {
      return cached;
    }
    const result = json.replace(mediaRefPattern, (_sentinel, ref: string) => {
      return dataUrlForMediaRef(ref);
    });
    rehydratedByRedacted.set(json, result);
    return result;
  };
  return { dataUrlForMediaRef, rehydratedStorybookJson };
}
