import { agencyTagCatalog, validateCharacterAgency, type AgencyTagId } from '../../shared/agency-tags.cjs';
import type { Character } from './character';

/** Tags describe the character, independent of which app accounts exist. */
export function withCharacterAgencyTags(character: Character, agencyTags: AgencyTagId[]): Character {
  const next = { ...character, agencyTags: [...agencyTags] };
  validateCharacterAgency(next);
  return next;
}

export const agencyAuthoringInstructions = [
  'Agency tags classify a character\'s typical online behavior. agencyTags is an optional array on the character with one or two unique tag IDs from the catalog below (usually one); absent or [] means unclassified. Set it with an add operation (add also overwrites an existing value); set [] to remove the classification. Copy IDs exactly; never invent one.',
  'Tags belong to the character, not to an app account. Every catalog tag is valid for every character, whichever accounts exist, are disabled or are created later. Accounts have no tags and no role: never write agencyTags or accountRole under apps, and never create, disable or change an account because of a tag. Choose tags from the character\'s personality and role in the story. Tags are separate from hiddenAgency and never perform an action. Preserve existing tags unless asked to edit them.',
  'Tag catalog:',
  ...agencyTagCatalog.map((tag) => `- ${tag.id}: ${tag.meaning}`),
].join('\n');
