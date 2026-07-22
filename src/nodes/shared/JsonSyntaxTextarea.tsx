/* eslint-disable react-refresh/only-export-components */
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { SettingsValueDefinition } from '../../types';
import { defaultWorkflowVariableValue, variableAliases } from '../../workflow';
import { defaultPromptActionTitle, promptActionKey } from './promptActions';
import { promptCommandTokenPattern } from './promptCommands';
import { promptStepMarkerPattern, stepOutputTokenPattern } from './promptSteps';
import { usePreservedTextSelection } from './usePreservedTextSelection';

type JsonToken =
  | { kind: 'plain'; text: string }
  | { kind: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation'; text: string };

type HighlightToken =
  | JsonToken
  | { kind: 'workflow-variable-valid' | 'workflow-variable-invalid'; text: string }
  | { kind: 'prompt-action'; text: string; title: string; index: number; hasTitle: boolean }
  | { kind: 'prompt-command'; text: string; name: string; index: number }
  | { kind: 'step-marker' | 'plan-output'; text: string }
  | { kind: 'template-variable-active' | 'template-variable-inactive'; text: string };

type JsonSyntaxTextareaProps = {
  className?: string;
  id?: string;
  ref?: React.Ref<HTMLTextAreaElement>;
  rows?: number;
  value: string;
  onChange?: (value: string) => void;
  onFocus?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  wrap?: 'hard' | 'soft' | 'off';
  highlightPlainText?: boolean;
  workflowVariableDefinitions?: SettingsValueDefinition[];
  workflowVariableValues?: Record<string, string>;
  templateVariableStatuses?: Record<string, 'active' | 'inactive'>;
  protectedPromptActionTitles?: string[];
  promptActionStatuses?: Record<string, { tone: 'warning' | 'error'; label: string; disabled?: boolean }>;
  onPromptActionClick?: (action: { title: string; index: number; hasTitle: boolean }) => void;
  promptCommandStatuses?: Record<string, { tone: 'warning' | 'error'; label: string; disabled?: boolean }>;
  onPromptCommandClick?: (command: { name: string; index: number }) => void;
};

const jsonTokenPattern =
  /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\],:]/g;
const workflowVariablePattern = /<([^<>\n]+)>/g;
const templateVariablePattern = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const promptActionPattern = /@action(?::([^\n\r]+))?/g;
const maxTextHistoryEntries = 120;

type TextSelectionSnapshot = {
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
  scrollLeft: number;
  scrollTop: number;
};

type TextHistoryEntry = TextSelectionSnapshot & {
  value: string;
};

function textSelectionSnapshot(element: HTMLTextAreaElement): TextSelectionSnapshot {
  return {
    start: element.selectionStart ?? element.value.length,
    end: element.selectionEnd ?? element.value.length,
    direction: element.selectionDirection ?? 'none',
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  };
}

function restoreTextSelection(element: HTMLTextAreaElement, selection: TextSelectionSnapshot) {
  const start = Math.min(selection.start, element.value.length);
  const end = Math.min(selection.end, element.value.length);
  element.setSelectionRange(start, end, selection.direction);
  element.scrollLeft = selection.scrollLeft;
  element.scrollTop = selection.scrollTop;
}

function pushTextHistoryEntry(stack: TextHistoryEntry[], entry: TextHistoryEntry) {
  stack.push(entry);
  if (stack.length > maxTextHistoryEntries) {
    stack.shift();
  }
}

function findMatchingClose(text: string, startIndex: number): number {
  const startChar = text[startIndex];
  const closeChar = startChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
    } else {
      if (c === '"') {
        inString = true;
      } else if (c === startChar) {
        depth++;
      } else if (c === closeChar) {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }
  }
  return -1;
}

interface TextSegment {
  type: 'json' | 'plain';
  text: string;
}

function findSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let index = 0;
  const len = text.length;

  while (index < len) {
    let foundJson = false;
    const char = text[index];

    if (char === '{' || char === '[') {
      const matchIndex = findMatchingClose(text, index);
      if (matchIndex !== -1) {
        const candidate = text.slice(index, matchIndex + 1);
        try {
          JSON.parse(candidate);
          segments.push({ type: 'json', text: candidate });
          index = matchIndex + 1;
          foundJson = true;
        } catch {
          // Candidate text inside outer braces is not valid JSON
        }
      }
    }

    if (!foundJson) {
      const lastSegment = segments[segments.length - 1];
      if (lastSegment && lastSegment.type === 'plain') {
        lastSegment.text += char;
      } else {
        segments.push({ type: 'plain', text: char });
      }
      index++;
    }
  }

  return segments;
}

export function formatJsonTextSegments(text: string) {
  return findSegments(text)
    .map((segment) => {
      if (segment.type !== 'json') {
        return segment.text;
      }
      return JSON.stringify(JSON.parse(segment.text), null, 2);
    })
    .join('');
}

function jsonTokens(value: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let lastIndex = 0;

  value.replace(jsonTokenPattern, (match, stringMatch: string | undefined, keySuffix: string | undefined, offset: number) => {
    if (offset > lastIndex) {
      tokens.push({ kind: 'plain', text: value.slice(lastIndex, offset) });
    }

    if (stringMatch) {
      tokens.push({ kind: keySuffix ? 'key' : 'string', text: stringMatch });
      if (keySuffix) {
        tokens.push({ kind: 'plain', text: keySuffix });
      }
    } else if (match === 'true' || match === 'false') {
      tokens.push({ kind: 'boolean', text: match });
    } else if (match === 'null') {
      tokens.push({ kind: 'null', text: match });
    } else if (/^-?\d/.test(match)) {
      tokens.push({ kind: 'number', text: match });
    } else {
      tokens.push({ kind: 'punctuation', text: match });
    }

    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < value.length) {
    tokens.push({ kind: 'plain', text: value.slice(lastIndex) });
  }

  return tokens;
}

function workflowVariableKey(
  rawName: string,
  definitions: SettingsValueDefinition[],
) {
  const normalizedName = rawName.trim().toLocaleLowerCase();
  return definitions.find((definition) =>
    variableAliases(definition).some((alias) => alias.toLocaleLowerCase() === normalizedName),
  )?.key;
}

function splitWorkflowVariables(
  token: JsonToken,
  definitions: SettingsValueDefinition[],
  values: Record<string, string>,
): HighlightToken[] {
  if (!definitions.length || !token.text.includes('<')) {
    return [token];
  }

  const tokens: HighlightToken[] = [];
  let lastIndex = 0;
  token.text.replace(workflowVariablePattern, (match, name: string, offset: number) => {
    if (offset > lastIndex) {
      tokens.push({ ...token, text: token.text.slice(lastIndex, offset) });
    }
    const key = workflowVariableKey(name, definitions);
    const resolvedValue = key ? values[key] ?? defaultWorkflowVariableValue(key) : '';
    tokens.push({
      kind: key && resolvedValue.trim() ? 'workflow-variable-valid' : 'workflow-variable-invalid',
      text: match,
    });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < token.text.length) {
    tokens.push({ ...token, text: token.text.slice(lastIndex) });
  }

  return tokens;
}

type PromptActionRange = {
  title: string;
  index: number;
  hasTitle: boolean;
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
  lineBreakEnd: number;
};

function promptActionRanges(text: string) {
  const ranges: PromptActionRange[] = [];
  text.replace(promptActionPattern, (match, title: string | undefined, offset: number) => {
    const end = offset + match.length;
    const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
    const lineFeedIndex = text.indexOf('\n', end);
    const lineEnd = lineFeedIndex >= 0
      ? lineFeedIndex > 0 && text[lineFeedIndex - 1] === '\r'
        ? lineFeedIndex - 1
        : lineFeedIndex
      : text.length;
    const lineBreakEnd = lineFeedIndex >= 0 ? lineFeedIndex + 1 : lineEnd;
    ranges.push({
      title: title?.trim() || defaultPromptActionTitle,
      index: offset,
      hasTitle: !!title?.trim(),
      start: offset,
      end,
      lineStart,
      lineEnd,
      lineBreakEnd,
    });
    return match;
  });
  return ranges;
}

function promptActionAtIndex(text: string, index: number) {
  return promptActionRanges(text).find((action) => index >= action.start && index < action.end);
}

function promptActionOnLineAtIndex(text: string, index: number) {
  return promptActionRanges(text).find((action) => index >= action.lineStart && index <= action.lineEnd);
}

function normalizedPromptActionTitle(value: string) {
  return promptActionKey(value);
}

function protectedPromptActionRanges(text: string, titles: Set<string>) {
  return promptActionRanges(text).filter((action) =>
    titles.has(normalizedPromptActionTitle(action.title)),
  );
}

function protectedPromptActionsRemainSealed(
  previousValue: string,
  nextValue: string,
  titles: Set<string>,
) {
  if (!titles.size) {
    return true;
  }
  const previousRanges = protectedPromptActionRanges(previousValue, titles);
  const nextRanges = protectedPromptActionRanges(nextValue, titles);
  const previousCounts = new Map<string, number>();
  previousRanges.forEach((action) => {
    const title = normalizedPromptActionTitle(action.title);
    previousCounts.set(title, (previousCounts.get(title) ?? 0) + 1);
  });
  const nextCounts = new Map<string, number>();
  nextRanges.forEach((action) => {
    const title = normalizedPromptActionTitle(action.title);
    nextCounts.set(title, (nextCounts.get(title) ?? 0) + 1);
  });
  const preservedCounts = Array.from(previousCounts).every(
    ([title, count]) => (nextCounts.get(title) ?? 0) >= count,
  );
  const sealedLines = nextRanges.every((action) =>
    !nextValue.slice(action.lineStart, action.start).trim(),
  );
  return preservedCounts && sealedLines;
}

function editTouchesProtectedPromptAction(
  element: HTMLTextAreaElement,
  titles: Set<string>,
  inputType = 'insertText',
) {
  if (!titles.size) {
    return false;
  }
  const ranges = protectedPromptActionRanges(element.value, titles);
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? start;
  if (start !== end) {
    return ranges.some((action) => {
      const boundaryStart = action.lineStart > 0 ? action.lineStart - 1 : action.lineStart;
      return start < action.lineBreakEnd && end > boundaryStart;
    });
  }
  if (inputType.startsWith('delete')) {
    const affectedStart = inputType.toLocaleLowerCase().includes('backward')
      ? Math.max(0, start - 1)
      : start;
    const affectedEnd = inputType.toLocaleLowerCase().includes('forward')
      ? Math.min(element.value.length, start + 1)
      : start;
    return ranges.some((action) => {
      const boundaryStart = action.lineStart > 0 ? action.lineStart - 1 : action.lineStart;
      return affectedStart < action.lineBreakEnd && affectedEnd > boundaryStart;
    });
  }
  return ranges.some((action) => start >= action.lineStart && start <= action.lineEnd);
}

function promptActionDeleteBounds(action: PromptActionRange) {
  if (action.lineBreakEnd > action.lineEnd) {
    return {
      start: action.lineStart,
      end: action.lineBreakEnd,
    };
  }
  return {
    start: action.lineStart > 0 ? action.lineStart - 1 : action.lineStart,
    end: action.lineEnd,
  };
}

function protectedPromptActionDeletionRange(
  element: HTMLTextAreaElement,
  titles: Set<string>,
  key: 'Backspace' | 'Delete',
) {
  if (!titles.size) {
    return undefined;
  }
  const ranges = protectedPromptActionRanges(element.value, titles);
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? start;

  if (start !== end) {
    const overlappingRanges = ranges.filter((action) => {
      const bounds = promptActionDeleteBounds(action);
      return start < bounds.end && end > bounds.start;
    });
    if (
      overlappingRanges.length &&
      overlappingRanges.every((action) => start <= action.start && end >= action.end)
    ) {
      const starts = overlappingRanges.map((action) => promptActionDeleteBounds(action).start);
      const ends = overlappingRanges.map((action) => promptActionDeleteBounds(action).end);
      return {
        start: Math.min(...starts),
        end: Math.max(...ends),
      };
    }
    return undefined;
  }

  const action = ranges.find((range) => {
    const bounds = promptActionDeleteBounds(range);
    if (key === 'Backspace') {
      return start === range.end || start === range.lineBreakEnd;
    }
    return start === range.start || start === bounds.start;
  });
  return action ? promptActionDeleteBounds(action) : undefined;
}

type PromptCommandRange = {
  name: string;
  index: number;
  start: number;
  end: number;
};

function promptCommandRanges(text: string) {
  const ranges: PromptCommandRange[] = [];
  text.replace(promptCommandTokenPattern, (match, name: string, offset: number) => {
    ranges.push({
      name: name.toLocaleLowerCase(),
      index: offset,
      start: offset,
      end: offset + match.length,
    });
    return match;
  });
  return ranges;
}

function promptCommandAtIndex(text: string, index: number) {
  return promptCommandRanges(text).find((command) => index >= command.start && index < command.end);
}

function splitPromptCommands(token: HighlightToken): HighlightToken[] {
  if (token.kind === 'prompt-action' || token.kind === 'prompt-command') {
    return [token];
  }
  if (!token.text.includes('@command')) {
    return [token];
  }

  const tokens: HighlightToken[] = [];
  let lastIndex = 0;
  token.text.replace(promptCommandTokenPattern, (match, name: string, offset: number) => {
    if (offset > lastIndex) {
      tokens.push({ ...token, text: token.text.slice(lastIndex, offset) });
    }
    tokens.push({
      kind: 'prompt-command',
      text: match,
      name: name.toLocaleLowerCase(),
      index: offset,
    });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < token.text.length) {
    tokens.push({ ...token, text: token.text.slice(lastIndex) });
  }
  return tokens;
}

function splitStepMarkers(token: HighlightToken): HighlightToken[] {
  if (token.kind !== 'plain' || !token.text.includes('@step')) {
    return [token];
  }

  const tokens: HighlightToken[] = [];
  let lastIndex = 0;
  token.text.replace(promptStepMarkerPattern, (match, _name: string, offset: number) => {
    if (offset > lastIndex) {
      tokens.push({ ...token, text: token.text.slice(lastIndex, offset) });
    }
    tokens.push({ kind: 'step-marker', text: match });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < token.text.length) {
    tokens.push({ ...token, text: token.text.slice(lastIndex) });
  }
  return tokens.length ? tokens : [token];
}

function splitPlanOutputs(token: HighlightToken): HighlightToken[] {
  if (token.kind !== 'plain' || !token.text.includes('@output')) {
    return [token];
  }

  const tokens: HighlightToken[] = [];
  let lastIndex = 0;
  token.text.replace(stepOutputTokenPattern, (match, _name: string, offset: number) => {
    if (offset > lastIndex) {
      tokens.push({ ...token, text: token.text.slice(lastIndex, offset) });
    }
    tokens.push({ kind: 'plan-output', text: match });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < token.text.length) {
    tokens.push({ ...token, text: token.text.slice(lastIndex) });
  }
  return tokens.length ? tokens : [token];
}

function splitPromptActions(token: HighlightToken): HighlightToken[] {
  if (token.kind === 'prompt-action') {
    return [token];
  }
  if (!token.text.includes('@action')) {
    return [token];
  }

  const tokens: HighlightToken[] = [];
  let lastIndex = 0;
  token.text.replace(promptActionPattern, (match, title: string | undefined, offset: number) => {
    if (offset > lastIndex) {
      tokens.push({ ...token, text: token.text.slice(lastIndex, offset) });
    }
    tokens.push({
      kind: 'prompt-action',
      text: match,
      title: title?.trim() || defaultPromptActionTitle,
      index: offset,
      hasTitle: !!title?.trim(),
    });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < token.text.length) {
    tokens.push({ ...token, text: token.text.slice(lastIndex) });
  }
  return tokens;
}

function splitTemplateVariables(
  token: HighlightToken,
  statuses: Record<string, 'active' | 'inactive'> | undefined,
): HighlightToken[] {
  if (!statuses || token.kind === 'prompt-action' || token.kind === 'prompt-command' || token.kind === 'template-variable-active' || token.kind === 'template-variable-inactive') {
    return [token];
  }
  if (!token.text.includes('{{')) {
    return [token];
  }

  const tokens: HighlightToken[] = [];
  let lastIndex = 0;
  token.text.replace(templateVariablePattern, (match, name: string, offset: number) => {
    if (offset > lastIndex) {
      tokens.push({ ...token, text: token.text.slice(lastIndex, offset) });
    }
    const status = statuses[name] ?? statuses[name.trim()] ?? 'active';
    tokens.push({
      kind: status === 'inactive' ? 'template-variable-inactive' : 'template-variable-active',
      text: match,
    });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < token.text.length) {
    tokens.push({ ...token, text: token.text.slice(lastIndex) });
  }
  return tokens;
}

export function JsonSyntaxTextarea({
  className,
  id,
  ref,
  rows,
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  readOnly,
  disabled,
  wrap,
  highlightPlainText = false,
  workflowVariableDefinitions = [],
  workflowVariableValues = {},
  templateVariableStatuses,
  protectedPromptActionTitles = [],
  promptActionStatuses = {},
  onPromptActionClick,
  promptCommandStatuses = {},
  onPromptCommandClick,
}: JsonSyntaxTextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const rememberSelection = usePreservedTextSelection(textareaRef, value);
  const lastValueRef = useRef(value);
  const undoStackRef = useRef<TextHistoryEntry[]>([]);
  const redoStackRef = useRef<TextHistoryEntry[]>([]);
  const selectionBeforeInputRef = useRef<TextSelectionSnapshot | null>(null);
  const pendingSelectionRestoreRef = useRef<TextSelectionSnapshot | null>(null);
  const protectedPromptActionTitleSet = useMemo(
    () => new Set(protectedPromptActionTitles.map(normalizedPromptActionTitle)),
    [protectedPromptActionTitles],
  );

  const setRefs = (node: HTMLTextAreaElement | null) => {
    textareaRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
    }
  };

  const segments = useMemo(() => findSegments(value), [value]);
  const jsonHighlightActive = useMemo(() => segments.some(s => s.type === 'json'), [segments]);
  const workflowVariableHighlightActive = useMemo(() => /<([^<>\n]+)>/.test(value), [value]);
  const tokens = useMemo(() => {
    const result: JsonToken[] = [];
    if (jsonHighlightActive) {
      for (const segment of segments) {
        if (segment.type === 'json') {
          result.push(...jsonTokens(segment.text));
        } else {
          result.push({ kind: 'plain', text: segment.text });
        }
      }
    } else {
      result.push({ kind: 'plain', text: value });
    }
    return result
      .flatMap((token) =>
        splitWorkflowVariables(token, workflowVariableDefinitions, workflowVariableValues),
      )
      .flatMap(splitStepMarkers)
      .flatMap(splitPromptActions)
      .flatMap(splitPromptCommands)
      .flatMap(splitPlanOutputs)
      .flatMap((token) => splitTemplateVariables(token, templateVariableStatuses));
  }, [segments, jsonHighlightActive, value, workflowVariableDefinitions, workflowVariableValues, templateVariableStatuses]);

  const promptActionHighlightActive = useMemo(
    () => /@action(?::[^\n\r]+)?/.test(value) || /@command:[ \t]*[A-Za-z0-9_]+/i.test(value),
    [value],
  );
  const templateVariableHighlightActive = useMemo(() => !!templateVariableStatuses && /\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\}/.test(value), [templateVariableStatuses, value]);
  const stepHighlightActive = useMemo(
    () => /@step:[ \t]*[A-Za-z0-9_-]+\b/i.test(value) || /@output:[A-Za-z0-9_-]+\b/i.test(value),
    [value],
  );
  const highlightActive = highlightPlainText || jsonHighlightActive || workflowVariableHighlightActive || promptActionHighlightActive || templateVariableHighlightActive || stepHighlightActive;

  const tokenClassName = (token: HighlightToken) => {
    if (
      token.kind === 'workflow-variable-valid' ||
      token.kind === 'workflow-variable-invalid' ||
      token.kind === 'template-variable-active' ||
      token.kind === 'template-variable-inactive'
    ) {
      return token.kind;
    }
    if (token.kind === 'prompt-action') {
      const status = promptActionStatuses[normalizedPromptActionTitle(token.title)];
      return [
        token.kind,
        status ? `prompt-action-status-${status.tone}` : '',
        status?.disabled ? 'disabled' : '',
      ].filter(Boolean).join(' ');
    }
    if (token.kind === 'step-marker') {
      return 'prompt-step-marker';
    }
    if (token.kind === 'plan-output') {
      return 'prompt-plan-output';
    }
    if (token.kind === 'prompt-command') {
      const status = promptCommandStatuses[token.name];
      return [
        'prompt-action prompt-command',
        status ? `prompt-action-status-${status.tone}` : '',
        status?.disabled ? 'disabled' : '',
      ].filter(Boolean).join(' ');
    }
    return `json-token-${token.kind}`;
  };

  const syncHighlightScroll = () => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;
    if (!textarea || !highlight) {
      return;
    }
    highlight.scrollLeft = textarea.scrollLeft;
    highlight.scrollTop = textarea.scrollTop;
  };

  useEffect(() => {
    if (value === lastValueRef.current) {
      return;
    }
    lastValueRef.current = value;
    undoStackRef.current = [];
    redoStackRef.current = [];
    selectionBeforeInputRef.current = null;
    pendingSelectionRestoreRef.current = null;
  }, [value]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const selection = pendingSelectionRestoreRef.current;
    if (!textarea || !selection || document.activeElement !== textarea) {
      return;
    }

    pendingSelectionRestoreRef.current = null;
    restoreTextSelection(textarea, selection);
    syncHighlightScroll();
  }, [value]);

  useLayoutEffect(() => {
    syncHighlightScroll();
  }, [highlightActive, value]);

  const rememberSelectionBeforeInput = (element: HTMLTextAreaElement) => {
    selectionBeforeInputRef.current = textSelectionSnapshot(element);
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.currentTarget.value;
    const previousValue = lastValueRef.current;
    const selection = selectionBeforeInputRef.current ?? textSelectionSnapshot(event.currentTarget);

    if (!protectedPromptActionsRemainSealed(previousValue, nextValue, protectedPromptActionTitleSet)) {
      event.currentTarget.value = previousValue;
      selectionBeforeInputRef.current = null;
      return;
    }

    if (nextValue !== previousValue) {
      pushTextHistoryEntry(undoStackRef.current, { value: previousValue, ...selection });
      redoStackRef.current = [];
    }

    selectionBeforeInputRef.current = null;
    lastValueRef.current = nextValue;
    rememberSelection(event.currentTarget);
    onChange?.(nextValue);
  };

  const handleBeforeInput = (event: FormEvent<HTMLTextAreaElement>) => {
    const inputType = (event.nativeEvent as InputEvent).inputType || 'insertText';
    if (editTouchesProtectedPromptAction(event.currentTarget, protectedPromptActionTitleSet, inputType)) {
      event.preventDefault();
      return;
    }
    rememberSelectionBeforeInput(event.currentTarget);
  };

  const applyHistoryEntry = (
    sourceStack: React.MutableRefObject<TextHistoryEntry[]>,
    targetStack: React.MutableRefObject<TextHistoryEntry[]>,
  ) => {
    const textarea = textareaRef.current;
    if (!textarea || readOnly || disabled || !onChange) {
      return;
    }

    const nextEntry = sourceStack.current[sourceStack.current.length - 1];
    if (!nextEntry) {
      return;
    }
    if (!protectedPromptActionsRemainSealed(
      lastValueRef.current,
      nextEntry.value,
      protectedPromptActionTitleSet,
    )) {
      return;
    }
    sourceStack.current.pop();

    pushTextHistoryEntry(targetStack.current, {
      value: lastValueRef.current,
      ...textSelectionSnapshot(textarea),
    });
    lastValueRef.current = nextEntry.value;
    pendingSelectionRestoreRef.current = nextEntry;
    selectionBeforeInputRef.current = null;
    onChange(nextEntry.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const key = event.key.toLocaleLowerCase();
    const usesShortcutModifier = event.ctrlKey || event.metaKey;
    const isUndo = usesShortcutModifier && !event.altKey && !event.shiftKey && key === 'z';
    const isRedo = usesShortcutModifier && !event.altKey && (
      (event.shiftKey && key === 'z') ||
      (!event.shiftKey && key === 'y')
    );

    if (isUndo || isRedo) {
      event.preventDefault();
      event.stopPropagation();
      applyHistoryEntry(
        isUndo ? undoStackRef : redoStackRef,
        isUndo ? redoStackRef : undoStackRef,
      );
      return;
    }

    const actionOnLine = promptActionOnLineAtIndex(
      event.currentTarget.value,
      event.currentTarget.selectionStart ?? 0,
    );
    if (event.key === 'Enter' && actionOnLine && onPromptActionClick) {
      event.preventDefault();
      event.stopPropagation();
      onPromptActionClick(actionOnLine);
      return;
    }
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      onChange &&
      !readOnly &&
      !disabled
    ) {
      const deletionRange = protectedPromptActionDeletionRange(
        event.currentTarget,
        protectedPromptActionTitleSet,
        event.key,
      );
      if (deletionRange) {
        event.preventDefault();
        event.stopPropagation();
        const previousValue = lastValueRef.current;
        const selection = textSelectionSnapshot(event.currentTarget);
        const nextValue = previousValue.slice(0, deletionRange.start) + previousValue.slice(deletionRange.end);
        if (nextValue !== previousValue) {
          pushTextHistoryEntry(undoStackRef.current, { value: previousValue, ...selection });
          redoStackRef.current = [];
          lastValueRef.current = nextValue;
          pendingSelectionRestoreRef.current = {
            ...selection,
            start: deletionRange.start,
            end: deletionRange.start,
          };
          selectionBeforeInputRef.current = null;
          onChange(nextValue);
        }
        return;
      }
    }

    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      editTouchesProtectedPromptAction(
        event.currentTarget,
        protectedPromptActionTitleSet,
        event.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward',
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!usesShortcutModifier && !event.altKey) {
      rememberSelectionBeforeInput(event.currentTarget);
    }
  };

  const handleClick = (event: MouseEvent<HTMLTextAreaElement>) => {
    if (!onPromptActionClick && !onPromptCommandClick) {
      return;
    }
    const element = event.currentTarget;
    window.requestAnimationFrame(() => {
      const selectionStart = element.selectionStart ?? 0;
      if (selectionStart !== (element.selectionEnd ?? selectionStart)) {
        return;
      }
      if (onPromptCommandClick) {
        const command = promptCommandAtIndex(element.value, selectionStart);
        if (command) {
          onPromptCommandClick(command);
          return;
        }
      }
      if (!onPromptActionClick) {
        return;
      }
      const actionOnLine = promptActionOnLineAtIndex(element.value, selectionStart);
      const action = actionOnLine && protectedPromptActionTitleSet.has(
        normalizedPromptActionTitle(actionOnLine.title),
      )
        ? actionOnLine
        : promptActionAtIndex(element.value, selectionStart);
      if (action) {
        onPromptActionClick(action);
      }
    });
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (editTouchesProtectedPromptAction(event.currentTarget, protectedPromptActionTitleSet, 'insertFromPaste')) {
      event.preventDefault();
    }
  };

  const handleCut = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (editTouchesProtectedPromptAction(event.currentTarget, protectedPromptActionTitleSet, 'deleteByCut')) {
      event.preventDefault();
    }
  };

  const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    if (editTouchesProtectedPromptAction(event.currentTarget, protectedPromptActionTitleSet, 'insertFromDrop')) {
      event.preventDefault();
    }
  };

  return (
    <div className={`json-syntax-textarea${highlightActive ? ' active' : ''}`}>
      <textarea
        className={className}
        id={textareaId}
        ref={setRefs}
        rows={rows}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onBeforeInput={handleBeforeInput}
        onChange={handleChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={handleClick}
        onPaste={handlePaste}
        onCut={handleCut}
        onDrop={handleDrop}
        onKeyDown={handleKeyDown}
        onScroll={syncHighlightScroll}
        readOnly={readOnly}
        disabled={disabled}
        wrap={wrap}
      />
      {highlightActive && (
        <pre className="json-syntax-highlight nowheel" aria-hidden="true" ref={highlightRef}>
          {tokens.map((token, index) => {
            const status = token.kind === 'prompt-action'
              ? promptActionStatuses[normalizedPromptActionTitle(token.title)]
              : token.kind === 'prompt-command'
                ? promptCommandStatuses[token.name]
                : undefined;
            return (
              <React.Fragment key={`${index}-${token.kind}`}>
                <span className={tokenClassName(token)}>
                  {token.text}
                </span>
                {status ? (
                  <span className={[
                    'prompt-action-status-label',
                    status.tone,
                    status.disabled ? 'disabled' : '',
                  ].filter(Boolean).join(' ')}
                  >
                    {` (${status.label})`}
                  </span>
                ) : null}
              </React.Fragment>
            );
          })}
          {/* A <pre> does not render an empty line after a trailing newline,
              but a textarea does. The invisible character forces the same final
              line so both elements scroll at exactly the same height. */}
          {'\u200b'}
        </pre>
      )}
    </div>
  );
}
