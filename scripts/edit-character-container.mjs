import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createEditedCharacterContainer, writeContainerAtomic } from './character-creator.mjs';

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' },
    spec: { type: 'string' },
    specification: { type: 'string' },
    output: { type: 'string' },
    overwrite: { type: 'boolean', default: false },
    'detect-faces': { type: 'boolean', default: false },
  } });
  const requestedSpecification = values.specification ?? values.spec;
  if (!values.input || !requestedSpecification) {
    throw new Error('Usage: npm run character:edit -- --input CONTAINER --spec EDIT_SPEC [--output CONTAINER] [--overwrite]');
  }
  const input = resolve(values.input);
  const specificationPath = resolve(requestedSpecification);
  const output = resolve(values.output ?? input);
  if (output === input && !values.overwrite) throw new Error('Editing a container in place requires --overwrite.');
  const container = JSON.parse(await readFile(input, 'utf8'));
  const specification = JSON.parse(await readFile(specificationPath, 'utf8'));
  const edited = await createEditedCharacterContainer(container, specification, dirname(specificationPath), { detectFace: values['detect-faces'] });
  await writeContainerAtomic(output, edited, values.overwrite);
  console.log(`Created Character Container ${edited.version} revision: ${output}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
