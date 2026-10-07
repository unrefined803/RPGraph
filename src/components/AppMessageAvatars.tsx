import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { StorybookCharacter } from '../storybook/runtime';
import { phoneCharacterAvatarDataUrl } from '../chat/phoneCharacters';
import { CharacterAvatar } from './CharacterAvatar';

const AvatarContext = createContext({ enabled: false, colors: new Map<string, string>() });

export function AppMessageAvatars({ enabled, size, colors, children }: {
  enabled: boolean; size: number; colors: Map<string, string>; children: ReactNode;
}) {
  return <AvatarContext.Provider value={{ enabled, colors }}>
    <div className={enabled ? 'app-message-avatars-enabled' : 'app-message-avatars-disabled'}
      style={{ display: 'contents', '--chat-message-avatar-scale': size / 100 } as CSSProperties}>
      {children}
    </div>
  </AvatarContext.Provider>;
}

/** `avatarDataUrl` is the app identity's own picture and replaces the character portrait. */
export function AppMessageAvatar({ character, name, hidePortrait = false, avatarDataUrl }: {
  character?: StorybookCharacter; name: string; hidePortrait?: boolean; avatarDataUrl?: string;
}) {
  const { enabled, colors } = useContext(AvatarContext);
  if (!enabled) return null;
  return <CharacterAvatar className="chat-message-avatar" name={name}
    fallback={name.trim().slice(0, 2).toUpperCase() || '?'}
    profileImageDataUrl={hidePortrait ? undefined : avatarDataUrl ?? phoneCharacterAvatarDataUrl(character)}
    style={{ borderColor: hidePortrait ? '#ffffff' : colors.get(character?.name ?? name) ?? '#ffffff' }} />;
}
