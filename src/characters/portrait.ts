import type { RpStorybookCharacterImage, RpStorybookCharacterProfileImage } from '../nodes/rp-storybook/model';
import type { CharacterApps } from './character';

type Crop = RpStorybookCharacterProfileImage['crop'];

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
export function portraitDataUrl(image: Pick<RpStorybookCharacterImage, 'dataUrl' | 'width' | 'height'>, crop?: Crop): string {
  if (!crop || ![crop.x, crop.y, crop.size].every(Number.isFinite) || crop.size <= 0 ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)) return image.dataUrl;
  const dimensions = image.width && image.height ? [image.width, image.height] : jpegDimensions(image.dataUrl);
  if (!dimensions) return image.dataUrl;
  const [width, height] = dimensions;
  if (!(width > 0 && height > 0)) return image.dataUrl;
  const size = Math.min(width, height, crop.size * width / 100);
  const x = Math.max(0, Math.min(width - size, crop.x * width / 100));
  const y = Math.max(0, Math.min(height - size, crop.y * height / 100));
  // Only validated JPEG bytes and finite numbers enter this self-contained SVG.
  // The viewport applies the crop synchronously, including in import and snapshot projections.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="256" height="256" viewBox="${x} ${y} ${size} ${size}"><image width="${width}" height="${height}" xlink:href="${image.dataUrl}"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** An app using the portrait's source photo inherits its manually editable crop. */
export function appAvatarDataUrl(
  character: { profileImage?: Pick<RpStorybookCharacterProfileImage, 'imageId' | 'crop'> & { dataUrl?: string } } | undefined,
  image?: Pick<RpStorybookCharacterImage, 'id' | 'dataUrl' | 'width' | 'height'>,
) {
  if (!image) return character?.profileImage?.dataUrl;
  return portraitDataUrl(image, character?.profileImage?.imageId === image.id ? character.profileImage.crop : undefined);
}

/** Keep apps following the previous portrait while preserving independently selected avatars. */
export function withCharacterPortrait<T extends { profileImage?: RpStorybookCharacterProfileImage; apps?: CharacterApps }>(
  character: T, profileImage: RpStorybookCharacterProfileImage | undefined,
): T {
  const previousId = character.profileImage?.imageId;
  const apps = character.apps && Object.fromEntries(Object.entries(character.apps).map(([app, account]) => [app,
    previousId && account.avatarImageId === previousId
      ? { ...account, avatarImageId: profileImage?.imageId }
      : account,
  ]));
  return { ...character, profileImage, ...(apps ? { apps } : {}) };
}
