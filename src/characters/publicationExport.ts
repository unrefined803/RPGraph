import { createCharacterContainer } from './creator';
import { withPublicationSnapshot } from './publications';
import type { Character } from './character';
import type { SocialPostRecord, TurnRecord } from '../types';

/**
 * Which received or shared gallery images travel with the exported character.
 * `referenced` keeps only those its public profile and own posts actually use.
 */
type ReceivedImageInclusion = 'all' | 'none' | 'referenced';

export type CharacterPublicationExportInput = {
  character: Character;
  /** Publication records of the source the character is exported from. */
  posts?: SocialPostRecord[];
  /** Gallery of that same source, used to resolve images referenced by own posts. */
  gallery?: Character['images'];
  includePosts?: boolean;
  receivedImages?: ReceivedImageInclusion;
  /** Report a post whose image is absent from the source; the post is then omitted. */
  onMissingImage?: (post: SocialPostRecord) => void;
};

/** Publication records carried by turns, in timeline order. */
export function socialPostsFromTurns(turns: TurnRecord[]): SocialPostRecord[] {
  return turns.flatMap((turn) => [...turn.input.messages, ...turn.output.messages]
    .flatMap((message) => message.socialPost ? [message.socialPost] : []));
}

function publicImageIds(character: Character) {
  const ids = new Set<string>();
  for (const portrait of Object.values(character.customPortraits ?? {})) ids.add(portrait.imageId);
  if (character.profileImage?.imageId) ids.add(character.profileImage.imageId);
  if (character.apps?.whatsup?.alias?.avatarImageId) ids.add(character.apps.whatsup.alias.avatarImageId);
  for (const [app, account] of Object.entries(character.apps ?? {})) {
    if (account.avatarImageId) ids.add(account.avatarImageId);
    if (app === 'fotogram' || app === 'onlyfriends') {
      for (const post of account.initialPosts ?? []) {
        if (post.imageId) ids.add(post.imageId);
      }
    }
  }
  for (const id of character.apps?.matchme?.profile?.photoIds ?? []) ids.add(id);
  return ids;
}

/**
 * The single preparation behind the manual character export and automatic NPC
 * copies: an explicit source goes in, a validated portable container comes out.
 * It never reads application state and never changes its inputs.
 */
export function prepareCharacterPublicationExport(input: CharacterPublicationExportInput) {
  const { character, includePosts = false, receivedImages = 'none' } = input;
  const exported = includePosts
    ? withPublicationSnapshot(character, input.posts ?? [], input.gallery ?? character.images,
      input.onMissingImage ? { onMissingImage: input.onMissingImage } : {})
    : structuredClone(character);
  if (receivedImages === 'referenced') {
    const referenced = publicImageIds(exported);
    exported.images = exported.images.filter((image) =>
      !(image.receivedFrom || image.imageAccess) || referenced.has(image.id));
  }
  return createCharacterContainer(exported, includePosts, receivedImages !== 'none');
}
