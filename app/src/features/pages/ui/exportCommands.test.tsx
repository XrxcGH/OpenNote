// The Markdown export asks whether to keep formatting Markdown cannot hold, and only when the page has some. The test
// answers the real dialog.
import { describe, expect, it } from 'vitest';
import { pageOf, textBlock } from '../testing/build';
import type { PageSource } from '../host/source';
import { markdownFormatting } from './exportCommands';

const source = (markdown: string): PageSource => ({
  pageId: 'p',
  title: 'T',
  notebook: '',
  section: '',
  page: pageOf([textBlock(markdown)]),
  assetUrls: {},
});

const styled = 'a <span data-font="Georgia">b</span>';

async function press(label: string): Promise<void> {
  const button = await waitFor(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label),
  );
  button.click();
}

async function waitFor<T>(find: () => T | undefined): Promise<T> {
  for (let i = 0; i < 200; i += 1) {
    const found = find();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The dialog did not open.');
}

/** Waits until the dialog has left the page, so the next test finds only its own. */
async function gone(): Promise<void> {
  await waitFor(() => (document.body.textContent?.includes('Keep the formatting?') ? undefined : true));
}

describe('markdownFormatting', () => {
  it('does not ask when the page has nothing Markdown cannot hold', async () => {
    expect(await markdownFormatting(source('plain **bold** words'))).toBe('keep');
    expect(document.body.textContent).not.toContain('Keep the formatting?');
  });

  it('asks when the page has a font, and removes the formatting on Remove formatting', async () => {
    const answer = markdownFormatting(source(styled));
    await press('Remove formatting');
    expect(await answer).toBe('remove');
    await gone();
  });

  it('keeps the formatting on Keep as HTML', async () => {
    const answer = markdownFormatting(source(styled));
    await press('Keep as HTML');
    expect(await answer).toBe('keep');
    await gone();
  });
});
