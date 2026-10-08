// The Markdown source view in the browser: an edit made there reaches the page's file and the text on screen.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import { sourceState } from '../qol/stores';
import { closeSource, openSource } from './controller';

const TEXT = '01k6f0000000000000000t0001';

afterEach(async () => {
  sourceState.set(null);
  await cleanupPages();
});

describe('the Markdown source view', () => {
  it('applies an edit on the way back, and the text box shows it', async () => {
    const page = await renderPage({
      fixture: textPageFixture('First line.'),
      flags: { 'page.markdownSource': true },
    });
    await page.type(TEXT, ' Typed.');
    await openSource(page.mounted);
    const opened = sourceState.get();
    expect(opened?.text).toContain('First line. Typed.');
    sourceState.set({ text: `${opened?.text ?? ''}\n\nCLEAN-EDIT`, caret: 0 });
    await closeSource(page.mounted);
    await page.mounted.sync.flushAll('command');
    expect(page.markdown(TEXT)).toBe('First line. Typed.\n\nCLEAN-EDIT');
    await expect.poll(() => page.editRoot(TEXT).textContent).toContain('CLEAN-EDIT');
    // Typing again goes on from the new text, in the same block.
    await page.type(TEXT, ' More');
    expect(page.markdown(TEXT)).toBe('First line. Typed.\n\nCLEAN-EDIT More');
  });
});
