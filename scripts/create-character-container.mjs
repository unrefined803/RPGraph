import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createFromSpecification, writeContainerAtomic, installationTarget } from './character-creator.mjs';

try {
  const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' },
    'install-dir': { type: 'string' }, 'skip-face-detection': { type: 'boolean', default: false }, overwrite: { type: 'boolean', default: false } } });
  if (!values.input || (!values.output && !values['install-dir'])) {
    throw new Error('Usage: npm run character:create -- --input specification.json [--output target.json] [--install-dir NPC_FOLDER] [--overwrite]');
  }
  const input = resolve(values.input);
  const container = await createFromSpecification(JSON.parse(await readFile(input, 'utf8')), dirname(input), undefined, { detectFace: !values['skip-face-detection'] });
  const targets = new Set([...(values.output ? [resolve(values.output)] : []),
    ...(values['install-dir'] ? [await installationTarget(resolve(values['install-dir']), container.character.id)] : [])]);
  if (targets.has(input)) throw new Error('Input and output must differ; preserve the source specification.');
  for (const target of targets) {
    await writeContainerAtomic(target, container, values.overwrite);
    console.log(`Created Character Container ${container.version}: ${target}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
