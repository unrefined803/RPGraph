import { agencyTagCatalog, validateCharacterAgency, type AgencyAccountRole, type AgencyTagId } from '../../shared/agency-tags.cjs';
import type { Character, CharacterApps } from './character';

export type CharacterAgencyDraft = {
  agencyTags: AgencyTagId[];
  apps: Partial<Record<keyof CharacterApps, { agencyTags: AgencyTagId[]; accountRole?: AgencyAccountRole }>>;
};

/** Small authoring projection; never copy gallery bytes or private app activity into form state. */
export function characterAgencyDraft(character: Character): CharacterAgencyDraft {
  return {
    agencyTags: [...(character.agencyTags ?? [])],
    apps: Object.fromEntries(Object.entries(character.apps ?? {}).map(([app, account]) => [app, {
      agencyTags: [...(account.agencyTags ?? [])],
      ...(['fotogram', 'onlyfriends'].includes(app) ? { accountRole: account.accountRole ?? 'user' } : {}),
    }])),
  };
}

/** Apply all tags and roles together; invalid intermediate selections never reach persisted data. */
export function withCharacterAgency(character: Character, draft: CharacterAgencyDraft): Character {
  const apps: CharacterApps = { ...character.apps };
  for (const [app, assignment] of Object.entries(draft.apps)) {
    const key = app as keyof CharacterApps;
    if (!apps[key]) throw new Error(`The ${app} account changed. Reopen Agency Tags before saving.`);
    apps[key] = { ...apps[key], ...assignment, agencyTags: [...assignment.agencyTags] };
  }
  const next = { ...character, agencyTags: [...draft.agencyTags], apps };
  validateCharacterAgency(next);
  return next;
}

export const agencyAuthoringInstructions = [
  'Optional agencyTags is an array of one or two unique catalog IDs on the character (usually one); absent or [] means unclassified. It is separate from hiddenAgency and never performs an action. Preserve existing tags unless asked to edit them.',
  'When authoring tags, update character agencyTags and every enabled apps.<app>.agencyTags together in one patch. Each app requires a nonempty compatible subset of the character tags. Disabled accounts may retain compatible assignments or []. To clear classification, clear character and app tags together.',
  'Fotogram and OnlyFriends accept accountRole: user or creator; absent means user. WhatsUp and MatchMe have no accountRole. Most authored social accounts should be users (80–90% across a population); never infer creator status from having posts. Use explicit app enablement. No NPC posting or reactions are activated by these fields.',
  'Catalog below maps each tag to app, effective role and supported actions. WhatsUp creator-style tags describe messaging behavior on an ordinary account; they do not confer creator status. Choose compatible tags for all enabled apps; never invent an ID. publish is reserved metadata for future workflows.',
  JSON.stringify(agencyTagCatalog),
].join('\n');
