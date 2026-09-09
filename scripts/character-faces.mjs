import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const run = promisify(execFile);
export const faceToolsDirectory = fileURLToPath(new URL('../.face-tools/', import.meta.url));
export const facePython = () => process.env.RPGRAPH_FACE_PYTHON || resolve(faceToolsDirectory,
  process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python');
export const faceModel = () => process.env.RPGRAPH_FACE_MODEL || resolve(faceToolsDirectory, 'blaze_face_short_range.tflite');

export async function detectFaces(images) {
  if (!images.length) return [];
  try {
    const operation = run(facePython(), [fileURLToPath(new URL('./detect-character-faces.py', import.meta.url)), faceModel()],
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, MPLCONFIGDIR: resolve(faceToolsDirectory, 'matplotlib') } });
    operation.child.stdin.on('error', () => { /* The process error below contains the setup diagnostic. */ });
    operation.child.stdin.end(JSON.stringify(images));
    return JSON.parse((await operation).stdout);
  } catch (error) {
    throw new Error(`Local face detection is unavailable. Run npm run character:faces:setup, or provide an explicit profileImage.crop. ${error.message}`, { cause: error });
  }
}

/** Primary portrait selection is deterministic and never depends on face detection results. */
export function primaryPortrait(character) {
  const id = character.profileImage?.imageId ?? character.apps?.matchme?.profile?.photoIds?.[0] ??
    character.apps?.fotogram?.avatarImageId ?? character.images[0]?.id;
  const image = character.images.find((candidate) => candidate.id === id);
  if (id && !image) throw new Error(`Unknown portrait gallery image: ${id}`);
  return image;
}

export async function ensureFaceCrop(character, detector = detectFaces) {
  if (character.profileImage?.crop) return;
  const image = primaryPortrait(character);
  if (!image) return;
  const [result] = await detector([image]);
  if (result?.faces === 0) return;
  if (!result?.crop) throw new Error(`Portrait ${image.id}: detected ${result?.faces ?? 0} faces. Select a single-person image or supply a manual profileImage.crop; no crop was guessed.`);
  character.profileImage = { imageId: image.id, crop: result.crop };
}
