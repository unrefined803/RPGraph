import { test, expect, type Locator, type Page } from '@playwright/test';
import { currentCoreNodeVersions } from '../src/nodes/nodeVersion';
import {
  launchAppWithWorkflow,
  cleanup,
  outdatedLlmWorkflow,
  singletonConflictWorkflow,
  type LaunchedApp,
} from './helpers';

const LLM_CURRENT = currentCoreNodeVersions['llm-prompt']; // '1.2.0'

let app: LaunchedApp | undefined;

test.afterEach(async () => {
  await cleanup(app);
  app = undefined;
});

function nodeWrapper(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'element should have a bounding box').not.toBeNull();
  return box!;
}

test('renders the outdated node as an incompatible card with an Upgrade button', async () => {
  app = await launchAppWithWorkflow(outdatedLlmWorkflow());
  const { page } = app;

  const wrapper = nodeWrapper(page, 'outdated-llm-prompt-1');
  const card = wrapper.locator('.workflow-node.incompatible-core-node');
  await expect(card).toBeVisible();

  // Node type / stored version / required version are surfaced on the card.
  await expect(card).toContainText('llm-prompt');
  await expect(card).toContainText('0.9.0');
  await expect(card).toContainText(LLM_CURRENT);

  await expect(card.getByRole('button', { name: 'Upgrade Node' })).toBeEnabled();
});

test('incompatible node has no oversized invisible drag region (size fix)', async () => {
  app = await launchAppWithWorkflow(outdatedLlmWorkflow());
  const { page } = app;

  const wrapper = nodeWrapper(page, 'outdated-llm-prompt-1');
  const card = wrapper.locator('.workflow-node.incompatible-core-node');
  await expect(card).toBeVisible();

  // The saved 900x1200 dimensions were stripped at hydration, so React Flow writes no
  // inline width/height on the wrapper (it re-measures to the card).
  const inline = await wrapper.evaluate((el) => ({
    width: (el as HTMLElement).style.width,
    height: (el as HTMLElement).style.height,
  }));
  expect(inline.width).toBe('');
  expect(inline.height).toBe('');

  // The wrapper hugs the small card (~300px min-width), not the old 900px — so there is
  // no large empty-but-draggable area. (.node-version-scope is display:contents.)
  const wrapperBox = await boxOf(wrapper);
  const cardBox = await boxOf(card);
  expect(wrapperBox.width).toBeLessThan(400);
  expect(Math.abs(wrapperBox.width - cardBox.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(wrapperBox.height - cardBox.height)).toBeLessThanOrEqual(2);
});

test('clicking Upgrade Node replaces the incompatible node with a live one', async () => {
  app = await launchAppWithWorkflow(outdatedLlmWorkflow());
  const { page } = app;

  const wrapper = nodeWrapper(page, 'outdated-llm-prompt-1');
  await expect(wrapper.locator('.incompatible-core-node')).toBeVisible();

  await wrapper.getByRole('button', { name: 'Upgrade Node' }).click();

  // Assert the toast first (it auto-clears after ~4.2s). Substring — the full message
  // contains an em dash.
  await expect(page.locator('.graph-system-toast.info')).toContainText(
    `Upgraded llm-prompt to v${LLM_CURRENT}`,
  );

  // Same node id, now a live node: incompatible styling gone, real ports present.
  await expect(wrapper.locator('.incompatible-core-node')).toHaveCount(0);
  await expect(wrapper.locator('.workflow-node')).toBeVisible();
  expect(await wrapper.locator('.react-flow__handle').count()).toBeGreaterThan(0);
});

test('upgrade is blocked when a live singleton of the same type exists', async () => {
  app = await launchAppWithWorkflow(singletonConflictWorkflow());
  const { page } = app;

  const wrapper = nodeWrapper(page, 'outdated-input-1');
  await expect(wrapper.locator('.incompatible-core-node')).toBeVisible();

  await wrapper.getByRole('button', { name: 'Upgrade Node' }).click();

  await expect(page.locator('.graph-system-toast.warning')).toContainText('Cannot upgrade');
  // The node is untouched — still incompatible.
  await expect(wrapper.locator('.incompatible-core-node')).toBeVisible();
});

test('the incompatible node can still be dragged (no drag regression)', async () => {
  app = await launchAppWithWorkflow(outdatedLlmWorkflow());
  const { page } = app;

  const wrapper = nodeWrapper(page, 'outdated-llm-prompt-1');
  const title = wrapper.locator('.node-title-row');
  await expect(title).toBeVisible();

  const before = await boxOf(wrapper);
  const grab = await boxOf(title);
  const startX = grab.x + grab.width / 2;
  const startY = grab.y + grab.height / 2;

  // Drag by the title row (not the nodrag Upgrade button) by a clear +200,+160 delta.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 100, startY + 80, { steps: 10 });
  await page.mouse.move(startX + 200, startY + 160, { steps: 10 });
  await page.mouse.up();

  const after = await boxOf(wrapper);
  expect(after.x - before.x).toBeGreaterThan(120);
  expect(after.y - before.y).toBeGreaterThan(90);
});
