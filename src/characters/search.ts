import { agencyTagCatalog, type AgencyTagId } from '../../shared/agency-tags.cjs';
import { accountHandleMatches, migratedProfileName, type Character } from './character';
import { postsWithInitialContent } from './publications';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';

const apps = ['whatsup', 'fotogram', 'onlyfriends', 'matchme'] as const;
export type CharacterSearchQuery = {
  app?: typeof apps[number];
  privacyMode?: boolean;
  hasPosts?: boolean;
  gender?: Character['gender'];
  agencyTags?: AgencyTagId[];
};

export const characterSearchInstruction = [
  'Action follow-up: search existing characters',
  'First-pass plan:',
  '{{plan}}',
  '',
  'Use the Text Input and plan to choose ranking criteria. Do not continue the visible reply.',
  'Output exactly one JSON object and nothing else:',
  '{"action":"get_character_list","query":{"app":"fotogram","privacyMode":true,"hasPosts":false,"gender":"man","agencyTags":["drama_magnet"]}}',
  'The example illustrates the fields, not required search values. Omit criteria that are irrelevant; query {} lists existing characters without preferences.',
  'app: whatsup, fotogram, onlyfriends, or matchme. gender: woman, man, or nonbinary. privacyMode and hasPosts: true or false.',
  'privacyMode and hasPosts require app fotogram or onlyfriends. Privacy mode hides the real name and profile photo publicly; it does not imply a locked account or restricted posts.',
  'hasPosts checks authored starting posts and current timeline posts, including text-only posts.',
  'Each requested criterion and each distinct agency tag adds one ranking point when matched. These are preferences, not mandatory filters: partial and zero matches can be returned. Missing accounts never match privacy or post criteria.',
  'Agency tags match character tags and tags on the requested enabled app account; without app, all enabled accounts are considered.',
  'Use only the following authored agency tag IDs:',
  '{{agencyTags}}',
].join('\n');

export const characterSearchResultTemplate = [
  'Action executed: get character list.',
  'Search criteria: {{query}}',
  'Ranked existing characters ({{returnedCount}} returned):',
  '{{characterList}}',
  'Choose an existing character and use their exact identity and enabled account details. Never invent an account or assume unmatched criteria are true. If no suitable candidate exists, acknowledge that limitation.',
  'Hidden agency, agency tags, and private identity are author-only context, not knowledge available to other characters. Respect anonymous profiles in the visible story.',
].join('\n');

export function characterSearchAgencyTagsText() {
  return agencyTagCatalog.map((tag) => `- ${tag.id}: ${tag.meaning}`).join('\n');
}

export function parseCharacterSearchQuery(value: unknown): CharacterSearchQuery | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some((key) => !['app', 'privacyMode', 'hasPosts', 'gender', 'agencyTags'].includes(key))) return undefined;
  if (query.app !== undefined && !apps.includes(query.app as typeof apps[number])) return undefined;
  if (query.gender !== undefined && !['woman', 'man', 'nonbinary'].includes(query.gender as string)) return undefined;
  for (const key of ['privacyMode', 'hasPosts']) {
    if (query[key] !== undefined && typeof query[key] !== 'boolean') return undefined;
    if (query[key] !== undefined && query.app !== 'fotogram' && query.app !== 'onlyfriends') return undefined;
  }
  if (query.agencyTags !== undefined && (!Array.isArray(query.agencyTags) ||
    query.agencyTags.some((id) => !agencyTagCatalog.some((tag) => tag.id === id)))) return undefined;
  return {
    ...(query.app !== undefined ? { app: query.app as CharacterSearchQuery['app'] } : {}),
    ...(query.gender !== undefined ? { gender: query.gender as CharacterSearchQuery['gender'] } : {}),
    ...(query.privacyMode !== undefined ? { privacyMode: query.privacyMode as boolean } : {}),
    ...(query.hasPosts !== undefined ? { hasPosts: query.hasPosts as boolean } : {}),
    ...(query.agencyTags !== undefined ? { agencyTags: [...new Set(query.agencyTags as AgencyTagId[])] } : {}),
  };
}

export function rankCharacters(characters: StorybookCharacter[], messages: MessageRecord[], query: CharacterSearchQuery, limit = 5) {
  const posts = postsWithInitialContent(characters, messages).flatMap((message) => message.socialPost ?? []);
  return characters.map((character) => {
    const accounts = apps.flatMap((app) => {
      const account = character.apps?.[app];
      if (!account?.enabled) return [];
      const social = app === 'fotogram' || app === 'onlyfriends';
      const postIds = new Set(posts.filter((post) => post.app === app && (
        post.authorAccountId ? post.authorAccountId === account.accountId :
        post.authorCharacterId ? post.authorCharacterId === character.sourceId || post.authorCharacterId === character.id :
        post.author === character.name && accountHandleMatches(account, post.authorHandle)
      )).map((post) => post.postId));
      return [{ app, accountId: account.accountId, profileName: app === 'whatsup' ? null : migratedProfileName(account, character.name),
        bio: account.bio, privacyMode: social ? account.privacyMode === true : null,
        postCount: social ? postIds.size : null, accountRole: account.accountRole ?? null, agencyTags: account.agencyTags ?? [] }];
    });
    const requestedAccount = accounts.find((account) => account.app === query.app);
    const tags = new Set([...(character.agencyTags ?? []), ...accounts
      .filter((account) => !query.app || account.app === query.app).flatMap((account) => account.agencyTags)]);
    const criteria: Array<[string, boolean]> = [];
    if (query.app !== undefined) criteria.push([`app:${query.app}`, !!requestedAccount]);
    if (query.privacyMode !== undefined) criteria.push([`privacyMode:${query.privacyMode}`, requestedAccount?.privacyMode === query.privacyMode]);
    if (query.hasPosts !== undefined) criteria.push([`hasPosts:${query.hasPosts}`, requestedAccount?.postCount != null && (requestedAccount.postCount > 0) === query.hasPosts]);
    if (query.gender !== undefined) criteria.push([`gender:${query.gender}`, character.gender === query.gender]);
    for (const tag of query.agencyTags ?? []) criteria.push([`agencyTag:${tag}`, tags.has(tag)]);
    return {
      characterId: character.sourceId, name: character.name,
      score: criteria.filter(([, matches]) => matches).length, totalCriteria: criteria.length,
      matchedCriteria: criteria.filter(([, matches]) => matches).map(([key]) => key),
      unmatchedCriteria: criteria.filter(([, matches]) => !matches).map(([key]) => key),
      gender: character.gender ?? null, age: character.age ?? null,
      description: character.profile.description, personality: character.profile.personality,
      role: character.profile.role, speechStyle: character.profile.speechStyle,
      hiddenAgency: character.hiddenAgency ?? '', agencyTags: character.agencyTags ?? [], accounts,
    };
  }).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name) || left.characterId.localeCompare(right.characterId))
    .slice(0, Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.trunc(limit))) : 5);
}
