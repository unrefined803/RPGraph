import { build } from 'esbuild';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const inputArg = args.indexOf('--input');
const outputArg = args.indexOf('--output');
if (inputArg < 0 || outputArg < 0 || !args[inputArg + 1] || !args[outputArg + 1]) {
  throw new Error('Usage: npm run character:migrate-v3 -- --input source.json --output target.json [--overwrite]');
}
const input = resolve(args[inputArg + 1]);
const output = resolve(args[outputArg + 1]);
const source = JSON.parse(await readFile(input, 'utf8'));
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/characters/migration.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm' });
const { migrateV3Document } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const result = migrateV3Document(source);
const contents = `${JSON.stringify(result.value, null, 2)}\n`;
if (args.includes('--overwrite')) {
  const temporary = `${output}.v3-${process.pid}.tmp`;
  try { await writeFile(temporary, contents, { flag: 'wx' }); await rename(temporary, output); }
  finally { await rm(temporary, { force: true }); }
} else await writeFile(output, contents, { flag: 'wx' });
console.log(`Migrated ${result.migratedDocuments} document(s) to V3: ${output}`);
