import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { faceToolsDirectory } from './character-faces.mjs';

const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const modelSha256 = 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f';
try {
  await mkdir(faceToolsDirectory, { recursive: true });
  execFileSync(process.env.RPGRAPH_SETUP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    ['-m', 'venv', resolve(faceToolsDirectory, 'venv')], { stdio: 'inherit' });
  const python = resolve(faceToolsDirectory, process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python');
  execFileSync(python, ['-m', 'pip', 'install', '-r', fileURLToPath(new URL('./face-requirements.txt', import.meta.url))], { stdio: 'inherit' });
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== modelSha256) throw new Error('Face detector model checksum mismatch.');
  await writeFile(resolve(faceToolsDirectory, 'blaze_face_short_range.tflite'), bytes);
  console.log('Local face detection is ready. Creation and backfill now work offline.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
