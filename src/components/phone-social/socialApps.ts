import type { SocialAppKind } from '../../types';
import { socialAppNames } from '../../chat/socialMedia';

export type SocialAppId = SocialAppKind;

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

export const socialApps: Record<SocialAppId, SocialAppConfig> = {
  fotogram: {
    id: 'fotogram',
    name: socialAppNames.fotogram,
    tagline: 'Share your moments',
    themeClass: 'phone-social-theme-fotogram',
    postsRequireUnlock: false,
    allowCreatorRole: false,
  },
  onlyfriends: {
    id: 'onlyfriends',
    name: socialAppNames.onlyfriends,
    tagline: 'Exclusive content from your friends',
    themeClass: 'phone-social-theme-onlyfriends',
    postsRequireUnlock: true,
    allowCreatorRole: true,
  },
};
