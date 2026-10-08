import type { RpStorybookCharacterImage, RpStorybookCharacterProfileImage } from '../nodes/rp-storybook/model';
import type { CharacterApps } from './character';

type Crop = RpStorybookCharacterProfileImage['crop'];

const portraitCacheMaxEntries = 64;
const portraitCache = new Map<string, Map<string, string>>();
let portraitCacheEntries = 0;
// A cast larger than the content cache would otherwise evict and re-encode every
// portrait on each pass. Entries live only as long as their image object.
const portraitImageCacheMaxVariants = 4;
const portraitImageCache = new WeakMap<object, { dataUrl: string; variants: Map<string, string> }>();

function rememberImagePortrait(image: { dataUrl: string }, variant: string, value: string) {
  let known = portraitImageCache.get(image);
  if (!known || known.dataUrl !== image.dataUrl || known.variants.size >= portraitImageCacheMaxVariants) {
    known = { dataUrl: image.dataUrl, variants: new Map() };
    portraitImageCache.set(image, known);
  }
  known.variants.set(variant, value);
  return value;
}

function cachedPortrait(dataUrl: string, variant: string) {
  const variants = portraitCache.get(dataUrl);
  const value = variants?.get(variant);
  if (value === undefined) return undefined;
  // Refresh both levels so Map insertion order remains the LRU order.
  variants!.delete(variant);
  variants!.set(variant, value);
  portraitCache.delete(dataUrl);
  portraitCache.set(dataUrl, variants!);
  return value;
}

function cachePortrait(dataUrl: string, variant: string, value: string) {
  let variants = portraitCache.get(dataUrl);
  if (!variants) {
    variants = new Map();
    portraitCache.set(dataUrl, variants);
  } else {
    portraitCache.delete(dataUrl);
    portraitCache.set(dataUrl, variants);
  }
  if (!variants.has(variant)) portraitCacheEntries += 1;
  variants.set(variant, value);

  while (portraitCacheEntries > portraitCacheMaxEntries) {
    const oldestSource = portraitCache.entries().next().value as [string, Map<string, string>] | undefined;
    if (!oldestSource) break;
    const [oldestDataUrl, oldestVariants] = oldestSource;
    const oldestVariant = oldestVariants.keys().next().value as string | undefined;
    if (oldestVariant === undefined) {
      portraitCache.delete(oldestDataUrl);
      continue;
    }
    oldestVariants.delete(oldestVariant);
    portraitCacheEntries -= 1;
    if (oldestVariants.size === 0) portraitCache.delete(oldestDataUrl);
  }
}

/** Older galleries omit dimensions. Read the JPEG frame header without decoding pixels. */
function jpegDimensions(dataUrl: string): [number, number] | undefined {
  try {
    const bytes = atob(dataUrl.slice('data:image/jpeg;base64,'.length));
    const word = (offset: number) => bytes.charCodeAt(offset) * 256 + bytes.charCodeAt(offset + 1);
    if (word(0) !== 0xffd8) return undefined;
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes.charCodeAt(offset++) !== 0xff) return undefined;
      while (bytes.charCodeAt(offset) === 0xff) offset++;
      const marker = bytes.charCodeAt(offset++);
      if (marker === 0xda || marker === 0xd9) return undefined;
      const length = word(offset);
      if (length < 2) return undefined;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return [word(offset + 5), word(offset + 3)];
      }
      offset += length;
    }
  } catch { /* Invalid legacy bytes retain the original unavailable-image behavior. */ }
  return undefined;
}

/** A derived, square image for existing avatar consumers; never persisted in a container. */
/** Pixel size of an embedded gallery JPEG, or undefined when it cannot be determined. */
export function imageDimensions(image: Pick<RpStorybookCharacterImage, 'dataUrl' | 'width' | 'height'>): [number, number] | undefined {
  const dimensions = image.width && image.height ? [image.width, image.height] : jpegDimensions(image.dataUrl);
  return dimensions && dimensions[0] > 0 && dimensions[1] > 0 ? [dimensions[0], dimensions[1]] : undefined;
}

export function portraitDataUrl(image: Pick<RpStorybookCharacterImage, 'dataUrl' | 'width' | 'height'>, crop?: Crop): string {
  if (!crop || ![crop.x, crop.y, crop.size].every(Number.isFinite) || crop.size <= 0) return image.dataUrl;
  const variant = `${image.width ?? ''}:${image.height ?? ''}:${crop.x}:${crop.y}:${crop.size}`;
  const known = portraitImageCache.get(image);
  const remembered = known?.dataUrl === image.dataUrl ? known.variants.get(variant) : undefined;
  if (remembered !== undefined) return remembered;
  const cached = cachedPortrait(image.dataUrl, variant);
  if (cached !== undefined) return rememberImagePortrait(image, variant, cached);
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)) return image.dataUrl;
  const dimensions = imageDimensions(image);
  if (!dimensions) return image.dataUrl;
  const [width, height] = dimensions;
  const size = Math.min(width, height, crop.size * width / 100);
  const x = Math.max(0, Math.min(width - size, crop.x * width / 100));
  const y = Math.max(0, Math.min(height - size, crop.y * height / 100));
  // Only validated JPEG bytes and finite numbers enter this self-contained SVG.
  // The viewport applies the crop synchronously, including in import and snapshot projections.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="256" height="256" viewBox="${x} ${y} ${size} ${size}"><image width="${width}" height="${height}" xlink:href="${image.dataUrl}"/></svg>`;
  const value = `data:image/svg+xml;base64,${btoa(svg)}`;
  cachePortrait(image.dataUrl, variant, value);
  return rememberImagePortrait(image, variant, value);
}

/** An app using the portrait's source photo inherits its manually editable crop. */
export function appAvatarDataUrl(
  character: { profileImage?: Pick<RpStorybookCharacterProfileImage, 'imageId' | 'crop'> & { dataUrl?: string } } | undefined,
  image?: Pick<RpStorybookCharacterImage, 'id' | 'dataUrl' | 'width' | 'height'>,
) {
  if (!image) return character?.profileImage?.dataUrl;
  return portraitDataUrl(image, character?.profileImage?.imageId === image.id ? character.profileImage.crop : undefined);
}

/** The real character portrait is independent of every app's selected slot. */
export function withCharacterPortrait<T extends { profileImage?: RpStorybookCharacterProfileImage; apps?: CharacterApps }>(
  character: T, profileImage: RpStorybookCharacterProfileImage | undefined,
): T {
  return { ...character, profileImage };
}
