import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  editableCharacterSpecification,
  embeddedImageBytes,
  writeBytesAtomic,
  writeJsonAtomic,
} from './character-creator.mjs';

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' },
    output: { type: 'string' },
    overwrite: { type: 'boolean', default: false },
    'extract-image': { type: 'string' },
    'image-output': { type: 'string' },
  } });
  if (!values.input) {
    throw new Error('Usage: npm run character:inspect -- --input CONTAINER [--output EDIT_SPEC] [--overwrite] [--extract-image IMAGE_ID --image-output IMAGE.jpg]');
  }
  if (!!values['extract-image'] !== !!values['image-output']) {
    throw new Error('--extract-image and --image-output must be used together.');
  }
  const input = resolve(values.input);
  const container = JSON.parse(await readFile(input, 'utf8'));
  const specification = editableCharacterSpecification(container);
  if (values.output) {
    const output = resolve(values.output);
    if (output === input) throw new Error('The edit specification must not overwrite its source container.');
    await writeJsonAtomic(output, specification, values.overwrite);
    console.log(`Created blob-free character edit specification: ${output}`);
  }
  if (values['extract-image']) {
    const output = resolve(values['image-output']);
    await writeBytesAtomic(output, embeddedImageBytes(container, values['extract-image']), values.overwrite);
    console.log(`Extracted embedded JPEG ${values['extract-image']}: ${output}`);
  }
  if (!values.output && !values['extract-image']) console.log(JSON.stringify(specification, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
