// Screen-reader and error states of every catalog subject kit window: a result is announced in a live region after
// an edit, a radio row moves with the arrow keys, and a bad entry shows an error that replaces the previous result.
// The radio-row and invalid-entry checks apply where the kit's default tool has a radio row or a numeric field; the
// others skip with the reason, because their default entries are free text or data lists with no invalid state.
import type { Locator } from '@playwright/test';
import { expect, test } from '../../fixtures';
import { SUBJECT_KITS, openKit } from '../../behavior/kits-subj/kit';

// A kit window loads its engines when it first opens, which is slow on a busy machine.
test.describe.configure({ timeout: 120_000 });

const LIVE = '[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]';
const ENTRY = 'input[type="text"], input[type="number"], input:not([type]), textarea';

/** The first text or number field that is inside a tool (not the window's own controls). */
async function firstEntry(dialog: Locator): Promise<Locator> {
  const field = dialog.locator(ENTRY).filter({ visible: true }).first();
  await expect(field).toBeVisible();
  return field;
}

/** The first field holding a number: a bad entry there is invalid, where a search box or a data list has no bad entry. */
async function firstNumberField(dialog: Locator): Promise<Locator | null> {
  await expect(dialog.locator(ENTRY).filter({ visible: true }).first()).toBeVisible();
  const fields = await dialog.locator(ENTRY).filter({ visible: true }).all();
  for (const field of fields) {
    if (/^-?\d+(\.\d+)?$/.test(await field.inputValue())) return field;
  }
  return null;
}

const liveText = (dialog: Locator) =>
  dialog.locator(LIVE).evaluateAll((els) =>
    els
      .map((e) => e.textContent?.trim() ?? '')
      .join(' ')
      .trim(),
  );

for (const kit of SUBJECT_KITS) {
  test(`${kit.id}: an edit is announced in a live region`, async ({ page }) => {
    const dialog = await openKit(page, kit);
    await expect(dialog.getByRole('combobox').first()).toBeVisible();
    await firstEntry(dialog);
    expect(await dialog.locator(LIVE).count(), 'the window has a live region').toBeGreaterThan(0);
    const field = await firstEntry(dialog);
    const value = await field.inputValue();
    await field.fill(value === '7' ? '8' : '7');
    await expect.poll(() => liveText(dialog), { message: 'a live region says something after the edit' }).not.toBe('');
  });

  test(`${kit.id}: a radio row, where the window has one, moves with the arrow keys`, async ({ page }) => {
    const dialog = await openKit(page, kit);
    await expect(dialog.getByRole('combobox').first()).toBeVisible();
    const radios = dialog.getByRole('radio');
    test.skip((await radios.count()) < 2, 'no radio row in the default view');
    const first = radios.first();
    await first.focus();
    const was = await first.getAttribute('aria-checked');
    await page.keyboard.press('ArrowRight');
    const next = dialog.getByRole('radio').nth(1);
    await expect(next).toBeFocused();
    await expect(next).toBeChecked();
    if (was === 'true') await expect(first).not.toBeChecked();
  });

  test(`${kit.id}: an invalid entry shows an error and clears the previous result`, async ({ page }) => {
    const dialog = await openKit(page, kit);
    await expect(dialog.getByRole('combobox').first()).toBeVisible();
    const field = await firstNumberField(dialog);
    test.skip(field === null, 'the default tool has no numeric field (its entries are free text or data lists)');
    const before = ((await dialog.textContent()) ?? '').replace(/\s+/g, ' ');
    await field!.fill('');
    await field!.fill('#$% not a number ((');
    await expect
      .poll(async () => ((await dialog.textContent()) ?? '').replace(/\s+/g, ' '), { message: 'the result changes' })
      .not.toBe(before);
    // The error is marked on the field or announced: an alert, an invalid field, or a status that says what to fix.
    await expect
      .poll(
        async () =>
          (await dialog.locator('[role="alert"], [aria-invalid="true"]').count()) > 0 ||
          /enter|number|invalid|fix|check|must|cannot|not a|empty|missing|error/i.test(await liveText(dialog)),
        { message: 'an error is shown' },
      )
      .toBe(true);
  });
}
