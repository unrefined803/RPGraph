import type { AppAvatarCrop } from './character';
import { imageDimensions } from './portrait';

/**
 * Where a vision model sees a face: its center in percent of the image width
 * and height, and the head height (chin to top of hair) in percent of the
 * image height.
 */
export type FaceEstimate = { centerX: number; centerY: number; height: number };

/** The avatar shows some room around the head. */
const facePadding = 1.5;
/** Smallest region the manual picker allows, in percent of the image width. */
const minimumCropSize = 18;

export function faceEstimate(value: unknown): FaceEstimate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { centerX, centerY, height } = value as Record<string, unknown>;
  return [centerX, centerY, height].every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 100) &&
    (height as number) > 0 ? { centerX: centerX as number, centerY: centerY as number, height: height as number } : undefined;
}

/**
 * Square avatar region around an estimated face, in the portrait crop's units.
 * Undefined when the image dimensions are unknown; the whole picture is then used.
 */
export function faceCropFromEstimate(image: { dataUrl: string; width?: number; height?: number }, face: FaceEstimate): AppAvatarCrop | undefined {
  const dimensions = imageDimensions(image);
  if (!dimensions) return undefined;
  const [width, height] = dimensions;
  const side = Math.min(width, height, Math.max(face.height / 100 * height * facePadding, minimumCropSize / 100 * width));
  const x = Math.max(0, Math.min(width - side, face.centerX / 100 * width - side / 2));
  const y = Math.max(0, Math.min(height - side, face.centerY / 100 * height - side / 2));
  const percent = (value: number) => Math.round(value * 10000) / 10000;
  return { x: percent(x / width * 100), y: percent(y / height * 100), size: percent(side / width * 100) };
}

/**
 * The centered square a round avatar shows of an uncropped photo. Stored when
 * the whole photo is chosen for an image that would otherwise inherit the
 * portrait's face region.
 */
export function wholeImageCrop(image: { dataUrl: string; width?: number; height?: number }): AppAvatarCrop | undefined {
  const dimensions = imageDimensions(image);
  if (!dimensions) return undefined;
  const [width, height] = dimensions;
  const side = Math.min(width, height);
  const percent = (value: number) => Math.round(value * 10000) / 10000;
  return { x: percent((width - side) / 2 / width * 100), y: percent((height - side) / 2 / height * 100), size: percent(side / width * 100) };
}
