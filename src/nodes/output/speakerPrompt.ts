import { encode } from '@toon-format/toon';
import type { OutputSpeakerPromptSettings, OutputSpeakerResponseFormat } from '../../types';
import { parseToonObject, stripStructuredResponse } from '../../utils/toon';
import { isRecord } from '../../utils/records';
import { fastTaskReasoningStart, fastTaskReasoningEnd } from '../../llm/fastTaskPrompt';
import type { PromptPreviewPart } from '../shared/promptRun';

export const defaultOutputSpeakerResponseFormat: OutputSpeakerResponseFormat = 'toon';

export const outputSpeakerPromptVariables = [
  '<OutputFormatInstructions>',
  '<KnownSpeakers>',
  '<HighlightingContext>',
  '<NumberedQuotedPassages>',
  '<ResponseText>',
  '<ExpectedShape>',
];

export const defaultOutputSpeakerPromptText = [
  fastTaskReasoningStart,
  '',
  'Analyze a roleplay response for chat display only. Do not rewrite the response.',
  'Known speaker names. Use speakerId values in your answer; speakerId 0 means unknown / do not highlight:',
  '<KnownSpeakers>',
  'Speaker details explain player selection, Storybook membership, prior interactions, name hits, and embedded message participants. A name hit alone does not confirm who is speaking; use this evidence to disambiguate shared names.',
  'Use Highlighting Context only to disambiguate who is present or likely speaking.',
  '<HighlightingContext>',
  'Analyze speakers only in the response text.',
  '<OutputFormatInstructions>',
  '',
  '<NumberedQuotedPassages>',
  'RESPONSE TEXT:',
  '<ResponseText>',
  '',
  fastTaskReasoningEnd,
].join('\n');

export function defaultOutputSpeakerPromptSettings(): OutputSpeakerPromptSettings {
  return { mode: 'default', customText: '' };
}

export function outputSpeakerPromptSettings(
  value: OutputSpeakerPromptSettings | undefined,
): OutputSpeakerPromptSettings {
  return value?.mode === 'custom'
    ? { mode: 'custom', customText: value.customText ?? '' }
    : defaultOutputSpeakerPromptSettings();
}

export function outputSpeakerPromptSaveSettings(
  value: OutputSpeakerPromptSettings | undefined,
): OutputSpeakerPromptSettings {
  const settings = outputSpeakerPromptSettings(value);
  return settings.mode === 'custom' && settings.customText === defaultOutputSpeakerPromptText
    ? defaultOutputSpeakerPromptSettings()
    : settings;
}

export function outputSpeakerResponseFormat(value: unknown): OutputSpeakerResponseFormat {
  return value === 'json' ? 'json' : defaultOutputSpeakerResponseFormat;
}

export function outputSpeakerFormatInstructions(
  format: OutputSpeakerResponseFormat,
  highlightDialogue: boolean,
  expectedShape: string,
) {
  const taskInstructions = highlightDialogue
    ? [
        'Assign each numbered quoted passage below to its speaker when it is spoken dialogue.',
        'Return one row per quoted passage at most, using quoteId first and speakerId second.',
        'Do not combine, rewrite, or reproduce quoted text. Return only quoteId and speakerId.',
        'Use speakerId 0 for quoted passages that are not spoken dialogue or cannot be assigned confidently.',
      ]
    : ['Return only the speakerId numbers for known characters that appear to speak in the response.'];
  const shared = [
    ...taskInstructions,
    'Use only speakerId values from the known speakers list. If speech cannot be assigned confidently, omit it.',
  ];
  if (format === 'json') {
    return [
      ...shared,
      'Return only valid JSON in this shape:',
      expectedShape,
      highlightDialogue
        ? 'Return {"dialogue":[{"quoteId":1,"speakerId":1}]} only. Do not return speakers; they are inferred from dialogue.'
        : 'Return {"speakers":[1]} only.',
    ].join('\n');
  }
  return [
    ...shared,
    'Return only valid TOON in this shape:',
    expectedShape,
    highlightDialogue
      ? 'Use TOON array length headers such as dialogue[1]{quoteId,speakerId}: only. Do not return speakers; they are inferred from dialogue.'
      : 'Use TOON array length headers such as speakers[1]: 1.',
  ].join('\n');
}

export function buildOutputSpeakerPromptPreview(
  settings: OutputSpeakerPromptSettings | undefined,
  variables: Record<string, string>,
) {
  const normalized = outputSpeakerPromptSettings(settings);
  const template = normalized.mode === 'custom'
    ? normalized.customText ?? ''
    : defaultOutputSpeakerPromptText;
  const parts: PromptPreviewPart[] = [];
  let cursor = 0;
  for (const match of template.matchAll(/<([A-Za-z]+)>/g)) {
    const value = variables[match[1]];
    if (value === undefined) continue;
    parts.push({ text: template.slice(cursor, match.index) });
    parts.push({ text: value, actionInserted: true });
    cursor = match.index + match[0].length;
  }
  parts.push({ text: template.slice(cursor) });
  while (parts.length) {
    parts[0].text = parts[0].text.trimStart();
    if (parts[0].text) break;
    parts.shift();
  }
  while (parts.length) {
    parts[parts.length - 1].text = parts[parts.length - 1].text.trimEnd();
    if (parts[parts.length - 1].text) break;
    parts.pop();
  }
  return { prompt: parts.map((part) => part.text).join(''), parts };
}

function parseJsonObject(text: string) {
  const stripped = stripStructuredResponse(text);
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  const candidates = Array.from(new Set([
    stripped,
    firstBrace >= 0 && lastBrace > firstBrace ? stripped.slice(firstBrace, lastBrace + 1) : '',
  ].filter(Boolean)));
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!isRecord(parsed)) {
        throw new Error('response is not an object');
      }
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The model did not return JSON.');
}

export function parseOutputSpeakerResponse(text: string, preferredFormat: OutputSpeakerResponseFormat) {
  // TOON can interpret a JSON object's first colon as a literal key separator.
  // Try JSON first for object-shaped responses so the fallback retains meaning.
  const parsers = preferredFormat === 'json' || stripStructuredResponse(text).startsWith('{')
    ? [parseJsonObject, parseToonObject]
    : [parseToonObject, parseJsonObject];
  let lastError: unknown;
  for (const parse of parsers) {
    try {
      return parse(text);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('The model did not return a supported speaker analysis format.');
}

export function speakerDataForFormat(format: OutputSpeakerResponseFormat, value: unknown) {
  return format === 'json'
    ? JSON.stringify(value, null, 2)
    : encode(value);
}
