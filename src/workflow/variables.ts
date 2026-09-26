import type { SettingsValueDefinition, WorkflowVariableSetCommand } from '../types';
import {
  contextLengthMaxOptionKey,
  defaultContextCompressionTokenLimit,
  responseLengthOptionKey,
} from './defaults';

export type WorkflowVariableValues = Record<string, string>;

export type { WorkflowVariableSetCommand };

const workflowVariableOpen = '<';
const workflowVariableClose = '>';

export const builtInWorkflowVariables: SettingsValueDefinition[] = [
  {
    key: contextLengthMaxOptionKey,
    label: 'Context Length Max',
    enabled: true,
    builtIn: true,
    valueKind: 'number',
    used: false,
    usedAsNumber: false,
  },
  {
    key: responseLengthOptionKey,
    label: 'Response Length',
    enabled: true,
    builtIn: true,
    valueKind: 'text',
    used: false,
    usedAsNumber: false,
  },
];

export function defaultWorkflowVariableValue(key: string) {
  if (key === contextLengthMaxOptionKey) {
    return String(defaultContextCompressionTokenLimit);
  }
  if (key === responseLengthOptionKey) {
    return '200-300';
  }
  return '';
}

function isStrictNumberText(value: string) {
  return /^-?(?:\d+|\d*\.\d+)$/.test(value.trim());
}

export function workflowVariableValueKind(value: string): 'number' | 'text' {
  return isStrictNumberText(value) ? 'number' : 'text';
}

function unescapeSetStringValue(value: string) {
  return value.replace(/\\(["\\nt])/g, (_, escaped: string) => {
    if (escaped === 'n') {
      return '\n';
    }
    if (escaped === 't') {
      return '\t';
    }
    return escaped;
  });
}

function parseSetValue(rawValue: string) {
  const value = rawValue.trim();
  const quoted = /^"((?:\\.|[^"\\])*)"$/.exec(value);
  return quoted ? unescapeSetStringValue(quoted[1]) : value;
}

function parseSetAssignment(line: string): WorkflowVariableSetCommand | undefined {
  const match = /^([^=@][^=]*?)\s*=\s*(.+)$/.exec(line.trim());
  if (!match) {
    return undefined;
  }
  const name = match[1].trim();
  if (!name) {
    return undefined;
  }
  return {
    name,
    value: parseSetValue(match[2]),
  };
}

export function parseWorkflowVariableSetCommands(text: string): WorkflowVariableSetCommand[] {
  // User/LLM-facing syntax:
  // @set
  // Variable Name = "Value"
  // Number Variable = 12
  // @endset
  // Also supports one-line assignments like: @set Current Location = "Old Harbor"
  const commands: WorkflowVariableSetCommand[] = [];
  const pendingBlockCommands: WorkflowVariableSetCommand[] = [];
  let inSetBlock = false;

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    if (line === '@set') {
      inSetBlock = true;
      pendingBlockCommands.length = 0;
      return;
    }
    if (line === '@endset') {
      if (inSetBlock) {
        commands.push(...pendingBlockCommands);
      }
      inSetBlock = false;
      pendingBlockCommands.length = 0;
      return;
    }
    if (inSetBlock) {
      const command = parseSetAssignment(line);
      if (command) {
        pendingBlockCommands.push(command);
      }
      return;
    }
    if (line.startsWith('@set ')) {
      const command = parseSetAssignment(line.slice('@set '.length));
      if (command) {
        commands.push(command);
      }
    }
  });

  return commands;
}

export function extractWorkflowVariableSetCommands(text: string): {
  text: string;
  commands: WorkflowVariableSetCommand[];
} {
  const commands: WorkflowVariableSetCommand[] = [];
  const outputLines: string[] = [];
  const pendingBlockCommands: WorkflowVariableSetCommand[] = [];
  const pendingBlockLines: string[] = [];
  let inSetBlock = false;

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!inSetBlock && line === '@set') {
      inSetBlock = true;
      pendingBlockCommands.length = 0;
      pendingBlockLines.length = 0;
      pendingBlockLines.push(rawLine);
      return;
    }
    if (inSetBlock) {
      pendingBlockLines.push(rawLine);
      if (line === '@endset') {
        commands.push(...pendingBlockCommands);
        inSetBlock = false;
        pendingBlockCommands.length = 0;
        pendingBlockLines.length = 0;
        return;
      }
      const command = parseSetAssignment(line);
      if (command) {
        pendingBlockCommands.push(command);
      }
      return;
    }
    if (line.startsWith('@set ')) {
      const command = parseSetAssignment(line.slice('@set '.length));
      if (command) {
        commands.push(command);
        return;
      }
    }
    outputLines.push(rawLine);
  });

  if (inSetBlock) {
    outputLines.push(...pendingBlockLines);
  }

  return {
    text: outputLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    commands,
  };
}

export function workflowVariablePreviewValues(
  commands: WorkflowVariableSetCommand[],
  definitions: Pick<SettingsValueDefinition, 'key' | 'label'>[],
  values: WorkflowVariableValues,
) {
  const previewValues = { ...values };
  commands.forEach((command) => {
    const name = command.name.trim();
    if (!name) {
      return;
    }
    const normalizedName = name.toLocaleLowerCase();
    const definition = definitions.find(
      (entry) =>
        entry.key.toLocaleLowerCase() === normalizedName ||
        entry.label.toLocaleLowerCase() === normalizedName,
    );
    const existingCustomKey = Object.keys(previewValues).find(
      (key) => key.toLocaleLowerCase() === normalizedName,
    );
    previewValues[definition?.key ?? existingCustomKey ?? name] = command.value;
  });
  return previewValues;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function workflowVariablePattern(alias: string, escaped = true) {
  return `${escaped ? '(?<!\\\\)' : ''}${escapeRegExp(workflowVariableOpen)}\\s*${escapeRegExp(alias)}\\s*${escapeRegExp(workflowVariableClose)}`;
}

export function variableAliases(definition: Pick<SettingsValueDefinition, 'key' | 'label'>) {
  return [definition.label, definition.key]
    .map((value) => value.trim())
    .filter(Boolean);
}

// Cached `<alias>`-reference test regexes (case-insensitive) — the pattern
// depends only on the alias, so it is compiled once per alias instead of on
// every textReferencesWorkflowVariable call (which runs per node × definition).
const referenceRegexCache = new Map<string, RegExp>();

function referenceRegexForAlias(alias: string): RegExp {
  let regex = referenceRegexCache.get(alias);
  if (!regex) {
    regex = new RegExp(workflowVariablePattern(alias), 'i');
    referenceRegexCache.set(alias, regex);
  }
  return regex;
}

export function textReferencesWorkflowVariable(
  text: string,
  definition: Pick<SettingsValueDefinition, 'key' | 'label'>,
) {
  // Fast path: without an opening delimiter the text cannot reference any
  // variable. Most checked fields are plain numbers/empty, so this skips regex
  // work entirely on the hot per-node/per-definition path.
  if (!text.includes(workflowVariableOpen)) {
    return false;
  }
  return variableAliases(definition).some((alias) => referenceRegexForAlias(alias).test(text));
}

export function textSetsWorkflowVariable(
  text: string,
  definition: Pick<SettingsValueDefinition, 'key' | 'label'>,
) {
  const aliases = new Set(
    variableAliases(definition).map((alias) => alias.toLocaleLowerCase()),
  );
  return parseWorkflowVariableSetCommands(text).some((command) =>
    aliases.has(command.name.trim().toLocaleLowerCase()),
  );
}

// One compiled regex per distinct alias set \u2014 the pattern depends only on the
// variable names, not their values, so it is cached across calls. This collapses
// the former per-alias `new RegExp(...)` + full-text `.replace` loop (O(aliases)
// scans of the whole prompt, recompiled every call) into a single cached pass.
const combinedVariableRegexCache = new Map<string, RegExp>();

function combinedWorkflowVariableRegex(aliases: string[]): RegExp {
  // Longest alias first so a shorter alias cannot shadow a longer one it prefixes.
  const ordered = [...aliases].sort((a, b) => b.length - a.length);
  const signature = ordered.join('\uE001');
  let regex = combinedVariableRegexCache.get(signature);
  if (!regex) {
    const alternation = ordered.map(escapeRegExp).join('|');
    // (\\?)      \u2014 optional escaping backslash: `\<Name>` stays literal (minus the
    //              backslash), mirroring the old protect/restore of escaped tokens.
    // <\s* \u2026 \s*> \u2014 the placeholder with tolerant surrounding whitespace.
    regex = new RegExp(
      `(\\\\?)${escapeRegExp(workflowVariableOpen)}\\s*(${alternation})\\s*${escapeRegExp(workflowVariableClose)}`,
      'gi',
    );
    combinedVariableRegexCache.set(signature, regex);
  }
  return regex;
}

export function resolveWorkflowVariables(
  text: string,
  definitions: Pick<SettingsValueDefinition, 'key' | 'label'>[],
  values: WorkflowVariableValues,
) {
  // Fast path: with no opening delimiter there is nothing to substitute or
  // unescape \u2014 skip building the value map and running any regex entirely.
  if (!text.includes(workflowVariableOpen)) {
    return text;
  }
  // Map each alias (label + key of every definition) to its value. First alias
  // wins on collision, preserving the old per-definition sequential replace order.
  const valueByAlias = new Map<string, string>();
  const aliases: string[] = [];
  for (const definition of definitions) {
    const value = values[definition.key] ?? defaultWorkflowVariableValue(definition.key);
    for (const alias of variableAliases(definition)) {
      const key = alias.toLocaleLowerCase();
      if (!valueByAlias.has(key)) {
        valueByAlias.set(key, value);
        aliases.push(alias);
      }
    }
  }
  if (aliases.length === 0) {
    return text;
  }
  // Single pass: substitute unescaped `<Name>` with its value; keep an escaped
  // `\<Name>` literal (minus the escape). Values are inserted literally (not
  // re-scanned), so a value cannot inject another placeholder.
  return text.replace(
    combinedWorkflowVariableRegex(aliases),
    (match: string, backslash: string, alias: string) =>
      backslash ? match.slice(1) : valueByAlias.get(alias.trim().toLocaleLowerCase()) ?? match,
  );
}

export function resolveWorkflowNumber(
  value: string | number | undefined,
  definitions: Pick<SettingsValueDefinition, 'key' | 'label'>[],
  values: WorkflowVariableValues,
) {
  const text = typeof value === 'number' ? String(value) : value ?? '';
  const resolved = resolveWorkflowVariables(text, definitions, values).trim();
  if (!isStrictNumberText(resolved)) {
    return undefined;
  }
  const numberValue = Number(resolved);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}
