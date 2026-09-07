import { build } from 'esbuild';
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { createFromSpecification, writeContainerAtomic, containerFileName } from './character-creator.mjs';

try {
  const { values } = parseArgs({ options: { output: { type: 'string' }, overwrite: { type: 'boolean', default: false } } });
  if (!values.output) throw new Error('Usage: npm run character:convert-demos -- --output STAGING_DIRECTORY [--overwrite]');
  const project = fileURLToPath(new URL('../', import.meta.url));
  const output = resolve(values.output);
  if (output === resolve(project, 'resources/npc-characters')) throw new Error('Demo conversion must use a staging directory until Stage 7.');
  const bundle = await build({ entryPoints: [join(project, 'src/characters/demoConversion.ts')],
    bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'local-image-paths', setup(builder) {
      builder.onLoad({ filter: /\.jpg$/ }, ({ path }) => ({ contents: `export default ${JSON.stringify(path)}`, loader: 'js' }));
    } }] });
  const { demoConversionPlan } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const plan = demoConversionPlan();
  const inventory = [];
  for (const { specification, ...mapping } of plan) {
    const container = await createFromSpecification(specification, project);
    const fileName = containerFileName(container.character.id);
    await writeContainerAtomic(join(output, fileName), container, values.overwrite);
    inventory.push({ ...mapping, fileName });
  }
  await writeFile(join(output, 'conversion-map.json'), `${JSON.stringify(inventory, null, 2)}\n`, { flag: values.overwrite ? 'w' : 'wx' });
  console.log(`Converted ${inventory.length} legacy identities into ${output}. Discovery remains unchanged.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
