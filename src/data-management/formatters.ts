import { encode } from '@toon-format/toon';
import { compactJson, prettyJson } from './parsing';
import { selectEvents, selectPhoneMessages, selectTimelineWindow } from './selectors';
import type { ContextEncoding, ContextViewOptions, RpgraphSessionV2 } from './types';
import { sanitizeDataUrls } from '../utils/sanitize';

function isPrimitive(value: unknown) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function uniformPrimitiveObjectArray(value: unknown): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const first = value[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    return false;
  }
  const keys = Object.keys(first).sort();
  if (!keys.length) {
    return false;
  }
  return value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return false;
    }
    const entryRecord = entry as Record<string, unknown>;
    const entryKeys = Object.keys(entryRecord).sort();
    return (
      entryKeys.length === keys.length &&
      entryKeys.every((key, index) => key === keys[index]) &&
      entryKeys.every((key) => isPrimitive(entryRecord[key]))
    );
  });
}

function toonWouldHelp(value: unknown) {
  if (uniformPrimitiveObjectArray(value)) {
    return true;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Object.values(record).some(uniformPrimitiveObjectArray);
}

function bestLlmEncoding(value: unknown): 'toon' | 'json-compact' {
  return toonWouldHelp(value) ? 'toon' : 'json-compact';
}

function jsonDataModelValue(value: unknown) {
  const json = JSON.stringify(sanitizeDataUrls(value) ?? null);
  return json === undefined ? null : JSON.parse(json);
}

export function formatContextValue(value: unknown, encoding: ContextEncoding) {
  const sanitizedValue = sanitizeDataUrls(value);
  if (encoding === 'text') {
    return typeof sanitizedValue === 'string' ? sanitizedValue : prettyJson(sanitizedValue);
  }
  if (encoding === 'json-pretty') {
    return prettyJson(sanitizedValue);
  }
  if (encoding === 'toon') {
    try {
      return encode(jsonDataModelValue(sanitizedValue));
    } catch {
      return compactJson(sanitizedValue);
    }
  }
  return compactJson(sanitizedValue);
}

function resolvedEncoding(value: unknown, requested: ContextEncoding) {
  if (requested === 'toon') {
    return bestLlmEncoding(value);
  }
  return requested;
}

export function formatTimelineContext(session: RpgraphSessionV2, options: ContextViewOptions) {
  const view = selectTimelineWindow(session, options.maxEntries);
  return formatContextValue(view, resolvedEncoding(view, options.encoding));
}

export function formatEventsContext(session: RpgraphSessionV2, options: ContextViewOptions) {
  const view = selectEvents(session, options.maxEntries);
  return formatContextValue(view, resolvedEncoding(view, options.encoding));
}

export function formatPhoneContext(session: RpgraphSessionV2, options: ContextViewOptions) {
  const view = selectPhoneMessages(session).slice(-(options.maxEntries ?? 24));
  return formatContextValue(view, resolvedEncoding(view, options.encoding));
}

export function formatDebugSnapshot(session: RpgraphSessionV2, options: ContextViewOptions) {
  const view = {
    timeline: selectTimelineWindow(session, options.maxEntries),
    events: selectEvents(session, options.maxEntries),
    phone: selectPhoneMessages(session).slice(-(options.maxEntries ?? 24)),
    runtime: {
      nodeIds: Object.keys(session.runtime.current.nodes),
      checkpointCount: session.runtime.undo.length,
    },
    debug: options.includeDebug ? session.debug : undefined,
  };
  return formatContextValue(view, resolvedEncoding(view, options.encoding));
}
