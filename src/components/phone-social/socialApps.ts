export type SocialAppId = 'fotogram' | 'onlyfriends';

export type SocialAppConfig = {
  id: SocialAppId;
  name: string;
  tagline: string;
  /** CSS theme class applied to the screen root; colors live in styles.css. */
  themeClass: string;
  /** Locked posts must be unlocked (paid) before their content is visible. */
  postsRequireUnlock: boolean;
  /** The app distinguishes regular users from creators. */
  allowCreatorRole: boolean;
};

/** Derive a handle-looking nickname from a character name, e.g. "Nova Reyes" → "nova.reyes". */
export function socialHandleForName(name: string) {
  const handle = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return handle || 'user';
}

export const socialApps: Record<SocialAppId, SocialAppConfig> = {
  fotogram: {
    id: 'fotogram',
    name: 'Fotogram',
    tagline: 'Share your moments',
    themeClass: 'phone-social-theme-fotogram',
    postsRequireUnlock: false,
    allowCreatorRole: false,
  },
  onlyfriends: {
    id: 'onlyfriends',
    name: 'OnlyFriends',
    tagline: 'Exclusive content from your friends',
    themeClass: 'phone-social-theme-onlyfriends',
    postsRequireUnlock: true,
    allowCreatorRole: true,
  },
};
