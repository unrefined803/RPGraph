#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const promptFileFormat = 'rpgraph-llm-prompt-switch-prompts';
const promptFileFormatVersion = 1;
const defaultPromptPath = '/tmp/rpgraph-workflow.default.prompts.json';
const maximumEntries = 10;

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

function usage() {
  return [
    'Usage:',
    '  node scripts/workflow-prompts.mjs extract [workflowSource] [promptDest]',
    '  node scripts/workflow-prompts.mjs merge [promptSource] [workflowSource] [workflowDest]',
    '',
    'Defaults:',
    '  workflow source/dest: auto-detected only when exactly one workflow.default*.json exists',
    `  prompt file:          ${defaultPromptPath}`,
  ].join('\n');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function workflowNodes(workflow) {
  const nodes = Array.isArray(workflow?.nodes)
    ? workflow.nodes
    : Array.isArray(workflow?.graph?.nodes)
      ? workflow.graph.nodes
      : undefined;
  if (!nodes) {
    throw new Error('Workflow JSON has no nodes array.');
  }
  return nodes;
}

function promptSwitchNodes(workflow) {
  return workflowNodes(workflow).filter((node) => node?.data?.nodeType === 'llm-prompt-switch');
}

function stringRows(value) {
  return Array.isArray(value)
    ? value.map((row) => Array.isArray(row) ? row.map((entry) => typeof entry === 'string' ? entry : '') : [])
    : [];
}

function extractedSwitch(node) {
  const data = node.data;
  const outputTitles = Array.isArray(data.llmPromptSwitchOutputTitles)
    ? data.llmPromptSwitchOutputTitles
    : [];
  const promptTitles = stringRows(data.llmPromptSwitchPromptTitlesByOutput);
  const promptBefores = stringRows(data.llmPromptSwitchPromptBeforesByOutput);
  const promptAfters = stringRows(data.llmPromptSwitchPromptAftersByOutput);
  return {
    nodeId: node.id,
    nodeLabel: data.label,
    outputs: outputTitles.map((title, outputIndex) => ({
      title,
      prompts: (promptTitles[outputIndex] ?? []).map((promptTitle, promptIndex) => ({
        title: promptTitle,
        before: promptBefores[outputIndex]?.[promptIndex] ?? '',
        after: promptAfters[outputIndex]?.[promptIndex] ?? '',
      })),
    })),
  };
}

function validatedPromptDocument(value) {
  if (
    value?.format !== promptFileFormat ||
    value?.formatVersion !== promptFileFormatVersion ||
    !Array.isArray(value.switches)
  ) {
    throw new Error(`Prompt file must use ${promptFileFormat} version ${promptFileFormatVersion}.`);
  }
  for (const promptSwitch of value.switches) {
    if (typeof promptSwitch?.nodeId !== 'string' || !Array.isArray(promptSwitch.outputs)) {
      throw new Error('Every prompt switch needs nodeId and outputs.');
    }
    if (promptSwitch.outputs.length < 1 || promptSwitch.outputs.length > maximumEntries) {
      throw new Error(`Prompt switch ${promptSwitch.nodeId} needs 1-${maximumEntries} outputs.`);
    }
    for (const output of promptSwitch.outputs) {
      if (typeof output?.title !== 'string' || !Array.isArray(output.prompts)) {
        throw new Error(`Prompt switch ${promptSwitch.nodeId} has an invalid output.`);
      }
      if (output.prompts.length < 1 || output.prompts.length > maximumEntries) {
        throw new Error(`Every output in ${promptSwitch.nodeId} needs 1-${maximumEntries} prompts.`);
      }
      for (const prompt of output.prompts) {
        if (
          typeof prompt?.title !== 'string' ||
          typeof prompt?.before !== 'string' ||
          typeof prompt?.after !== 'string'
        ) {
          throw new Error(`Prompt switch ${promptSwitch.nodeId} has an invalid prompt entry.`);
        }
      }
    }
  }
  return value;
}

async function extractPrompts(workflowPath, promptPath) {
  const workflow = await readJson(resolve(workflowPath));
  const switches = promptSwitchNodes(workflow).map(extractedSwitch);
  if (switches.length === 0) {
    throw new Error('Workflow has no LLM Prompt Switch nodes.');
  }
  const promptCount = switches.reduce(
    (total, promptSwitch) => total + promptSwitch.outputs.reduce(
      (outputTotal, output) => outputTotal + output.prompts.length,
      0,
    ),
    0,
  );
  const destination = resolve(promptPath);
  await writeJson(destination, {
    format: promptFileFormat,
    formatVersion: promptFileFormatVersion,
    sourceFile: workflowPath,
    switches,
  });
  console.log(`Extracted ${promptCount} prompts from ${switches.length} switch node(s): ${destination}`);
}

async function mergePrompts(promptPath, workflowPath, destinationPath) {
  const promptDocument = validatedPromptDocument(await readJson(resolve(promptPath)));
  const workflow = await readJson(resolve(workflowPath));
  const switchesById = new Map(promptSwitchNodes(workflow).map((node) => [node.id, node]));
  for (const extracted of promptDocument.switches) {
    const node = switchesById.get(extracted.nodeId);
    if (!node) {
      throw new Error(`Workflow has no LLM Prompt Switch node with id ${extracted.nodeId}.`);
    }
    node.data.llmPromptSwitchOutputTitles = extracted.outputs.map((output) => output.title);
    node.data.llmPromptSwitchPromptTitlesByOutput = extracted.outputs.map((output) =>
      output.prompts.map((prompt) => prompt.title),
    );
    node.data.llmPromptSwitchPromptBeforesByOutput = extracted.outputs.map((output) =>
      output.prompts.map((prompt) => prompt.before),
    );
    node.data.llmPromptSwitchPromptAftersByOutput = extracted.outputs.map((output) =>
      output.prompts.map((prompt) => prompt.after),
    );
  }
  const destination = resolve(destinationPath);
  await writeJson(destination, workflow);
  console.log(`Merged prompts from ${resolve(promptPath)}: ${destination}`);
}

async function main() {
  const [command, first, second, third] = process.argv.slice(2);
  if (command === 'extract') {
    await extractPrompts(first ?? bundledDefaultWorkflowFile(), second ?? defaultPromptPath);
    return;
  }
  if (command === 'merge') {
    const bundledFile = first && second && third ? undefined : bundledDefaultWorkflowFile();
    await mergePrompts(
      first ?? defaultPromptPath,
      second ?? bundledFile,
      third ?? bundledFile,
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
