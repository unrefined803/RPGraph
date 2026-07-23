import { test, expect, type Locator, type Page } from '@playwright/test';
import { launchAppWithWorkflow, cleanup, llmPromptOverrideWorkflow, type LaunchedApp } from './helpers';

let app: LaunchedApp | undefined;

test.afterEach(async () => {
  await cleanup(app);
  app = undefined;
});

function nodeWrapper(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

function llmCard(page: Page): Locator {
  return nodeWrapper(page, 'llm-under-test').locator('.workflow-node.llm-prompt-node');
}

test('LLM Prompt node exposes both prompt-override input ports', async () => {
  app = await launchAppWithWorkflow(llmPromptOverrideWorkflow());
  const card = llmCard(app.page);

  await expect(card).toBeVisible();
  await expect(card).toContainText('Prompt Before Override');
  await expect(card).toContainText('Prompt After Override');
  // Text Input + Image Input + the two new override rows = 4 input ports.
  await expect(card.locator('.workflow-port-input')).toHaveCount(4);
});

test('no override connection leaves both fields in their authored state', async () => {
  app = await launchAppWithWorkflow(llmPromptOverrideWorkflow());
  const card = llmCard(app.page);

  await expect(card).toBeVisible();
  await expect(card.locator('.llm-prompt-override-badge')).toHaveCount(0);
  await expect(card.locator('.llm-prompt-field-overridden')).toHaveCount(0);
});

test('connecting prompt-before overrides only that field and preserves the authored text', async () => {
  app = await launchAppWithWorkflow(llmPromptOverrideWorkflow({ before: true }));
  const card = llmCard(app.page);
  const fields = card.locator('.llm-prompt-field');
  const beforeField = fields.nth(0);
  const afterField = fields.nth(1);

  await expect(beforeField).toHaveClass(/llm-prompt-field-overridden/);
  await expect(beforeField.locator('.llm-prompt-override-badge')).toHaveText('Overridden by connection');

  // Per-field independence: the un-connected "after" field is unaffected.
  await expect(afterField).not.toHaveClass(/llm-prompt-field-overridden/);
  await expect(afterField.locator('.llm-prompt-override-badge')).toHaveCount(0);

  // Bypass, not clear: both authored values remain in their textareas.
  await expect(app.page.locator('#llm-under-test-before')).toHaveValue('AUTHORED BEFORE TEXT');
  await expect(app.page.locator('#llm-under-test-after')).toHaveValue('AUTHORED AFTER TEXT');
});

test('connecting prompt-after overrides only that field and preserves the authored text', async () => {
  app = await launchAppWithWorkflow(llmPromptOverrideWorkflow({ after: true }));
  const card = llmCard(app.page);
  const fields = card.locator('.llm-prompt-field');
  const beforeField = fields.nth(0);
  const afterField = fields.nth(1);

  await expect(afterField).toHaveClass(/llm-prompt-field-overridden/);
  await expect(afterField.locator('.llm-prompt-override-badge')).toHaveText('Overridden by connection');

  await expect(beforeField).not.toHaveClass(/llm-prompt-field-overridden/);
  await expect(beforeField.locator('.llm-prompt-override-badge')).toHaveCount(0);

  await expect(app.page.locator('#llm-under-test-before')).toHaveValue('AUTHORED BEFORE TEXT');
  await expect(app.page.locator('#llm-under-test-after')).toHaveValue('AUTHORED AFTER TEXT');
});
