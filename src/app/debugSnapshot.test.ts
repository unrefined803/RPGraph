import { describe, expect, it } from 'vitest';
import { decode } from '@toon-format/toon';
import { formatContextValue } from '../data-management/formatters';
import { TextMetricsApi } from '../llm/tokenMetrics';
import {
  compactDebugValue, createDebugSnapshotCopy, debugSnapshotLimits,
  sanitizeDebugSnapshotValue, type DebugSnapshot,
} from './debugSnapshot';

const textMetrics = new TextMetricsApi();
const imageUrl = `data:image/png;base64,${'A'.repeat(4000)}`;
const repeatedText = 'Important diagnostic context. '.repeat(150);

function snapshot(): DebugSnapshot {
  return {
    schema: 'rpgraph-debug-snapshot', version: 2, createdAt: '2026-09-05T10:00:00Z',
    selectedSections: [], appState: {}, lastRun: {}, recentTurns: [], promptSwitch: {},
    eventManager: {}, nodes: [], edges: [], systemLog: [],
  };
}

function checkReferences(payload: unknown) {
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if ('$ref' in value) {
      const pointer = String(value.$ref);
      expect(pointer.startsWith('#/')).toBe(true);
      let target: unknown = payload;
      for (const part of pointer.slice(2).split('/')) {
        target = (target as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
      }
      expect(target).toBeDefined();
      expect(target).not.toHaveProperty('$ref');
    }
    Object.values(value).forEach(visit);
  };
  visit(payload);
}

describe('debug snapshot compaction', () => {
  it('redacts images before choosing a preview and preserves following diagnostics', () => {
    const text = `Image: ${imageUrl}\nDiagnostic: routing failed.`;
    expect(compactDebugValue(text, textMetrics)).toBe(sanitizeDebugSnapshotValue(text));
    expect(compactDebugValue(text, textMetrics)).toContain('Diagnostic: routing failed.');
  });

  it('removes nested image payloads without mutating source data', () => {
    const value = { images: [{ dataUrl: imageUrl, name: 'Reference' }], error: 'Routing failed' };
    expect(compactDebugValue(value, textMetrics)).toEqual({
      images: [{ name: 'Reference' }], error: 'Routing failed',
    });
    expect(value.images[0].dataUrl).toBe(imageUrl);
  });

  it('preserves structure, routing, errors, and both ends of long responses', () => {
    const value = { prompt: repeatedText, response: `START ${repeatedText} ERROR AT END`, selectedPromptSlot: 3, runError: 'Invalid JSON' };
    const result = compactDebugValue(value, textMetrics, true);
    expect(result).toMatchObject({
      selectedPromptSlot: 3, runError: 'Invalid JSON',
      response: { head: expect.stringContaining('START'), tail: expect.stringContaining('ERROR AT END') },
    });
    expect(result).not.toHaveProperty('preview');
  });

  it('keeps the latest history and measures sanitized source text', () => {
    const text = `${imageUrl}\n${repeatedText}LATEST TURN`;
    const sanitized = sanitizeDebugSnapshotValue(text) as string;
    expect(compactDebugValue({ originalHistory: text }, textMetrics, true)).toEqual({
      originalHistory: {
        characters: sanitized.length, estimatedTokens: textMetrics.measure(sanitized).tokens,
        omittedCharacters: sanitized.length - debugSnapshotLimits.compressed.textPreviewCharacters,
        tail: sanitized.slice(-debugSnapshotLimits.compressed.textPreviewCharacters),
      },
    });
  });

  it('leaves short and empty text untouched rather than adding metadata', () => {
    const value = { combinedPrompt: '', graphText: 'Hello', eventLastResponse: 'OK' };
    expect(compactDebugValue(value, textMetrics, true)).toEqual(value);
  });

  it('deduplicates exact source strings, escapes pointers, and distinguishes different truncated middles', () => {
    const result = compactDebugValue({
      'a/b~c': repeatedText,
      duplicate: repeatedText,
      different: repeatedText.slice(0, 1500) + 'DIFFERENT' + repeatedText.slice(1500),
    }, textMetrics, true);
    expect(result).toHaveProperty('duplicate', { $ref: '#/a~1b~0c' });
    expect(result).not.toHaveProperty('different.$ref');
    checkReferences(result);
  });

  it('bounds logs while retaining older warnings and the latest entries', () => {
    const systemLog = Array.from({ length: 150 }, (_, id) => ({
      id, level: id === 2 ? 'error' : 'info', text: id === 2 ? 'Earlier failure' : repeatedText,
    }));
    const result = compactDebugValue({ systemLog }, textMetrics, true) as { systemLog: unknown[] };
    expect(result.systemLog.length).toBeLessThanOrEqual(41);
    expect(result.systemLog).toContainEqual({ id: 2, level: 'error', text: 'Earlier failure' });
    expect(result.systemLog.slice(-1)[0]).toMatchObject({ id: 149 });
    expect(result.systemLog[0]).toMatchObject({ omittedItems: 110, totalItems: 150 });
    checkReferences(result);
  });

  it('keeps upcoming events ahead of completed events and preserves graph connectivity', () => {
    const events = Array.from({ length: 110 }, (_, id) => ({ id, status: id === 0 ? 'upcoming' : 'completed' }));
    const edges = Array.from({ length: 150 }, (_, id) => ({ id, source: `n${id}`, target: `n${id + 1}` }));
    const result = compactDebugValue({ events, edges }, textMetrics, true);
    expect(result).toHaveProperty('edges', edges);
    expect((result as { events: unknown[] }).events).toContainEqual(events[0]);
  });

  it('deduplicates only selected sections and retains capture time', () => {
    const source = snapshot();
    source.lastRun = { originalInput: repeatedText };
    source.promptSwitch = { inputValue: repeatedText };
    const both = createDebugSnapshotCopy(source, [
      { id: 'last-run', snapshotKey: 'lastRun' }, { id: 'prompt', snapshotKey: 'promptSwitch' },
    ], textMetrics, true);
    expect(both.createdAt).toBe(source.createdAt);
    expect(both.promptSwitch?.inputValue).toEqual({ $ref: '#/lastRun/originalInput' });
    checkReferences(both);
    expect(decode(formatContextValue(both, 'toon'), { expandPaths: 'safe' })).toEqual(JSON.parse(JSON.stringify(both)));
    const onlyPrompt = createDebugSnapshotCopy(source, [{ id: 'prompt', snapshotKey: 'promptSwitch' }], textMetrics, true);
    expect(onlyPrompt.lastRun).toBeUndefined();
    expect(onlyPrompt.promptSwitch?.inputValue).not.toHaveProperty('$ref');
    checkReferences(onlyPrompt);
    expect(source.promptSwitch.inputValue).toBe(repeatedText);
  });

  it('includes duplicated runtime objects only once across selected node sections', () => {
    const debug = { inputValue: repeatedText, selectedPromptSlot: 2, generatedText: 'Reply' };
    const source = snapshot();
    source.promptSwitch = { nodes: [{ runtimeDebug: debug }] };
    source.nodes = [{ data: { llmPromptSwitchDebug: debug } }];
    const result = createDebugSnapshotCopy(source, [
      { id: 'prompt', snapshotKey: 'promptSwitch' }, { id: 'nodes', snapshotKey: 'nodes' },
    ], textMetrics, true);
    expect(result.nodes).toEqual([{ data: { llmPromptSwitchDebug: { $ref: '#/promptSwitch/nodes/0/runtimeDebug' } } }]);
    checkReferences(result);
  });

  it('reduces a repeated realistic prompt export while keeping diagnostic fields', () => {
    const source = snapshot();
    source.lastRun = { originalHistory: repeatedText, originalInput: 'Latest question' };
    source.promptSwitch = { nodes: [{
      runtimeDebug: { inputValue: repeatedText, combinedPrompt: repeatedText, selectedOutputChannel: 2 },
      fullText: repeatedText, generatedText: repeatedText, runError: 'Provider timeout',
    }] };
    const sections = [{ id: 'last-run', snapshotKey: 'lastRun' }, { id: 'prompt', snapshotKey: 'promptSwitch' }] as const;
    const normal = createDebugSnapshotCopy(source, [...sections], textMetrics, false);
    const compressed = createDebugSnapshotCopy(source, [...sections], textMetrics, true);
    expect(textMetrics.measure(JSON.stringify(compressed)).tokens).toBeLessThan(textMetrics.measure(JSON.stringify(normal)).tokens);
    expect(JSON.stringify(compressed).length).toBeLessThan(JSON.stringify(source).length / 4);
    expect(JSON.stringify(compressed)).toContain('Provider timeout');
    expect(JSON.stringify(compressed)).toContain('selectedOutputChannel');
    checkReferences(compressed);
  });
  it('shares identical excerpts without merging sources with different middles', () => {
    const head = 'Shared beginning. '.repeat(30);
    const tail = 'Shared ending. '.repeat(60);
    const result = compactDebugValue({
      combined: head + 'first middle'.repeat(200) + tail,
      part: head + 'different middle'.repeat(200) + tail,
    }, textMetrics, true);
    expect(result).not.toHaveProperty('part.$ref');
    expect(result).toHaveProperty('part.head', { $ref: '#/combined/head' });
    expect(result).toHaveProperty('part.tail', { $ref: '#/combined/tail' });
    checkReferences(result);
    const plain = JSON.parse(JSON.stringify(result));
    plain.part.head = head.slice(0, 266);
    plain.part.tail = tail.slice(-534);
    expect(textMetrics.measure(JSON.stringify(result)).tokens)
      .toBeLessThan(textMetrics.measure(JSON.stringify(plain)).tokens);
  });

  it('bounds event maps without colliding with IDs or referencing omitted values', () => {
    const eventEntities = Object.fromEntries(Array.from({ length: 110 }, (_, index) => [
      index === 0 ? 'entries' : index === 1 ? 'omittedItems' : `event/${index}~`,
      { status: index < 2 ? 'upcoming' : 'completed', details: repeatedText },
    ]));
    const result = compactDebugValue({ eventEntities, text: repeatedText }, textMetrics, true);
    expect(result).toHaveProperty('eventEntities.omittedItems', 70);
    expect(result).toHaveProperty('eventEntities.entries.entries.status', 'upcoming');
    expect(result).toHaveProperty('eventEntities.entries.omittedItems.status', 'upcoming');
    checkReferences(result);
    expect(decode(formatContextValue(result, 'toon'), { expandPaths: 'safe' }))
      .toEqual(JSON.parse(JSON.stringify(result)));
    expect(Object.keys(eventEntities)).toHaveLength(110);
  });

});
