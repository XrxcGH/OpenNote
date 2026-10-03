// Composition in a real Chromium, driven through the DevTools Protocol as an input method drives WebView2
// (ARCHITECTURE.md section 10.4): nothing goes to the page service while a word is composed, and the committed
// text goes as one typing batch.
import { afterEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import { textPageFixture } from '../test/fixtures';
import { cleanupPages, renderPage } from '../test/harness';

afterEach(cleanupPages);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('input method composition', () => {
  it('sends nothing while composing, then the committed text as one typing batch', async () => {
    const fixture = textPageFixture('Hello');
    const block = fixture.page.blocks[0].id;
    const page = await renderPage({ fixture });
    const editor = page.mounted.pool.mount(block, { kind: 'end' }, 'target')!;
    editor.commands.focus('end');
    const session = cdp();
    for (const text of ['n', 'に', 'にh', 'にほ', 'にほn', 'にほん']) {
      await session.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      await wait(120);
    }
    await wait(400);
    expect(page.sent()).toEqual([]);
    await session.send('Input.insertText', { text: '日本' });
    await expect.poll(() => page.sent().length, { timeout: 2000 }).toBe(1);
    expect(page.sent()[0].coalesce).toEqual({ kind: 'typing', target: block });
    expect(page.markdown(block)).toBe('Hello日本');
  });
});
