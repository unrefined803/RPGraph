/**
 * Media-pool reference encoding shared by the renderer's session serializer
 * and the Electron main process, which reads RP Saves as publication sources.
 */

// A raw NUL cannot occur in valid JSON text. Wrapping references with it keeps
// user-authored text such as "rpgraph-data-ref:media-1" from being mistaken
// for an internal reference while the storybook JSON is stored as a string in
// the outer session JSON (which safely escapes the NUL during serialization).
const mediaRefPrefix = '\u0000rpgraph-data-ref:';
const mediaRefSuffix = '\u0000';

const mediaRefPattern = new RegExp(`${mediaRefPrefix}(media-\\d+)${mediaRefSuffix}`, 'g');

/** Replace every pooled reference in `json`; a missing pool entry is corruption. */
function rehydratedMediaJson(json, mediaData) {
  if (!json.includes(mediaRefPrefix)) {
    return json;
  }
  return json.replace(mediaRefPattern, (_sentinel, ref) => {
    const dataUrl = mediaData?.[ref];
    if (dataUrl === undefined) {
      throw new Error(`The RP save is corrupted: media reference ${ref} has no stored data.`);
    }
    return dataUrl;
  });
}

module.exports = { mediaRefPrefix, mediaRefSuffix, rehydratedMediaJson };
