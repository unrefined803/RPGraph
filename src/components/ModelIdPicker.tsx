import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { comfyCharacterLoraName } from '../settings';

const defaultFavoriteModelsStorageKey = 'rpgraph.favoriteProviderModels';

function loadFavoriteModels(storageKey: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((model): model is string => typeof model === 'string')
      : [];
  } catch {
    return [];
  }
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3Z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

export function ModelIdPicker({
  id = 'model-name',
  value,
  options,
  onChange,
  onOpenOptions,
  onBlur,
  placeholder = 'Type a model ID or load models',
  favoritesStorageKey = defaultFavoriteModelsStorageKey,
  disabled = false,
  optionLabels,
  selectionOnly = false,
}: {
  id?: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onOpenOptions: () => void;
  onBlur?: () => void;
  placeholder?: string;
  favoritesStorageKey?: string;
  disabled?: boolean;
  optionLabels?: Record<string, string>;
  selectionOnly?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const [favoriteModelsByKey, setFavoriteModelsByKey] = useState<Record<string, string[]>>(() => ({
    [favoritesStorageKey]: loadFavoriteModels(favoritesStorageKey),
  }));
  const favoriteModels = useMemo(
    () => favoriteModelsByKey[favoritesStorageKey] ?? loadFavoriteModels(favoritesStorageKey),
    [favoriteModelsByKey, favoritesStorageKey],
  );
  const favoriteModelSet = new Set(favoriteModels);
  const modelOptionKind = (model: string) =>
    model === comfyCharacterLoraName ? 'character-lora' : 'default';
  const normalizedOptions = Array.from(
    new Set(options.map((model) => model.trim()).filter((model) => model.length > 0)),
  );
  const query = selectionOnly ? '' : value.trim().toLowerCase();
  const favoriteOptions = favoriteModels.filter((model) => normalizedOptions.includes(model));
  const matchedOptions = normalizedOptions.filter(
    (model) => !favoriteModelSet.has(model) && query.length > 0 && model.toLowerCase().includes(query),
  );
  const otherOptions = normalizedOptions.filter(
    (model) =>
      !favoriteModelSet.has(model) &&
      (query.length === 0 || !model.toLowerCase().includes(query)),
  );
  const groups = [
    favoriteOptions.length > 0
      ? { label: `Favorites (${favoriteOptions.length})`, models: favoriteOptions }
      : null,
    query.length > 0
      ? { label: `Matches (${matchedOptions.length})`, models: matchedOptions }
      : { label: `All models (${otherOptions.length})`, models: otherOptions },
    query.length > 0
      ? { label: `Other models (${otherOptions.length})`, models: otherOptions }
      : null,
  ].filter((group): group is { label: string; models: string[] } => Boolean(group));

  const updatePopoverStyle = useCallback(() => {
    const inputRow = wrapperRef.current?.querySelector('.model-id-input-row');
    if (!(inputRow instanceof HTMLElement)) {
      return;
    }
    const rect = inputRow.getBoundingClientRect();
    const top = rect.bottom + 4;
    setPopoverStyle({
      position: 'fixed',
      top,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(160, window.innerHeight - top - 12),
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      favoritesStorageKey,
      JSON.stringify(favoriteModels),
    );
  }, [favoriteModels, favoritesStorageKey]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    updatePopoverStyle();

    function closeFromOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target) &&
        !popoverRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    const handleReposition = () => updatePopoverStyle();
    document.addEventListener('pointerdown', closeFromOutside);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, updatePopoverStyle]);

  function toggleFavorite(model: string) {
    setFavoriteModelsByKey((current) => {
      const currentFavorites = current[favoritesStorageKey] ?? loadFavoriteModels(favoritesStorageKey);
      return {
        ...current,
        [favoritesStorageKey]: currentFavorites.includes(model)
          ? currentFavorites.filter((favorite) => favorite !== model)
          : [model, ...currentFavorites],
      };
    });
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openOptions();
    }
  }

  function openOptions() {
    if (disabled) {
      return;
    }
    updatePopoverStyle();
    if (!isOpen) {
      onOpenOptions();
    }
    setIsOpen(true);
  }

  const optionsId = `${id}-options`;
  const popover = isOpen && popoverStyle ? (
    <div
      className="model-id-options node-custom-select-popover"
      id={optionsId}
      ref={popoverRef}
      role="listbox"
      style={popoverStyle}
    >
      {groups.map((group) => (
        <div className="model-id-option-group" key={group.label}>
          <div className="model-id-separator">{group.label}</div>
          {group.models.length > 0 ? (
            group.models.map((model) => {
              const isFavorite = favoriteModelSet.has(model);
              return (
                <div className={`model-id-option ${modelOptionKind(model)}`} key={`${group.label}-${model}`}>
                  <button
                    type="button"
                    className="model-id-favorite-button"
                    aria-label={isFavorite ? `Remove ${model} from favorites` : `Add ${model} to favorites`}
                    aria-pressed={isFavorite}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(model);
                    }}
                  >
                    <StarIcon filled={isFavorite} />
                  </button>
                  <button
                    type="button"
                    className={`model-id-option-button node-custom-select-option ${model === value ? 'selected' : ''}`}
                    role="option"
                    aria-selected={model === value}
                    onClick={() => {
                      onChange(model);
                      setIsOpen(false);
                    }}
                  >
                    {optionLabels?.[model] ?? model}
                  </button>
                </div>
              );
            })
          ) : (
            <div className="model-id-empty">No models in this group</div>
          )}
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div
      className={`model-id-picker${value === comfyCharacterLoraName ? ' character-lora-selected' : ''}${disabled ? ' disabled' : ''}`}
      ref={wrapperRef}
    >
      <div className="model-id-input-row">
        <input
          id={id}
          value={selectionOnly ? optionLabels?.[value] ?? value : value}
          readOnly={selectionOnly}
          onChange={(event) => {
            onChange(event.target.value);
            openOptions();
          }}
          onFocus={openOptions}
          onBlur={onBlur}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={optionsId}
          aria-autocomplete="list"
          disabled={disabled}
        />
        <button
          type="button"
          className="model-id-dropdown-button"
          aria-label="Show model list"
          aria-expanded={isOpen}
          disabled={disabled}
          onClick={() => {
            if (isOpen) {
              setIsOpen(false);
              return;
            }
            openOptions();
          }}
        >
          <ChevronDownIcon />
        </button>
      </div>
      {popover ? createPortal(popover, document.body) : null}
    </div>
  );
}
