import { gradientPhaseStyle } from '../chat/gradientPhase';
import { isNpcCharacterColor } from '../chat/characterColors';
import { EmojiText } from './EmojiText';
import { useState, type ReactNode } from 'react';

/** Canonical color tokens distinguish vivid players from flat, muted NPCs. */
export function CharacterName({ color, children }: { color?: string; children: ReactNode }) {
  const [animationDelay] = useState(() => `${-Math.random() * 3}s`);
  if (!color) return <>{children}</>;
  return (
    <span
      className={isNpcCharacterColor(color) ? undefined : 'player-name-gradient'}
      style={{ ...gradientPhaseStyle(children), animationDelay, color, font: 'inherit', letterSpacing: 'inherit', display: 'inline' }}
    >
      {typeof children === 'string' ? <EmojiText text={children} /> : children}
    </span>
  );
}
