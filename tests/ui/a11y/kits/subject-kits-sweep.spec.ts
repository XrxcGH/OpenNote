// Every tab and every topic or tool option of every catalog subject kit passes axe, at three window widths. The
// default-view check in subject-kits.spec.ts misses what only another tab or a narrower window shows (a table that
// overflows, a duplicate landmark name, an empty header cell). Findings from all views are listed together.
// Subject foundations (features/tools/subjects) has no window of its own: its figure block and field parts render inside
// these twelve kits, so the sweep covers them through the kits that use them.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures';
import { axeViolations } from '../../axe';
import { SUBJECT_KITS, openKit } from '../../behavior/kits-subj/kit';

// Each kit opens once per width and then visits every view, which is slow on a busy machine.
test.describe.configure({ timeout: 600_000 });

const WIDTHS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
];

/** Selects each option of the window's first list in turn and runs axe on every one. */
async function sweepOptions(page: Page, dialog: Locator, where: string, found: string[]) {
  const list = dialog.getByRole('combobox').first();
  if ((await list.count()) === 0) return;
  const tag = await list.evaluate((el) => el.tagName);
  if (tag !== 'SELECT') return;
  const count = await list.locator('option').count();
  for (let i = 0; i < count; i++) {
    const value = await list.locator('option').nth(i).getAttribute('value');
    await list.selectOption({ index: i });
    // The tool redraws for the new topic.
    await page.waitForTimeout(150);
    for (const v of await axeViolations(page)) found.push(`${where} / option ${value}: ${v}`);
  }
}

for (const size of WIDTHS) {
  for (const kit of SUBJECT_KITS) {
    test(`${kit.id}: every tab and topic passes axe at ${size.width} wide`, async ({ page }) => {
      await page.setViewportSize(size);
      const dialog = await openKit(page, kit);
      await expect(dialog.getByRole('combobox').first()).toBeVisible();
      const found: string[] = [];
      if (kit.tabs) {
        const tabs = dialog.getByRole('tablist').first().getByRole('tab');
        const count = await tabs.count();
        for (let i = 0; i < count; i++) {
          const tab = tabs.nth(i);
          const name = (await tab.textContent())?.trim() ?? String(i);
          await tab.click();
          await expect(tab).toHaveAttribute('aria-selected', 'true');
          await expect(dialog.getByRole('tabpanel').first()).toBeVisible();
          for (const v of await axeViolations(page)) found.push(`tab ${name}: ${v}`);
          await sweepOptions(page, dialog.getByRole('tabpanel').first(), `tab ${name}`, found);
        }
      } else {
        for (const v of await axeViolations(page)) found.push(`default: ${v}`);
        await sweepOptions(page, dialog, 'window', found);
      }
      expect(found).toEqual([]);
    });
  }
}
