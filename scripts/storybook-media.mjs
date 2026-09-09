#!/usr/bin/env node
import { createHash } from 'node:crypto';
import bundledJsonFiles from '../electron/bundledJsonFiles.cjs';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { bundledJsonFilesByFormat } = bundledJsonFiles;

const dataUrlPattern = /data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/_=-]+)/gi;
const markerPattern = /__RPGRAPH_DATA_URL_REDACTED__sha256:([a-f0-9]{64});mime:([^;]+);bytes:(\d+)__/g;
const defaultStorybookRedactedPath = '/tmp/rpgraph-storybook.redacted.json';
const bundledContentDirectory = 'resources/default-content';

function bundledStorybookFile() {
  const names = bundledJsonFilesByFormat(bundledContentDirectory, 'rpgraph-storybook')
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (names.length === 0) {
    throw new Error(`No Storybook JSON file was found in ${bundledContentDirectory}.`);
  }
  if (names.length > 1) {
    throw new Error(
      `Multiple bundled Storybooks were found (${names.join(', ')}). Pass the intended Storybook path explicitly.`,
    );
  }
  return join(bundledContentDirectory, names[0]);
}

function storybookFileInCurrentDirectory() {
  const names = bundledJsonFilesByFormat('.', 'rpgraph-storybook')
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (names.length === 0) {
    return undefined;
  }
  if (names.length > 1) {
    throw new Error(
      `Multiple Storybooks were found (${names.join(', ')}). Pass the intended Storybook path explicitly.`,
    );
  }
  return names[0];
}

function exportedStorybookFile() {
  return storybookFileInCurrentDirectory() ?? bundledStorybookFile();
}

function usage() {
  return [
    'Usage:',
    '  npm run storybook:redact -- <storybook> [redactedDest]',
    '  npm run storybook:merge -- <redactedStorybook> <originalStorybook> <dest>',
    '',
    'Defaults:',
    `  Storybook source: the sole Storybook JSON in the current directory or ${bundledContentDirectory}`,
    `  redacted copy:   ${defaultStorybookRedactedPath}`,
    '  merge requires the redacted copy, untouched image-bearing original, and destination.',
    '',
    'The redacted copy replaces Base64 Data URLs with hash markers. Edit only that',
    'copy, keep the original available, then merge to restore the original media.',
    'Full guide: docs/storybook-media-editing.md',
  ].join('\n');
}

function dataUrlBytes(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.ceil((base64.length * 3) / 4) - padding);
}

function dataUrlHash(dataUrl) {
  return createHash('sha256').update(dataUrl).digest('hex');
}

function redactionMarker(dataUrl, mimeType, base64) {
  return `__RPGRAPH_DATA_URL_REDACTED__sha256:${dataUrlHash(dataUrl)};mime:${mimeType};bytes:${dataUrlBytes(base64)}__`;
}

function redactText(text, stats) {
  return text.replace(dataUrlPattern, (match, mimeType, base64) => {
    stats.redacted += 1;
    return redactionMarker(match, mimeType, base64);
  });
}

function redactValue(value, stats) {
  if (typeof value === 'string') {
    return redactText(value, stats);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, stats));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, stats),
      ]),
    );
  }
  return value;
}

function collectDataUrlsFromText(text, originals) {
  for (const match of text.matchAll(dataUrlPattern)) {
    originals.set(dataUrlHash(match[0]), match[0]);
  }
}

function collectOriginalDataUrls(value, originals) {
  if (typeof value === 'string') {
    collectDataUrlsFromText(value, originals);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectOriginalDataUrls(entry, originals));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entryValue) => {
      collectOriginalDataUrls(entryValue, originals);
    });
  }
}

function restoreText(text, originals, stats) {
  return text.replace(markerPattern, (marker, hash) => {
    const original = originals.get(hash);
    if (!original) {
      throw new Error(`Cannot restore redacted Data URL marker; original hash not found: ${hash}`);
    }
    stats.restored += 1;
    return original;
  });
}

function restoreValue(value, originals, stats) {
  if (typeof value === 'string') {
    return restoreText(value, originals, stats);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => restoreValue(entry, originals, stats));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        restoreValue(entryValue, originals, stats),
      ]),
    );
  }
  return value;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function validatedStorybook(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== 'rpgraph-storybook') {
    throw new Error(`${label} must be a plain RPGraph Storybook.`);
  }
  return value;
}

async function redactStorybook(sourcePath, destPath) {
  const source = resolve(sourcePath);
  const dest = resolve(destPath);
  const storybook = validatedStorybook(await readJson(source), 'Source file');
  const stats = { redacted: 0 };
  await writeJson(dest, redactValue(storybook, stats));
  console.log(`Redacted ${stats.redacted} Data URL${stats.redacted === 1 ? '' : 's'}: ${dest}`);
}

async function mergeStorybook(redactedPath, originalPath, destPath) {
  const redacted = resolve(redactedPath);
  const original = resolve(originalPath);
  const dest = resolve(destPath);
  const redactedStorybook = validatedStorybook(await readJson(redacted), 'Redacted file');
  const originalStorybook = validatedStorybook(await readJson(original), 'Original file');
  const originals = new Map();
  collectOriginalDataUrls(originalStorybook, originals);
  const stats = { restored: 0 };
  const restoredStorybook = restoreValue(redactedStorybook, originals, stats);
  if (JSON.stringify(restoredStorybook).includes('__RPGRAPH_DATA_URL_REDACTED__')) {
    throw new Error('Cannot merge: one or more redacted Data URL markers remain unresolved.');
  }
  await writeJson(dest, restoredStorybook);
  console.log(`Restored ${stats.restored} Data URL${stats.restored === 1 ? '' : 's'}: ${dest}`);
}

async function main() {
  const [command, first, second, third] = process.argv.slice(2);
  if (command === 'redact') {
    await redactStorybook(first ?? exportedStorybookFile(), second ?? defaultStorybookRedactedPath);
    return;
  }
  if (command === 'merge') {
    if (!first || !second || !third) {
      throw new Error('Merge requires redacted, original, and destination paths.\n\n' + usage());
    }
    await mergeStorybook(first, second, third);
    return;
  }
  console.error(usage());
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
