// checks-disable-file length: the long lines are selectors and trace messages.
// The walks of the layout audit: each lists its surfaces from the app's registries (see app/src/app/auditHooks.ts), so
// a new tool, command, settings section, or setup step is audited the day it is registered.

import type { Page } from '@playwright/test';
import type { Auditor } from './auditor';
import { slug } from './cells';

interface Registries {
  tools: string[];
  commands: { id: string; title: string; palette: boolean }[];
  settingsSections: { id: string }[];
  setupSteps: { id: string }[];
  slashItems: { id: string; command: string }[];
}

type Hooks = Record<string, (...args: unknown[]) => unknown>;

/** Everything that floats above the page or sits beside it. */
export const FLOATING =
  '[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [popover], [data-tool], [data-region=notifications]';

/** Commands that close the window, remove data, or leave the app: the sweep never runs them. */
const SKIP_COMMAND =
  /^(window\.|api\.|updates\.(restart|download|check)|app\.palette|notes\.openFolder)|delete|trash|\.close$|protect\.|history\.|\.remove|\.clear|reset/i;

const hook = <T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([hookName, hookArgs]) => {
      const hooks = (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__;
      return hooks[hookName as string]!(...(hookArgs as unknown[]));
    },
    [name, args] as const,
  ) as Promise<T>;

export const registries = (page: Page) => hook<Registries>(page, 'auditRegistries');

export async function boot(page: Page, open = true): Promise<void> {
  // Under load the first load can stall; one more load settles it.
  for (let attempt = 0; ; attempt += 1) {
    await page.goto('/?fixture=smart');
    try {
      await page.locator('[data-workspace]').waitFor({ timeout: 15_000 });
      break;
    } catch (error) {
      if (attempt >= 1) throw error;
    }
  }
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __OPENNOTE_TEST__?: Hooks }).__OPENNOTE_TEST__?.['auditRegistries']),
  );
  // Feature chunks load after the first paint and register their commands, tools, and tabs.
  await page.waitForLoadState('networkidle');
  if (open) await openPage(page);
}

/** Opens the sampler page (text, a table, code, and display math), through the panes or behind their rails. */
export async function openPage(page: Page): Promise<void> {
  const open = async (tree: string, item: string, rail: string) => {
    const row = page.getByRole('tree', { name: tree }).getByRole('treeitem', { name: item });
    if (!(await row.isVisible())) await page.getByRole('button', { name: rail }).click();
    await row.click();
  };
  await open('Notebooks', 'Lectures', 'Show notebooks');
  await open('Pages', 'Membranes', 'Show pages');
  await page.getByRole('heading', { level: 1, name: 'Membranes' }).waitFor();
}

async function calm(page: Page): Promise<void> {
  await hook(page, 'closeTools');
  for (let i = 0; i < 2; i += 1) await page.keyboard.press('Escape');
}

const textOf = async (tab: ReturnType<Page['locator']>, fallback: string) =>
  slug(((await tab.textContent()) ?? fallback).trim() || fallback);

/** First-run setup: every step, walked with Continue the way a person does (the steps come and go with their flags). */
export async function walkSetup(audit: Auditor, page: Page): Promise<void> {
  await page.evaluate(() => sessionStorage.setItem('audit-first-run', '1'));
  await page.goto('/?fixture=smart');
  const heading = page.getByRole('heading', { level: 1 }).first();
  await heading.waitFor();
  const start = page.getByRole('button', { name: 'Get started' });
  if (await start.isVisible()) await audit.visit('setup.start');
  if (await start.isVisible()) await start.click();
  const seen = new Set<string>();
  for (let step = 0; step < 10; step += 1) {
    await heading.waitFor();
    const current = ((await heading.textContent()) ?? '').trim();
    if (seen.has(current)) break;
    seen.add(current);
    await audit.visit(`setup.${slug(current)}`);
    const next = page.getByRole('button', { name: 'Continue' });
    if (!(await next.isVisible())) break;
    await next.click();
    await page.waitForFunction((was) => document.querySelector('h1')?.textContent?.trim() !== was, current);
  }
  await page.evaluate(() => sessionStorage.removeItem('audit-first-run'));
}

/** Settings: every section. */
export async function walkSettings(audit: Auditor, page: Page): Promise<void> {
  for (const section of (await registries(page)).settingsSections) {
    await hook(page, 'navigate', { view: 'settings', section: section.id });
    await page.locator('h1, h2').first().waitFor();
    // A section's body loads after its heading (a lazy chunk, then its own data), so a capture taken at once shows only
    // the heading. A panel with nothing under its heading is rare, so the wait is short.
    await page
      .locator('main h1 ~ *')
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => undefined);
    await audit.visit(`settings.${section.id}`);
  }
}

/** The workspace: the command bar's tabs, the palette, the menus. */
export async function walkWorkspace(audit: Auditor, page: Page): Promise<void> {
  await audit.visit('workspace.home');
  await openPage(page);
  await audit.visit('workspace');
  const tabs = page.locator('[data-region=commandBar] [role=tab]');
  const count = await tabs.count();
  for (let i = 0; i < count; i += 1) {
    const tab = tabs.nth(i);
    const name = await textOf(tab, `tab${i}`);
    await tab.click();
    await audit.visit(`commandbar.${name}`, '[data-region=commandBar]');
  }
  await tabs.first().click();
  await page.keyboard.press('Control+KeyK');
  await page.getByRole('combobox', { name: 'Search commands and pages' }).waitFor();
  await audit.visit('palette', FLOATING);
  await page.keyboard.type('open');
  await audit.visit('palette.results', FLOATING);
  await calm(page);
  await page.getByRole('treeitem').first().click({ button: 'right' });
  await audit.visit('menu.tree-item', FLOATING);
  await calm(page);
  const body = page.getByRole('textbox', { name: 'Text' }).first();
  if (await body.count()) {
    await body.click({ button: 'right' });
    await audit.visit('menu.page-body', FLOATING);
    await calm(page);
    await body.click();
    await page.keyboard.type('/');
    await audit.visit('menu.slash', FLOATING);
    await page.keyboard.press('Backspace');
    await calm(page);
  }
}

/** A long page, so the page's own scroll bar exists, then every tool window and every tab in it, docked beside it. */
export async function walkTools(audit: Auditor, page: Page): Promise<void> {
  const body = page.getByRole('textbox', { name: 'Text' }).first();
  await body.click();
  for (let i = 0; i < 70; i += 1) {
    await page.keyboard.insertText(`A line of the notes, number ${i + 1}, long enough to be a sentence.`);
    await page.keyboard.press('Enter');
  }
  for (const id of (await registries(page)).tools) {
    await hook(page, 'openTool', id);
    const scope = `[data-tool=${id}]`;
    if (!(await page.locator(scope).count())) continue;
    await page.locator(scope).first().waitFor();
    await audit.visit(`tool.${id}`);
    const tabs = page.locator(`${scope} [role=tablist] [role=tab]`);
    const n = await tabs.count();
    // A narrow window shows a menu in place of the tab strip, so the strip is hidden: step through the menu instead.
    const menu = page.locator(`${scope} select[aria-label]`).first();
    const stripHidden = n > 0 && !(await tabs.first().isVisible());
    if (stripHidden && (await menu.count())) {
      const options = menu.locator('option');
      const count = await options.count();
      for (let i = 0; i < count; i += 1) {
        const name = await textOf(options.nth(i), `tab${i}`);
        await menu.selectOption({ index: i });
        await audit.visit(`tool.${id}.${name}`);
      }
    } else {
      for (let i = 0; i < n; i += 1) {
        const tab = tabs.nth(i);
        const name = await textOf(tab, `tab${i}`);
        await tab.click();
        await audit.visit(`tool.${id}.${name}`);
      }
    }
    if (id === 'reference') {
      const list = page.locator(scope).getByRole('button', { name: 'List', exact: true });
      if (await list.count()) {
        await tabs.first().click();
        await list.click();
        await audit.visit('tool.reference.elements-list');
      }
    }
    await hook(page, 'closeTools');
  }
  await hook(page, 'openTool', 'reference');
  await hook(page, 'openTool', 'calculator');
  await audit.visit('tools.two-docked');
  await calm(page);
}

/** Every command that is safe to run, and what it opens. */
export async function sweepCommands(audit: Auditor, page: Page): Promise<void> {
  const commands = (await registries(page)).commands.filter((one) => !SKIP_COMMAND.test(one.id));
  const signature = () =>
    page.evaluate(
      (selector) =>
        `${document.querySelectorAll(selector).length}:${document.body.children.length}:${Boolean(document.querySelector('[data-workspace]'))}`,
      FLOATING,
    );
  await calm(page);
  const baseline = await signature();
  for (const command of commands) {
    try {
      await hook(page, 'runCommand', command.id);
      await page.waitForTimeout(80);
    } catch {
      continue;
    }
    const now = await signature();
    if (now !== baseline && now.endsWith('true')) await audit.visit(`command.${command.id}`, FLOATING);
    await calm(page);
    if (!(await page.locator('[data-workspace]').count())) await boot(page);
  }
}

/** Every block a page can hold, each on a page of its own. */
export async function walkBlocks(audit: Auditor, page: Page): Promise<void> {
  const reg = await registries(page);
  const inserts = [...new Set(reg.slashItems.map((one) => one.command))].filter((id) => !SKIP_COMMAND.test(id));
  for (const id of inserts) {
    await hook(page, 'runCommand', 'notes.newPage');
    const body = page.getByRole('textbox', { name: 'Text' }).first();
    await body.waitFor();
    try {
      await body.click({ timeout: 5_000 });
      await hook(page, 'runCommand', id);
    } catch {
      continue;
    }
    await audit.visit(`block.${slug(id)}`, '[data-region=page]');
    if (process.env.OPENNOTE_AUDIT_TRACE) console.log('[audit]   visited');
    await calm(page);
    if (process.env.OPENNOTE_AUDIT_TRACE) console.log('[audit]   calm');
    if (!(await page.locator('[data-workspace]').count())) await boot(page);
  }
}
