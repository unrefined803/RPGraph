#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const dataUrlPattern = /data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/_=-]+)/gi;
const markerPattern = /__RPGRAPH_DATA_URL_REDACTED__sha256:([a-f0-9]{64});mime:([^;]+);bytes:(\d+)__/g;
const defaultRedactedPath = '/tmp/rpgraph-workflow.default.redacted.json';
const defaultStorybookRedactedPath = '/tmp/rpgraph-storybook.redacted.json';

function highestMatchingFile(pattern, description) {
  const names = readdirSync('.')
    .filter((name) => pattern.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (names.length === 0) {
    throw new Error(`No ${description} file was found in the current directory.`);
  }
  return names[names.length - 1];
}

function bundledDefaultWorkflowFile() {
  const names = readdirSync('.')
    .filter((name) => /^workflow\.default.*\.json$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (names.length === 0) {
    throw new Error('No workflow.default*.json file was found in the current directory.');
  }
  if (names.length > 1) {
    throw new Error(
      `Multiple bundled workflows were found (${names.join(', ')}). Pass the intended workflow path explicitly.`,
    );
  }
  return names[0];
}

function exportedStorybookFile() {
  return highestMatchingFile(/\.rpgraph-storybook\.json$/i, '*.rpgraph-storybook.json');
}

function usage() {
  return [
    'Usage:',
    '  node scripts/workflow-redact.mjs redact [source] [redactedDest]',
    '  node scripts/workflow-redact.mjs merge [redactedSource] [originalSource] [dest]',
    '  node scripts/workflow-redact.mjs redact-storybook [source] [redactedDest]',
    '  node scripts/workflow-redact.mjs merge-storybook [redactedSource] [originalSource] [dest]',
    '',
    'Defaults:',
    '  redact source: explicit path required when multiple workflow.default*.json files exist',
    `  redact dest:   ${defaultRedactedPath}`,
    `  merge redacted:${defaultRedactedPath}`,
    '  merge original:explicit path required when multiple bundled workflows exist',
    '  merge dest:    explicit path required when multiple bundled workflows exist',
    '  storybook variants: *.rpgraph-storybook.json (auto-detected, highest',
    `  natural-sort name wins) and ${defaultStorybookRedactedPath}`,
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

function parseJsonString(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function redactText(text, stats) {
  return text.replace(dataUrlPattern, (match, mimeType, base64) => {
    stats.redacted += 1;
    return redactionMarker(match, mimeType, base64);
  });
}

function redactValue(value, stats, key = '') {
  if (typeof value === 'string') {
    if (key === 'storybookJson') {
      const parsed = parseJsonString(value);
      if (parsed !== undefined) {
        return JSON.stringify(redactValue(parsed, stats), null, 2);
      }
    }
    return redactText(value, stats);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, stats));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, stats, entryKey),
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

function collectOriginalDataUrls(value, originals, key = '') {
  if (typeof value === 'string') {
    if (key === 'storybookJson') {
      const parsed = parseJsonString(value);
      if (parsed !== undefined) {
        collectOriginalDataUrls(parsed, originals);
        return;
      }
    }
    collectDataUrlsFromText(value, originals);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectOriginalDataUrls(entry, originals));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([entryKey, entryValue]) => {
      collectOriginalDataUrls(entryValue, originals, entryKey);
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

function restoreValue(value, originals, stats, key = '') {
  if (typeof value === 'string') {
    if (key === 'storybookJson') {
      const parsed = parseJsonString(value);
      if (parsed !== undefined) {
        return JSON.stringify(restoreValue(parsed, originals, stats), null, 2);
      }
      if (value.includes('__RPGRAPH_DATA_URL_REDACTED__')) {
        throw new Error('Cannot merge: node.data.storybookJson is not valid JSON.');
      }
    }
    return restoreText(value, originals, stats);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => restoreValue(entry, originals, stats));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        restoreValue(entryValue, originals, stats, entryKey),
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

async function redactWorkflow(sourcePath, destPath) {
  const source = resolve(sourcePath);
  const dest = resolve(destPath);
  const workflow = await readJson(source);
  const stats = { redacted: 0 };
  await writeJson(dest, redactValue(workflow, stats));
  console.log(`Redacted ${stats.redacted} Data URL${stats.redacted === 1 ? '' : 's'}: ${dest}`);
}

async function mergeWorkflow(redactedPath, originalPath, destPath) {
  const redacted = resolve(redactedPath);
  const original = resolve(originalPath);
  const dest = resolve(destPath);
  const redactedWorkflow = await readJson(redacted);
  const originalWorkflow = await readJson(original);
  const originals = new Map();
  collectOriginalDataUrls(originalWorkflow, originals);
  const stats = { restored: 0 };
  await writeJson(dest, restoreValue(redactedWorkflow, originals, stats));
  console.log(`Restored ${stats.restored} Data URL${stats.restored === 1 ? '' : 's'}: ${dest}`);
}

async function main() {
  const [command, first, second, third] = process.argv.slice(2);
  if (command === 'redact') {
    await redactWorkflow(first ?? bundledDefaultWorkflowFile(), second ?? defaultRedactedPath);
    return;
  }
  if (command === 'merge') {
    const bundledFile = first && second && third ? undefined : bundledDefaultWorkflowFile();
    await mergeWorkflow(
      first ?? defaultRedactedPath,
      second ?? bundledFile,
      third ?? bundledFile,
    );
    return;
  }
  if (command === 'redact-storybook') {
    await redactWorkflow(first ?? exportedStorybookFile(), second ?? defaultStorybookRedactedPath);
    return;
  }
  if (command === 'merge-storybook') {
    const storybookFile = first && second && third ? undefined : exportedStorybookFile();
    await mergeWorkflow(
      first ?? defaultStorybookRedactedPath,
      second ?? storybookFile,
      third ?? storybookFile,
    );
    return;
  }
  console.error(usage());
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
