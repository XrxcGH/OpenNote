// @vitest-environment jsdom
// The test helpers on WP0's stubs: a page opens, typed text reaches the memory service, frames from undo come
// back into the editor, and expectCommand runs a command on a marked selection.
import { afterEach, describe, expect, it } from 'vitest';
import { serializeTextBlock, createMarkdownCache } from '../../../editor/markdown';
import { commands } from '../../../registries';
import { pageCommandDef } from '../keys';
import { shownPool } from '../pool/pool';
import { doc, h, li, md, p, task, ul } from './builders';
import { pageFixtures, textPageFixture } from './fixtures';
import { cleanupPages, expectCommand, renderPage } from './harness';

afterEach(cleanupPages);

describe('builders', () => {
  it('build documents over the text schema', () => {
    const built = doc(h(1)('Title'), ul(li(p('one')), task(true)(p('done'))));
    expect(serializeTextBlock(built, createMarkdownCache())).toBe('# Title\n\n- one\n- [x] done');
  });

  it('read a marked selection out of Markdown', () => {
    const marked = md('a **[b]** c');
    expect(marked.doc.textBetween(marked.anchor, marked.head)).toBe('b');
    const caret = md('- [ ] task []here');
    expect(caret.anchor).toBe(caret.head);
    expect(caret.doc.textBetween(caret.anchor, caret.doc.content.size - 2)).toBe('here');
  });
});

describe('renderPage', () => {
  it('sends typed text to the memory service', async () => {
    const fixture = textPageFixture('Hello');
    const block = fixture.page.blocks[0].id;
    const page = await renderPage({ fixture });
    await page.type(block, ' there');
    expect(page.markdown(block)).toBe('Hello there');
    expect(page.sent().at(-1)?.coalesce).toEqual({ kind: 'typing', target: block });
  });

  it('puts undone text back into the editor', async () => {
    const fixture = textPageFixture('Hello');
    const block = fixture.page.blocks[0].id;
    const page = await renderPage({ fixture });
    await page.type(block, '!');
    await page.mounted.sync.undo();
    expect(page.editRoot(block).textContent).toBe('Hello');
    await page.type(block, '?');
    expect(page.markdown(block)).toBe('Hello?');
  });

  it('opens an empty page with a text box that joins the page when typed in', async () => {
    const empty = { page: { ...textPageFixture('').page, blocks: [] } };
    const page = await renderPage({ fixture: empty });
    const draft =
      page.mounted.pool.active()?.block ??
      page.viewport.world.querySelector<HTMLElement>('[data-block-id]')?.dataset.blockId;
    expect(draft).toBeDefined();
    await page.type(draft!, 'First words');
    expect(page.sent()[0].edits[0]).toMatchObject({
      edit: 'insertBlock',
      block: { type: 'text', data: { markdown: 'First words' } },
    });
  });

  it('renders the sampler, with placeholders for blocks no package renders yet', async () => {
    const page = await renderPage({ fixture: pageFixtures.sampler });
    expect(page.viewport.world.querySelectorAll('[role="textbox"]')).toHaveLength(1);
    expect(page.viewport.world.textContent).toContain('Table');
  });
});

describe('expectCommand', () => {
  it('runs a page command on the marked selection', async () => {
    const stop = commands.register(
      pageCommandDef({
        id: 'format.bold',
        title: 'pageSync.undo',
        category: 'format',
        run: () => void shownPool.get()?.active()?.editor.chain().toggleMark('bold').run(),
      }),
    );
    try {
      await expectCommand('format.bold', 'a [b] c', 'a **b** c');
    } finally {
      stop();
    }
  });
});
