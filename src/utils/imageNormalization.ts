import type { ChatImageAttachment } from '../types';

export type SelectedImageSource = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

const maxSelectedImageBytes = 32 * 1024 * 1024;
const normalizedImageMimeType = 'image/jpeg';
const normalizedImageExtension = 'jpg';
const normalizedImageQuality = 0.9;
const maxNormalizedImagePixels = 1_000_000;
const allowedSourceImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function formatMegabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function assertSelectedImageSize(source: Pick<SelectedImageSource, 'name' | 'size'>) {
  if (source.size > maxSelectedImageBytes) {
    throw new Error(
      `Selected image is too large: ${source.name} is ${formatMegabytes(source.size)}. ` +
        `The limit is ${formatMegabytes(maxSelectedImageBytes)} per image.`,
    );
  }
}

function loadImageElement(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected image could not be decoded.'));
    image.src = source;
  });
}

function dataUrlBase64(source: string) {
  const prefixEnd = source.indexOf(',');
  if (prefixEnd < 0 || !source.slice(0, prefixEnd).endsWith(';base64')) {
    return '';
  }
  return source.slice(prefixEnd + 1);
}

function decodedDataUrlPrefix(source: string) {
  const base64 = dataUrlBase64(source).slice(0, 32);
  if (!base64) {
    return [];
  }
  try {
    return Array.from(atob(base64), (character) => character.charCodeAt(0));
  } catch {
    return [];
  }
}

function detectedRasterMimeType(source: SelectedImageSource) {
  const bytes = decodedDataUrlPrefix(source.dataUrl);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

function assertAllowedRasterImage(source: SelectedImageSource) {
  const detectedMimeType = detectedRasterMimeType(source);
  if (!detectedMimeType || !allowedSourceImageMimeTypes.has(detectedMimeType)) {
    throw new Error(
      `Unsupported image format: ${source.name}. Use a JPEG, PNG, or WebP image.`,
    );
  }
}

export function encodedDataUrlBytes(dataUrl: string) {
  const base64 = dataUrlBase64(dataUrl);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.ceil((base64.length * 3) / 4) - padding);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read image: ${file.name}`));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Unable to read image: ${file.name}`));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function normalizeImageAttachment(
  source: SelectedImageSource,
  createId: () => string,
  quality = normalizedImageQuality,
): Promise<ChatImageAttachment> {
  assertSelectedImageSize(source);
  assertAllowedRasterImage(source);
  const image = await loadImageElement(source.dataUrl);
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('The selected image could not be decoded.');
  }
  const originalPixels = image.naturalWidth * image.naturalHeight;
  const scale = originalPixels > maxNormalizedImagePixels
    ? Math.sqrt(maxNormalizedImagePixels / originalPixels)
    : 1;
  const width = Math.max(1, Math.floor(image.naturalWidth * scale));
  const height = Math.max(1, Math.floor(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to prepare image for the LLM request.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL(normalizedImageMimeType, quality);
  return {
    id: createId(),
    name: `${source.name.replace(/\.[^.]+$/, '')}.${normalizedImageExtension}`,
    mimeType: normalizedImageMimeType,
    size: encodedDataUrlBytes(dataUrl),
    dataUrl,
    width,
    height,
  };
}

export async function normalizeImageFile(
  file: File,
  createId: () => string,
  quality = normalizedImageQuality,
): Promise<ChatImageAttachment> {
  assertSelectedImageSize({
    name: file.name,
    size: file.size,
  });
  const dataUrl = await fileToDataUrl(file);
  return normalizeImageAttachment({
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    dataUrl,
  }, createId, quality);
}
