// Every catalog subject kit window passes axe (WCAG 2.2 AA and best practices) in light and dark. Each also works
// from the keyboard. Tab reaches the window's controls in order. Arrow keys, Home, and End move through a tab strip.
// A Topic or Tool list changes with the arrow keys. Escape closes the window.
import { expect, test } from '../../fixtures';
import { expectNoAxeViolations } from '../../axe';
import { SUBJECT_KITS, openKit } from '../../behavior/kits-subj/kit';

// A kit window loads its engines when it first opens, which is slow on a busy machine.
test.describe.configure({ timeout: 90_000 });

for (const kit of SUBJECT_KITS) {
  test(`${kit.id}: the window has no axe violations in light and dark`, async ({ page }) => {
    const dialog = await openKit(page, kit);
    await expect(dialog.locator('table, [role="img"], p').first()).toBeVisible();
    await expectNoAxeViolations(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectNoAxeViolations(page);
  });

  test(`${kit.id}: the keyboard reaches the controls, moves between tools, and Escape closes the window`, async ({
    page,
  }) => {
    const dialog = await openKit(page, kit);
    // The tool's controls load after the frame does.
    await expect(dialog.getByRole('combobox').first()).toBeVisible();
    // Tab walks forward through the window's first controls (Keep on top, Close, the tool picker), each with a name.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const dialogs = [...document.querySelectorAll('[role="dialog"]')];
        const labels =
          el && 'labels' in el ? [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent) : [];
        const by = (el?.getAttribute('aria-labelledby') ?? '')
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent);
        const name = [el?.getAttribute('aria-label'), el?.getAttribute('title'), ...labels, ...by, el?.textContent]
          .join('')
          .trim();
        return {
          inside: Boolean(el && dialogs.some((d) => d.contains(el))),
          named: name.length > 0,
          what: `${el?.tagName} ${el?.getAttribute('role') ?? ''} ${el?.className ?? ''}`,
        };
      });
      expect(stop.inside, `Tab stop ${i + 1} (${stop.what}) is inside the window`).toBe(true);
      expect(stop.named, `Tab stop ${i + 1} (${stop.what}) has a name`).toBe(true);
    }

    if (kit.tabs) {
      const tabs = dialog.getByRole('tablist').first().getByRole('tab');
      const count = await tabs.count();
      expect(count).toBeGreaterThan(2);
      await tabs.first().focus();
      // Roving focus: only the selected tab is in the Tab order.
      await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.first()).toHaveAttribute('tabindex', '0');
      await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1');
      await page.keyboard.press('ArrowRight');
      await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.nth(1)).toBeFocused();
      await page.keyboard.press('End');
      await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.last()).toBeFocused();
      await page.keyboard.press('Home');
      await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ArrowLeft');
      await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    } else {
      // These windows pick the tool from a list; a closed list changes with the arrow keys.
      const list = dialog.getByRole('combobox').first();
      const before = await list.inputValue();
      await list.focus();
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => list.inputValue()).not.toBe(before);
      await page.keyboard.press('ArrowUp');
      await expect.poll(() => list.inputValue()).toBe(before);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}
