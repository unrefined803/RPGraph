import { assertSelectedImageSize, normalizeImageFile } from '../utils/imageNormalization';
import type { RpStorybookCharacterImage } from '../nodes/rp-storybook/model';

/** Reject animation before browser decoding can silently flatten it to one frame. */
export function assertStaticCharacterImage(bytes: Uint8Array) {
  const tag = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tag(0, 3) === 'GIF') throw new Error('Animated and GIF images are unsupported. Use a static JPEG, PNG or WebP.');
  const png = bytes[0] === 0x89 && tag(1, 3) === 'PNG';
  const webp = tag(0, 4) === 'RIFF' && tag(8, 4) === 'WEBP';
  if (!png && !webp) return;
  for (let offset = png ? 8 : 12; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset + (png ? 0 : 4), !png);
    const kind = tag(offset + (png ? 4 : 0), 4);
    if (kind === 'acTL' || kind === 'ANIM' || kind === 'ANMF') throw new Error('Animated images are unsupported. Choose a static image.');
    offset += png ? length + 12 : length + 8 + length % 2;
  }
}

export async function normalizeCharacterImage(file: File): Promise<RpStorybookCharacterImage> {
  assertSelectedImageSize(file);
  assertStaticCharacterImage(new Uint8Array(await file.arrayBuffer()));
  const image = await normalizeImageFile(file, () => crypto.randomUUID(), 0.84);
  return { id: image.id, name: image.name, size: image.size, dataUrl: image.dataUrl,
    width: image.width, height: image.height, mimeType: 'image/jpeg', description: '' };
}
