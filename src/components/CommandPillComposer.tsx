import { AccountLinkText } from './AccountLinkText';
import {
  forwardRef,
  type FormEvent,
  useImperativeHandle,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  commandMenuTrigger,
  createDirectCommand,
  createTimeCommand,
  defaultTimeCommandValue,
  timeCommandExamples,
  type CommandInputCommand,
} from '../chat/structuredCommands';

type CommandPillComposerProps = {
  id?: string;
  value: string;
  commands: CommandInputCommand[];
  commandsEnabled: boolean;
  disabled?: boolean;
  placeholder: string;
  rows: number;
  className?: string;
  disabledReason?: string;
  onValueChange: (value: string) => void;
  onCommandsChange: (commands: CommandInputCommand[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

type CommandPillListProps = {
  commands: CommandInputCommand[];
  onCommandsChange: (commands: CommandInputCommand[]) => void;
  onRequestMessageFocus?: () => void;
  className?: string;
};

export type CommandPillComposerHandle = {
  focusMessage: () => void;
};

function commandId() {
  return `command-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function triggerAtCursor(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(?:^|\s)(\/cmd|\/?time|\/act)$/i);
  if (!match || match.index === undefined) {
    return undefined;
  }
  const token = match[1].toLocaleLowerCase();
  const start = match.index + match[0].length - match[1].length;
  return {
    kind: token === commandMenuTrigger ? 'menu' as const : token === '/act' ? 'direct' as const : 'time' as const,
    start,
    end: cursor,
  };
}

function removeTriggerToken(value: string, start: number, end: number) {
  const before = value.slice(0, start).replace(/[ \t]+$/, '');
  const after = value.slice(end).replace(/^[ \t]+/, '');
  if (!before) {
    return after;
  }
  if (!after) {
    return before;
  }
  return `${before} ${after}`;
}

export function CommandPillList({
  commands,
  onCommandsChange,
  onRequestMessageFocus,
  className,
}: CommandPillListProps) {
  const commandInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const editingCommand = commands.find((command) => command.editing);
    if (editingCommand) {
      window.setTimeout(() => commandInputRefs.current[editingCommand.id]?.focus(), 0);
    }
  }, [commands]);

  const updateCommand = (commandIdValue: string, patch: { editing?: boolean; value?: string }) => {
    onCommandsChange(commands.map((command): CommandInputCommand => {
      if (command.id !== commandIdValue) {
        return command;
      }
      if (command.type === 'time') {
        return {
          ...command,
          editing: patch.editing ?? command.editing,
          value: patch.value ?? command.value,
        };
      }
      return {
        ...command,
        editing: patch.editing ?? command.editing,
      };
    }));
  };

  const removeCommand = (commandIdValue: string) => {
    onCommandsChange(commands.filter((command) => command.id !== commandIdValue));
    onRequestMessageFocus?.();
  };

  const finalizeCommand = (commandIdValue: string) => {
    const command = commands.find((entry) => entry.id === commandIdValue);
    if (!command || command.type !== 'time') {
      return;
    }
    updateCommand(commandIdValue, {
      editing: false,
      value: command.value.trim(),
    });
    onRequestMessageFocus?.();
  };

  if (commands.length === 0) {
    return null;
  }

  return (
    <div className={`command-pill-list${className ? ` ${className}` : ''}`}>
      {commands.map((command) => (
        <span className={`command-pill ${command.editing ? 'editing' : ''}`} key={command.id}>
          <button
            className="command-pill-label"
            type="button"
            onClick={() => {
              if (command.type === 'time') {
                updateCommand(command.id, { editing: true });
              } else {
                removeCommand(command.id);
              }
            }}
            title={command.type === 'direct' ? 'Remove Act Command' : undefined}
          >
            {command.type === 'direct' ? 'Act' : 'Time'}
          </button>
          {command.type === 'direct' ? null : command.editing ? (
            <input
              ref={(element) => {
                commandInputRefs.current[command.id] = element;
              }}
              value={command.value}
              onChange={(event) => updateCommand(command.id, { value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  finalizeCommand(command.id);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  updateCommand(command.id, { editing: false });
                  onRequestMessageFocus?.();
                }
                if (event.key === 'Backspace' && !command.value) {
                  event.preventDefault();
                  removeCommand(command.id);
                }
              }}
              onBlur={() => updateCommand(command.id, { editing: false, value: command.value.trim() })}
              placeholder={defaultTimeCommandValue}
              aria-label="Time Command value"
            />
          ) : (
            <button
              className="command-pill-value"
              type="button"
              onClick={() => updateCommand(command.id, { editing: true })}
            >
              {command.value || defaultTimeCommandValue}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

export const CommandPillComposer = forwardRef<CommandPillComposerHandle, CommandPillComposerProps>(function CommandPillComposer({
  id,
  value,
  commands,
  commandsEnabled,
  disabled = false,
  placeholder,
  rows,
  className,
  disabledReason = 'Enable RP Time Tracking in Chat History to use commands.',
  onValueChange,
  onCommandsChange,
  onSubmit,
}, ref) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMenuIndex, setActiveMenuIndex] = useState(0);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasTimeCommand = commands.some((command) => command.type === 'time');
  const hasDirectCommand = commands.some((command) => command.type === 'direct');

  const focusMessage = () => {
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  useImperativeHandle(ref, () => ({ focusMessage }));

  const menuOptions = [
    {
      kind: 'time' as const,
      label: 'Time Command',
      trigger: '/time',
      description: timeCommandExamples.join('  '),
      disabled: !commandsEnabled || disabled || hasTimeCommand,
      title: !commandsEnabled ? disabledReason : undefined,
    },
    {
      kind: 'direct' as const,
      label: 'Act',
      trigger: '/act',
      description: 'Play out instruction',
      disabled: disabled || hasDirectCommand,
      title: undefined,
    },
  ];

  const firstEnabledMenuIndex = () => {
    const index = menuOptions.findIndex((option) => !option.disabled);
    return index >= 0 ? index : 0;
  };
  const visibleActiveMenuIndex =
    menuOptions[activeMenuIndex]?.disabled ? firstEnabledMenuIndex() : activeMenuIndex;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const closeCommandMenu = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !composerRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeCommandMenu);
    return () => document.removeEventListener('pointerdown', closeCommandMenu);
  }, [menuOpen]);

  const addTimeCommand = () => {
    if (!commandsEnabled || disabled || commands.some((command) => command.type === 'time')) {
      return;
    }
    const command = createTimeCommand(commandId());
    onCommandsChange([...commands.map((entry) => ({ ...entry, editing: false })), command]);
    setMenuOpen(false);
  };

  const addDirectCommand = () => {
    if (disabled || commands.some((command) => command.type === 'direct')) {
      return;
    }
    onCommandsChange([...commands.map((entry) => ({ ...entry, editing: false })), createDirectCommand(commandId())]);
    setMenuOpen(false);
    focusMessage();
  };

  const selectMenuOption = (index: number) => {
    const option = menuOptions[index];
    if (!option || option.disabled) {
      return;
    }
    if (option.kind === 'time') {
      addTimeCommand();
      return;
    }
    addDirectCommand();
  };

  const moveMenuSelection = (direction: 1 | -1) => {
    const enabledIndexes = menuOptions
      .map((option, index) => option.disabled ? -1 : index)
      .filter((index) => index >= 0);
    if (enabledIndexes.length === 0) {
      return;
    }
    const currentIndex = enabledIndexes.indexOf(visibleActiveMenuIndex);
    const nextPosition = currentIndex >= 0
      ? (currentIndex + direction + enabledIndexes.length) % enabledIndexes.length
      : direction > 0
        ? 0
        : enabledIndexes.length - 1;
    setActiveMenuIndex(enabledIndexes[nextPosition]);
  };

  const changeValue = (nextValue: string, cursor: number) => {
    const trigger = triggerAtCursor(nextValue, cursor);
    if (!disabled && trigger?.kind === 'menu') {
      onValueChange(removeTriggerToken(nextValue, trigger.start, trigger.end));
      setMenuOpen(true);
      setActiveMenuIndex(firstEnabledMenuIndex());
      return;
    }
    if (commandsEnabled && !disabled && !hasTimeCommand && trigger?.kind === 'time') {
      onValueChange(removeTriggerToken(nextValue, trigger.start, trigger.end));
      onCommandsChange([...commands, createTimeCommand(commandId())]);
      setMenuOpen(false);
      return;
    }
    if (!disabled && !hasDirectCommand && trigger?.kind === 'direct') {
      onValueChange(removeTriggerToken(nextValue, trigger.start, trigger.end));
      onCommandsChange([...commands, createDirectCommand(commandId())]);
      setMenuOpen(false);
      return;
    }
    if (menuOpen) {
      setMenuOpen(false);
    }
    onValueChange(nextValue);
  };

  const textareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveMenuSelection(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveMenuSelection(-1);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
        event.preventDefault();
        selectMenuOption(visibleActiveMenuIndex);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key === 'Tab') {
        setMenuOpen(false);
      }
    }
    if (event.key === 'Backspace' && !value && commands.length > 0) {
      event.preventDefault();
      const lastCommand = commands[commands.length - 1];
      if (lastCommand.type === 'direct') {
        onCommandsChange(commands.slice(0, -1));
        return;
      }
      onCommandsChange(commands.map((command) =>
        command.id === lastCommand.id ? { ...command, editing: true } : command,
      ));
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
      event.preventDefault();
      onSubmit(event as unknown as FormEvent<HTMLFormElement>);
    }
  };

  return (
    <div ref={composerRef} className={`command-composer${className ? ` ${className}` : ''}${disabled ? ' disabled' : ''}`}>
      <div className="command-composer-input">
        {menuOpen && (
          <div className="command-menu" role="menu">
            {menuOptions.map((option, index) => (
              <button
                className={index === visibleActiveMenuIndex ? 'active' : undefined}
                type="button"
                role="menuitem"
                disabled={option.disabled}
                title={option.title}
                key={option.kind}
                onMouseEnter={() => setActiveMenuIndex(index)}
                onClick={() => selectMenuOption(index)}
              >
                <span className="command-menu-title">
                  <span>{option.label}</span>
                  <kbd>{option.trigger}</kbd>
                </span>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
        )}
        <AccountLinkText text={value} preview />
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => changeValue(event.target.value, event.target.selectionStart)}
          onKeyDown={textareaKeyDown}
          placeholder={placeholder}
          rows={rows}
        />
      </div>
    </div>
  );
});
