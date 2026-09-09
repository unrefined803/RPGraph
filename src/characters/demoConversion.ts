import { bundledSocialIdentities } from '../chat/socialCatalogs';
import { datingNpcProfiles } from '../chat/datingAccounts';
import { dummyPostPools } from '../components/phone-social/dummyPosts';

const characterizationThemes = [
  { interest: 'local culture', trait: 'observant, curious and easygoing', voice: 'warm, concise and conversational' },
  { interest: 'music and live events', trait: 'energetic, open-minded and sociable', voice: 'upbeat, playful and direct' },
  { interest: 'food and neighborhood finds', trait: 'welcoming, practical and quietly funny', voice: 'friendly, vivid and relaxed' },
  { interest: 'art and design', trait: 'creative, thoughtful and detail-oriented', voice: 'expressive, considerate and informal' },
  { interest: 'the outdoors and slow weekends', trait: 'grounded, adventurous and independent', voice: 'calm, candid and encouraging' },
] as const;

function stableTheme(value: string) {
  let hash = 0;
  for (const character of value) hash = Math.imul(hash, 31) + character.charCodeAt(0) | 0;
  return characterizationThemes[Math.abs(hash) % characterizationThemes.length];
}

function socialCharacterization(
  app: 'fotogram' | 'onlyfriends',
  name: string,
  handle: string,
  captions: string[],
) {
  const theme = stableTheme(`${app}:${handle}`);
  const subject = captions[0]
    ? ` Their feed starts with: ${captions[0]}`
    : '';
  const bio = captions.length
    ? `${name} shares ${theme.interest}, everyday moments and personal recommendations.`
    : `${name} follows and discusses ${theme.interest} with a small online community.`;
  return {
    description: `${name} is an independent fictional social-media user interested in ${theme.interest}.${subject}`,
    personality: `${name} is ${theme.trait}. They have their own opinions, boundaries and relationships, and do not exist merely to agree with the player.`,
    speechStyle: `${name} writes in a ${theme.voice} style and responds naturally to the current conversation.`,
    role: app === 'fotogram' ? 'Fotogram community member' : 'OnlyFriends creator or community member',
    bio,
  };
}

/** App-scoped legacy identities are deliberately never joined by display name. */
export function demoConversionPlan() {
  const social = (['fotogram', 'onlyfriends'] as const).flatMap((app) =>
    bundledSocialIdentities[app].map(({ name, handle }) => {
      const id = `bundled:${app}:${handle.toLowerCase()}`;
      const templates = dummyPostPools[app].filter((post) => post.author.handle === handle);
      const characterization = socialCharacterization(app, name, handle, templates.map((post) => post.caption));
      const posts = templates.map((post) => ({ id: post.id, text: post.caption,
        ...(post.imageDataUrl ? { imageId: `${id}:image:${post.id}` } : {}) }));
      return {
        identityKind: 'legacy-social', characterId: id, accountId: id, app, name, handle,
        legacyDirectoryId: id,
        posts: templates.map((post) => ({ templateId: post.id,
          legacyPostPattern: `dummy-${app}-{viewerId}-${post.id}`, seedId: post.id,
          ...(post.imageDataUrl ? { imagePath: `src/assets/social/fotogram/${post.id}.jpg` } : {}),
          omitted: ['likeCount', 'commentCount', 'comments', 'locked', 'unlockPrice', 'dummy', 'textOnly'],
        })),
        specification: {
          id, name, playable: false,
          description: characterization.description,
          personality: characterization.personality,
          speechStyle: characterization.speechStyle,
          role: characterization.role,
          images: templates.filter((post) => post.imageDataUrl).map((post) => ({
            id: `${id}:image:${post.id}`, name: post.id, description: post.caption,
            path: `src/assets/social/fotogram/${post.id}.jpg`,
          })),
          apps: {
            ...(app === 'onlyfriends' ? { fotogram: { accountId: `${id}:fotogram`, enabled: false,
              username: '', displayName: name, bio: '' } } : {}),
            [app]: { accountId: id, enabled: true, username: handle, displayName: name,
              bio: characterization.bio, initialPosts: posts },
          },
        },
      };
    }));
  const dating = datingNpcProfiles.map((profile) => ({
    identityKind: 'legacy-matchme', characterId: profile.id, accountId: profile.id,
    app: 'matchme', name: profile.name, handle: '', legacyDirectoryId: null, posts: [],
    missing: ['No source portrait exists; a discoverable MatchMe profile requires at least one real gallery photo.'],
    omitted: ['color'],
    specification: {
      id: profile.id, name: profile.name, age: profile.age, gender: profile.gender, playable: false,
      description: profile.bio, personality: profile.personality,
      speechStyle: '', role: '', images: [],
      apps: {
        fotogram: { accountId: `${profile.id}:fotogram`, enabled: false, username: '', displayName: profile.name, bio: '' },
        matchme: { accountId: profile.id, enabled: true, username: '', displayName: profile.name, bio: profile.bio },
      },
    },
    legacyInterests: profile.interests,
  }));
  return [...social, ...dating];
}
