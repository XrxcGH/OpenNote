// Settings, then Recording: the live captions switch and where captions sit, and the setting that makes a transcript
// and summary of every recording. Both turn transcription on first, and both choices survive a reload in the web
// build, as they do on a computer. No microphone is opened: a stand-in for the shell plays the speech.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openMembranes, sendSpeech, speechSessions, startWith } from '../intel';

async function openRecording(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Recording' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Recording' })).toBeVisible();
}

test('live captions ask for transcription first, and the choice and the position survive a reload', async ({
  page,
}) => {
  await openRecording(page);
  const captions = page.getByRole('switch', { name: 'Show live captions while recording' });
  await expect(captions).toHaveAttribute('aria-checked', 'false');
  await captions.click();
  await page
    .getByRole('dialog', { name: /Turn on/ })
    .getByRole('button', { name: 'Turn on' })
    .click();
  await expect(captions).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Where captions sit').selectOption('top');

  await page.reload();
  await openRecording(page);
  await expect(page.getByRole('switch', { name: 'Show live captions while recording' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByLabel('Where captions sit')).toHaveValue('top');
});

test('a transcript of every recording stays off until chosen, and the choice survives a reload', async ({ page }) => {
  await openRecording(page);
  const every = page.getByRole('switch', { name: 'Make a transcript and summary of every recording' });
  await expect(every).toHaveAttribute('aria-checked', 'false');
  await every.click();
  await page
    .getByRole('dialog', { name: /Turn on/ })
    .getByRole('button', { name: 'Turn on' })
    .click();
  await expect(every).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await openRecording(page);
  await expect(page.getByRole('switch', { name: 'Make a transcript and summary of every recording' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('dictation types what the speech model hears at the cursor, and Escape closes the microphone', async ({
  page,
}) => {
  await startWith(page, []);
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  // A speech model arrives in the web build in a few seconds, and is remembered for the reload below.
  await page.keyboard.press('Control+Comma');
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'On-device intelligence' })
    .click();
  const balanced = page.getByRole('listitem').filter({ hasText: 'Speech, balanced (English)' }).first();
  await balanced.getByRole('button', { name: /^Download Speech, balanced \(English\)/ }).click();
  await page
    .getByRole('dialog', { name: 'Download Speech, balanced (English)?' })
    .getByRole('button', { name: 'Download' })
    .click();
  await expect(balanced.getByText('Downloaded', { exact: true })).toBeVisible({ timeout: 20_000 });

  await openMembranes(page);
  const box = page.getByRole('textbox', { name: 'Text' });
  await box.click();
  await page.keyboard.press('Control+Alt+KeyV');
  // The first press asks to turn transcription on.
  await page
    .getByRole('dialog', { name: /Turn on/ })
    .getByRole('button', { name: 'Turn on' })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /Listening/ })
      .first(),
  ).toBeVisible({ timeout: 10_000 });
  await sendSpeech(page, {
    kind: 'final',
    text: 'cells make energy period new line they divide',
    startMs: 0,
    endMs: 2000,
    behindMs: 0,
  });
  await expect(box).toContainText('Cells make energy.');
  await expect(box).toContainText('they divide');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({ hasText: /Listening/ })).toHaveCount(0);
  expect(await speechSessions(page)).toEqual(['dictation']);
});
