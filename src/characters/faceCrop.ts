import type { AppAvatarCrop } from './character';

/**
 * Face region for a round avatar. Undefined means the full picture is used:
 * no single face was found, or local detection is unavailable (browser build,
 * missing desktop tools).
 */
export async function detectAvatarFaceCrop(image: { id: string; dataUrl: string }): Promise<AppAvatarCrop | undefined> {
  if (typeof window === 'undefined' || !window.rpgraph?.detectCharacterFace) return undefined;
  try {
    const result = await window.rpgraph.detectCharacterFace({ id: image.id, dataUrl: image.dataUrl });
    return result.faces === 1 ? result.crop : undefined;
  } catch {
    return undefined;
  }
}
