// The tutor (ADR 0050) with no model: select worked lines, ask for a hint from the text menu, turn the tutor on, and
// climb the four rungs in the Tutor panel. The corrected line shows only at the last rung, and the full solution
// only after a confirmation. Explain this step on a Check my work mark explains the slip without the fix.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { newLine, openSmart } from './smart';

async function typeWorking(page: Page): Promise<void> {
  await openSmart(page);
  await newLine(page);
  for (const [i, line] of ['2x + 3 = 7', '2x = 10', 'x = 5'].entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+Home');
}

async function textMenu(page: Page, item: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await box
    .locator('p')
    .filter({ hasText: /^2x = 10$/ })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: item }).click();
}

async function turnOn(page: Page): Promise<void> {
  const ask = page.getByRole('dialog', { name: 'Turn on the tutor?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Turn on' }).click();
}

test('climbs the hint ladder without giving the answer away, then shows the solution', async ({ page }) => {
  await typeWorking(page);
  await textMenu(page, 'Give me a hint');
  await turnOn(page);

  const panel = page.locator('[data-tutor-panel]');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'What the tutor sees' })).toHaveValue('2x + 3 = 7\n2x = 10\nx = 5');
  const log = panel.getByRole('log', { name: 'Conversation with the tutor' });
  await expect(log).toContainText('Hint 1 of 4: Where to look');
  await expect(log).toContainText('Look at line 2. Compare it with line 1');
  await expect(log).toContainText('Built-in hints, on this device.');

  const next = panel.getByRole('button', { name: 'Next hint' });
  await next.click();
  await expect(log).toContainText('Hint 2 of 4: The idea');
  await next.click();
  await expect(log).toContainText('Hint 3 of 4: A question to try');
  // Before the last rung, neither the corrected line nor the answer has been shown.
  await expect(log).not.toContainText('2x = 4');
  await expect(log).not.toContainText('x = 2');
  await next.click();
  await expect(log).toContainText('Hint 4 of 4: The next step');
  await expect(log).toContainText('That step could be: 2x = 4');
  await next.click();
  await expect(log).toContainText('That was the last hint.');

  await panel.getByRole('button', { name: 'Show the full solution' }).click();
  const confirm = page.getByRole('dialog', { name: 'Show the full solution?' });
  await confirm.getByRole('button', { name: 'Show it' }).click();
  await expect(log).toContainText('Here is the full solution:');
  await expect(log.locator('li').last()).toContainText('x = 2');

  // Escape closes the panel and forgets the session.
  await panel.getByRole('button', { name: 'Show the full solution' }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('explains a step Check my work flagged, without the corrected line', async ({ page }) => {
  await typeWorking(page);
  await textMenu(page, 'Check my work');
  const card = page.getByRole('region', { name: 'Check my work' });
  await card.getByRole('button', { name: 'Explain this step: Line 2' }).click();
  await turnOn(page);

  const log = page.locator('[data-tutor-panel]').getByRole('log', { name: 'Conversation with the tutor' });
  await expect(log).toContainText('Line 2 does not follow from line 1.');
  await expect(log).not.toContainText('2x = 4');
});

// Built from pieces, so the source holds nothing shaped like a key. The web build's fake shell keeps it in memory.
const TEST_KEY = ['test', 'only', '0123456789', 'abcdef'].join('-');

test('asks before text goes to the cloud key, keeps it local on a no, and asks again for a question', async ({
  page,
}) => {
  await openSmart(page);
  await page.keyboard.press('Control+Comma');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Editing' }).click();
  await page.getByRole('switch', { name: 'Tutor' }).click();
  await page.getByRole('radio', { name: /With my own key/ }).check();
  await page.getByRole('textbox', { name: 'Key for the tutor' }).fill(TEST_KEY);
  await page.getByRole('button', { name: 'Save key' }).click();
  await page
    .getByRole('dialog', { name: 'Send this to a cloud service?' })
    .getByRole('button', { name: 'Save key and use it' })
    .click();
  await expect(page.getByRole('button', { name: /Forget/ })).toBeVisible();

  await page.keyboard.press('Control+KeyK');
  await page.getByRole('combobox', { name: 'Search commands and pages' }).fill('Open the tutor');
  await page
    .getByRole('option', { name: /^Open the tutor/ })
    .first()
    .click();
  const panel = page.locator('[data-tutor-panel]');
  await panel.getByRole('textbox', { name: 'What the tutor sees' }).fill('2x + 3 = 7\n2x = 10\nx = 5');
  await panel.getByRole('button', { name: 'Give me a hint' }).click();

  // The card names the host, shows the exact text, and takes the keyboard focus.
  const card = panel.locator('[data-tutor-consent]');
  await expect(card).toBeFocused();
  await expect(card.getByRole('heading')).toContainText(/^Send this to \S+\?$/);
  await expect(card.getByLabel('Text to send')).toContainText('2x + 3 = 7');
  await card.getByRole('button', { name: 'Keep it on this device' }).click();
  await expect(card).toHaveCount(0);
  const log = panel.getByRole('log', { name: 'Conversation with the tutor' });
  await expect(log).toContainText('Look at line 2. Compare it with line 1');
  await expect(log).toContainText('Built-in hints, on this device.');
  await expect(log).not.toContainText('Written with your key');

  // A typed question is new text: the card shows again, with the question in it.
  const question = 'Why did the 3 change sides?';
  await panel.getByRole('textbox', { name: 'Ask the tutor' }).fill(question);
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByLabel('Text to send')).toContainText(question);
  await card.getByRole('button', { name: 'Send this' }).click();
  await expect(log).toContainText(question);
  await expect(log).toContainText('Look again at the line the hint points to.');
  await expect(log).toContainText(/Written with your key by \S+\./);
});

test('asks guiding questions about words, and keeps the solution until the student tries', async ({ page }) => {
  await openSmart(page);
  await page.keyboard.press('Control+KeyK');
  await page.getByRole('combobox', { name: 'Search commands and pages' }).fill('Open the tutor');
  await page
    .getByRole('option', { name: /^Open the tutor/ })
    .first()
    .click();
  await turnOn(page);

  const panel = page.locator('[data-tutor-panel]');
  await panel.getByRole('textbox', { name: 'What the tutor sees' }).fill('Why did the Roman Empire fall?');
  await panel.getByRole('button', { name: 'Show the full solution' }).click();
  const log = panel.getByRole('log', { name: 'Conversation with the tutor' });
  await expect(log).toContainText('Try a hint or a step first.');
  await panel.getByRole('button', { name: 'Give me a hint' }).click();
  await expect(log).toContainText('Find the key words in the question.');
  await panel.getByRole('button', { name: 'Close the tutor' }).click();
  await expect(panel).toHaveCount(0);
});
