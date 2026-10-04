import { CharacterName } from './CharacterName';
import { CharacterAvatar } from './CharacterAvatar';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { narratorCharacterId, narratorSpeakerName } from '../app/runOrchestration';
import type { StorybookCharacter } from '../storybook/runtime';

type EdgeCharacterPickerProps = {
  characters: StorybookCharacter[];
  selectedId?: string;
  characterColors: ReadonlyMap<string, string>;
  onSelect: (id: string) => void;
  settingsLoadComplete: boolean;
  hintSeen: boolean;
  onHintSeen: (seen: boolean) => void;
};

/** Mounted only while the drawer is open, so its first edge contact cannot open the picker. */
export function EdgeCharacterPicker({ characters, selectedId, characterColors, onSelect, settingsLoadComplete, hintSeen, onHintSeen }: EdgeCharacterPickerProps) {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(window.innerHeight);
  const panelRef = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const availableHeight = Math.max(48, height - 162);
  // Every entry, including the narrator, gets the same tile with an avatar circle.
  const itemHeight = Math.min(112, Math.max(64, availableHeight / (characters.length + 1)));

  const showHint = settingsLoadComplete && !hintSeen && characters.length > 0 && !open;

  useEffect(() => {
    if (open && settingsLoadComplete && !hintSeen && characters.length > 0) {
      onHintSeen(true);
    }
  }, [open, settingsLoadComplete, hintSeen, characters.length, onHintSeen]);

  function dismiss() {
    setOpen(false);
    armed.current = false;
  }

  useEffect(() => {
    let scrollbarEnteredAt: number | undefined;

    // Native scrollbar hover is not exposed as a DOM event. Measure the gutter
    // of the scrollable element under the pointer, including its path to the edge.
    function isOverScrollbar(event: PointerEvent) {
      const probeX = Math.min(event.clientX, window.innerWidth - 16);
      let element = document.elementFromPoint(probeX, event.clientY);
      while (element instanceof HTMLElement) {
        if (element.scrollHeight > element.clientHeight) {
          const style = getComputedStyle(element);
          if (/^(auto|scroll)$/.test(style.overflowY) && style.scrollbarWidth !== 'none') {
            const bounds = element.getBoundingClientRect();
            const borderRight = parseFloat(style.borderRightWidth) || 0;
            const gutter = element.offsetWidth - element.clientWidth - element.clientLeft - borderRight;
            const scrollbarWidth = gutter || (style.scrollbarWidth === 'thin' ? 6 : 12);
            if (
              bounds.right >= window.innerWidth - 32 &&
              event.clientX >= bounds.right - borderRight - scrollbarWidth &&
              event.clientY >= bounds.top + element.clientTop &&
              event.clientY < bounds.top + element.clientTop + element.clientHeight
            ) return true;
          }
        }
        element = element.parentElement;
      }
      return false;
    }
    function onMove(event: PointerEvent) {
      const distance = window.innerWidth - event.clientX;
      if (distance >= 64) {
        armed.current = true;
        scrollbarEnteredAt = undefined;
      }
      if (event.buttons) {
        armed.current = false;
        scrollbarEnteredAt = undefined;
        return;
      }
      if (event.pointerType === 'touch' || document.querySelector('[aria-modal="true"], .dialog-backdrop')) return;
      if (distance <= 32 && isOverScrollbar(event)) {
        scrollbarEnteredAt ??= event.timeStamp;
      } else {
        scrollbarEnteredAt = undefined;
      }
      if (distance <= 1 && distance >= 0 && armed.current) {
        armed.current = false;
        if (scrollbarEnteredAt === undefined || event.timeStamp - scrollbarEnteredAt < 200) {
          setOpen(true);
        }
      }
    }
    function onResize() { setHeight(window.innerHeight); }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function onPointerDown(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) dismiss();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        previousFocus.current?.focus({ preventScroll: true });
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      {showHint && (
        <span className="feature-discovery-hint edge-character-picker-hint" role="status">
          Switch characters quickly: move your pointer away from the right edge, then bump
          the very edge again to open the character picker.
        </span>
      )}
    <div
      ref={panelRef}
      className={`edge-character-picker${open ? ' is-open' : ''}`}
      role="group"
      aria-label="Quick character selection"
      aria-hidden={!open}
      inert={!open}
      style={{ '--picker-item-height': `${itemHeight}px`, '--picker-avatar-size': `${Math.max(24, itemHeight - 50)}px` } as CSSProperties}
    >
      {[...characters, { id: narratorCharacterId, name: narratorSpeakerName, profileImage: undefined }].map((character, index) => (
        <button
          key={character.id}
          type="button"
          className="edge-character-choice"
          aria-label={`Play as ${character.name}`}
          aria-pressed={selectedId === character.id}
          title={character.name}
          style={{
            '--picker-delay': `${Math.min(index, 10) * 24}ms`,
            '--picker-color': character.id === narratorCharacterId ? '#cbd5e1' : characterColors.get(character.name) ?? '#dbe5f5',
          } as CSSProperties}
          onClick={() => {
            onSelect(character.id);
            dismiss();
            previousFocus.current?.focus({ preventScroll: true });
          }}
        >
          <CharacterAvatar
            className="edge-character-avatar"
            name={character.name}
            fallback={character.name.trim().slice(0, 1).toUpperCase() || '?'}
            profileImageDataUrl={character.profileImage?.dataUrl}
            ringColor={character.id === narratorCharacterId ? '#cbd5e1' : characterColors.get(character.name)}
          />
          <span><CharacterName color={character.id === narratorCharacterId ? undefined : characterColors.get(character.name)}>{character.name}</CharacterName></span>
        </button>
      ))}
    </div>
    </>
  );
}
