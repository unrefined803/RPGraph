import { bundledSocialIdentities } from '../chat/socialCatalogs';
import { datingNpcProfiles } from '../chat/datingAccounts';
import { dummyPostPools } from '../components/phone-social/dummyPosts';

/** App-scoped legacy identities are deliberately never joined by display name. */
export function demoConversionPlan() {
  const social = (['fotogram', 'onlyfriends'] as const).flatMap((app) =>
    bundledSocialIdentities[app].map(({ name, handle }) => {
      const id = `bundled:${app}:${handle.toLowerCase()}`;
      const templates = dummyPostPools[app].filter((post) => post.author.handle === handle);
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
          id, name, playable: false, description: '', personality: '', speechStyle: '', role: '',
          images: templates.filter((post) => post.imageDataUrl).map((post) => ({
            id: `${id}:image:${post.id}`, name: post.id, description: post.caption,
            path: `src/assets/social/fotogram/${post.id}.jpg`,
          })),
          apps: {
            ...(app === 'onlyfriends' ? { fotogram: { accountId: `${id}:fotogram`, enabled: false,
              username: '', displayName: name, bio: '' } } : {}),
            [app]: { accountId: id, enabled: true, username: handle, displayName: name, bio: '', initialPosts: posts },
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
