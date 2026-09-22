import { afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const directory = mkdtempSync(join(tmpdir(), 'rpgraph-population-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const cli = (input: string, output: string) => run(process.execPath, ['scripts/report-npc-population.mjs', '--input', input, '--output', output]);
const fixture = () => JSON.parse(readFileSync('resources/npc-characters/avery-hart.json', 'utf8'));

function setup(name: string) {
  const input = join(directory, name);
  mkdirSync(input);
  return { input, output: join(directory, `${name}.md`) };
}

describe('NPC population report CLI', () => {
  it('counts explicit enabled accounts, legacy user roles and distinct tags without modifying sources', async () => {
    const { input, output } = setup('counts');
    const container = fixture();
    container.character.apps.fotogram.enabled = false;
    delete container.character.apps.onlyfriends.accountRole;
    const original = JSON.stringify(container);
    writeFileSync(join(input, 'one.json'), original);
    await cli(input, output);
    const report = readFileSync(output, 'utf8');
    expect(report).toContain('| Characters | 1 | 50 / 49 still needed; 0 above target |');
    expect(report).toContain('| Distinct character tags | 2 | 54 / 52 missing |');
    expect(report).toContain('| Fotogram | 35 / 50 | 0 | 35 | 0 |');
    expect(report).toContain('| OnlyFriends | 1 | 0 | 100.0% |');
    expect(report).not.toContain('data:image');
    expect(report).not.toContain('Duplicate account ID');
    expect(report).not.toContain('undefined');
    expect(readFileSync(join(input, 'one.json'), 'utf8')).toBe(original);
    await cli(input, output);
    expect(readFileSync(output, 'utf8')).toBe(report);
  });

  it('reports duplicate identities and does not silently deduplicate the inventory', async () => {
    const { input, output } = setup('duplicates');
    const original = JSON.stringify(fixture());
    writeFileSync(join(input, 'one.json'), original);
    writeFileSync(join(input, 'two.json'), original);
    await cli(input, output);
    const report = readFileSync(output, 'utf8');
    expect(report).toContain('Duplicate character ID');
    expect(report).toContain(`Duplicate account ID ${fixture().character.apps.whatsup.accountId}`);
    expect(report).not.toContain('account ID undefined');
    expect(report).toContain('| genuine_user | 2 | 2 | 2 | 2 | 2 |');
  });

  it('preserves an existing report when a source is invalid and protects unrelated files', async () => {
    const { input, output } = setup('invalid');
    await cli(input, output);
    const original = readFileSync(output, 'utf8');
    expect(original).toContain('contains no character containers');
    writeFileSync(join(input, 'broken.json'), '{}');
    await expect(cli(input, output)).rejects.toMatchObject({ code: 1 });
    expect(readFileSync(output, 'utf8')).toBe(original);
    writeFileSync(join(input, 'broken.json'), JSON.stringify(fixture()));
    writeFileSync(output, '# Authored notes\n');
    await expect(cli(input, output)).rejects.toMatchObject({ code: 1 });
    expect(readFileSync(output, 'utf8')).toBe('# Authored notes\n');
  });

  it('distinguishes unclassified characters and declared tags without active assignments', async () => {
    const { input, output } = setup('inactive');
    const container = fixture();
    for (const account of Object.values(container.character.apps) as Record<string, unknown>[]) account.enabled = false;
    writeFileSync(join(input, 'one.json'), JSON.stringify(container));
    await cli(input, output);
    expect(readFileSync(output, 'utf8')).toContain('| genuine_user | 1 | 0 | 0 | 0 | 0 |');
    container.character.agencyTags = [];
    for (const account of Object.values(container.character.apps) as Record<string, unknown>[]) account.agencyTags = [];
    writeFileSync(join(input, 'one.json'), JSON.stringify(container));
    await cli(input, output);
    const report = readFileSync(output, 'utf8');
    expect(report).toContain('| Unclassified characters | 1 | 0 unclassified |');
    expect(report).toContain('| Distinct character tags | 0 | 54 / 54 missing |');
  });
});
