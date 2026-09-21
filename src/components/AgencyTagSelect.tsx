import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { agencyTagCatalog, type AgencyTagId } from '../../shared/agency-tags.cjs';

type AgencyTagSelectOption = {
  id: AgencyTagId | '';
  disabled?: boolean;
};

type Props = {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  options: AgencyTagSelectOption[];
  onChange: (value: string) => void;
  onShowTooltip?: (tagId: string, element: HTMLElement, extra?: string, isDropdownOption?: boolean) => void;
  onHideTooltip?: () => void;
};

export function AgencyTagSelect({
  value,
  disabled = false,
  placeholder = 'None',
  options,
  onChange,
  onShowTooltip,
  onHideTooltip,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const noneOption: { id: string; meaning?: string; disabled?: boolean } = { id: '', disabled: false };

    const tagOptions = options
      .map((opt) => {
        const catalogEntry = agencyTagCatalog.find((tag) => tag.id === opt.id);
        return {
          id: opt.id,
          meaning: catalogEntry?.meaning ?? '',
          disabled: opt.disabled,
        };
      })
      .filter((opt) => {
        if (!q) return true;
        return opt.id.toLowerCase().includes(q) || opt.meaning.toLowerCase().includes(q);
      });

    if (!q) {
      return [noneOption, ...tagOptions];
    }
    return tagOptions;
  }, [options, searchQuery]);

  const updatePopoverPosition = useCallback(() => {
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!button || !popover) return;

    const rect = button.getBoundingClientRect();
    const popoverHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < popoverHeight && rect.top > popoverHeight;

    popover.style.top = placeAbove
      ? `${Math.max(8, rect.top - popoverHeight - 4)}px`
      : `${Math.min(window.innerHeight - 8, rect.bottom + 4)}px`;
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - 260, rect.left))}px`;
    popover.style.width = `${Math.max(240, rect.width)}px`;
  }, []);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    onHideTooltip?.();
    setSearchQuery('');
    setIsOpen(true);
  }, [disabled, onHideTooltip]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
    onHideTooltip?.();
  }, [onHideTooltip]);

  useEffect(() => {
    if (!isOpen) return;
    updatePopoverPosition();
    const timeout = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 20);

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      closeDropdown();
    };

    const handleWindowEvents = () => {
      updatePopoverPosition();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleWindowEvents);
    window.addEventListener('scroll', handleWindowEvents, true);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleWindowEvents);
      window.removeEventListener('scroll', handleWindowEvents, true);
    };
  }, [isOpen, updatePopoverPosition, closeDropdown]);

  const handleSelect = useCallback((selectedId: string) => {
    onChange(selectedId);
    closeDropdown();
  }, [onChange, closeDropdown]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (!isOpen) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        openDropdown();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDropdown();
      buttonRef.current?.focus();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => {
        let next = prev + 1;
        while (next < filteredOptions.length && filteredOptions[next].disabled) {
          next += 1;
        }
        return next < filteredOptions.length ? next : prev;
      });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => {
        let next = prev - 1;
        while (next >= 0 && filteredOptions[next].disabled) {
          next -= 1;
        }
        return next >= 0 ? next : prev;
      });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        const option = filteredOptions[highlightedIndex];
        if (!option.disabled) {
          handleSelect(option.id);
          buttonRef.current?.focus();
        }
      }
    }
  }, [isOpen, filteredOptions, highlightedIndex, openDropdown, closeDropdown, handleSelect]);

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('.character-agency-dropdown-option');
      items[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  const handleButtonMouseEnter = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (value && !isOpen && onShowTooltip) {
      onShowTooltip(value, event.currentTarget, undefined, false);
    }
  }, [value, isOpen, onShowTooltip]);

  const handleOptionMouseEnter = useCallback((tagId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (tagId && onShowTooltip) {
      onShowTooltip(tagId, event.currentTarget, undefined, true);
    }
  }, [onShowTooltip]);

  const selectedDisplay = value || placeholder;

  return (
    <div className="character-agency-select-wrap">
      <button
        ref={buttonRef}
        type="button"
        className={`character-agency-select character-agency-select-button nodrag${value ? ' character-agency-hoverable' : ''}${isOpen ? ' is-open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          if (isOpen) closeDropdown();
          else openDropdown();
        }}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleButtonMouseEnter}
        onMouseLeave={onHideTooltip}
      >
        <span className={`character-agency-select-display${!value ? ' is-placeholder' : ''}`}>
          {selectedDisplay}
        </span>
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="character-agency-dropdown-popover nodrag nowheel"
          role="listbox"
          onKeyDown={handleKeyDown}
        >
          <div className="character-agency-dropdown-search-wrap">
            <input
              ref={searchInputRef}
              type="text"
              className="character-agency-dropdown-search nodrag"
              placeholder="Filter tags..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setHighlightedIndex(-1);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="character-agency-dropdown-list" ref={listRef}>
            {filteredOptions.length === 0 ? (
              <div className="character-agency-dropdown-empty">No matching tags</div>
            ) : (
              filteredOptions.map((opt, index) => {
                const isSelected = opt.id === value;
                const isFocused = index === highlightedIndex;
                const label = opt.id === '' ? placeholder : opt.id;

                return (
                  <button
                    key={opt.id || '__none__'}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={opt.disabled}
                    className={`character-agency-dropdown-option${isSelected ? ' is-selected' : ''}${isFocused ? ' is-focused' : ''}`}
                    onClick={() => {
                      if (!opt.disabled) handleSelect(opt.id);
                    }}
                    onMouseEnter={(event) => handleOptionMouseEnter(opt.id, event)}
                    onMouseLeave={onHideTooltip}
                  >
                    <span className="character-agency-dropdown-option-label">{label}</span>
                    {isSelected && <span className="character-agency-dropdown-option-check" aria-hidden="true">✓</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
