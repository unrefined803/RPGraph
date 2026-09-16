import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { editableCharacterSpecification, writeBytesAtomic } from './character-creator.mjs';
import agency from '../shared/agency-tags.cjs';

// Authoring targets from docs/architecture/npc-agency-tags.md; role counts are examples.
export const populationTargets = {
  characters: 50,
  apps: { whatsup: 50, fotogram: 35, matchme: 15, onlyfriends: 25 },
  exampleCreators: { fotogram: 5, onlyfriends: 3 },
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appNames = { whatsup: 'WhatsUp', fotogram: 'Fotogram', matchme: 'MatchMe', onlyfriends: 'OnlyFriends' };
const apps = Object.keys(appNames);
const social = ['fotogram', 'onlyfriends'];
const enabled = (c, app) => c.apps?.[app]?.enabled === true;
const role = (c, app) => c.apps[app].accountRole ?? 'user';
const cell = value => String(value).replace(/\|/g, '&#124;').replace(/[\r\n]+/g, ' ');
const table = (headers, rows) => [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.map(cell).join(' | ')} |`).join('\n');
const gap = (target, count) => Math.max(0, target - count);
const percent = (count, total) => total ? `${(100 * count / total).toFixed(1)}%` : 'n/a';

export function renderPopulationReport(entries, source = 'resources/npc-characters') {
  const characters = entries.map(entry => entry.character);
  const count = characters.length;
  const remaining = gap(populationTargets.characters, count);
  const warnings = [];
  const seen = new Map();
  function unique(key, label) {
    if (seen.has(key)) warnings.push(`Duplicate ${label}; also used by ${seen.get(key)}.`);
    else seen.set(key, label);
  }
  for (const c of characters) {
    unique(`id:${c.id}`, `character ID ${c.id} (${c.name})`);
    unique(`name:${c.name.trim().toLowerCase()}`, `character name ${c.name}`);
    for (const app of apps) {
      const account = c.apps?.[app];
      if (!account) continue;
      unique(`account:${account.accountId}`, `account ID ${account.accountId} (${c.name}, ${appNames[app]})`);
      if (enabled(c, app) && account.profileName) unique(`profile:${app}:${account.profileName.trim().toLowerCase()}`, `${appNames[app]} profile ${account.profileName} (${c.name})`);
    }
  }
  const tags = agency.agencyTagCatalog.map(tag => ({
    ...tag,
    owners: characters.filter(c => c.agencyTags?.includes(tag.id)),
    assigned: characters.filter(c => apps.some(app => enabled(c, app) && c.apps[app].agencyTags?.includes(tag.id))),
  }));
  const missing = tags.filter(tag => !tag.owners.length);
  const inactive = tags.filter(tag => tag.owners.length && !tag.assigned.length);
  const duplicate = tags.filter(tag => tag.owners.length > 1);
  const unclassified = characters.filter(c => !c.agencyTags?.length);
  const accountRows = apps.map(app => {
    const current = characters.filter(c => enabled(c, app)).length;
    const target = populationTargets.apps[app];
    if (gap(target, current) > remaining) warnings.push(`${appNames[app]} needs ${gap(target, current)} accounts but only ${remaining} new-character slots remain; review existing profiles or the plan.`);
    return [appNames[app], `${target} / 50`, current, gap(target, current), gap(current, target)];
  });
  const roleRows = social.map(app => {
    const users = characters.filter(c => enabled(c, app) && role(c, app) === 'user').length;
    const creators = characters.filter(c => enabled(c, app) && role(c, app) === 'creator').length;
    const targetCreators = populationTargets.exampleCreators[app];
    const targetUsers = populationTargets.apps[app] - targetCreators;
    return [appNames[app], users, creators, percent(users, users + creators), `${targetUsers} / ${targetCreators}`, `${gap(targetUsers, users)} / ${gap(targetCreators, creators)}`, `${gap(users, targetUsers)} / ${gap(creators, targetCreators)}`];
  });
  const totalUsers = social.reduce((sum, app) => sum + characters.filter(c => enabled(c, app) && role(c, app) === 'user').length, 0);
  const totalSocial = social.reduce((sum, app) => sum + characters.filter(c => enabled(c, app)).length, 0);
  const creators = characters.filter(c => social.some(app => enabled(c, app) && role(c, app) === 'creator'));
  const mixed = creators.filter(c => social.some(app => enabled(c, app) && role(c, app) === 'user'));
  if (missing.length > remaining * 2) warnings.push('Missing tags exceed the two-tag capacity of the remaining new characters; existing characters or the population target need review.');
  for (const c of characters.filter(c => enabled(c, 'matchme') && !c.apps.matchme.profile?.photoIds?.length)) warnings.push(`${c.name}: enabled MatchMe account has no discoverable profile with photos.`);
  if (!count) warnings.push('The source directory contains no character containers.');
  const assignment = (tag, app) => characters.filter(c => enabled(c, app) && c.apps[app].agencyTags?.includes(tag.id)).length;
  const lines = [
    '# NPC Population and Agency Coverage Report', '',
    `Source: ${source}. Generated from validated containers and the executable agency catalog.`, '',
    'Scope: bundled authoring inventory only; saved revisions, user-library overrides and Storybook characters are excluded. No containers were modified. Delete this generated file after review; rerun `npm run npc:report` to recreate it.', '',
    'Targets: `docs/architecture/npc-agency-tags.md`; executable target values: `scripts/report-npc-population.mjs`. Every catalog tag should occur on at least one character. Counts below use enabled accounts only; missing social roles mean user.', '',
    '## At a glance', '',
    table(['Measure', 'Current', 'Target / remaining'], [
      ['Characters', count, `50 / ${remaining} still needed; ${gap(count, 50)} above target`],
      ['Distinct character tags', tags.length - missing.length, `${tags.length} / ${missing.length} missing`],
      ['Tags assigned to enabled apps', tags.filter(t => t.assigned.length).length, `${tags.length} / ${missing.length + inactive.length} not active`],
      ['Unclassified characters', unclassified.length, '0 unclassified'],
      ['Repeated tags', duplicate.length, 'Review before reusing; no maximum per tag is specified'],
      ['Ordinary-user social accounts', `${totalUsers} / ${totalSocial} (${percent(totalUsers, totalSocial)})`, '80–90% users; 10–20% creators'],
    ]), '',
    '## Enabled account targets', '',
    table(['App', 'Final target', 'Existing', 'Still needed', 'Above target'], accountRows), '',
    'Accounts overlap across people. Preserve existing accounts. Explicitly disable Fotogram on new characters that should not have it; creation otherwise provisions standard accounts. MatchMe additions require suitable identity-specific images and valid photo references; this report does not establish image suitability or future media availability.', '',
    '## Social account roles', '',
    table(['App', 'Users', 'Creators', 'User share', 'Example final users / creators', 'Needed for example U / C', 'Above example U / C'], roleRows), '',
    `The 30/5 Fotogram and 22/3 OnlyFriends splits are planning examples, not mandatory quotas. At the final account totals, 80–90% users allows 4–7 Fotogram creators and 3–5 OnlyFriends creators. Unique people with a creator account: ${creators.length}; with both user and creator social roles: ${mixed.length}.`, '',
    '## Complete tag coverage', '',
    'Character counts count each person once. App columns count explicit assignments on enabled accounts. Prioritize tags with zero characters when authoring new characters. A tag need not appear on every compatible app; zero in an app column is not an additional quota.', '',
    table(['Tag', 'Characters', ...apps.map(a => appNames[a])], tags.map(t => [t.id, t.owners.length, ...apps.map(a => assignment(t, a))])), '',
    '## Validation and planning issues', '',
    warnings.length ? warnings.map(w => `- ${w}`).join('\n') : 'No inventory conflicts or capacity issues detected. All source containers passed shared validation.', '',
  ];
  return lines.join('\n');
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' } } });
  const input = resolve(values.input ?? resolve(root, 'resources/npc-characters'));
  const output = resolve(values.output ?? resolve(root, 'npc-population-report.md'));
  if (!output.endsWith('.md')) throw new Error('The report output must be a Markdown (.md) file.');
  const entries = [];
  for (const file of (await readdir(input)).filter(name => name.endsWith('.json')).sort()) {
    try {
      const container = JSON.parse(await readFile(resolve(input, file), 'utf8'));
      entries.push({ file, character: editableCharacterSpecification(container).character });
    } catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
  }
  // Replace only our own disposable report, never an unrelated Markdown document.
  try {
    const previous = await readFile(output, 'utf8');
    if (!previous.startsWith('# NPC Population and Agency Coverage Report\n')) throw new Error(`Refusing to replace unrelated file: ${output}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeBytesAtomic(output, renderPopulationReport(entries, relative(root, input).split('\\').join('/')), true);
  console.log(`Created NPC population report: ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
